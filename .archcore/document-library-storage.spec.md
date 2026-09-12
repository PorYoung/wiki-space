---
title: 文档库存储后端与存储源连接配置技术契约
status: draft
tags:
  - domain:storage
  - domain:document-library
  - contract
---

## Purpose

将 ADR `remove-source-concept` 落地为可实现、可验收的技术契约：删除 `sources` 层后，文档库（`projects`）自身持有存储后端描述，「存储源」仅指用户级可复用连接配置（`storage_connections` 的泛化）。本文规定数据库表结构、共享类型、HTTP 接口与 worker 消息的契约面，供迁移计划逐阶段实现与验收。

## Scope and Authority

- 权威范围：`@ewiki/packages/db` 的 Drizzle schema 与迁移 SQL、`@ewiki/packages/shared` 的 zod 类型、`@ewiki/apps/server` 的 HTTP 路由与保存副作用、`@ewiki/apps/worker` 的同步作业。
- 不在范围内：`web`/`database` 两类后端（连同枚举值删除，不提供兼容）；定时同步的调度执行；开放推送（open push）API；发布站点（`publish_sites`）链路。
- 与 ADR 冲突时以 ADR 为准；本契约对 ADR 的唯一事实性收紧是：`push_tokens` 表与 `/open/sources/:id/push` 在代码中不存在任何消费者与路由（全仓 grep `push_tokens` 仅命中 schema 定义，`@ewiki/apps/server/src/http/routes.ts` L217 的 open 白名单下仅注册 `site-check`），因此契约规定直接删表而非迁移失效令牌。

## Subject

两个实体：

1. **存储后端**：文档库的 1:1 内嵌属性，取值仅 `git` 或 `local`，生命周期从属于文档库，无独立 CRUD。
2. **存储源（连接配置）**：用户级实体 `storage_connections`，持有远端主机地址与加密凭据，可被同一用户的多个 Git 文档库引用；物理表名在本次迁移中保持不变。

## Contract Surface

### 数据库（`@ewiki/packages/db/src/schema.ts`）

`projects` 表新增列（当前该表零存储字段，见 L53–L67）：

```text
storage_kind         text        NOT NULL DEFAULT 'local'
                               CHECK (storage_kind IN ('git','local'))
storage_connection_id uuid       NULL REFERENCES storage_connections(id)
storage_config       jsonb       NOT NULL DEFAULT '{}'
default_branch       text        NULL
auto_sync            boolean     NOT NULL DEFAULT false
interval_seconds     integer     NOT NULL DEFAULT 0
storage_status       text        NOT NULL DEFAULT 'connected'
                               CHECK (storage_status IN ('connected','synced','syncing','error'))
last_synced_at       timestamptz NULL
last_error           text        NULL
```

- `storage_config`（git 后端）：`{ url, host, kind, namespace, repoName, autoCommit, path? }`，字段名与现行 `sources.config_public` 的写入形状一致（`@ewiki/apps/server/src/http/routes.ts` L340–L438、`@ewiki/apps/server/src/http/routes-platform.ts` L572–L593）。
- `storage_config`（local 后端）：`{ path? }`；worker 现从 `configPublic.path` 读取本地目录（`@ewiki/apps/worker/src/index.ts` L262–L274），`path` 缺省时的解析规则由实现定义并须在 worker README 或种子脚本注释中写明。
- `storage_connections`：列结构不变（L316–L331）。`kind` 列当前 CHECK/默认值为 `gitlab|gitea`；新增取值（如对象存储）必须在同一迁移中给出至少一个读取该凭据的调用方，否则不得加入枚举。
- `documents`：删除 `source_id` 列（L137，当前可空）；文档仅经 `project_id` 归属。
- `sync_jobs`：`source_id NOT NULL`（L122）改为 `project_id NOT NULL REFERENCES projects(id)`；`trigger` 枚举保持 `manual|schedule|push`（`push` 仍指服务端保存后的自动提交，见下）；幂等唯一索引由 `(source_id, commit_hash)` 改为 `(project_id, commit_hash)`；其余列不变。
- 删除表：`sources`、`push_tokens`。

### 共享类型（`@ewiki/packages/shared/src/schemas/index.ts`）

```ts
StorageBackendKind   = z.enum(['git', 'local'])
StorageStatus        = z.enum(['connected', 'synced', 'syncing', 'error'])
StorageConnectionKind = z.enum(['gitlab', 'gitea'])
```

- 删除导出：`SourceType`、`SourceStatus`、`SourceSchema`（L13、L16、L80–L93）。
- `ProjectSchema`（L54）扩展上述存储字段；`DocumentSchema` 删除 `sourceId`（L70）。
- 新建文档库请求体：`{ ...现有 ProjectSchema 字段, storage: { kind: 'git', connectionId: string, repoName: string, defaultBranch?: string } | { kind: 'local', path?: string } | 省略 }`；省略时按 `local` 处理。`repoName` 约束沿用现行正则 `^[A-Za-z0-9_.-]{1,100}$`。
- 项目更新请求体可包含：`name`、`autoSync`、`intervalSeconds`、`defaultBranch`；不得包含 `storageKind`、`storageConnectionId`（后端不可通过 PATCH 更换，见不变量）。

### HTTP（`@ewiki/apps/server/src/http/`）

| 方法/路径 | 规定 |
|---|---|
| `POST /api/v1/projects` | 吸收现 `POST /api/v1/projects/with-storage`（routes-platform.ts L480–L622）的全部 Git 开通逻辑（连接归属校验、`validateConnection`、`ensureRepo/findRepo`、种子文档、首次 commit）；现 `with-storage` 路由删除。 |
| `POST /api/v1/projects/:id/sync` | 取代 `POST /api/v1/sources/:id/sync`（routes.ts L440）；入队载荷 `{ projectId, trigger: 'manual' }`，singleton key 为 `sync:<projectId>:manual`，窗口 1 分钟（沿用现行 `singletonMinutes: 1`）。 |
| `PATCH /api/v1/projects/:id` | 接受上节允许的更新字段。 |
| `GET /api/v1/overview` | `sourceType`/`sourceCount`（routes.ts L758–L800）替换为 `backendKind`（取项目 `storage_kind`）；不再返回任何 source 命名字段。 |
| `/api/v1/sources*` | 全部路由（routes.ts L310–L502）删除，无兼容别名。 |
| `/api/v1/connections` | CRUD 保留（routes-platform.ts L339–L461）；`DELETE` 在该连接被任意非删除项目的 `storage_connection_id` 引用时 MUST 返回 409。 |
| `/api/v1/open/*` | 不新增推送端点；`site-check` 行为不变。 |

### Worker（`@ewiki/apps/worker/src/index.ts`）

- pg-boss 队列名保持 `sync`；作业载荷契约由 `{ sourceId, trigger }`（L319）改为 `{ projectId, trigger }`。
- 同步函数以 `projectId` 为主键：工作目录由 `FS_ROOT/repos/<sourceId>`（L234）改为 `FS_ROOT/repos/<projectId>`；`harvestDocsFromDir` 的 upsert/删除条件由 `documents.sourceId`（L95、L132）改为 `documents.projectId`。
- 删除 `web`/`database` 分支及其「尚未实现」抛错（L275）；git 分支的 clone/pull、凭据解密、local 分支的目录读取行为不变，凭据来源改为经 `projects.storage_connection_id` 读取 `storage_connections.token_encrypted`，不再存在项目侧令牌副本。
- LISTEN/NOTIFY 频道 `sync.status_changed` 保留，载荷改为 `{ projectId, status }`。
- 保存副作用 `docStorageEffects()`（routes-platform.ts L108–L215）：Git 自动提交的源行查询、`ensureWorkdir`、`commitAndPush`、作业写入与审计（`resourceType: 'source'` → `'project'`）全部改按 `projectId` 定位；自动提交产生的 `sync_jobs.trigger` 仍为 `push`。

## Normative Behavior

- 每个文档库 MUST 恰好持有一个存储后端：`storage_kind` 非空且取值仅 `git|local`，后端属性内嵌于项目行，不存在独立实体与独立 CRUD。
- Git 后端 MUST 引用一个调用用户拥有（`storage_connections.owner_id` 匹配）的存储源；服务端 MUST 在建库时完成连接校验与仓库存在性检查，校验失败 MUST NOT 创建项目行。
- local 后端 MUST NOT 引用存储源：`storage_kind='local'` 时 `storage_connection_id` MUST 为 NULL。
- 远端凭据 MUST 仅存于 `storage_connections.token_encrypted`（AES-256-GCM secretbox，沿用现行加密）；`projects` MUST NOT 出现任何令牌列或 `*_encrypted` 列。
- 文档库创建后 MUST NOT 通过 API 更换后端种类或存储源；需要更换时 MUST 新建文档库。
- `auto_sync`/`interval_seconds` MUST 被持久化、读取与原样返回；本契约 MUST NOT 要求任何组件按其值调度作业（现行 worker 仅注册 publish 的 `0 3 * * *`，无 sync 调度器，见 worker L774）。定时执行属于后续独立契约，任何接口文档与前端文案 MUST NOT 声称定时同步已生效。
- 存储源 MAY 被同一用户的多个 Git 文档库引用；存储源 MUST NOT 跨用户共享（归属仍为 `owner_id NOT NULL`）。
- `sources` 与 `push_tokens` 的删除 MUST 在同一个迁移内完成，不保留视图、别名或双写。

## Constraints and Invariants

- 单后端不变量由列结构固化：同一项目无法仅靠配置并存两个后端，并存需求触发 ADR 的 supersede 条件。
- 迁移为一次性破坏性变更：旧 `sources` 行按 1:1 回填 `projects` 存储列后，`sources` 数据不保留运行时副本；回填 SQL 必须在同一事务内完成。
- 软删除语义不变：仅 `projects`/`documents` 软删除；`sync_jobs` 与存储源引用随之指向项目。
- 加密令牌在迁移中不重加密：Git 源行回填时仅复制 `config_public.connection_id` 引用，`sources.config_encrypted` 的令牌副本随表删除丢弃；运行时统一读连接表。
- 工作目录改名（`repos/<sourceId>` → `repos/<projectId>`）必须在应用新版本上线前完成，且每个旧 Git 仓库目录恰好改名一次；local 后端目录若以 source 维度命名，适用同一规则。

## Error Handling

| 情形 | 状态码/行为 |
|---|---|
| `storage.kind` 非 `git|local`，或 zod 校验失败 | 400，返回字段级错误（沿用现行 zod 错误响应形状） |
| Git 建库的 `connectionId` 不存在或不属于当前用户 | 403 |
| 连接校验失败（`validateConnection`）或仓库不存在（`findRepo`） | 400，消息透传现行校验错误；不得产生残留项目行 |
| 删除被引用的存储源 | 409，响应体给出引用方 `projectId` 列表 |
| 对不存在或已删除项目触发同步 | 404 |
| worker 同步失败 | 写 `sync_jobs.status='failed'` 与 `error`，置 `projects.storage_status='error'`、`last_error`，NOTIFY 载荷 `{ projectId, status: 'error' }`；重试由再次手动触发完成，不自动退避重试（沿用现行行为） |
| 保存时自动提交失败 | 文档保存 MUST NOT 回滚；提交错误按现行 `docStorageEffects` 方式记录为失败作业，不阻塞写路径 |

## Conformance

实现满足以下全部条件方为合规：

1. `pnpm -r typecheck` 与根目录 `pnpm lint` 退出码 0。
2. 全仓搜索 `sources`、`sourceId`、`/api/v1/sources`、`push_tokens`、`SourceType`，在 `apps/`、`packages/`、`scripts/` 运行时代码中零命中（迁移 SQL 与归档文档除外）。
3. drizzle 迁移 0003 可正向执行；在含 1 个 Git 源、1 个 local 源、各自若干 `sync_jobs`/`documents` 行的库上执行后：项目存储列与连接引用正确，`documents.source_id` 消失，`sources`/`push_tokens` 表不存在。
4. `ewiki/scripts/e2e-platform.mjs` 平台套件全部通过（基线 53 项，其中 P5d/P5e 的 `/api/v1/sources` 调用改写为项目创建与 `POST /projects/:id/sync` 后用例数允许变化，全绿为准）。
5. worker 作业契约测试：发送 `{ projectId, trigger:'manual' }` 后 `sync_jobs` 出现归属该项目的作业记录，NOTIFY 载荷含 `projectId`。
6. 新建 Git 文档库为单次 `POST /api/v1/projects` 请求完成（ADR 的收敛后果可测：建库 + 开通 Git 无第二次 POST）。
