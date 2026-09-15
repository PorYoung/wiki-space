# 对外开放 API（OpenAPI）· MCP 服务 · 设计与落地规划

> 状态：**已实施（2026-09-15 全量落地，验收 e2e 124/124）**。
> 关联：`docs/DESIGN.md`（§4.1 通用契约约定、§4.5 版本策略、ADR-5/14 开放推送 API 的历史教训、ADR-11 方言边界）、`specs/TEAM-PERMISSIONS-DESIGN.md`（五态可见性、决策 5"本期不做匿名读"、`readableProjectIdsSql` 单一口径）、`specs/SEARCH-VECTOR-DESIGN.md`（SearchService 端口、写路径收敛点 §6.1、开放问题 Q6"匿名检索"）、`specs/EXT-PLATFORM-PLAN.md`（ADR-P1 Provider 模式）。
> 证据约定：现状结论均以 `file:line` 标注，已逐行核实。范围：ewiki（apps/server + packages/* + deploy，新增 packages/mcp）。

---

## 0. 结论（TL;DR）

诉求：把现有文档知识库能力对外提供 **MCP 服务**与 **OpenAPI 接口**，按三个维度开放——**公开的知识库检索**、**个人的知识库检索**、**个人的知识库管理**，最终让用户自己的 AI 客户端（Claude/Cursor/自建 Agent 等）能直接检索与管理知识库。

| # | 缺口 | 根因（现状证据） | 方案 |
|---|---|---|---|
| 1 | 无机器身份：外部 AI 无法稳定接入 | 全平台只有 15 分钟 JWT + 7 天 refresh token（`apps/server/src/auth/utils.ts:25-37`），无 API key/token 表；`app.use('/api/v1/*')` 全局守卫仅认 JWT（`routes.ts:340`） | 新增 `api_tokens`（PAT，sha256 落库、scope 分级、可吊销/过期），开放面中间件 `requireToken(scopes)` 认证后**复用既有用户权限口径** |
| 2 | 无对外开放面：`/api/v1` 全部是 web 内部消费 | 全仓无任何 openapi/swagger/mcp 代码（已搜索确认）；`GET /api/v1/search` 等均挂 JWT 守卫（`routes.ts:1383`） | 新建稳定契约面 `/api/open/v1/*`（OpenAPI 3.1 文档自动产出），与内部 `/api/v1` 物理隔离、独立演进 |
| 3 | 无公开（匿名）检索 | 权限 spec 决策 5"本期不做匿名读"；检索唯一口径 `readableProjectIdsSql` 要求 uid（`permissions.ts:111,124`） | 窄开口两个匿名端点：**站点范围**（发布站访客检索，按最近发布清单过滤）与**平台公开面**（默认关，仅 `public-*` 五态库）；复用权限函数新增匿名变体 |
| 4 | 无 MCP：AI 无法"读-写"闭环地帮用户管知识 | 无 MCP server；对外仅有 `/sites/:slug` 匿名静态站与 HMAC 签名 raw URL（`raw-sign.ts:21-53`） | `@ewiki/mcp` 包：**工具清单 = 开放 REST 的 1:1 投影**，双形态（stdio 桥给本地 AI 客户端 + server 内挂 Streamable HTTP 给远端 Agent），执行器统一回环开放 REST，行为单源 |

**八条核心决策**（详见 §5 ADR-O1~O8）：

1. **独立开放面 `/api/open/v1`**：不改动内部 `/api/v1`（web 专用、可随时破坏性演进）；开放面 OpenAPI 3.1 契约先行、向后兼容承诺（信封/分页沿用 SDD §4.1，升级为公开契约）。
2. **机器身份 = PAT（Personal Access Token），act-as-user + scope**：token 属于某个真实用户，认证后权限解析与登录态**完全同源**（`readableProjectIds(uid)` + `projectAccess`），不新造任何权限语义。scope 三级：`search` / `read` / `write`。
3. **MCP 是开放 REST 的投影层，不是第二条能力通路**：工具执行统一走开放 REST（托管形态用 Hono 进程内 `app.request` 回环、stdio 桥走网络 fetch），杜绝"两套实现行为漂移"。
4. **对外写路径必须复用既有收敛点**：提取 `documentService`（创建/保存/软删/移动），内部路由与开放路由共同调用——副作用（NAS 镜像 + git push `docStorageEffects`、版本快照、索引入队 `enqueueSearchIndex`）一处不少。
5. **公开检索窄开口 + 默认关 + kill switch**：站点检索按最近一次发布清单（path 白名单）过滤，防未发布内容泄露；平台公开面仅覆盖 `public-read/public-write` 库，管理端开关默认关闭。
6. **限流双层**：匿名按 IP（应用层滑窗）、token 按维度配额（search/read/write 各自阈值，管理端可调）；多副本内存态 ≈N× 放宽如实声明，硬配额走 PG 计数（预留）。
7. **审计延续单口径**：`audit_logs`（`schema.ts:454`）记 actor=用户 + detail 带 tokenId；公开检索采样审计 + 限流计数可观测。
8. **版本与兼容**：`/api/open/v1` 加字段原位发布、破坏性变更升 `/v2` 并行 ≥6 个月（SDD §4.5 既定策略的公开面版本）。

**与 ADR-14 的关系（评审必问，先答）**：R4 曾删除"开放推送 API + push_tokens"（ADR-14）——被删除的是**与 sources 概念绑定的、语义重复的推送通道**，不是"对外能力"本身。本方案无 sources 概念包袱、机器身份（PAT）与 push_tokens（写入凭据）形态不同，且读写均收敛到既有文档事实源，不复现当年问题。

---

## 1. 需求分析与场景

### 1.1 三维度的精确定义

| 维度 | 消费方 | 身份 | 内容边界 | 形态 |
|---|---|---|---|---|
| **D1 公开检索** | 发布站访客、站点内嵌搜索框、面向公网的 AI 问答窗口 | **匿名**（限流 + 平台开关） | 站点维度：最近一次成功发布的文档集合；平台维度（默认关）：`public-read/public-write` 库 | `GET /api/open/v1/sites/{slug}/search`、`GET /api/open/v1/public/search` |
| **D2 个人检索** | 用户自己的 AI 客户端（RAG/问答/整理）、第三方工具（带授权） | PAT（scope `search`/`read`） | token 属主的可读集合（五态 + 成员 + 团队，与登录态完全一致） | `GET /api/open/v1/search`、`GET .../documents/{id}` 等 |
| **D3 个人管理** | 用户自己的 AI 客户端（采集/归档/整理自动化） | PAT（scope `write`，隐含需 `read`） | 同上；建库限**个人归属**；不做跨库移动、不做成员管理 | 文档 CRUD + 标签 + 建库 |

边界声明：D2/D3 的 token **永远等价于"它的属主本人在操作"**——能看什么、能改什么与该用户登录后完全一致，token 不产生任何额外权限。这是权限模型零新增的根本保证（TEAM-PERMISSIONS 的五态/成员/团队语义原样生效）。

### 1.2 "AI 帮助知识管理"的四类编排场景（MCP 工具清单的推导依据）

| 场景 | 用户故事 | 需要的最小工具集 |
|---|---|---|
| **采集** | "把刚才讨论的方案整理后存进我的收集箱库" | `kb_list_projects`（找目标库）→ `kb_create_document` |
| **检索问答** | "我们内部是怎么处理 XX 的？"（RAG） | `kb_search` → `kb_read_document`（拼上下文） |
| **整理归档** | "把这份笔记归档到部署手册，打上标签" | `kb_search`（查重/找位置）→ `kb_update_document`/`kb_move_document` → `kb_set_tags` |
| **维护治理** | "找出内容重复/长期未更新的文档" | `kb_list_documents` + `kb_get_versions`（时间线索）+ `kb_search`（相似内容） |

四类场景的最小工具集 = §8 的 10 个工具，不多做（resources/prompts、断链分析、跨库移动均后置，见 §14）。

### 1.3 术语澄清

- **PAT（api_tokens）**：长期机器凭据，Bearer 方式使用，属主为真实用户；区别于 15 分钟 JWT（web 用）与 7 天 refresh token（JWT 续期用）。
- **开放面 vs 内部面**：`/api/open/v1`（本文新增，稳定契约、机器消费）与 `/api/v1`（既有，web 前端专用、内部自由演进）。token 管理本身（创建/吊销自己的 token）属于**内部面**的人用功能（web 设置页）。
- **MCP 双形态**：stdio 桥（本地进程，给 Claude Desktop / Cursor 等桌面客户端）与托管 Streamable HTTP（server 内挂 `/api/open/v1/mcp`，给远端/云端 Agent）。工具定义单源，传输不同。

---

## 2. 现状盘点（2026-09-15 逐行核实）

| # | 事实 | 证据 | 设计含义 |
|---|---|---|---|
| F1 | 全局守卫只认 JWT：`app.use('/api/v1/*')` 校验 Bearer + 每请求回查 `users.status` | `routes.ts:340-363` | 开放面需要并行的守卫链，不能复用 JWT 中间件 |
| F2 | 无任何机器身份实体：全仓无 api key/token/OAuth 代码；`apiKey` 仅指 embedding 服务配置 | Explore 报告 §8；`config.ts` | PAT 是全新表 + 中间件，迁移从 **0011** 起（现至 0010） |
| F3 | 检索有干净端口与实现：`SearchService.search(req)`，`SearchRequest{q,mode,projectIds,projectId,tags,limit,offset}`，权限以 `projectIds[]` 由路由层物化下推 | `ports/index.ts:63-98`、`adapters/pg/search.ts:64,73`、`routes.ts:1383` | 开放检索端点 = 换一层鉴权与限流，服务零改动 |
| F4 | 权限单口径：`readableProjectIdsSql(uid)` / `readableProjectIds(uid)`，五态 CHECK 约束 | `permissions.ts:111,124`、`schema.ts:123,162` | D2/D3 权限零新增；D1 需匿名变体（§6.2） |
| F5 | 写路径副作用已收敛：`docStorageEffects(Batch)`（NAS 镜像 + git push）+ 版本快照 + `enqueueSearchIndex` 挂 7 处路由 | `routes-platform.ts:136,317`、`shared/search.ts:153` | 对外写必须走同一批函数 → 需提取 service 供内外共同调用（ADR-O4） |
| F6 | 文档路由现状：GET/PUT/PATCH/DELETE `/api/v1/documents/:id` + POST `/projects/:id/documents`，PUT 乐观并发 `baseVersionNo` | `routes.ts:1534,1574,1939,2058,2130` | 开放写契约沿用 `baseVersionNo` 并发语义，AI 客户端同样受并发保护 |
| F7 | 契约约定已定：成功直返资源；错误 `{code,message,details?,requestId}`；分页 `?page=&pageSize=` → `{items,page,pageSize,total}`；URL 主版本 `/v1` 破坏性升 `/v2` 并行 ≥6 月 | `docs/DESIGN.md:312-315,438` | 开放面直接沿用，不再发明第二套信封 |
| F8 | 运行时配置底座已有：`platform_settings` KV（加密 secretbox 支持管理端覆盖，10s TTL 生效） | `schema.ts:418`、`lib/search-settings.ts` | 公开检索开关、限流阈值走同一底座，管理端有现成页签模式（检索与任务） |
| F9 | 匿名面先例：`/api/v1/open/*`（Caddy site-check）、`/sites/:slug/*` 静态站、HMAC 签名 raw URL | `routes-platform.ts`、`raw-sign.ts:21-53` | D1 的匿名先例成立；签名 URL 机制不动 |
| F10 | 历史教训：开放推送 API 与 push_tokens 随 ADR-14 删除（概念重复） | `docs/DESIGN.md:636,645,665` | 本方案的 PAT 与之形态/语义不同，需在评审中显式切割（§0 末段） |
| F11 | 部署 6 容器（caddy/server×2/realtime/worker×2/postgres/minio），无新增有状态组件文化（ADR-8） | `deploy/compose.yml` | MCP 不新增容器：stdio 桥是客户端侧进程；托管形态并入 server |

---

## 3. 目标与非目标

**目标（本专项）**

1. 机器身份：PAT 全生命周期（签发一次明文、哈希落库、前缀展示、吊销、过期、最后使用时间、scope）+ web 设置页自助管理。
2. 开放面 `/api/open/v1`：OpenAPI 3.1 文档（`GET /openapi.json`）+ 三个维度的 REST 端点，鉴权/限流/审计齐备。
3. MCP：`@ewiki/mcp` 单包双形态（stdio 桥 + 托管 Streamable HTTP），10 个工具覆盖 §1.2 四场景。
4. 公开检索：站点访客搜索（含发布模板搜索框）与平台公开面（默认关、kill switch）。
5. 对外写与内部写行为单源（service 提取），内部 e2e（当前 96 项）零回归。

**非目标（本期不做，见 §14 开放问题）**

- OAuth 2.1 / 动态客户端注册（MCP HTTP 授权的"标准姿势"）——待企业 SSO 落地后评估；本期 PAT Bearer 为**显式声明的偏差**。
- 二进制/附件上传的开放 API（binary 不入索引，采集场景 v1 以 markdown 文本为主）。
- 跨库移动文档、成员/权限管理 API、团队管理 API（管理面维持 web 内部）。
- MCP resources / prompts / 订阅、webhook 事件推送、实时协同（WS）对外开放。
- 匿名**写**任何东西；公开面的全文批量导出（防爬：仅检索 snippet + 站点已发布页）。
- 多租户计费/用量报表（私有部署单租户语境）。

---

## 4. 总体架构

一次实现、三个消费形态、一个契约面：

```
                         ┌────────────────────────────────────────────┐
  用户 AI 客户端          │              apps/server (Hono)             │
  (Claude/Cursor/Agent)  │                                             │
   │ stdio (本地进程)     │  /api/open/v1/*        /api/v1/* (内部,不动) │
   │  ┌──────────────┐   │  ┌───────────────────┐  ┌───────────────┐  │
   └─▶│ @ewiki/mcp   │──fetch──▶ requireToken   │  │ JWT 守卫       │  │
      │ stdio 桥      │  │  │ (PAT→uid+scope)    │  │ (routes.ts:340)│  │
      └──────────────┘  │  │   │                 │  └───────┬───────┘  │
                        │  │   ▼                 │          │          │
  远端/云端 Agent        │  │ routes-open.ts      │          ▼          │
   │ Streamable HTTP    │  │ (@hono/zod-openapi) │   既有路由 handlers  │
   └────────────────────┼─▶│   │    ▲            │          │          │
                        │  │   │    └─ app.request 进程内回环            │
  站点访客(匿名)         │  │   ▼        (@ewiki/mcp 托管形态)          │
   └────────────────────┼─▶│ 限流(IP) → 站点/公开检索                    │
                        │  └────┬─────────────┘                      │
                        │       ▼ 共同下沉                            │
                        │  SearchService / documentService(提取)      │
                        │  permissions.readableProjectIds            │
                        │  docStorageEffects + enqueueSearchIndex    │
                        └────────────────────────────────────────────┘
```

要点：

- **开放面自带完整链路**（token 认证 → scope 门 → 限流 → 路由 → service），内部面原样不动；两者只在 service 层汇合。
- **MCP 托管形态走进程内回环**（Hono `app.request`，带同一 Authorization 头）：行为与外部客户端逐字节一致（自吃狗粮），不因"自己人"走捷径产生旁路。
- **stdio 桥零部署**：`npx @ewiki/mcp` + 两个 env（`EWIKI_BASE_URL`/`EWIKI_TOKEN`），客户端侧进程，服务端无感知。

---

## 5. 架构决策（ADR-O1~O8）

### ADR-O1 · 独立开放面 `/api/open/v1`，OpenAPI 契约先行，不改造内部 `/api/v1`

| 备选 | 结论 |
|---|---|
| **新建开放面（采纳）** | 内部面（`routes.ts` 3790 行）可保持 web 专属的演进自由；开放面用 `@hono/zod-openapi` 从第一行起就是规范驱动，`GET /api/open/v1/openapi.json` 自动产出、永不过期 |
| 给 `/api/v1` 全量补 OpenAPI 注解 | 3790 行路由改造成本高、且把"内部可随变"与"对外须稳定"耦合在同一 URL 空间，错误率与心智负担双高 |

兼容承诺（公开契约的绷带）：信封（成功直返资源 / 错误 `{code,message,details?,requestId}`）、分页（`{items,page,pageSize,total}`）、限流响应头 `X-RateLimit-*`，全部沿用 SDD §4.1——不再发明第二套。破坏性变更升 `/api/open/v2` 并行 ≥6 个月。

### ADR-O2 · 机器身份 = PAT（act-as-user + scope），OAuth 2.1 后置为显式偏差

- token 形如 `ewk_<base64url(32B)>`；库内仅存 `sha256(token)` + 前 12 字符前缀（列表展示与定位）。明文只在签发响应中出现一次。
- **act-as-user**：认证 = 查哈希 → 校验 revoked/expired → 加载属主 users 行（status 必须 active）→ 以 `uid = token.userId` 进入既有权限体系。token 不引入"服务账号/应用身份"新概念（`users.globalRole` 语义不变，`schema.ts:45`）。
- **scope 三级**：`search`（检索）/ `read`（读全文与元数据）/ `write`（管理写）。端点声明所需 scope，缺则 `403 insufficient_scope`。签发 UI 提供三个预设：检索专用（search）/ 只读（search+read）/ 读写（全部）。
- **MCP 授权偏差声明**：MCP Streamable HTTP 规范推荐 OAuth 2.1；私有部署 + 单租户语境下 v1 采用 PAT Bearer（业界私有部署常见做法），在 `/mcp` 端点文档与 401 响应体中显式声明。OAuth 2.1 + DCR 列为 M4（依赖企业 SSO/`ssoSubject` 预留字段成型）。

### ADR-O3 · 权限零新增：认证后完全复用 `readableProjectIds` / `projectAccess`

开放面不做任何"token 特有"的权限判断；可见性五态、成员四角色、团队档位的并集语义原样生效。收益：权限 spec 的单口径约束（`permissions.ts:111` 注释强制）自动覆盖对外面，不存在"第二套权限真相"。唯一新增是 D1 的**匿名变体**（§6.2），它是既有函数的退化参数（uid=null → 仅 public-*），不是平行实现。

### ADR-O4 · 对外写路径复用既有收敛点：提取 `documentService`，禁止旁路

现状写副作用分散在路由 handler 内（`routes.ts:1939` 创建、`:1574` 保存、`:2058` 软删、`:2130` 移动）但全部收敛到 `docStorageEffects` + 版本快照 + `enqueueSearchIndex`（SEARCH-VECTOR §6.1）。开放写若各自实现等价逻辑，必然漂移。方案：

1. 新建 `apps/server/src/lib/document-service.ts`：`createDocument / saveDocument / moveDocument / softDeleteDocument`，函数体 = 现有 handler 主体平移（校验 zod schema 复用 `@ewiki/shared/schemas`）。
2. 内部路由改为薄壳调用（行为不变，e2e 96 项作为回归证据）；开放路由同样调用。
3. 评审守则：**任何新的文档写路径（含未来的协同 flush）必须经 `documentService`**——与 SEARCH-VECTOR R4 的索引钩子守则同构。

### ADR-O5 · MCP = 开放 REST 的投影层：工具执行统一回环，单包双形态

| 备选 | 结论 |
|---|---|
| **MCP 工具 → 开放 REST（采纳）** | 行为单源（鉴权/scope/限流/审计对 MCP 客户端与 REST 客户端完全一致）；工具层只做"参数模式 + 描述文案 + 结果裁剪"三件事，可维护性最高 |
| MCP 工具直调 service 函数 | 托管形态与 stdio 桥将出现两条执行路径；绕过限流与审计；实现重复 |

- 单包 `packages/mcp`：`defineTools(client)` 返回工具清单；`client` 是 `OpenApiClient` 接口，两个实现——`LoopbackClient`（Hono `app.request`，托管形态用）与 `HttpFetchClient`（stdio 桥用）。
- 托管形态挂 `POST|GET|DELETE /api/open/v1/mcp`（MCP Streamable HTTP，**stateless 模式**——server×2 副本无需粘性路由，与部署约束一致）。
- stdio 桥：`packages/mcp` 提供 bin，env `EWIKI_BASE_URL` + `EWIKI_TOKEN`，可选 `EWIKI_ALLOW_WRITE=0` 过滤全部写工具（只读接入的安全旋钮）。
- MCP SDK 锁定官方 `@modelcontextprotocol/sdk` 固定版本（生态演进快，升级走专项）。

### ADR-O6 · 公开检索：窄开口、清单过滤、默认关

| 决策点 | 选择 | 理由 |
|---|---|---|
| 站点检索的内容范围 | 最近一次成功发布的文档清单（path 白名单，读发布工件 `current.json` 等价物 + 短 TTL 缓存） | 发布站是快照语义（ADR-4），检索若直接打活库会把**未发布编辑**泄露给匿名访客；path 白名单挡住"未发布的新文档"，残余偏差（同 path 内容新于快照）如实声明为已知风险（§12 R3） |
| 平台公开面 | `GET /public/search`，仅 `public-read/public-write` 库，**默认关闭**（platform_settings），开启需管理员显式操作 | 权限 spec 决策 5"本期不做匿名读"只被窄口径突破；站点维度是既有匿名面（`/sites/:slug`）的自然延伸，平台维度是显式 opt-in |
| 返回内容 | 仅 `title/path/snippet(≤300 字符)/链接/score`，**无全文端点**；单页 ≤20 条 | 匿名面最小内容暴露；全文消费走站点已发布页面本身 |
| kill switch | 管理端一键停公开检索（两类端点同时 503/423） | 滥用/泄露应急（复用 §15.2 检索 kill switch 的管理端模式） |

### ADR-O7 · 限流双层 + 审计单口径

- **匿名（D1）**：按 IP 滑窗（应用内存实现，默认 10 次/分/IP，platform_settings 可调）。多副本内存态 → 实际阈值 ≈ 副本数 ×N，对"防爬与止血"足够；硬精确配额 → PG 计数表（预留，不做）。
- **token（D2/D3）**：按 token × 维度滑窗（search 60/分、read 120/分、write 30/分，默认值 platform_settings 可调），超限 `429` + `Retry-After`；响应统一带 `X-RateLimit-Limit/Remaining/Reset`。
- **审计**：复用 `audit_logs`（`schema.ts:454`），actor=属主 userId，detail 附 `{tokenId, tokenName, route}`——"谁授权的机器在何时做了什么"一条链查清。D1 匿名检索采样审计（1%）+ 限流拒绝全量计数（进管理端调用量视图）。

### ADR-O8 · 版本化与废弃策略

`/api/open/v1` 生命周期承诺：新增可选字段/新端点 = 原位兼容发布；字段删除、语义变更、必填新增 = `/v2` 并行 ≥6 个月 + `Sunset` 头预告。`openapi.json` 里的每个端点带 `deprecated: true` + `x-sunset-date` 后再实际下线。stdio 桥与服务端同仓同版本发布，天然同步。

---

## 6. 领域模型

### 6.1 `api_tokens`（迁移 `0011_open_api.sql`）

```sql
CREATE TABLE api_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL,                    -- 用户可读名（"我的 Claude"）
  token_prefix  text NOT NULL,                    -- 前 12 字符，列表展示/定位
  token_hash    text NOT NULL UNIQUE,             -- sha256(token) hex
  scopes        text[] NOT NULL,                  -- {search} | {search,read} | {search,read,write}
  expires_at    timestamptz,                      -- NULL = 永不过期（建议 UI 引导 1 年）
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);
```

写路径（内部面，web 设置页消费）：`GET/POST /api/v1/me/tokens`、`DELETE /api/v1/me/tokens/:id`（JWT 鉴权；只能管理自己的）。签发响应一次性返回明文；吊销即时生效（每请求查库，同 `users.status` 模式）。

### 6.2 匿名可读集合（权限函数的匿名变体）

`permissions.ts` 新增：

```ts
// D1 平台公开面专用：uid=null 的退化口径，仅 public-* 且未删除
export function anonymousReadableProjectIdsSql() { … WHERE visibility IN ('public-read','public-write') AND deleted_at IS NULL … }
```

站点维度不查该函数（范围 = 发布清单 path 白名单 ∩ 该站点项目），与权限体系解耦——发布本身已是显式的公开动作。

### 6.3 `platform_settings` 新键（复用既有 KV + 管理端模式）

| 键 | 默认 | 说明 |
|---|---|---|
| `openapi.publicSearchEnabled` | `false` | D1 总开关（站点 + 平台公开面共用） |
| `openapi.publicPerIpPerMin` | `10` | 匿名 IP 限流 |
| `openapi.searchPerMin` | `60` | token 检索配额 |
| `openapi.readPerMin` | `120` | token 读取配额 |
| `openapi.writePerMin` | `30` | token 写入配额 |

---

## 7. REST 契约（`/api/open/v1`）

### 7.1 通用约定

- 认证：`Authorization: Bearer ewk_…`（D1 两端点免认证）；scope 不足 → `403 {code:"insufficient_scope"}`；token 无效/吊销/过期 → `401`。
- 信封/分页/错误码：SDD §4.1 原样（F7）；新增错误码仅 `insufficient_scope`、`rate_limited`、`public_search_disabled`。
- 全部响应带 `X-Request-Id`（既有 requestId 中间件）与 `X-RateLimit-*`。

### 7.2 端点清单

**D1 公开检索（匿名）**

| 端点 | 说明 |
|---|---|
| `GET /sites/{slug}/search?q=&limit=` | 站点访客检索；范围=该站点最近发布清单；仅 keyword 模式（匿名面不外呼 embedding，成本与滥用面双控）；`publicSearchEnabled=false` 或站点不存在 → 404（不区分，防站点探测） |
| `GET /public/search?q=&limit=` | 平台公开面；匿名可读集合；同上仅 keyword |

**D2 个人检索（scope：search / read）**

| 端点 | scope | 说明 |
|---|---|---|
| `GET /search?q=&mode=&projectId=&tags=&limit=&offset=` | search | 与内部 `GET /api/v1/search` 同源调用 `PgSearchService`；响应含 `degraded` 语义 |
| `GET /projects?page=&pageSize=` | read | 属主可读的库列表（名称/可见性/我的角色/文档数） |
| `GET /projects/{id}/documents?folder=&tag=&q=` | read | 库内文档列表（元数据，不含 content） |
| `GET /documents/{id}` | read | 文档全文（title/path/content/tags/updatedAt/latestVersionNo） |
| `GET /documents/{id}/versions` | read | 版本列表（M2） |

**D3 个人管理（scope：write）**

| 端点 | 说明 |
|---|---|
| `POST /projects` | 建库（限个人归属 `ownerType:'user'`；`storageKind:'local'` 起步，git 内嵌存储经内部面配置后开放面只读） |
| `POST /projects/{id}/documents` | 建文档（path/title/content）→ 经 `documentService` |
| `PUT /documents/{id}` | 保存（content + `baseVersionNo` 乐观并发 + 可选 message）→ 冲突 `409` |
| `PATCH /documents/{id}` | 移动/重命名（newPath）/改标题 |
| `PUT /documents/{id}/tags` | 标签替换式设置 |
| `DELETE /documents/{id}` | 软删（可恢复语义在工具描述中声明） |

**MCP 托管端点**

| 端点 | 说明 |
|---|---|
| `POST|GET|DELETE /mcp`（挂 `/api/open/v1` 下） | Streamable HTTP，stateless；鉴权与 scope 同 REST；初始化时按 token scopes 裁剪工具清单 |

### 7.4 令牌签发（内部面契约 + 二次风险确认，评审决议 1/3）

- 端点（JWT 鉴权，web 设置页消费）：`GET /api/v1/me/tokens`（列表 + 近 7 天用量）、`GET /api/v1/me/token-policy`（生效策略回显）、`POST /api/v1/me/tokens`（签发，明文仅此一次返回）、`DELETE /api/v1/me/tokens/:id`（吊销，即时生效）。
- **write scope 二次风险确认（决议 1）**：设置页在签发含 `write` 的令牌时强制展示风险确认区，明示"该令牌允许 AI 自主创建知识库、新建/修改/移动/删除文档"，用户须勾选确认方可提交（`TokenSettings.tsx`）。
- 签发侧策略门：`allowTokens=false` → `403 TOKEN_POLICY_DISABLED`；scope 超出 `maxScope` → `403 TOKEN_POLICY_SCOPE`。
- 配套端点：`PUT /api/v1/teams/:id/token-policy`（团队 owner 维护策略，决议 3）；管理端 `/api/v1/admin/open-api*`（开关/配额/用量/令牌全景/强制吊销，决议 8）。

### 7.5 契约示例：`GET /search`（开放面）

```
GET /api/open/v1/search?q=向量检索%20构建&mode=auto&limit=10
Authorization: Bearer ewk_xxx
→ 200
{ "items": [ { "documentId": "…", "projectId": "…", "projectName": "部署手册",
    "path": "ops/vector.md", "title": "向量检索与全文索引",
    "snippet": "…<em>向量检索</em>的<em>构建</em>走 search-build 队列…",
    "score": 0.83, "reason": "hybrid", "heading": "索引管线/全量回填" } ],
  "hasMore": false, "tookMs": 142 }
```

与内部面响应的唯一差异：`projectName` 附带字段成为开放契约的一部分（内部面已有同名附带，检索 spec §14.1）。

---

## 8. MCP 工具面

### 8.1 工具清单（12 个，全部映射 §7.2 端点）

| 工具 | scope | 读/写 | MCP 注解 | 对应端点 |
|---|---|---|---|---|
| `kb_search` | search | 只读 | `readOnlyHint` | GET /search |
| `kb_read_document` | read | 只读 | `readOnlyHint` | GET /documents/{id} |
| `kb_list_projects` | read | 只读 | `readOnlyHint` | GET /projects |
| `kb_list_documents` | read | 只读 | `readOnlyHint` | GET /projects/{id}/documents |
| `kb_get_versions` | read | 只读 | `readOnlyHint` | GET /documents/{id}/versions |
| `kb_create_document` | write | 写 | — | POST /projects/{id}/documents |
| `kb_update_document` | write | 写 | `idempotentHint` | PUT /documents/{id} |
| `kb_move_document` | write | 写 | — | PATCH /documents/{id} |
| `kb_set_tags` | write | 写 | `idempotentHint` | PUT /documents/{id}/tags |
| `kb_delete_document` | write | 删 | `destructiveHint` | DELETE /documents/{id} |
| `kb_create_project` | write | 写 | — | POST /projects（决议 1：进清单；write token 签发时二次风险确认） |
| `kb_suggest_organization` | read | 只读 | `readOnlyHint` | GET /projects/{id}/ai-suggestions（决议 4：ai-classify 建议只读开放，执行仍需显式移动/打标） |

（建库工具描述强制"先 `kb_list_projects` 确认无合适库再建"，抑制库蔓延。）

### 8.2 工具描述编写守则（AI 可用性 = 工具描述质量）

- **检索优先**：`kb_create_document` 描述首句强制"创建前必须先 `kb_search` 查重，避免重复文档"。
- **并发安全用法**：`kb_update_document` 描述给出标准序列——read → edit → update(baseVersionNo)；409 时重新 read 再试，禁止盲写。
- **删除语义**：`kb_delete_document` 声明软删可恢复（v1 无恢复工具，恢复走 web 端），建议 AI 在删除前向用户复述目标文档标题。
- **参数即文档**：`mode` 枚举说明"auto=有向量用混合；未开向量自动降级 keyword（响应 degraded 提示）"；`heading` 字段说明是命中段落的标题链。
- 结构化输出：工具结果 = REST 响应原样 JSON（MCP structuredContent），不做二次包装。

### 8.3 错误映射

REST 错误信封直通为工具错误（`isError: true` + message），保留 `code`；409/429 的 message 面向 AI 可执行（"版本冲突：请重新读取文档后重试"/"速率限制：N 秒后重试"）。

---

## 9. AI 知识管理编排（端到端故事，验收用例来源）

1. **采集入库**：用户在 Claude Desktop 说"把这段结论存到我的收集箱"→ `kb_list_projects` 找"收集箱"→ `kb_create_document{path:"2026-09-15-方案结论.md"}`。服务端自动：版本快照 + git push + 索引入队（用户在 web 端立即可搜）。
2. **RAG 问答**：`kb_search(mode=auto)` → `kb_read_document` 拼上下文回答，引用 `path + heading`。
3. **整理归档**：`kb_search` 查重 → `kb_create_document` 或 `kb_update_document` → `kb_set_tags`。
4. **维护治理**：`kb_list_documents` 按库拉清单 → `kb_get_versions` 看 `updatedAt` 时间线 → 给出"90 天未更新"清单；重复内容靠 `kb_search` 相似命中。
5. **站点问答**（D1）：发布站嵌搜索框 → `/sites/{slug}/search`；面向公网的客服 AI 走同一端点（限流内）。

---

## 10. 配置与部署

- env（`apps/server/src/config.ts` zod schema 扩展）：`OPENAPI_ENABLED`（默认 true，气隙可整体关）、`MCP_STATELESS=1` 固定；token 限流与公开开关走 platform_settings（§6.3，运行时可调）。
- compose 拓扑**不变**（仍 6 容器）：stdio 桥是客户端侧 npm 包；托管 MCP 并入 server 进程。
- Caddy：无需新路由（`/api/open/v1/*` 走既有 server 上游）；若后续启用 Caddy 层 IP 限流模块再评估（v1 应用层已够）。
- OpenAPI 文档消费：`GET /api/open/v1/openapi.json` + 单页 Scalar/Redoc（CDN 引入，挂 `/api/open/v1/docs`，生产可关）。

---

## 11. 风险与应对

| # | 风险 | 概率 | 应对 |
|---|---|---|---|
| R1 | 对外写绕过副作用收敛点（丢 git push/索引/版本） | 中 | ADR-O4 service 提取是**前提工作**；e2e 断言开放写后 git 有 commit、chunk 可检索、版本 +1 |
| R2 | PAT 泄露（长生命周期凭据） | 中 | 哈希落库、前缀展示、一键吊销、`last_used_at` 异常可见、scope 最小化预设、可选过期；审计链（ADR-O7）；IP 绑定列开放问题 |
| R3 | 站点检索泄露未发布内容（同 path 内容新于快照） | 中 | path 白名单挡新增文档；残余偏差在站点检索响应带 `publishedAt` 提示；开放问题 Q6 评估"发布时内容快照"强保证 |
| R4 | AI 误操作（删错/覆盖文档） | 中 | baseVersionNo 并发保护 + 软删可恢复 + 工具描述守则（§8.2）+ write scope 独立签发 |
| R5 | 内外面行为漂移（开放面修了 bug 内部面没修，或反之） | 低 | service 层单源 + 96 项内部 e2e + 开放面 e2e（P13）双侧回归 |
| R6 | 限流内存态多副本放宽 ≈N× | 高（必然） | 如实声明；防爬场景叠加匿名低阈值；硬配额 PG 计数预留 |
| R7 | MCP 生态/SDK 破坏性演进 | 中 | SDK 锁版本；stdio 桥与工具层在单包内隔离传输细节；升级走专项 |
| R8 | 公开检索被批量爬取（拼 snippet 重建全文） | 低 | snippet ≤300 字符 + 单页 ≤20 + IP 限流 + kill switch + 采样审计；platform 公开面默认关 |

---

## 12. 分期实施计划

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M1 机器身份 + 个人检索** | 迁移 0011 + `requireToken` 中间件 + scope 门 + 限流骨架；`/api/open/v1/{search,projects,projects/{id}/documents,documents/{id}}` + `openapi.json`；web 设置页 token 管理；e2e P13（检索维度） | token 检索结果与同用户登录态**逐条一致**；无 scope 403；吊销后立即 401；私有库对他人 token 不可见；`openapi.json` 通过 schema 校验 |
| **M2 个人管理 + MCP** | `documentService` 提取 + 内部路由改薄壳（96 项 e2e 零回归为门禁）；D3 写端点；`@ewiki/mcp`（10 工具 + stdio 桥 + 托管 `/mcp` stateless）；接入文档 | e2e P14：开放写后 git/chunk/版本三断言；MCP 在真实客户端（Claude Desktop）完成 §9 场景 1-3 闭环；`EWIKI_ALLOW_WRITE=0` 时写工具不出现 |
| **M3 公开检索 + 治理** | 匿名可读 SQL 变体；`/sites/{slug}/search`（发布清单过滤）+ `/public/search`；IP 限流 + `publicSearchEnabled` kill switch；发布模板搜索框；管理端「开放接口」页签（开关/配额/调用量/公开 token 吊销） | 未发布文档在站点检索不可见；kill switch 后 404/423；限流 429 + Retry-After；发布站搜索框可用 |
| **M4 治理增强（预留）** | OAuth 2.1 + DCR（随 SSO）；`Idempotency-Key`；MCP resources/prompts；PG 硬配额；webhook | 届时另立 spec |

实施顺序依赖：M2 的 service 提取是开放写与未来一切写路径的地基，必须先行于 D3 端点；M3 依赖 M1 的限流骨架与管理端模式；M4 独立。

---

## 13. 开放问题 → 评审决议（2026-09-15）

| # | 问题 | 决议 |
|---|---|---|
| 1 | `POST /projects` 是否进 MCP 工具清单 | **进**（`kb_create_project`）；配套要求：write scope token **签发时**做二次风险提示与确认（UI 明示"该 token 允许 AI 自主创建知识库/写入文档"），见 §7.4 |
| 2 | 站点检索的强快照一致 | 本期维持"path 白名单 + `publishedAt` 提示"（R3 缓解态）；发布清单表（contentHash 级）留作后续发布管线专项 |
| 3 | token IP 绑定 / 使用策略 | **按企业组织规范落地，挂在团队维度**：`teams.token_policy`（是否允许 token、scope 上限、IP 白名单），签发与请求双侧校验；团队概念预留给组织架构接入（策略来源可替换，见 §6.4） |
| 4 | 内部 ai-classify 整理建议开放为工具 | **开放**（`kb_suggest_organization`，read scope，只读消费最近一次运行的建议） |
| 5 | 附件/二进制上传开放 API | 后置（维持开放问题，binary 不入索引） |
| 6 | `Idempotency-Key` 幂等写 | **已落地（2026-09-15 增补）**：D3 全部写端点支持 `Idempotency-Key` 头，2xx 响应快照按 (token, key) 落库 24h，重放返回原响应（`Idempotency-Replayed: true`），同键不同 method/path → `409 IDEMPOTENCY_CONFLICT`；见 §15.5 |
| 7 | 匿名公开面的 robots/爬虫协商 | `/public/search` 响应带 `X-Robots-Tag: noindex`；站点检索跟随站点页本身策略 |
| 8 | 用量报表 | **本期建**：per-token 用量日汇总表 + 管理端视图 + 审计事件全覆盖（签发/吊销/写操作/限流拒绝），见 §6.5、§10 |

### 13.1 补充设计（按决议 3/4/8 新增）

- **团队 token 策略（§6.4）**：`teams.token_policy jsonb`，默认 `{allowTokens:true, maxScope:'write'}`；用户签发 token 时取其所属团队的**最严策略交集**（scope 上限封顶、allowTokens=false 则拒绝签发）；请求侧校验 IP 白名单（配置了才启用）。策略结构预留 `source: 'local' | 'org'` 字段——组织架构接入后策略可切换为从组织系统同步，本地校验逻辑不变。
- **ai-classify 建议工具（§8.1 增补）**：`kb_suggest_organization(projectId)` → `GET /api/open/v1/projects/{id}/ai-suggestions`，只读返回最近一次 `ai_classify_runs` 的建议集（目标库/置信度/依据），AI 可据此引导用户确认后再调用 `kb_move_document`/`kb_set_tags`——**建议只读、执行显式**，与平台内"只建议不执行"原则一致。
- **用量统计与审计（§6.5、§10 增补）**：`api_token_usage`（token_id × 日期 粒度：search/read/write/rejected 四计数，UPSERT 累加，管理端 + 设置页可见）；审计事件清单：`token.created / token.revoked / token.policy_denied / open.write.*`（全部写操作）+ 限流拒绝计数进用量表。

---

## 14. 参考

- `docs/DESIGN.md`：§4.1 通用契约（信封/分页/版本）、ADR-5/14（开放推送 API 的历史）、ADR-8（实体收敛文化）
- `specs/TEAM-PERMISSIONS-DESIGN.md`：五态可见性、决策 5（匿名读本期不做）、`readableProjectIdsSql` 单一口径
- `specs/SEARCH-VECTOR-DESIGN.md`：SearchService 端口、写路径收敛点（§6.1）、管理端运行时配置底座（§15）
- `specs/EXT-PLATFORM-PLAN.md`：ADR-P1 Provider/env 模式、ADR-P2 单一事实源原则（本文 ADR-O4/O5 同构）
- MCP 规范：Streamable HTTP 传输、工具注解（readOnlyHint/destructiveHint/idempotentHint）、structuredContent
- OpenAPI 3.1 / `@hono/zod-openapi` / `@modelcontextprotocol/sdk`

---

## 15. 实施记录（2026-09-15 落地）

> 状态：**M1 + M2 + M3 全部落地**（含评审决议 1/3/4/8 的增强项）。单测/类型检查/协议冒烟已通过；**e2e P14/P15（新增 17 项断言）已编写，须在具备 docker（ewiki-pg / gitea）与本地全栈的环境中执行**（本机开发环境无 docker，见 §15.4 验证边界）。

### 15.1 实现策略的重要调整（与 §4/§5 ADR-O4/O5 的偏差，评审确认点）

开放写路径的"收敛点复用"**未采用 documentService 提取**，改为**进程内回环网关**：开放面路由完成 PAT 认证 → scope 门 → 团队策略 → 限流 → 用量记账后，铸造 15 分钟内部 JWT（`signAccessToken`），经 Hono `app.request` 回环调用内部 `/api/v1` 同源路由。理由：行为单源**按构造成立**（版本快照/`docStorageEffects`/`enqueueSearchIndex`/activity 零旁路），且内部 96+ 项 e2e 所覆盖的 3790 行路由零改动、零回归风险。代价：开放契约与内部响应形状耦合（由开放面 e2e 锁定）。`@hono/zod-openapi` 同样未引入——契约文档由 `lib/openapi-doc.ts` 手工维护单源（零新依赖，`GET /api/open/v1/openapi.json` 冒烟通过）。MCP SDK 未引入（npmmirror 离线仓无包）——协议层在 `packages/mcp` 零依赖手写（initialize/ping/tools/*，版本 2025-03-26/2025-06-18 协商，stdio 逐行 JSON-RPC + 托管 POST 无状态 JSON-RPC，SSE 未启用），已通过协议冒烟。

### 15.2 交付物清单

| 层 | 交付物 | 位置 |
|---|---|---|
| 迁移 | 0011（api_tokens / api_token_usage / teams.token_policy 默认值） | `apps/server/drizzle/0011_open_api.sql` |
| 领域 | PAT 生成/哈希/scope 门/团队策略合并（最严封顶 + IP 白名单 union + `source:'org'` 预留） | `apps/server/src/lib/open-tokens.ts` |
| 限流 | 内存滑窗（惰性清扫 + 内存打爆自保护），per-token 三维 + per-IP | `apps/server/src/lib/rate-limit.ts` |
| 运行时配置 | `openapi.config`（KV 覆盖 + 10s TTL + env 抬升），公开检索默认关 | `apps/server/src/lib/open-settings.ts` |
| 开放面 | D1 站点/公开检索（发布清单过滤 + kill switch + IP 限流 + noindex）、D2 检索/读/建议、D3 建/存/移/删/标签、`/mcp`、`openapi.json`；错误信封 code 提取（`app.onError` 仅对 `/api/open/*`） | `apps/server/src/http/routes-open.ts`、`lib/openapi-doc.ts`、`http/app.ts` |
| 匿名口径 | `anonymousReadableProjectIds(Sql)`（单口径退化，非平行实现） | `apps/server/src/lib/permissions.ts` |
| 内部面 | `me/tokens` CRUD + `me/token-policy`；团队 `PUT :id/token-policy`；管理端 `admin/open-api*`（开关/配额/用量/令牌全景/强制吊销）；token.created/revoked/policy_denied + open.write.* 审计 | `apps/server/src/http/routes.ts` |
| MCP | `@ewiki/mcp`：协议层 + 12 工具（含 `kb_create_project`/`kb_suggest_organization`）+ HTTP 客户端 + stdio 桥（`EWIKI_BASE_URL/EWIKI_TOKEN/EWIKI_ALLOW_WRITE`）；托管端点按 token scopes 裁剪工具 | `packages/mcp/*` |
| D1 管线 | 发布时写 `manifest.json`（path 白名单）；`renderSite` 支持 `search.endpoint` 注入站点搜索框（textContent 防注入，页面命名前端换算） | `apps/worker/src/index.ts`、`packages/render/src/index.ts` |
| Web | 设置页「API 令牌」页签（scope 预设 + **write 二次风险确认** + 签发弹窗明文仅显一次 + 吊销 + 用量）；管理端「开放接口」页签；团队设置页「API 令牌策略」卡片 | `apps/web/src/components/TokenSettings.tsx`、`OpenApiAdminSection.tsx`、`pages/TeamDetailPage.tsx` |
| 配置 | `OPENAPI_ENABLED` / `OPENAPI_PUBLIC_SEARCH`（env）；公开开关与配额走 platform_settings 运行时可调 | `apps/server/src/config.ts`、`.env.example` |

### 15.3 测试与验收

- **单测**（`pnpm -r test` 全绿，138 项）：新增限流 3 用例（窗口/隔离/递减）、PAT 与团队策略 5 用例（格式/脏数据/封顶/CIDR 白名单）、开放设置 3 用例（默认关/覆盖/env 抬升）、MCP 协议 10 用例（握手协商/notification/工具裁剪/isError 路径/12 工具齐备与描述守则断言）。
- **类型检查**：`pnpm -r typecheck` 全部通过；`@ewiki/web` 构建通过。
- **协议冒烟（本机实跑）**：openapi.json 构建（3.1.0 / 10 paths / bearer scheme）；stdio 桥 initialize 协商 2025-06-18、tools/list 12 工具、notification 静默、tools/call 参数错误走 isError、resources/list −32601。
- **e2e P14/P15**（`scripts/e2e-platform.mjs`，新增 22 项，其中 P15g 为平台态恢复 cleanup）：令牌三 scope 门/内外检索同源对齐/写链路五连（建→索引可见→乐观并发→409→标签→移动）/软删索引清除/令牌建库/吊销即时生效/配额 429/用量记账/MCP 托管四断言/团队策略禁用与封顶/**CORS 预检与回显/MCP SSE 协商/Idempotency-Key 幂等**/公开检索默认 404/公开面权限边界/站点发布清单过滤（发布后新增不可搜、公开面活库可见）/IP 限流/kill switch/审计闭环。

### 15.4 验证边界与运行指引（诚实声明）

本开发机无 docker/运行栈，以下未在本机执行，须在开发环境完成（一次性）：

```bash
docker compose -f deploy/compose.dev.yml up -d        # ewiki-pg
pnpm --filter @ewiki/server db:migrate                # 应用迁移 0011 + 0012
pnpm dev                                              # server/worker/realtime（tsx watch）
node scripts/e2e-platform.mjs                         # 含新增 P14/P15 段（原 96+ 项 + 新 22 项）
```

### 15.5 增补实施（2026-09-15 第二批：遗留项与建议项落地）

| # | 项 | 落地 |
|---|---|---|
| 1 | **MCP Streamable HTTP 完整传输面**（边界②关闭） | POST 按 `Accept` 协商：含 `text/event-stream` → SSE 单消息流（`event: message`，兼容官方 SDK 客户端），否则 application/json；GET 打开服务端→客户端通知流（SSE 注释心跳 25s 保活，abort 即断）；无状态部署不签发 `Mcp-Session-Id`，客户端携带的会话/版本头容忍不校验。e2e P14m 锁定 SSE 协商行为 |
| 2 | **开放面 CORS**（边界②关闭、遗留③的跨源前提） | `hono/cors` 挂 `/api/open/*`：Origin 反射（token/匿名鉴权无 cookie，通配安全）、允许 MCP/幂等头（`MCP-Protocol-Version`/`Mcp-Session-Id`/`Idempotency-Key`）、expose 限流头；`OPENAPI_CORS_ORIGINS` 逗号白名单可收紧。e2e P14l 锁定预检与回显 |
| 3 | **跨副本精确限流**（边界①关闭，ADR-O7 硬配额落地） | `api_rate_windows` 固定窗口计数（迁移 0012）：单语句原子 check-and-increment（`ON CONFLICT DO UPDATE … CASE … RETURNING`），server×2 下配额精确；DB 异常 fail-open 回退内存口径；历史窗口 2% 概率捎带清理。纯函数（窗口对齐/限额判定）单测锁定 |
| 4 | **Idempotency-Key 幂等写**（决议 6 提前落地，原 M4） | `api_idempotency_keys`（迁移 0012）：D3 六个写端点经 `withIdempotency` 包装，2xx 快照 24h、重放带 `Idempotency-Replayed` 头、同键异请求 409。e2e P14n 锁定"重放同响应 + 仅创建一份" |
| 5 | **子域/自定义域名站点检索**（遗留③关闭） | worker 发布时按 `addressMode` 分流：subpath 同源相对路径；subdomain/自定义域名 → 绝对地址指向主域（`EWIKI_SITE_API_ORIGIN` 覆盖，缺省 `https://EWIKI_BASE_DOMAIN`），跨源调用由第 2 项 CORS 放行 |

仍按计划后置（评审决议维持）：OAuth 2.1 + 动态客户端注册（依赖企业 SSO 落地）、MCP resources/prompts（工具面已覆盖四类场景，等真实客户端需求驱动）、站点检索 contentHash 级强快照（随发布管线专项）、二进制上传开放 API。
