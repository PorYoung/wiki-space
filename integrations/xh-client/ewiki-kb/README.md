# ewiki 知识库（ewiki-kb）· edith 官方插件

对接企业知识库平台 **ewiki**：在 edith 中直接检索、读取、整理团队文档。AI 对话工具与独立面板双入口，全部经 ewiki 开放 API（`/api/open/v1`）以 **PAT act-as-user** 访问——权限与你在 ewiki 登录后完全一致，不产生任何额外权限。

设计文档：`wiki-space/specs/AI-FIRST-CLIENT-INTEGRATION-DESIGN.md`。

> **源记录**：本目录（wiki-space 仓库）是插件的版本化源码；`xh_client-plugin/data/plugins/ewiki-kb/` 是部署实例（该仓 `data/` 不入 git，属运行时通道惯例）。改动在本目录进行，然后同步过去：

## 安装（dev / node 直跑）

```bash
# 同步到 edith（文件系统通道）：
cp -r integrations/xh-client/ewiki-kb <edith 仓库>/data/plugins/
# 重启 edith 服务，在「插件」管理面板安装并授权（确认 secret.scoped ewiki-kb/* 等）
# 装载冒烟（edith 仓库根）：npx tsx data/plugins/ewiki-kb/test/smoke.mjs
```

> pkg 打包产物内 `data/plugins` 通道不可用（动态 import 限制）。随产物分发的 builtin 化：
> 参照 `src/plugins/email/` 把 `backend/main.mjs` 移植为 `src/plugins/ewiki-kb/`
> （`manifest.ts` + `index.ts` + 内联 skill content），经 `builtinPlugins` 注入。

## 配置

1. 在 ewiki Web 端「设置 → API 令牌」签发令牌（推荐「检索专用」或「只读」预设；需要 AI 整理文档时用「读写」）。
2. 打开 edith 的「ewiki 知识库」面板（欢迎页胶囊 / 主视图 / 设置页均有入口）：
   - 服务地址：ewiki 部署地址（如 `https://wiki.example.com`）
   - 访问令牌：粘贴 `ewk_…`（明文只入平台密钥托管，插件与面板均不保存）
3. 点「测试连接」：① 服务可达（openapi.json）② 令牌有效（projects）。

## AI 工具面（11 个）

| 工具 | 说明 |
|---|---|
| `ewiki.search` | 全文/语义/混合检索（回答知识性问题前先调用，引用 path/heading） |
| `ewiki.read_document` | 读取文档全文（Markdown）与元数据 |
| `ewiki.list_projects` / `ewiki.list_documents` | 列库 / 列库内文档 |
| `ewiki.get_versions` | 版本时间线（治理场景） |
| `ewiki.create_document` | 新建文档（先查重；自动版本快照 + Git 提交 + 进索引） |
| `ewiki.update_document` | 更新全文（乐观并发 baseVersionNo；409 重读重试） |
| `ewiki.move_document` / `ewiki.set_tags` | 移动重命名 / 标签替换 |
| `ewiki.delete_document` | 软删（**dangerous**：会话内确认卡；ewiki Web 端可恢复） |
| `ewiki.connection_status` | 连接自诊断（未配置时引导用户去面板） |

另有技能「知识库检索」（auto 触发：知识库/ewiki/检索文档/归档…）与子代理「知识库助理」。

## 与 MCP 通道的关系

本插件是 ewiki 对接 edith 的**企业增强通道**（原生工具 + UI 面板 + 密钥托管）。纯 MCP 直连通道无需本插件：在 ewiki Web 端「设置 → API 令牌 → AI 客户端接入」获取 `~/.edith/mcp.json` 配置片段即可（edith 原生 MCP client，transport `streamable-http`）。两者行为单源（同一批开放 REST 端点）。

## 故障排查

| 现象 | 处理 |
|---|---|
| 工具报「尚未配置 ewiki 连接」 | 打开面板完成连接配置 |
| 401 | 令牌无效/吊销/过期：ewiki 端重签，面板重新保存 |
| 403 insufficient_scope | 令牌 scope 不足（如只读令牌调写工具）：换预设重签 |
| 409 | 版本冲突：重读文档后基于最新 latestVersionNo 重试 |
| 429 | 限流：按 Retry-After 等待 |
| 连接测试「服务不可达」 | 检查服务地址；服务端 `OPENAPI_ENABLED` 是否开启 |
| edith 开启 `MCP_ENABLE_SSRF_GUARD=1` 且 ewiki 为内网/本机地址 | 该开关会拦私网；内网部署保持默认关闭，或 ewiki 走域名 + https |
