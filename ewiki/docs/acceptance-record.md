# 端到端验收演示记录（企业知识管理平台 · 首期 10 项基础需求）

- 验收时间：2026-09-09 22:12 – 22:20（Asia/Shanghai）
- 验收环境：本机开发部署 —— server/realtime/worker（tsx watch）+ PostgreSQL 16.15（Docker `ewiki-pg`）+ Gitea 1.27.3（Docker `gitea`，端口 3300，作为 Git 托管演示目标）+ git 2.55（Windows）
- 被测版本：`ewiki` 工作区（含本轮平台化扩展，见 §3）
- 自动化脚本：`ewiki/scripts/e2e-platform.mjs` → 结果 `ewiki/scripts/e2e-report.json`
- 结果：**51/51 断言通过**（连续 3 轮全绿，含幂等重跑与异常路径轮次）

## 1. 需求 → 实现 → 证据映射（10 项）

| # | 需求 | 实现落点 | 验收证据（e2e 断言 / 工件） |
| --- | --- | --- | --- |
| 1 | 系统管理页面（用户/数据库/存储等基础设施管理） | 全局侧栏「系统管理」（admin 限定）：用户管理（禁用/启用/重置密码/角色）、数据库状态（PG 版本/体积/12 张表行数）、存储基础设施（NAS 根可写性、按用户占用、git 版本）、审计台账（按操作人/动作/时间筛选） | P9a–P9k；非管理员访问 403（P9c） |
| 2 | 云文档默认存服务器配置存储目录（模拟 NAS） | 文档每次创建/更新/删除同步镜像到 `<NAS>/users/<用户名>/projects/<库slug>-<id8>/`，目录结构与平台内一致；管理员可运行时切换根目录（平台设置+审计） | P1d/P4b/P4d/P4g（磁盘文件字节级比对）；P9i/P9j 切换演练 |
| 3 | 注册 + LDAP 预留 | 登录页注册页签；`POST /api/v1/auth/register`（邮箱+密码≥8+姓名）；LDAP 预留：`/auth/ldap/status`、`/auth/ldap/login`、`users.sso_subject`、`lib/ldap.ts` 适配器位 | P1a/P1e/P1f；P0b（enabled=false） |
| 4 | 注册即得个人示例知识库 | 注册事务内创建 `<姓名>的示例知识库`（模板 personal-sample，4 篇示例文档 + NAS 落盘） | P1b/P1c/P1d |
| 5 | 新建文档库：模板/空库 × 云文档/Git | `/projects/new` 三步向导；`POST /api/v1/projects/with-storage`；模板：空/个人示例/团队知识库/项目空间/6 个 starter-pack | P4a；P6a |
| 6 | 存储配置页面（GitLab 连接配置） | 全局侧栏「存储配置」：新增/验证/编辑/删除；类型 gitlab（REST v4）与 gitea（兼容演示方言），Token AES-256-GCM 加密存储 | P5a（验证成功显示账号）/P5b（错误令牌明确原因）/P5c（非法类型拒绝） |
| 7 | Git 仓库指定 + 不存在自动初始化 | 向导第二步：仓库名 + 连接配置 + 自动初始化开关；不存在→API 建仓+模板首次提交推送；已存在→关联且不覆盖远端；关闭自动初始化且缺失→明确 404 | P6a（created=true）/P6b（服务端可查）/P6h（404 路径）；关联路径见首轮运行（created=false） |
| 8 | 仓库文件增删查改 + 自动提交 | 平台内新建/更新/删除 → 工作副本写盘 → `git add/commit/push`（提交人=操作者）→ `sync_jobs` 留痕 + 审计 `git.auto_commit`；推送失败标记 source error 且不阻断保存 | P6c–P6g（Gitea 提交历史 3 commits、raw 内容一致、commit hash 回显） |
| 9 | 分享项目空间 + 多人协作编辑 | 成员模型（owner/maintainer/editor/guest）+ 乐观并发（`baseVersionNo` 冲突 409）+ WS 房间广播 `document.updated`（编辑器自动刷新/冲突提示） | P7a–P7g（editor 可编辑、guest 只读 403、editor 无权管理成员）；前端冲突流程见 §4 |
| 10 | 模板发布为平台子路径网站 | 文档库 → 发布（t-docs/t-blog/t-product/t-wiki/t-api 五套模板，subpath 模式）；worker 渲染写入 `<NAS>/users/<用户名>/sites/<slug>/vN` + `current.json` 指针；server 公开路由 `/sites/<slug>/*` | P8a–P8e（发布成功、无痕匿名 200、页面/样式可访问、资源落用户目录） |

## 2. 验收标准逐条自检（13 条 Goal Brief）

| 验收标准 | 结论 | 关键证据 |
| --- | --- | --- |
| 系统管理页面可用 | ✅ | P9a/P9b/P9g/P9h；禁用/启用/重置密码全部 200 且生效（P9d/P9e/P9f）；审计台账 110 条可查（P9k） |
| 云文档实际落盘配置存储目录 | ✅ | 磁盘路径 `data-nas/users/Alice/projects/产品蓝图-*/需求/…` 与平台树一致，内容字节级一致（P4b/P4d/P4g） |
| 用户注册可走通（LDAP 预留） | ✅ | P1a/P1e/P1f + P0b |
| 注册即得个人示例知识库 | ✅ | P1b/P1c（4 篇）+ P1d（落盘） |
| 新建文档库支持模板/空库与双存储源 | ✅ | P4a（模板+云）、P6a（模板+Git）；空库与 starter-pack 由同一接口支持 |
| GitLab 连接配置可增可验 | ✅ | P5a/P5b/P5c；Token 加密落库、验证结果与原因持久化 |
| Git 仓库自动初始化 | ✅ | P6a/P6b（服务端建仓）；已存在关联路径首轮实测（created=false，仓库内容未覆盖） |
| 仓库文件增删查改并自动提交 | ✅ | P6d–P6g；服务端提交历史与平台操作对应（提交消息含路径与操作者） |
| 项目空间可分享并多人协作 | ✅ | P7a–P7g；不丢失机制：版本冲突 409（P4e）+ WS 互见广播（§4） |
| 文档可发布为平台子路径网站 | ✅ | P8a–P8e + 本记录复验 `/sites/ewiki-e2e-site-pl36/` 200（index/doc/css） |
| 关键操作有可追踪台账 | ✅ | `audit_logs` 110 条：注册/登录/建库/连接/自动提交/分享/发布/管理员操作全覆盖（P9k） |
| 越权访问被拦截 | ✅ | P3（非成员读 403）、P7d（editor 管理成员 403）、P7g（guest 写 403）、P9c（非 admin 管理页 403） |
| 备份与回滚演练 | ✅ | `backups/backup-20260909-222131.zip`；临时库还原校验 users=4/documents=69/connections=8，原库无扰动（见 docs/backup-rollback.md §3.3） |

## 3. 本轮平台化扩展清单（代码落点）

- 新包 `packages/storage`（NAS 路径解析/安全拼接）
- `packages/db`：新表 `storage_connections`、`platform_settings`；`users.last_login_at`（迁移 `0002_lumpy_joystick.sql`）
- `apps/server`：注册+示例库、LDAP 预留、连接配置 CRUD/验证、建库向导 `projects/with-storage`、文档 NAS 镜像+Git 自动提交（`lib/git-host.ts`、`lib/git-push.ts`、`lib/nas.ts`、`lib/library-templates.ts`）、系统管理与审计路由、`/sites/:slug/*` 公开服务、项目级越权拦截（`lib/permissions.ts`）、生产模式静态托管（WEB_DIST）
- `apps/worker`：发布产物写入用户 NAS 站点目录（vN+current.json）
- `apps/web`：注册页签、存储配置页、系统管理页、新建文档库向导、发布子路径真实链接、编辑器版本冲突保护 + 实时互见（WS）
- 修复：文档路由越权缺口（原实现任何登录用户可读写任意项目文档）；worker git token 内嵌确认无缺陷（输出脱敏导致误判）

## 4. 多人协作机制说明（互见与不丢失）

- **不丢失**：保存携带 `baseVersionNo`，与最新版本不符返回 409；前端提示「加载最新/留在当前」，绝不静默覆盖。
- **互见**：保存后向项目房间广播 `document.updated`（pg_notify → realtime WS）；他人在看同一文档且无未保存修改时自动刷新，有未保存修改时提示并将在其保存时触发冲突检测。
- **边界**（与目标假设一致）：本期为「基础同步机制」，不承诺 OT/CRDT 字符级合并；同段落同时编辑以冲突提示收尾。

## 5. 边界与遗留（如实声明）

- GitLab 方言按 REST v4 实现（验证/查仓/建仓/克隆推送），本地无 GitLab 实例，实测走 Gitea 兼容方言；两类实例共用同一条管线与错误映射，接真实 GitLab 仅需可用实例与 Token。
- 发布站点路径按「用户当前姓名」解析，用户改名后历史站点目录不迁移（记录在案，后续加目录别名）。
- LDAP、子域名发布、本地客户端形态、生产级高可用：本期范围外（见 Goal Brief）。
- worker 同步为浅克隆（单向拉取），与平台推送工作副本分离，互不污染。

## 6. 验收数据快照（验收结束时）

- 用户 4（admin/Alice/Bob/Carol）· 项目空间 17 · 文档 69 · 数据源 5 · 存储连接 8 · 发布站点 8（4 个已发布 v1）· 审计台账 110 · 自动提交任务 6
- E2E：`scripts/e2e-report.json` total 51 / passed 51 / failed 0（耗时 ~8.9s）
- 抽验 URL：`http://localhost:3000/sites/ewiki-e2e-site-pl36/`（匿名 200）

## 7. 修订记录（2026-09-10）

### 越权核验加深 → 发布配置权限缺口修复（补充验收证据）

- 第二轮只读核验发现真实缺口：`GET /api/v1/projects/:id/publish-sites` 与 `PATCH /api/v1/publish-sites/:id` 缺少项目级权限校验（非成员可读站点配置、可改 slug）。
- 系统性排查后为全部项目级路由补齐 `projectAccess` 校验（共 22 处）：项目详情/概览、成员读改、文档列表（全局列表范围过滤）与版本历史、知识图谱、数据源增删改同步、活动流（含全局流可见性过滤）、发布配置读写与发布历史、发布预览、AI 整理、导入任务。
- 复验（工具输出含 `AUTOCLAW_GOAL_CHECK_V1 passed:true`）：**21/21 通过** —— 两个非成员（bob/carol）对私有库的 10 类资源读取均 403；全局文档/数据源/动态流列表零泄露；普通用户访问管理 API 403；所有者与管理员阳性对照 200。
- 核验夹具：项目「项目空间 Wiki-mtu6p8pg」上的未发布站点草稿 `perm-evidence-site`（用于发布历史 403 断言，不影响平台数据）。
- 口令管理备注：bob 密码在验收流程中被管理员重置为流程内新口令，核验脚本使用流程内凭据。
