# AI 优先对接企业自研客户端（xh_client / edith）· 设计与落地

> 状态：**已实施（2026-09-17）**。
> 关联：`docs/comparison-workbuddy-vs-openknowledge.md`（§5 结论：P0「ewiki 暴露 MCP」已落地 → 本专项是其消费侧闭环 + P2/O3「AI 接入向导」的企业化变体）、`specs/OPEN-API-MCP-DESIGN.md`（开放面与 MCP 托管端点的事实源，下称 [O-MCP]）。
> 对接目标：`D:\works\xh_client-plugin`（内部名 **edith**，multi-kernel-agent-server v0.3.7）——企业自研多内核智能体客户端。

---

## 0. 结论（TL;DR）

ewiki 已是标准 MCP server（托管 Streamable HTTP + stdio 桥，12 个 `kb_*` 工具，[O-MCP] §15 全量落地）；edith 已是成熟 MCP consumer（官方 SDK client + McpManager + 会话级启停 + HITL/审计）。**两侧能力都已存在，缺的是"焊点"**：配置格式产出、令牌托管、企业分发通道。本专项补三层：

| # | 层 | 交付物 | 消费方 |
|---|---|---|---|
| 1 | **MCP 直连通道**（普适，零安装） | ewiki 设置页「AI 客户端接入向导」：签发 PAT 后一键产出 edith 用户级 `~/.edith/mcp.json` / 项目级 `.mcp.json` / Claude Desktop / Cursor / 通用 Streamable HTTP 五类配置片段 | edith 任意用户、Claude/Cursor 等通用客户端 |
| 2 | **企业插件通道**（深度，官方分发） | edith 官方插件 `ewiki-kb`：11 个原生工具（打开放 REST）+ 主视图 UI（连接配置/检索/浏览）+ 欢迎页胶囊 + 技能 + Agent + SecretStore 托管 PAT | edith 企业版内置（builtin 通道）/ dev（data/plugins 通道） |
| 3 | **互操作验收** | `scripts/mcp-interop-smoke.mjs`：用 edith 同款官方 SDK client（`@modelcontextprotocol/sdk`）实连 ewiki 托管端点，握手/列工具/调工具全链路断言 | 回归门禁 |

三条通道**行为单源**：全部收敛到 `/api/open/v1/*`（MCP 是 REST 的投影 [O-MCP] ADR-O5，插件工具同为 REST 投影），鉴权/scope/限流/审计一套。

---

## 1. 现状事实（2026-09-17 逐行核实）

### 1.1 edith 侧（消费端）

| # | 事实 | 证据 |
|---|---|---|
| E1 | MCP client 仅支持 `sse` \| `streamable-http` 两种 transport，**stdio 明确不支持**（v1.1 硬约束，类型 + manifest 校验双重限制） | `packages/types/src/kernel-platform-types.ts`（McpServerConfig.transport）；`packages/kernel-adapter/src/tools/mcp/mcp-config-loader.ts` |
| E2 | 连接用官方 SDK `Client` + `StreamableHTTPClientTransport`/`SSEClientTransport`，支持自定义 `headers`（放 auth token）；协议版本随 SDK（^1.29.0） | `packages/kernel-adapter/src/tools/mcp/client-factory.ts` |
| E3 | 配置三来源：用户级 `~/.edith/mcp.json`（多用户部署在 `~/.edith/users/<name>/.edith/mcp.json`）、项目级 `<projectRoot>/.mcp.json`、插件 manifest `contributes.mcpServers`；文件格式只接受 **JSON 数组或 `{"servers":[...]}`**（设计文档里的 `{"mcpServers":{...}}` map 与实现不符，以代码为准） | `mcp-config-loader.ts` `readMcpConfigFile()`；`tests/mcp-config-loader.test.ts` |
| E4 | MCP 默认 **opt-in**：`userEnabled` 默认 false，需在 MCP 面板启用或配置 `"enabled": true`；工具以 `mcp:<serverId>:<toolName>` 进入 LLM 工具面 | `manager.ts`；`mcp-routes.ts` |
| E5 | 插件 manifest 的 `mcpServers` 是**静态声明**：URL 写死在 manifest，headers 仅支持字面量或 `{secretRef}`，**无运行时配置插值**；收集器做 consent 门（`mcp.connect`）+ secretRef 解析，任一失败整条跳过 | `src/plugin-system/host/plugin-mcp-servers.ts` |
| E6 | 插件原生工具通道成熟：`create(ctx)` 返回 `tools[]`（manifest 元数据 × 真实 handler 按 id 合成），handler 可在**调用时**读 `ctx.storage` / `ctx.services.secrets`；单插件工具预算默认 maxTools=12；dangerous 工具自动走会话内 HITL 确认卡 | `packages/types/src/feature-contract.ts`；`src/plugins/email/manifest.ts`；`templates/plugin-template/backend/main.mjs` |
| E7 | 插件 UI 双 renderer：`builtin-component` 需要改宿主 `builtin-registrations.ts`（违背零宿主改动）；`iframe-app` 由平台静态托管 `GET {basePath}/ui/*`，postMessage 桥三通道（invoke/storage/events，`requiredBridgeCaps` 最小授权） | `data/plugins/iframe-demo/`（通车演示）；`web/src/components/slots/SlotHost.tsx` |
| E8 | 凭据托管：插件只持 scopedRef（`eds:<owner>:<key>`）永不接触明文；`secret.scoped` 权限按 glob 校验 | `src/user-service/security/secret-store.ts`；`src/plugins/email/index.ts` |
| E9 | 无任何知识库/RAG 模块（`src/memory/` 是个人记忆系统）——知识检索只能从外部经 MCP 或插件工具接入 | 全仓 grep 无 knowledge/wiki/vector 命中 |
| E10 | SSRF 防护默认关闭（`MCP_ENABLE_SSRF_GUARD=1` 才拦截私网/loopback）；插件出网无运行时 fetch 拦截（信任边界=安装授权+审计） | `ssrf-guard.ts`；plugin-sdk README |

### 1.2 ewiki 侧（提供端，[O-MCP] §15 已落地）

| # | 事实 | 证据 |
|---|---|---|
| W1 | 托管 MCP：`POST\|GET\|DELETE /api/open/v1/mcp`，POST 按 `Accept` 协商（含 `text/event-stream` → SSE 单消息流，兼容官方 SDK），notification → 202，无状态不签发 `Mcp-Session-Id` | `apps/server/src/http/routes-open.ts:559-627` |
| W2 | 协议层零依赖手写：initialize（2025-03-26/2025-06-18 协商）/ping/tools·list/tools·call；托管端点按 token scopes 裁剪工具清单 | `packages/mcp/src/protocol.ts`；`routes-open.ts:559-570` |
| W3 | PAT Bearer 认证（scope search/read/write），开放面 CORS 已放行 MCP 头；`GET /openapi.json` 免认证（连接测试可用） | `routes-open.ts:289`；[O-MCP] §15.5 |
| W4 | stdio 桥（`EWIKI_BASE_URL`/`EWIKI_TOKEN`/`EWIKI_ALLOW_WRITE`）面向 Claude Desktop/Cursor 等本地客户端 | `packages/mcp/src/stdio.ts` |
| W5 | web 设置页已有「API 令牌」页签（scope 预设 + write 二次确认 + 签发明文仅显一次），但**没有任何客户端接入产物**——用户拿到 token 后不知道往哪贴 | `apps/web/src/components/TokenSettings.tsx` |

**对接缺口结论**：W1-W4 与 E1/E2 协议层完全兼容（无需改服务端一行代码）；缺的是 E3 的**正确格式配置产出**（W5）、E5 决定的**插件通道形态选择**（§3 ADR-C2）、以及企业分发与凭据托管（E6-E8 已提供全部底座）。

---

## 2. 目标与非目标

**目标**

1. ewiki 用户签发 PAT 后 30 秒内完成任意 AI 客户端接入（向导产出可直接粘贴的配置）。
2. edith 企业版内置 `ewiki-kb` 插件：AI 对话中直接检索/读写 ewiki 知识库；用户在插件面板完成连接配置（baseUrl + PAT 入 SecretStore）；知识检索/浏览有独立主视图。
3. 互操作冒烟进 ewiki 仓库回归（官方 SDK 客户端 ↔ 托管端点）。
4. edith 与 ewiki 双侧文档齐备（安装/配置/故障排查）。

**非目标**

- 改 edith 宿主代码（含 web 源码）——插件必须零宿主改动可装卸；builtin 化（`src/plugins/`）由 edith 团队按发版节奏执行，本专项交付等价物。
- manifest 静态 `contributes.mcpServers` 的动态化（需改 edith 收集器，收益低，见 ADR-C2）。
- ewiki 服务端新增端点/迁移——本专项零服务端改动。
- edith stdio transport、SSRF guard 开关策略（edith 侧既定约束，如实声明边界）。

---

## 3. 总体架构

```
┌─────────────────────────── ewiki（提供端）────────────────────────────┐
│  web 设置页「API 令牌」                                                │
│   ├─ 签发 PAT（明文仅显一次）                                          │
│   └─ ★ AI 客户端接入向导（本专项新增，纯前端）                          │
│       ├─ edith 用户级 ~/.edith/mcp.json（数组格式）                    │
│       ├─ edith 项目级 .mcp.json（同格式）                              │
│       ├─ Claude Desktop / Cursor（stdio 桥 npx @ewiki/mcp）            │
│       └─ 通用 Streamable HTTP（URL + curl）                            │
└──────────────┬───────────────────────────────────┬───────────────────┘
               │ 通道 1：MCP 直连（用户自助粘贴）      │ 通道 2：官方插件
               ▼                                    ▼
┌─────────────────────────── edith（消费端）───────────────────────────┐
│  McpManager（SDK StreamableHTTPClientTransport）                      │
│   └─ mcp:ewiki:kb_search / kb_read_document / ... （opt-in 启用）      │
│                                                                       │
│  ewiki-kb 插件（本专项新增，data/plugins → builtin）                   │
│   ├─ 11 个原生工具 plugin.ewiki-kb.ewiki.*（fetch /api/open/v1/*）     │
│   ├─ work.main.view（iframe：连接配置/检索/浏览）+ 欢迎页胶囊 + 设置页  │
│   ├─ skill「知识库检索」+ agent「知识库助理」                          │
│   └─ PAT 入 SecretStore（ewiki-kb/*），UI/工具只持 scopedRef           │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ 全部收敛（行为单源）
                           ▼
              ewiki /api/open/v1/*（PAT 认证 → scope 门 → 限流 → 审计）
```

**通道选型矩阵**

| 场景 | 通道 | 理由 |
|---|---|---|
| 个人用户、已有 edith/Claude/Cursor，想立刻用 | 通道 1（向导 + mcp.json） | 零安装、零分发，5 分钟自助 |
| 企业统一分发、要 UI 面板 + 凭据托管 + 技能/Agent | 通道 2（ewiki-kb 插件） | 官方信任级、配置中心化、审计走 edith |
| 云端 Agent / 服务端集成 | 通道 1 的通用 Streamable HTTP | 纯 HTTP，无桌面依赖 |

---

## 4. 架构决策（ADR-C1~C6）

### ADR-C1 · 对接主形态 = ewiki 托管 Streamable HTTP MCP，服务端零改动

edith 只吃 `sse`/`streamable-http`（E1），ewiki 托管端点的传输面（SSE 协商/无状态/无会话头）正是为这类客户端设计（W1，[O-MCP] §15.5 第 1 项的动机即"兼容官方 SDK 客户端"）。stdio 桥保留给 Claude Desktop/Cursor（edith 用不上，但向导一并产出，一份向导服务所有客户端）。**本专项不改 ewiki 服务端行为**——唯一改动是工具元数据注解对齐（[O-MCP] §8.1 表声明了 readOnlyHint/idempotentHint，实现只标了 destructiveHint；已补齐 8 个注解，纯提示性元数据，互操作冒烟锁定）。

### ADR-C2 · edith 插件通道选「原生工具打 REST」，不用 manifest `contributes.mcpServers`

| 备选 | 结论 |
|---|---|
| **原生工具（contributes.tools → fetch `/api/open/v1/*`）（采纳）** | ① 企业部署 baseUrl 因部署而异，manifest 是静态 JSON（E5），URL 无法运行时配置；原生工具 handler 调用时读 `ctx.storage`/`ctx.services.secrets`（E6），改配置即生效。② 获得 UI/技能/Agent/配置表单的完整贡献面。③ 行为与 MCP 通道单源（都打开放 REST）。 |
| manifest `contributes.mcpServers`（静态 URL + secretRef） | URL 写死 → 换部署地址要改 manifest 重装；UI/技能无法贡献；且 `mcp.connect` 为 dangerous 权限，安装摩擦更大。保留为"baseUrl 固定的纯 MCP 分发"备选，本期不做。 |
| 插件后端起本地 stdio MCP 再转接 | edith 不支持 stdio（E1），且进程内再起 server 纯属绕路。 |

### ADR-C3 · 机器身份沿用 PAT，edith 侧凭据托管分通道如实声明

PAT 是唯一机器身份（[O-MCP] ADR-O2，act-as-user + scope，权限零新增）。通道差异：

- **通道 2（插件）**：PAT 入 edith SecretStore（`eds:ewiki-kb:pat`），插件持 scopedRef，iframe UI 永不接触明文（D6 纪律，与 email 插件同构）。
- **通道 1（mcp.json）**：edith 文件通道不支持 secretRef（E3/E5），PAT 以明文进 `~/.edith/mcp.json`——向导页明示风险与缓解（文件权限 0600、scope 最小化预设、泄漏即吊销）。

### ADR-C4 · 接入向导 = ewiki web 纯前端生成，配置片段单测锁定

服务端零新端点（baseUrl 前端取 `window.location.origin`；token 明文只在签发弹窗内存中存在）。配置片段由 `@ewiki/shared` 纯函数生成，vitest 断言锁定两个高危细节：

1. **edith 格式是 JSON 数组**（E3 实现事实），不是通用 `{"mcpServers":{}}` map——贴错格式 edith 静默读不到。
2. transport 必须是 `streamable-http`（E1）；`"enabled": true` 显式写上以越过 opt-in（E4），并向导文案提示面板可改。

### ADR-C5 · 插件 UI 走 iframe-app 自绘，桥通道最小授权

`builtin-component` 需要改宿主注册表（E7），违背零宿主改动。`ewiki-kb` 主视图/设置页均用 `iframe-app`（平台静态托管 + CSP），`requiredBridgeCaps` 只授 `plugin.invoke`——**检索与连接配置全部经桥 invoke 到插件后端**，后端持有 scopedRef 换明文调 REST，iframe 内无 token、无直连 URL 之外的敏感面（storage/events 桥不授）。

### ADR-C6 · 工具面 = MCP 12 工具的企业子集（11 个，≤ maxTools 12 预算）

镜像 `kb_*` 工具语义（命名 `ewiki.*`），砍掉 `kb_create_project`/`kb_suggest_organization` 中低频项**之外**的……取：search / read_document / list_projects / list_documents / get_versions / create_document / update_document / move_document / set_tags / delete_document（10）+ connection_status（自诊断，非 REST 投影）= 11 ≤ 12。`kb_create_project` 与 `kb_suggest_organization` 不进插件面（前者 write 二次确认语义在 web 端完成更稳，后者依赖内部 ai-classify 运行记录）；需要完整面时走通道 1 的 MCP。`ewiki.delete_document` 标 `dangerous`（HITL 确认卡），写工具描述沿用 [O-MCP] §8.2 守则（先查重、乐观并发序列、软删语义）。

---

## 5. ewiki 侧设计：AI 客户端接入向导

### 5.1 落点

- `packages/shared/src/client-onboarding.ts`：纯函数配置生成器（零依赖，前后端可用）：

| 函数 | 产物 |
|---|---|
| `edithMcpServerEntry({baseUrl, token, name})` | edith `McpServerConfig` 单条对象（数组元素） |
| `buildEdithUserConfig(...)` / `buildEdithProjectConfig(...)` | `~/.edith/mcp.json` / `.mcp.json` 全文（JSON 数组格式，含已有 server 合并提示） |
| `buildClaudeDesktopConfig(...)` | `claude_desktop_config.json` / `mcp.json`（Cursor）的 `mcpServers` map + stdio 桥 env |
| `buildGenericHttpExample(...)` | curl 示例 + URL/头说明 |

- `apps/web/src/components/ClientOnboarding.tsx`：向导组件（客户端 tabs + 代码块 + 复制 + 风险提示）；token 未持有时以 `<你的令牌>` 占位。
- `TokenSettings.tsx`：签发成功弹窗内嵌向导（带真明文）；页签常驻「AI 客户端接入」按钮（占位形态）。

### 5.2 交互细节

- 签发后弹窗即向导默认页（edith tab 在首位——企业自研优先）。
- edith tab 内容：完整 JSON + 写入路径说明（`%USERPROFILE%\.edith\mcp.json`，多用户部署注明 users 子目录）+「保存后在 MCP 服务面板确认 ewiki 已启用」（E4 opt-in）。
- 风险区（ADR-C3）：明文落盘提示 + 「建议 scope 只给 search/read；write 授权需谨慎」。
- 连接自检指引：edith MCP 面板「测试」按钮 / `POST /api/open/v1/mcp` 握手；失败排查表（401=token 吊销/过期、403=scope 不足、404=OPENAPI_ENABLED 关闭、429=限流）。

---

## 6. edith 侧设计：`ewiki-kb` 官方插件

### 6.1 包结构（文件系统通道，`data/plugins/ewiki-kb/`）

```
ewiki-kb/
├── plugin.json          # manifest（official / in-process / maxTools 默认）
├── backend/main.mjs     # create(ctx)：routes + tools + skills + agents + ui + bridge
├── ui/index.html        # iframe 自绘（连接配置 / 检索 / 浏览 三态）
├── ui/app.js
├── ui/app.css
└── README.md
```

### 6.2 manifest 要点

- `id: "ewiki-kb"`，`trust: "official"`，`runtime: "in-process"`，`entry`/`uiEntry` 指向上述文件；`scopes: ["global","project","session"]`。
- `contributes.tools`：11 条元数据（`ewiki.search` 等，与 `backend` handler 按 id 合成）；`ewiki.delete_document` 声明 `dangerous: true`。
- `contributes.skills`：`knowledge-retrieval`（内联 content：先查重再写、乐观并发序列、引用 path+heading、未配置引导）。
- `contributes.agents`：`kb-assistant`（subagent，allowedTools 缺省=插件自身工具）。
- `contributes.ui`：`work.main.view`（iframe）、`work.home.quick`（胶囊，办公/编码场景，open-panel）、`settings.section`（iframe）。
- `permissions`：`ui.slot` / `tool.register` / `skill.register` / `agent.register` / `route.mount` / `{secret.scoped, value:"ewiki-kb/*"}`（不声明 `mcp.connect`/`net.host`——不出 MCP、宿主无出网运行时拦截（E10），与 email 插件口径一致）。

### 6.3 backend 行为

- **连接管理**（REST + bridge 双通道）：
  - `POST /connection {baseUrl, token}` → `secrets.set('ewiki-kb','pat',token)` + `storage.set('connection',{baseUrl, patRef})`；响应只回 `{baseUrl, patPrefix}`。
  - `GET /connection` → `{configured, baseUrl, patPrefix, checkedAt?}`（永不回明文）。
  - `DELETE /connection` → `secrets.delete` + 清 KV。
  - `POST /connection/test` → ① `GET {baseUrl}/api/open/v1/openapi.json`（免认证，验证可达）② `GET {baseUrl}/api/open/v1/projects?page=1&pageSize=1`（带 PAT，验证认证/scope）→ 返回分步结果。
- **工具 handler**：统一 `callOpenApi(method, path, {query, body})` → 读 connection → `secrets.resolve(patRef, 'ewiki-kb/*')` → fetch → 非 2xx 抛带 `code` 的结构化错误（`isError` 语义由平台包装）；工具结果返回 REST 原样 JSON。
- **`ewiki.connection_status`**：返回 configured/baseUrl/patPrefix + 提示文案（AI 据此引导用户先配置）。
- **bridge.invoke**：`{path:'/connection'...}` 与 `{path:'/kb/search', body:{q,...}}` 两族——UI 的检索/浏览请求由后端代理（iframe 不持 token）。

### 6.4 UI（iframe 自绘，零构建依赖）

三区块单页：连接配置表单（baseUrl + PAT + 测试按钮）→ 检索框（结果列表：标题/path/ snippet/score，点击看全文）→ 库/文档浏览（项目列表 → 文档清单）。视觉走宿主玄墨语义 token 风格（自绘近似，iframe 无宿主 CSS）。

### 6.5 生产分发（builtin 通道，edith 团队执行）

`data/plugins/` 通道在 pkg 打包产物内不可用（动态 import 限制）。builtin 化 = 把 `backend/main.mjs` 移植为 `src/plugins/ewiki-kb/`（TS，参照 email：`manifest.ts` + `index.ts` + 内联 skill content），经 `builtinPlugins` 注入。本专项交付文件系统通道完整等价物 + README 迁移指引。

---

## 7. 互操作验收

`ewiki/scripts/mcp-interop-smoke.mjs`（Node 直跑，零新增依赖）：

1. 以 `@ewiki/mcp` 协议层起最小 Hono 应用，复刻托管 POST 路由的传输语义（Accept 协商 / 202 / 无会话头），loopback client 打内存桩 REST。
2. 用 **edith 同款官方 SDK**（`--sdk-root` 指向 `D:/works/xh_client-plugin/node_modules`，版本 ^1.29.0）`StreamableHTTPClientTransport + Client` 实连：
   - initialize 协商 2025-06-18；`tools/list` 返回桩工具清单；`tools/call` 端到端打到桩 REST 并回 structuredContent；notification → 202 不挂死。
3. 断言清单即 ewiki 仓库回归（CI/开发机均可跑；sdk-root 缺省自动探测相邻 checkout）。

## 8. 风险与边界

| # | 风险 | 应对 |
|---|---|---|
| R1 | edith mcp.json 格式误配（通用 map 格式静默失效） | ADR-C4 单测锁定数组格式；向导文案给写入路径与格式警示 |
| R2 | PAT 明文落 mcp.json | 向导风险区 + scope 预设引导 + 吊销路径提示；插件通道走 SecretStore 免明文 |
| R3 | MCP 默认 opt-in，用户贴完配置以为没生效 | 向导明示「保存后到 MCP 服务面板启用」（E4） |
| R4 | 部署方开启 `MCP_ENABLE_SSRF_GUARD=1` 后私网 ewiki 被拦 | 文档如实声明：内网部署保持默认关闭，或 ewiki 走域名 + https |
| R5 | 插件工具与 MCP 工具行为漂移 | 两者同为 `/api/open/v1` 投影；差异只在参数模式文案；描述守则与 [O-MCP] §8.2 对齐并在单测断言关键词 |
| R6 | maxTools 预算超限 | 11 ≤ 12；manifest 校验器安装期兜底 |
| R7 | 协议/SDK 演进破坏互操作 | 互操作冒烟锁真实 SDK 版本；ewiki 侧 SDK 锁版本策略不变（[O-MCP] R7） |

## 9. 分期

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 互操作验证 | 冒烟脚本 + 官方 SDK 实连通过 | ✅ 2026-09-17 |
| M2 通道 1 | shared 配置生成器（含单测）+ web 向导 + TokenSettings 集成 | ✅ 2026-09-17 |
| M3 通道 2 | `ewiki-kb` 插件（manifest/backend/UI/README）+ 装载冒烟 | ✅ 2026-09-17 |
| M4 企业分发 | edith builtin 化（src/plugins/ewiki-kb）+ 打包产物验收 | 移交 edith 团队（指引见插件 README） |

## 10. 实施记录（2026-09-17）

| 层 | 交付物 | 位置 |
|---|---|---|
| 设计 | 本文 | `specs/AI-FIRST-CLIENT-INTEGRATION-DESIGN.md` |
| 通道 1 | 配置生成器 + 6 项单测（锁定 edith 数组格式/streamable-http/enabled 等） | `ewiki/packages/shared/src/client-onboarding.ts` + `.test.ts` |
| 通道 1 | 向导组件 + TokenSettings 集成 | `ewiki/apps/web/src/components/ClientOnboarding.tsx`、`TokenSettings.tsx` |
| 通道 2 | 插件完整包（manifest/backend/ui/README） | `xh_client-plugin/data/plugins/ewiki-kb/`（部署实例；版本化源记录在 `integrations/xh-client/ewiki-kb/`，该仓 `data/` 不入 git） |
| 验收 | 互操作冒烟 12 项断言（官方 SDK 实连：握手/协商/工具面/回环执行/错误路径） | `ewiki/scripts/mcp-interop-smoke.mjs` |
| 验收 | 插件装载冒烟 31 项断言（edith 官方校验器 + mock ctx + ewiki REST 桩端到端） | `xh_client-plugin/data/plugins/ewiki-kb/test/smoke.mjs` |
| 回归 | ewiki `pnpm -r typecheck` / `pnpm -r test` / `@ewiki/web build` 全绿（2026-09-17） | — |
| 对齐 | MCP 工具注解补齐（5×readOnlyHint + 2×idempotentHint，[O-MCP] §8.1） | `ewiki/packages/mcp/src/tools.ts` |
