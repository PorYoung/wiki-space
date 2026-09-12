---
title: 移除数据源并下沉存储后端的分阶段实施计划
status: draft
tags:
  - domain:storage
  - domain:document-library
  - migration
---

## Goal

按 spec `document-library-storage` 完成一次性破坏性迁移：删除 `sources` 与 `push_tokens` 两张表，文档库自持 `git|local` 存储后端，存储源收敛为用户级连接配置；建 Git 文档库由两次 POST 收敛为单次 `POST /api/v1/projects`。零运行时兼容层，单一版本完成切换。

## Tasks

### P0 — 共享类型（`packages/shared`，可独立提交）

1. 在 `@ewiki/packages/shared/src/schemas/index.ts` 新增 `StorageBackendKind`、`StorageStatus`、`StorageConnectionKind` 与新建/更新项目请求体 schema；扩展 `ProjectSchema` 存储字段；`DocumentSchema` 删除 `sourceId`。
2. 删除 `SourceType`、`SourceStatus`、`SourceSchema` 导出；全仓 grep 修正所有 import（server、worker、web 三处均引用该包）。
3. 验收：`pnpm --filter @ewiki/shared build` 通过；此阶段允许 apps 侧暂时类型报错（P2/P3/P4 修复），不得在 P0 内提交 apps 半成品改动。

### P1 — 数据库迁移 0003（schema + 回填，可独立评审）

1. 修改 `@ewiki/packages/db/src/schema.ts`：按 spec 给 `projects` 加 10 个存储列；`syncJobs` 改挂 `projectId`（唯一索引同步改名）；`documents` 删 `sourceId`；删除 `sources`、`pushTokens` 表定义。
2. 用 `pnpm db:generate` 生成 `apps/server/drizzle/0003_*.sql` 后改为**手写回填 SQL**（drizzle-kit 生成的 DROP 不含数据搬迁），结构：
   - 预检：`SELECT id, project_id, type FROM sources WHERE deleted_at IS NULL AND type NOT IN ('git','local')` 返回非空则迁移报错中止；统计每个 `project_id` 的有效源行数，>1 即中止（契约假设 1:1）。
   - `ALTER TABLE projects ADD COLUMN ...`（全部 NULL 允许或带默认值先行）。
   - Git 回填：`UPDATE projects p SET storage_kind='git', storage_connection_id=(s.config_public->>'connectionId')::uuid, storage_config=s.config_public, default_branch=s.default_branch, auto_sync=s.auto_sync, interval_seconds=s.interval_seconds, storage_status=..., last_synced_at=s.last_synced_at, last_error=s.last_error FROM sources s WHERE s.project_id=p.id AND s.deleted_at IS NULL AND s.type='git'`；回填后断言无 git 项目 `storage_connection_id IS NULL`。
   - Local 回填：同形 UPDATE 写 `storage_kind='local'`、`storage_config` 透传；无源行的项目保持列默认值 `'local'/'{}'`。
   - `UPDATE sync_jobs j SET project_id=s.project_id FROM sources s WHERE j.source_id=s.id`；`ALTER TABLE sync_jobs DROP COLUMN source_id`、重建 `(project_id, commit_hash)` 唯一索引与外键。
   - `ALTER TABLE documents DROP COLUMN source_id`；`DROP TABLE push_tokens; DROP TABLE sources;`。
   - 全部置于单个事务；在本地库用 seed 数据（含 1 local 源）与手工插入的 1 git 源演练正向迁移。
3. 工作目录改名脚本（一次性运维脚本，放 `apps/server/scripts/`，迁移上线窗口执行）：读取改名前的 `sources` 映射（脚本须在 DROP TABLE 前运行，或从迁移前导出的 `id→project_id` CSV 读取），将 `FS_ROOT/repos/<sourceId>` 逐个 `git fsck` 校验后 `rename` 为 `repos/<projectId>`；目标已存在则报错跳过，不覆盖。

### P2 — Server（`apps/server`）

1. 路由：删除 `sourcesRoute` 及其挂载（routes.ts L310–L502）；将 `with-storage`（routes-platform.ts L480–L622）的 Git 开通逻辑并入 `POST /projects`（routes.ts L263），删除 `with-storage` 路由；新增 `POST /projects/:id/sync`（载荷 `{ projectId, trigger:'manual' }`，singletonKey `sync:<id>:manual`，`singletonMinutes:1`）；`PATCH /projects/:id` 支持 `name/autoSync/intervalSeconds/defaultBranch`，拒绝后端更换字段。
2. overview（routes.ts L758–L800）：`sourceType/sourceCount` 改为 `backendKind`，数据源改查项目列。
3. `docStorageEffects()`（routes-platform.ts L108–L215）：按项目存储列查询；`ensureWorkdir` 改 `repos/<projectId>`；凭据经 `storage_connection_id` 取；审计 `resourceType` 改 `'project'`；失败仍写 `sync_jobs` 且不阻塞保存。
4. 连接删除（routes-platform.ts L456）：引用检查改查 `projects.storage_connection_id`，被引用返回 409 与引用方 id 列表。
5. 管理端统计（L710、L762）：表清单去掉 `sources`，`push_tokens` 计数删除，`storage_connections` 保留。
6. seed（seed.ts）：删除 sources import 与 `ensureSource`（L344–L360），示例项目建为 `storage_kind='local'` + `storage_config.path` 指向现 `seed-source` 目录；同步演示改为插入 `project_id` 归属的 `sync_jobs` 或直接调用项目同步；内嵌排障文档中 `/api/v1/sources` 文案改为项目接口。
7. 验收：`pnpm --filter @ewiki/server typecheck`、`pnpm lint` 退出码 0；`pnpm db:migrate && pnpm db:seed` 干净库通过。

### P3 — Worker（`apps/worker`）

1. `syncSource(sourceId, trigger)` 改为 `syncProject(projectId, trigger)`：`SourceRow` 类型改项目行；git/local 分支读 `storage_config`；删除 web/database 抛错分支（L275）；凭据读 `storage_connections`。
2. `harvestDocsFromDir` 的 upsert/删除条件改 `documents.projectId`（L95、L132）；工作目录改 `FS_ROOT/repos/<projectId>`；活动记录 `targetType:'source'` 改 `'project'`；NOTIFY 载荷改 `{ projectId, status }`。
3. `handleSync` 读 `job.data.{projectId,trigger}`；队列注册（L752–L756）其余队列不动；不新增定时 sync 调度（`auto_sync` 仅持久化）。
4. 验收：typechain 清零；本地以 local 项目跑通手动同步，`sync_jobs` 与 NOTIFY 均带 `projectId`。

### P4 — Web（`apps/web`）

1. 删除 `pages/SourcesPage.tsx` 与 `App.tsx` 的 `/sources` 路由、Sidebar/TopBar 入口。
2. `NewProjectPage.tsx`：请求地址由 `/projects/with-storage` 改为 `/projects`，请求体改 `storage: { kind:'git', connectionId, repoName } | { kind:'local' }`。
3. `ProjectSettingsPage.tsx`：同步设置区块（L394–L482）改读写项目接口与项目存储字段，标注「手动同步 / 仅保存频率偏好，调度未启用」；同步按钮打 `POST /projects/:id/sync`。
4. `LibraryPage.tsx`、`DashboardPage.tsx`、`ProjectLayout.tsx`：source 字段消费改 `backendKind`/项目存储字段。
5. `StorageConnectionsPage.tsx` 及导航文案：「存储配置」统一改名为「存储源」；`SettingsPage.tsx`、`index.css` 中相关标签同步；`PublishPage.tsx` 的 `autoSync` 属发布站点字段，不在本次改动范围，仅确认命名不冲突。
6. 验收：`pnpm --filter @ewiki/web build` 通过，页面无 `/api/v1/sources` 请求。

### P5 — 测试与文档

1. `scripts/e2e-platform.mjs`：L153/L242/L292 的 `with-storage` 调用改 `/projects`；L219–L240 的 `/api/v1/sources` 建源/legacy 用例改写为「建库即带后端 + `POST /projects/:id/sync`」；连接 `kind:'ftp'` 的 400 用例（L213）保留；P9g 表清单断言去掉 `sources`。
2. 全平台套件跑通为绿（基线 53 项，改写后用例数量允许变化）。
3. `docs/DESIGN.md`：ER 图删 `sources` 层；模块依赖链 `open-api → sync → sources → documents → projects` 缩短；API 章节删 S1/S2/S3 并改项目接口；5.1 同步流程与 4.3 O1 开放推送段落删除（无实现）；前端原型页描述同步更新。
4. 全仓复查 grep：`sources`、`sourceId`、`push_tokens`、`SourceType` 在 `apps/`、`packages/`、`scripts/` 运行时代码零命中（迁移 SQL 与归档文档除外）。

## Acceptance Criteria

- 根目录 `pnpm -r typecheck`、`pnpm lint`、`pnpm --filter @ewiki/web build` 退出码均为 0。
- 干净环境 `db:migrate → db:seed → e2e-platform.mjs` 全流程绿；含 git/local 两类源的存量库演练迁移后数据断言符合 spec Conformance 第 3 条。
- Git 文档库创建在网络面板中仅产生 1 次 `POST /api/v1/projects`，且库建成后工作区有首次提交。
- `/api/v1/sources*` 任意请求返回 404；删除被引用的存储源返回 409。
- spec Conformance 第 1–6 条逐条可演示。

## Dependencies

- 破坏性单次发布：P0–P5 必须在同一版本上线；上线顺序为「停 worker → 等 `sync` 队列排空（pg-boss 无在途作业）→ 跑改名脚本 → 执行 0003 迁移 → 部署 server/worker/web」。新旧版本不得并行访问同一库（旧版本会查询已删除的 `sources`）。[assumption] 当前仅单环境部署，无灰度/多副本并存要求。
- 0003 依赖存量数据满足「每有效项目至多 1 个未删除源」；预检不通过时迁移中止，需人工清洗后重跑。
- P2 依赖 P0 类型与 P1 schema；P3 依赖 P1；P4 依赖 P0/P2 的接口；P5 依赖 P2–P4 完成。
- 对象存储类存储源不在本次范围：`storage_connections.kind` 保持 `gitlab|gitea`，新取值待出现真实凭据消费方时另立契约。
