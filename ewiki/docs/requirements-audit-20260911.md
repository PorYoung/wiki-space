# ewiki 平台需求完成度审计与链路验证报告

> 审计时间：2026-09-11 · 验收脚本：`node scripts/e2e-platform.mjs`（53/53 通过，8.0s）· 环境：PostgreSQL 16（ewiki-pg）+ Gitea 1.27（gitea:3300）+ server/realtime/worker（tsx watch）

## 一、需求完成度清单（10/10）

| # | 需求 | 状态 | 关键实现 |
|---| --- | --- | --- |
| 1 | 系统管理页面（用户/数据库/存储） | ✅ 已实现 | `apps/web/src/pages/AdminPage.tsx`（/admin）；`apps/server/src/http/routes-platform.ts`：用户管理(:627+)、`GET /admin/system`(:702) DB 版本/表行数/NAS 用量、NAS 根目录运行时切换(:790)、审计台账(:810)，仅管理员可见 |
| 2 | 云文档默认存服务器存储目录（模拟 NAS） | ✅ 已实现 | `apps/server/src/lib/nas.ts`：`getNasRoot()` 优先级 平台设置 > env `FS_NAS_ROOT` > `./data-nas`；`mirrorDoc()` 按 `users/<用户>/projects/<库slug>-<id8>/` 落盘；文档增删改均调用 `docStorageEffects()` 镜像 |
| 3 | 用户注册 + 企业 LDAP 预留 | ✅ 已实现 | `POST /api/v1/auth/register`（routes-platform.ts:235）；LDAP 预留 `GET/POST /api/v1/auth/ldap/*`（:312-324，`lib/ldap.ts` 适配器位），本期未启用 |
| 4 | 注册自动创建个人示例知识库 | ✅ 已实现 | 注册流程（:253-291）以 `getLibraryTemplate('personal-sample')` 建库、插 4 篇示例文档并同步 NAS 镜像 |
| 5 | 新建文档库：模板/空库 × 云文档/Git | ✅ 已实现 | `apps/web/src/pages/NewProjectPage.tsx`（/projects/new 四步向导，唯一建库入口：Dashboard 与 Library 页头均跳转此处）；服务端 `POST /api/v1/projects/with-storage`（:465），模板解析含 空库/富模板/6 个 starter-pack |
| 6 | 存储配置页（GitLab 连接配置） | ✅ 已实现 | `apps/web/src/pages/StorageConnectionsPage.tsx`（/connections）；服务端 connections CRUD+验证（:337-462），Token AES-256-GCM 加密落库（`packages/db/src/secretbox.ts`），支持 GitLab（第一方言）/Gitea（兼容演示） |
| 7 | Git 库只填仓库名称+选连接配置，自动初始化 | ✅ 已实现（本次修复后全入口一致） | 向导提交 `{git:{connectionId,repoName,autoInit}}`；服务端校验仓库名正则、按连接配置取凭据、`ensureRepo/findRepo` 自动建仓/关联（:534-617）。数据源页 Git 源本次同步迁移（见修复说明 A）；`POST /api/v1/sources` 现拒绝直填 Git 地址（e2e P5e 断言） |
| 8 | 仓库文件增删查改 + 自动提交 | ✅ 已实现 | `routes.ts` documents CRUD（:735-1086）→ `docStorageEffects()` Git 分支读 `configPublic.autoCommit` → `ensureWorkdir`+`commitAndPush`（`lib/git-push.ts`），提交人=操作用户，`sync_jobs` 留痕；e2e P6d/P6f 验证 |
| 9 | 分享项目空间，多人共享与协作编辑 | ✅ 已实现 | 成员四角色 `GET/POST/PUT /projects/:id/members`（routes.ts:1183+）+ `project_members` 表；WS+Yjs 协同（apps/realtime）；版本冲突 409 保护；e2e P7 权限矩阵全过 |
| 10 | 按模板发布为平台子路径站点 | ✅ 已实现 | 5 套发布模板（`GET /publish-templates`）；worker 渲染产物写 `users/<用户>/sites/<slug>/vN+current.json`；匿名访问 `/sites/<slug>/`（routes-platform.ts:901+）；e2e P8 验证 |

## 二、链路验证结果（e2e-platform.mjs，53/53 PASS）

| 分组 | 覆盖内容 | 结果 |
| --- | --- | --- |
| P0 | 健康检查、LDAP 预留 | 2/2 |
| P1-P3 | 注册/重复注册 409/弱密码 400、示例知识库+示例文档、NAS 落盘、多用户、越权 403 | 9/9 |
| P4 | 云文档库：模板创建、NAS 落盘结构一致、文档增改、版本冲突 409、三方内容一致 | 7/7 |
| P5 | 连接配置：验证成功/错误令牌/类型限制；**新增** P5d 数据源 Git 模型（连接配置+仓库名+自动建仓）、P5e 直填 Git 地址被拒 400 | 5/5 |
| P6 | Git 库：自动初始化、服务端建仓、工作副本克隆、新建/更新文档自动 commit+push、服务端历史与内容核对、关闭自动初始化 404 | 8/8 |
| P7 | 分享协作：editor 读写、editor 无法管理成员、guest 只读 403 | 7/7 |
| P8 | 发布：站点创建、任务入队、worker 渲染发布、子路径匿名访问、产物落用户存储目录 | 5/5 |
| P9 | 系统管理：管理员登录、用户增禁用/重置密码、DB/存储状态、NAS 根目录切换演练、审计台账 | 10/10 |

本次运行总耗时 **8.0 秒**（修复前 Git 相关步骤单请求即超 60-120s，见下）。

## 三、问题修复说明

### A. 「新建 Git 文档库仍需输入完整 Git 地址、缺少连接配置入口」（需求 5/6/7 不符）

**根因**：主向导 `NewProjectPage`（/projects/new）本身已符合「连接配置下拉 + 仓库名称 + 自动初始化」设计；不符的是周边入口与陈旧产物：

1. **`SourcesPage.tsx` 添加数据源弹窗（活代码，/sources 路由）**：Git 表单仍是「仓库 URL + 分支 + 认证方式 + Token」直填模型，无连接配置选择 → **已改造**为与向导一致的「连接配置选择 + 仓库名称 + 自动初始化」，凭据由服务端从连接配置解密，前端不再接触 Token；
2. **服务端 `POST /api/v1/sources`**：原先原样接受 `configPublic.url` → **已改造**为 Git 类型强制走连接模型（校验连接归属、`validateConnection`、`ensureRepo/findRepo` 自动初始化、写入 `configPublic{url,host,kind,namespace,repoName,autoCommit,connectionId}`）；直填 Git 地址返回 400（e2e P5e 固化）；
3. **`StarterPackWizardModal.tsx`（从模板创建向导）**：唯一调用方 LibraryPage 已改为跳转统一向导，该组件成为死代码 → **已删除**；其依赖的服务端 `POST /api/v1/projects/init-from-starter`（直填 Git 地址模型）**已下线**（`STARTER_PACKS` 清单保留，with-storage 的模板解析继续使用）；
4. **`DashboardPage.tsx` 残留**：页内旧简版弹窗（直填仓库地址模式）删除不彻底，存在死引用与编译错误 → **已清理**，「新建文档库」按钮统一跳转 /projects/new；
5. **`apps/web/dist` 为 11:55 旧构建**（仍打包旧版向导）→ **已重建**，server 托管的前端（WEB_DIST）即为修复后版本。

### B. Git 自动提交/初始化偶发超时甚至挂死（性能缺陷，验证链路时发现）

**现象**：e2e P6a/P6d 频繁超时（60s），DB 时间线显示 with-storage 的 Git 管线耗时 85-115s；手动复现 `git push` 走默认配置 96.5s、clone 挂死 120s+，而 `127.0.0.1` 直连同一操作 0-7s。

**根因**：本机 git 全局配置 `http.proxy=127.0.0.1:20809`，代理对 `localhost` 主机名的路由处理不可靠（回环流量被绕道代理转发，时快时慢甚至挂死）。`NO_PROXY` 环境变量对该 git/libcurl 组合不生效（显式 http.proxy 配置优先）。

**修复**（`apps/server/src/lib/git-push.ts`、`apps/worker/src/index.ts`）：Git 管线对回环主机（localhost/127.0.0.1/::1）：
- 克隆/拉取前将 URL 主机名重写为 `127.0.0.1`（`loopbackDirectUrl`），push 前同步修正工作副本 remote 配置；
- 附加 `-c http.proxy= -c https.proxy=` 显式清空代理 + `NO_PROXY` 环境变量（双保险）；
- 非回环主机（企业 GitLab 等）保持用户代理配置不变。

**效果**：完整 e2e 从「Git 步骤反复超时」到 **8 秒全绿**（含 Git 自动建仓、自动提交、发布、NAS 切换演练）。

## 四、遗留与建议

- 发布侧 `@ewiki/render` 仍为极简 Markdown 渲染（表格/公式/流程图不支持），需与应用内预览渲染管线同源化（另起任务）；
- `GET /api/v1/documents` 仍为 500 条硬上限，数据量逼近时需升级真服务端分页；
- dev 服务本次以 Windows 计划任务（ewiki-dev-server / ewiki-dev-realtime / ewiki-dev-worker）托管，可 `schtasks /End` 停止或保留复用。
