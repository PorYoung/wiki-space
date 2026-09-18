# ewiki 工程与部署规范

| 项 | 说明 |
| --- | --- |
| 文档目的 | 定义 ewiki 的仓库工程化、本地开发、构建产物、容器化部署、CI/CD、配置密钥与运行手册，作为层 4 落地与日常运维的直接依据 |
| 创建日期 | 2026-09-06 |
| 上游基线 | [PRD](./PRD.md)（R4）；[SDD](./DESIGN.md)（R3）；[FRONTEND](./FRONTEND.md)（R1） |
| 阅读对象 | 全体工程师、AI 编码代理、DevOps |
| 修订记录 | R1（2026-09-06）：初版 |

**证据标注约定**：同 SDD——`[Data-backed]` / `[Research-backed]` / `[Expert judgment]` / `[Hypothesis]` / `[To be confirmed]`。

---

## 1 概述

### 1.1 定位与范围

本层回答"代码放哪、怎么跑起来、怎么发出去、出问题怎么救"：

- 覆盖：monorepo 工程化、本地开发环境、构建产物、Docker/Caddy 部署、GitLab CI/CD、数据库迁移、配置与密钥、可观测性落地、运行手册。
- 不覆盖：PRD/SDD 的需求与架构内容；K8s 生产编排（Phase 2，本层只交付 Compose 形态）。

### 1.2 上游约束回执（SDD 决议 → 本层落地物）

| SDD 决议 | 本层落地物 |
| --- | --- |
| ADR-1 模块化单体 + Worker 分池 | apps/server / apps/realtime / apps/worker 同镜像不同入口 |
| ADR-8 最小实体集（R3 修订 6 容器） | docker-compose 服务清单（第 5 章） |
| ADR-9/10 Hono + Drizzle + pg-boss | 依赖清单与初始化脚本（第 2 章） |
| ADR-11 数据库方言边界 | 四接口落在 packages/shared 的 `ports` 目录，实现放 apps（第 2.3） |
| ADR-12 存储双轨（S3 主 + NAS 回退） | MinIO 容器 + NAS 卷挂载 + StorageService 配置（第 5.3/8 章） |
| ADR-13 REST/WS 拆分 + 粘性路由 | Caddyfile 路径分流与 docId 哈希（第 5.4） |
| PRD R4 发布双地址 | Caddy 泛域名 + /wiki/{slug} 子路径重写（第 5.4） |

---

## 2 仓库工程化

### 2.1 工具链版本

| 工具 | 版本 | 依据 |
| --- | --- | --- |
| Node.js | 22 LTS（≥ 22.12） | pg-boss 12 引擎要求 `[Data-backed：pg-boss README]` |
| pnpm | 9.x `\[To be confirmed：以初始化时最新稳定为准\]` | workspace 协议链接 monorepo |
| TypeScript | 5.x strict | 全仓统一 |
| Drizzle Kit | 与 drizzle-orm 匹配 | 迁移生成/执行 |
| pg-boss | 12.x | 队列 `[Research-backed：2.4 调研]` |

原则：构建编排 Phase 1 用 `pnpm -r --filter` 脚本（零额外实体）；任务量上来再引入 Turborepo（仅 dev 工具，不影响部署实体）`[Expert judgment]`。

### 2.2 workspace 与脚本

根 `pnpm-workspace.yaml`：`apps/*`、`packages/*`。根 package.json 关键脚本：

```json
{
  "scripts": {
    "dev": "pnpm -r --filter=./apps/* --parallel dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "db:generate": "pnpm --filter @ewiki/server db:generate",
    "db:migrate": "pnpm --filter @ewiki/server db:migrate",
    "db:seed": "pnpm --filter @ewiki/server db:seed"
  }
}
```

### 2.3 TypeScript 与边界

- `tsconfig.base.json`（strict、`moduleResolution: bundler`、paths：`@ewiki/shared/*` → `packages/shared/src/*`、`@/` → `apps/*/src`）。
- **方言边界落点**：`packages/shared/src/ports/` 定义四接口（`JobQueue` / `LockService` / `EventBus` / `SearchService`）；`apps/server/src/adapters/pg/` 提供默认实现；未来 MySQL 方言实现放 `apps/server/src/adapters/mysql/`，切换仅改装配 `[Data-backed：SDD ADR-11]`。
- 领域类型与 Zod schema 全部在 `packages/shared/src/schemas/`，API/WS 事件信封共用。
- 构建产物：apps 用 tsup 打 bundle（server/realtime/worker 各一个入口，`dist/{server,realtime,worker}.js`）；packages/shared 以 TS 源码被 monorepo 内直接引用（`exports` 条件 `import`→源码），仅发布时构建。

### 2.4 代码质量门槛（合并门禁）

| 门禁 | 命令 | 标准 |
| --- | --- | --- |
| Lint | `pnpm lint` | 0 error |
| 类型 | `pnpm typecheck` | 0 error |
| 测试 | `pnpm test` | 全绿（Vitest；lib/ports/adapters 必测） |
| 迁移 | `drizzle-kit generate` 产物入 PR | 迁移文件必须随代码评审 |

---

## 3 本地开发环境

### 3.1 一键启动

```bash
docker compose -f deploy/compose.dev.yml up -d   # postgres + minio（caddy 可选）
pnpm install
pnpm db:migrate && pnpm db:seed                  # 建表 + starter packs 种子
pnpm dev                                          # web(5173) / server(3000) / realtime(3001) / worker
```

开发期前端直连 `localhost:3000`（Vite proxy `/api`、`/ws`、`/collab`），存储驱动默认 `fs`（本地 `./data` 目录）以降低依赖；S3 联调切 `STORAGE_DRIVER=s3`。

### 3.2 环境变量清单（.env，模板 `.env.example` 入库）

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| DATABASE_URL | 是 | — | `postgres://…`；唯一有状态设施 |
| PORT_SERVER / PORT_REALTIME | 否 | 3000 / 3001 | 服务端口 |
| JWT_PRIVATE_KEY / JWT_PUBLIC_KEY | 是 | — | EdDSA 或 RS256 签名密钥对 `[To be confirmed：算法定稿]` |
| REFRESH_TTL_DAYS | 否 | 7 | 刷新令牌有效期 |
| STORAGE_DRIVER | 否 | fs | `fs`（NAS/本地卷）\| `s3` |
| S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY | s3 时是 | — | MinIO 或云 OSS |
| FS_ROOT | fs 时是 | ./data | 卷根目录 |
| NAS_FALLBACK_ENABLED / FS_NAS_ROOT | 否 | false / — | S3 失败回退 NAS（ADR-12） |
| EWIKI_BASE_DOMAIN | prod 是 | ewiki.yfzx.cn | 发布站点泛域名基域（PRD R4） |
| SITE_ADDRESS_MODE | 否 | subdomain | `subdomain` \| `subpath` |
| ENCRYPTION_KEY | 是 | — | 数据源凭据 AES-256-GCM 主密钥（32B） |
| LLM_PROVIDER / LLM_API_KEY | AI 整理启用时是 | — | 适配器配置 `[To be confirmed]` |
| LOG_LEVEL | 否 | info | pino 级别 |

规则：`.env`不入库；生产密钥由部署环境注入（Compose secrets / CI 变量）`[To be confirmed：密钥管理设施]`；`ENCRYPTION_KEY` 轮换需执行重加密脚本（第 9 章）。

---

## 4 构建与产物

| 产物 | 命令 | 输出 | 说明 |
| --- | --- | --- | --- |
| web | `pnpm --filter @ewiki/web build` | `apps/web/dist` | Vite 产物，由 Caddy 静态服务（gzip ≤300KB 预算见 FRONTEND 9） |
| server/realtime/worker | `pnpm --filter @ewiki/server build` 等 | `dist/{server,realtime,worker}.js` | tsup ESM bundle + 外部依赖；三入口共享 node_modules |
| 迁移 | `drizzle-kit generate` | `drizzle/*.sql` | 随 PR 入库；`migrate` 启动前执行 |
| 镜像 | `docker build` | `registry/ewiki/app:{tag}` | 单镜像多入口（第 5.2） |

**镜像策略（单镜像多入口）**：一个 Dockerfile 构建一个镜像 `ewiki/app`，以 `ENTRYPOINT` 参数区分 `server` / `realtime` / `worker`——三服务版本永远一致，消除"前端调用了不存在的后端接口"这类漂移 `[Expert judgment]`。

```dockerfile
# 多阶段：deps（pnpm fetch）→ build（pnpm -r build）→ runtime（node:22-slim）
FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./
ENV NODE_ENV=production
ENTRYPOINT ["node", "apps/server/dist/index.js"]   # 由 compose 覆盖 command 切换入口
```

---

## 5 部署

### 5.1 环境分层

| 环境 | 编排 | 数据 | 说明 |
| --- | --- | --- | --- |
| dev | compose.dev（PG+MinIO） | 本地 | 开发者本机 |
| staging | compose（第 5.3） | 独立 PG + MinIO + NAS | 发布双地址全链路演练 |
| prod | compose（可多副本） | PG 主备 + MinIO + NAS | 单主机起步，K8s 为 Phase 2 |

### 5.2 服务清单（deploy/compose.yml 骨架）

```yaml
services:
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes: ["./deploy/Caddyfile:/etc/caddy/Caddyfile:ro", "caddy_data:/data", "web_dist:/srv/web:ro", "sites:/srv/sites:ro"]
  server:
    image: registry/ewiki/app:${TAG}
    command: ["node", "apps/server/dist/index.js"]
    env_file: [.env.production]
    depends_on: { postgres: { condition: service_healthy } }
    healthcheck: { test: ["CMD", "wget -qO- http://localhost:3000/healthz"], interval: 10s }
    deploy: { replicas: 2 }
  realtime:
    image: registry/ewiki/app:${TAG}
    command: ["node", "apps/realtime/dist/index.js"]
    env_file: [.env.production]
    healthcheck: { test: ["CMD", "wget -qO- http://localhost:3001/healthz"], interval: 10s }
    deploy: { replicas: 1 }        # Phase 1 单副本 + 粘性路由；扩容见 SDD 6.2
  worker:
    image: registry/ewiki/app:${TAG}
    command: ["node", "apps/worker/dist/index.js"]
    env_file: [.env.production]
    deploy: { replicas: 2 }        # sync/publish/ai 分池由队列名路由
  postgres:
    image: postgres:16
    volumes: ["pg_data:/var/lib/postgresql/data"]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U ewiki"], interval: 5s }
  minio:
    image: minio/minio
    command: server /data
    volumes: ["minio_data:/data"]
volumes: { caddy_data: {}, web_dist: {}, sites: {}, pg_data: {}, minio_data: {} }
```

> 注：上图为设计骨架；**实际部署清单以 `ewiki/deploy/compose.yml` 为准**（已落地 web-init/migrate/seed 任务、NAS bind 挂载与基础镜像版本固定；发布站点经 server `/sites/:slug/*` 服务）。

规则：三类应用副本均可 `--scale`（无状态）；MinIO 单实例起步（SDD 6.2）；NAS 由宿主机挂载后以 `FS_NAS_ROOT` 交给 fs 适配器（回退路径）。

### 5.3 Caddy 配置（deploy/Caddyfile 要点）

```caddyfile
{
    on_demand_tls { ask http://server:3000/api/v1/open/site-check }   # 子域名按需签证书
}

# 主站：SPA + API + 实时
ewiki.yfzx.cn {
    handle /api/*   { reverse_proxy server:3000 }
    handle /ws      { reverse_proxy realtime:3001 }                    # 事件通道（WSS 升级）
    handle /collab* { reverse_proxy rt_hash }                          # Yjs，粘性路由
    handle /wiki/*  { rewrite * /sites/{path.2}/current{path}          # 子路径形态（PRD R4）
                      reverse_proxy minio:9000 }
    handle          { root * /srv/web; try_files {path} /index.html; file_server }
}

# 子域名形态：{slug}.ewiki.yfzx.cn → 对应站点产物
*.ewiki.yfzx.cn {
    tls { on_demand }
    rewrite * /sites/{labels.3}/current{path}
    reverse_proxy minio:9000
}

rt_hash: {
    # 粘性路由：对 /collab 连接按 docId 查询参数哈希选副本（ADR-13）
    reverse_proxy realtime:3001
}
```

要点：泛域名证书由 DNS challenge 签发（`*.ewiki.yfzx.cn` 一张证书覆盖全部子域名）或 on_demand 逐域名签发，DNS 提供商插件 `[To be confirmed：以实际 DNS 服务商定]`；`/wiki/{slug}` 的 base path 由构建产物相对路径保证（FRONTEND 8.1）；粘性路由 Phase 1 用 Caddy `header_regexp` + `hash` 策略实现，多副本房间迁移协议为 Phase 2 `[To be confirmed：Caddy 粘性策略细节压测确认]`。

### 5.4 发布/回滚

- 发布：合并 → CI 构建镜像（tag = 短 SHA）→ 迁移任务 → `docker compose pull && up -d`（滚动重建）→ healthz 探活确认。
- 回滚：`TAG=<上一短 SHA>` 重跑部署命令即可（镜像不可变）；数据库回滚遵循**迁移只向前**原则——回滚代码不回滚表结构，兼容窗口 ≥ 1 个版本 `[Expert judgment]`。

---

## 6 CI/CD（GitLab CI）

```yaml
stages: [verify, build, migrate, deploy]
verify:   { stage: verify, script: [pnpm install --frozen-lockfile, pnpm lint, pnpm typecheck, pnpm test] }
build:    { stage: build, script: [pnpm build, docker build -t $REG/ewiki/app:$CI_COMMIT_SHORT_SHA .], only: [main] }
migrate:  { stage: migrate, script: [pnpm db:migrate], environment: staging }
deploy:   { stage: deploy, script: [ssh $DEPLOY_HOST "cd /srv/ewiki && TAG=$CI_COMMIT_SHORT_SHA docker compose pull && docker compose up -d"], environment: staging }
```

规则：`main` → staging 自动；prod 手动点按（`when: manual`）+ 同迁移门禁；迁移失败阻断部署（迁移 job 非零退出即停）`[Expert judgment]`。

---

## 7 数据库迁移与种子

- 生成：`pnpm db:generate`（drizzle-kit，schema 变更随 PR 评审）。
- 执行：部署流水线 `migrate` 阶段（server 启动前）；pg-boss 自身表由其 CLI `pg-boss migration` 维护（版本随依赖升级）`[Research-backed：pg-boss CLI]`。
- 原则：**只向前**；重命名/删除列采用"扩展-迁移-收缩"三步，跨版本兼容（SDD 4.5 弃用窗口）。
- 种子：`db:seed` 写入 8 个 starter packs 与演示模板元数据（幂等，可重复执行）。

---

## 8 配置、密钥与补偿任务

- 密钥清单与轮换：`JWT 密钥对`（轮换 = 双公钥并行验证窗口）、`ENCRYPTION_KEY`（轮换 = 重加密脚本逐行改写 sources.config_encrypted）、`push_tokens`（用户侧自助吊销重发）`[Expert judgment]`。
- **NAS 回退补偿任务**（ADR-12）：fs 适配器写入 NAS 时记录 `compensation` 标记；Worker 周期任务扫描标记 → 回传 S3 → 成功后清除标记；S3 恢复期间读路径自动回到主存储。
- 降级开关：`STORAGE_DRIVER` 运行时只读配置，切换需重启（Phase 1 接受）`[Hypothesis]`。

---

## 9 可观测性与运行手册

| 项 | 落地 |
| --- | --- |
| 日志 | pino JSON → stdout → 宿主机收集；requestId 贯穿 API→队列→Worker |
| 指标 | `/metrics`（Prometheus 格式）：HTTP 时延直方图、pg-boss 队列深度、同步成功率、WS 连接数、协同房间数 |
| 队列观测 | pg-boss dashboard 挂载 realtime 管理路由（仅管理员可达）`[Research-backed]` |
| 告警基线 | 同步失败率 > 5%、队列积压 > 1000、PG 主从断连、磁盘 > 80% |
| 备份 | PG：每日 `pg_dump` + WAL 归档；S3：版本化；NAS：rsync 至备份机 `[To be confirmed：备份存储位置]` |
| 恢复 | PG 恢复演练每季度一次；演练步骤入 runbook |
| 常见故障 | PG 不可用 → readyz 摘流等待；S3 不可用 → 自动 NAS 降级（业务无感）；realtime 重启 → 客户端自动重连（IndexedDB 增量不丢） |

---

## 10 验收清单（层 4 完成门禁）

| # | 验收项 | 标准 |
| --- | --- | --- |
| 1 | 新人上手 | 克隆仓库 → `compose up` → `pnpm dev` 10 分钟内跑通全功能（含协同） |
| 2 | CI 门禁 | verify/build/migrate/deploy 四阶段全绿；PR 无迁移遗漏 |
| 3 | 部署 | staging 一条命令部署；healthz 探活通过；发布双地址（子域名 + /wiki/ 子路径）均可访问 |
| 4 | 回滚演练 | 预生产环境完成一次镜像回滚 + 数据兼容验证 |
| 5 | 降级演练 | 停 MinIO → NAS 降级生效 → 恢复 → 补偿任务回迁成功 |
| 6 | 备份恢复 | 每季度 PG 恢复演练通过 |

---

## 11 文档链路与后续

```
PRD（R4）→ SDD（R3）→ FRONTEND（R1）→ ENGINEERING（R1）  ✅ 四层齐备
```

层 4 完成后即可启动**工程脚手架执行**（按第 2 章初始化 monorepo、按第 5 章落 compose/Caddy，迁移原型代码进 apps/web）。执行中的反馈回写各层文档。
