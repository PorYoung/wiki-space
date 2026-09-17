// ---------------------------------------------------------------------------
// AI 客户端接入向导 · 配置片段生成器（AI-FIRST-CLIENT-INTEGRATION-DESIGN §5）
//
// 纯函数、零依赖：ewiki web 向导组件消费；格式细节由 client-onboarding.test.ts
// 锁定——尤其 edith 的 mcp.json 是「JSON 数组」而非通用 {"mcpServers":{}} map
// （edith mcp-config-loader 的实现事实，贴错格式会静默读不到）。
// ---------------------------------------------------------------------------

/** edith（企业自研客户端）单条 MCP server 配置（McpServerConfig 结构子集） */
export interface EdithMcpServerEntry {
  id: string;
  name: string;
  description: string;
  transport: 'streamable-http';
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
}

export interface OnboardingInput {
  /** ewiki 服务地址（如 https://wiki.example.com；容忍尾斜杠） */
  baseUrl: string;
  /** PAT 明文（ewk_ 前缀）；未持有时传占位文案 */
  token: string;
  /** MCP server 显示名（缺省 ewiki） */
  serverName?: string;
}

export const DEFAULT_SERVER_NAME = 'ewiki';

export const EDITH_MCP_ENDPOINT_PATH = '/api/open/v1/mcp';

/** 归一化 baseUrl（去尾斜杠）并拼托管 MCP 端点 */
export function mcpEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${EDITH_MCP_ENDPOINT_PATH}`;
}

/** edith mcp.json 的单条 server 配置（数组元素） */
export function edithMcpServerEntry(input: OnboardingInput): EdithMcpServerEntry {
  const name = input.serverName || DEFAULT_SERVER_NAME;
  return {
    id: name,
    name: 'ewiki 知识库',
    description: 'ewiki 团队知识库：检索/读取/整理文档（PAT act-as-user，scope 决定可用工具）',
    transport: 'streamable-http',
    url: mcpEndpoint(input.baseUrl),
    headers: { Authorization: `Bearer ${input.token}` },
    // edith 默认 opt-in（userEnabled=false）；显式 enabled 越过首次启用，用户仍可在 MCP 面板关
    enabled: true,
  };
}

/** edith 用户级 ~/.edith/mcp.json 全文（JSON 数组格式——edith 实现事实，勿改 map 形态） */
export function buildEdithMcpConfig(input: OnboardingInput): string {
  return JSON.stringify([edithMcpServerEntry(input)], null, 2);
}

/** Claude Desktop / Cursor 的 mcpServers map + stdio 桥（ewiki-mcp 未发布 npm，走 tsx 直跑仓库源码） */
export function buildStdioBridgeConfig(input: OnboardingInput, ewikiRepoPath: string): string {
  const name = input.serverName || DEFAULT_SERVER_NAME;
  return JSON.stringify(
    {
      mcpServers: {
        [name]: {
          command: 'npx',
          args: ['tsx', `${ewikiRepoPath}/packages/mcp/src/stdio.ts`],
          env: { EWIKI_BASE_URL: input.baseUrl.replace(/\/+$/, ''), EWIKI_TOKEN: input.token },
        },
      },
    },
    null,
    2,
  );
}

/** 通用 Streamable HTTP 消费示例（云端 Agent / 服务端集成） */
export function buildGenericHttpExample(input: OnboardingInput): string {
  return [
    `# 1) 握手（MCP initialize；SDK 客户端把 url 指向下面的端点即可）`,
    `curl -s -X POST '${mcpEndpoint(input.baseUrl)}' \\`,
    `  -H 'Authorization: Bearer ${input.token}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'Accept: application/json, text/event-stream' \\`,
    `  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"my-agent","version":"0.1.0"}}}'`,
    ``,
    `# 2) REST 直连（MCP 工具的投影源）`,
    `curl -s '${input.baseUrl.replace(/\/+$/, '')}/api/open/v1/search?q=部署&limit=5' \\`,
    `  -H 'Authorization: Bearer ${input.token}'`,
  ].join('\n');
}
