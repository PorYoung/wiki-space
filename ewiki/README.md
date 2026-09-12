# ewiki（edith-wiki）

团队文档知识管理平台。文档链路：`../docs/`（PRD R4 → SDD R3 → FRONTEND R1 → ENGINEERING R1）。

## 快速开始（ENGINEERING.md 第 3 章）

```bash
# 0) 工具链：Node >= 20（生产建议 22 LTS），pnpm 9
npm i -g pnpm@9

# 1) 起本地有状态设施（PostgreSQL + MinIO）
docker compose -f deploy/compose.dev.yml up -d

# 2) 安装依赖 + 建表 + 种子
pnpm install
cp .env.example .env      # 按需修改
pnpm db:migrate
pnpm db:seed

# 3) 启动四个进程（web 5173 / server 3000 / realtime 3001 / worker）
pnpm dev
```

## 结构

```
apps/web        # 前端 SPA（React 19 + Vite + Tailwind，迁移自 prototype-docvault）
apps/server     # REST API（Hono + Drizzle + pg-boss）
apps/realtime   # 实时服务（WS 事件 + Yjs 协同）
apps/worker     # 后台任务（同步/发布/导入/AI 整理/补偿）
packages/shared # 领域类型、Zod schema、方言边界四接口（ports）
packages/theme  # 8 套 UI 主题与令牌
packages/editor # TipTap 封装（占位）
```

## 注意事项

- 当前开发环境 Node 20 → **pg-boss 锁定 10.x**；升级 Node 22 LTS 后升到 pg-boss 12（API 兼容，队列表自动迁移）。
- 数据库迁移只向前：`pnpm db:generate` 生成 → `pnpm db:migrate` 执行。
- 存储双轨：`STORAGE_DRIVER=s3|fs`，S3 写失败自动回退 NAS（`FS_NAS_ROOT`），补偿任务回迁。

## 平台化首期能力（2026-09-09 已验收）

- **注册即用**：登录页注册页签，注册自动创建个人示例知识库；企业 LDAP 自动登录为预留接口（`/api/v1/auth/ldap/*`）。
- **新建文档库向导**：模板/空库 × 云文档（平台 NAS 目录落盘镜像）或 Git 仓库（GitLab/Gitea 连接，仓库不存在自动初始化，保存自动 commit+push）。
- **存储配置**：全局侧栏「存储配置」管理 Git 连接（Token 加密落库、一键验证）。
- **分享与协作**：项目成员四角色分享；版本冲突 409 保护 + WS 实时互见。
- **发布站点**：五套模板发布为平台子路径 `/sites/<slug>/`（匿名可访问），产物写入用户 NAS 目录。
- **系统管理**：用户管理、数据库/存储基础设施状态、NAS 根目录运行时切换、审计台账（仅管理员）。
- **验收**：`node scripts/e2e-platform.mjs`（53 项断言）；文档见 `docs/deploy.md`、`docs/backup-rollback.md`、`docs/acceptance-record.md`、`docs/acceptance-report.html`。
