# ewiki 平台部署文档（平台服务形态）

> 对应目标：企业知识管理平台首期 10 项基础需求。本文覆盖：拓扑、本地运行、生产部署、初始账号、Git 连接配置、E2E 验收脚本。

## 1. 拓扑

```
浏览器 ── 3000 (server: REST API + 前端静态 + /sites/<slug> 发布站点)
        ├─ /ws、/collab ──► 3001 (realtime: 房间广播 + Yjs 协同)
        └─ /api ──► server ──► PostgreSQL（唯一有状态设施，Docker: ewiki-pg）
 worker（ts x watch / node dist）── 消费 pg-boss 队列：sync / publish / import / export
 存储目录（模拟 NAS 盘，FS_NAS_ROOT）
   ├─ users/<用户名>/projects/<库slug>-<id8>/…   云文档镜像（与平台内结构一一对应）
   ├─ users/<用户名>/sites/<slug>/vN + current.json   发布站点（公开访问）
   └─ （server 侧）apps/server/data/repos/<sourceId>/   Git 工作副本（自动提交推送）
```

## 2. 本地开发运行

前置：Node ≥ 20（生产建议 22 LTS）、pnpm 9（`corepack pnpm` 可用）、Docker、git ≥ 2.30。

```bash
# 1) 有状态设施
docker compose -f deploy/compose.dev.yml up -d      # PostgreSQL（+ MinIO 可选）

# 2) 依赖 + 建表 + 种子
corepack pnpm install
cp .env.example apps/server/.env                    # 按需修改
corepack pnpm --filter @ewiki/server db:migrate
corepack pnpm --filter @ewiki/server db:seed

# 3) 启动（web 5173 / server 3000 / realtime 3001 / worker）
corepack pnpm dev
```

数据库迁移只向前：新增表后 `corepack pnpm --filter @ewiki/server db:generate` → `db:migrate`。

## 3. 生产部署（单机）

1. **构建前端**：`corepack pnpm --filter @ewiki/web build`（产物 `apps/web/dist`）。
2. **环境变量**（`apps/server/.env` / `apps/worker/.env`）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | `postgres://用户:密码@host:5432/ewiki` |
| `JWT_SECRET` | ✅ | ≥16 字符随机串（登录令牌签名） |
| `ENCRYPTION_KEY` | ✅ | ≥16 字符（Git 连接 Token 的 AES-256-GCM 加密密钥，server/worker 必须一致） |
| `FS_NAS_ROOT` | ✅ | 模拟 NAS 盘根目录，**绝对路径**（如 `D:/nas/wiki` 或 `/srv/nas/wiki`）；server/worker 指向同一目录 |
| `FS_ROOT` | 建议 | 平台工作数据根（Git 工作副本等），默认 `./data` |
| `WEB_DIST` | 建议 | 设为 `../web/dist` 后，server 直接托管前端构建产物（单端口部署） |
| `PORT_SERVER` / `PORT_REALTIME` | 可选 | 默认 3000 / 3001 |

3. **启动**：`corepack pnpm --filter @ewiki/server start`（或 tsx 运行 src），worker/realtime 同理。
4. **反向代理**：参考 `deploy/Caddyfile`；本期发布站点为平台子路径 `/sites/<slug>/`，无需泛域名 TLS。子域名模式为后续能力（`SITE_ADDRESS_MODE`）。
5. **首次建库**：`db:migrate` + `db:seed`（种子管理员见下）。

## 4. 初始账号与注册

- 种子管理员：`admin@ewiki.local` / `ewiki-admin`（**上线后立即在「系统管理 → 用户管理」重置密码**）。
- 普通用户：登录页「注册」页签，邮箱 + 密码（≥8 位）+ 姓名；注册成功自动创建「个人示例知识库」（4 篇示例文档，同时落盘 NAS）。
- 企业 LDAP 自动登录注册：**预留接口**（`GET /api/v1/auth/ldap/status`、`POST /api/v1/auth/ldap/login`、`users.sso_subject` 字段、`apps/server/src/lib/ldap.ts` 适配器位），本期未启用。

## 5. Git 连接配置（GitLab / Gitea）

1. 用户登录 → 全局侧栏「存储配置」→ 添加连接：类型 GitLab（REST v4）或 Gitea（兼容演示方言），服务地址 + 访问令牌（需 `api`/`write_repository` 权限）→ 保存即自动验证。
2. 新建文档库向导选「Git 仓库」：指定仓库名称 + 选择连接配置 + 勾选「仓库不存在时自动初始化」。
   - 仓库不存在 → 自动创建并写入模板文档做首次提交推送；
   - 仓库已存在 → 直接关联，远端内容不被覆盖（模板文档仅平台侧预置）。
3. Git 库内文档的每次保存/删除 → 自动 `commit + push`（提交人 = 操作用户），`sync_jobs` 留痕，Git 服务端提交历史可查。
4. 本地无 GitLab 时可用 Gitea 容器演示：`docker run -d --name gitea -p 3300:3000 ghcr.io/go-gitea/gitea:latest`，创建用户与 Token 后在「存储配置」录入。

## 6. 端到端验收脚本

```bash
# 前置：server/worker/realtime 已启动；Gitea 已创建测试账号与 Token
$env:E2E_GITEA_TOKEN = '<token>'
node scripts/e2e-platform.mjs        # 51 项断言，写 scripts/e2e-report.json
```

覆盖：注册/示例库、NAS 落盘三方一致、越权拦截、版本冲突保护、连接配置验证（含错误令牌）、Git 自动建仓与自动提交（服务端可查）、分享协作（editor/guest 权限）、发布站点匿名访问、系统管理与审计台账、NAS 根目录运行时切换演练。

## 7. 健康检查

- `GET /healthz`、`GET /readyz`（含 DB 探测）
- 管理员「系统管理 → 数据库与存储」：PG 版本/体积/表行数、NAS 可写性、按用户占用、git 版本、运行时长。
