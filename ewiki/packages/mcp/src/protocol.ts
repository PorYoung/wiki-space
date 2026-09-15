// ---------------------------------------------------------------------------
// @ewiki/mcp —— MCP 协议层（OPEN-API-MCP-DESIGN ADR-O5）
//   零依赖手写 MCP（JSON-RPC 2.0）最小兼容面：initialize / ping / tools/list /
//   tools/call + notifications。工具执行统一走开放 REST（HttpFetchClient），
//   行为与外部 REST 客户端逐字节一致（鉴权/scope/限流/审计单源）。
//   协议版本支持 2025-03-26 / 2025-06-18（协商：客户端版本在支持集内则回显，
//   否则回本实现最新）；无状态：不维护会话，每请求独立。
// ---------------------------------------------------------------------------

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export const ERR_PARSE = -32700;
export const ERR_INVALID_REQUEST = -32600;
export const ERR_METHOD_NOT_FOUND = -32601;
export const ERR_INVALID_PARAMS = -32602;

const SUPPORTED_VERSIONS = ['2025-03-26', '2025-06-18'];
const LATEST_VERSION = SUPPORTED_VERSIONS[SUPPORTED_VERSIONS.length - 1]!;

/** 开放 API 调用客户端：stdio 桥（跨网络 fetch）与托管形态（本机回环 fetch）共用同一实现 */
export interface McpClient {
  call(
    method: string,
    path: string,
    opts?: { query?: Record<string, string | undefined>; body?: unknown },
  ): Promise<{ status: number; json: unknown }>;
}

/** 工具执行失败（REST 非 2xx）：message 面向 AI 可执行（如 409 提示重读文档） */
export class McpToolError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** JSON Schema（draft 2020-12），MCP tools/list 原样下发 */
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute(client: McpClient, args: Record<string, unknown>): Promise<ToolCallResult>;
}

export interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export function textResult(text: string, structured?: unknown): ToolCallResult {
  const out: ToolCallResult = { content: [{ type: 'text', text }] };
  if (structured !== undefined) out.structuredContent = structured;
  return out;
}

export interface McpServerOptions {
  client: McpClient;
  tools: ToolDef[];
  serverName?: string;
  serverVersion?: string;
  /** 下发给客户端的使用指引（initialize.result.instructions） */
  instructions?: string;
}

export interface McpServer {
  /** 处理一条 JSON-RPC 消息；notification（无 id）返回 null（传输层按 202/静默处理） */
  handle(message: unknown): Promise<JsonRpcResponse | null>;
}

export function createMcpServer(opts: McpServerOptions): McpServer {
  const serverName = opts.serverName ?? 'ewiki-mcp';
  const serverVersion = opts.serverVersion ?? '0.1.0';
  const tools = opts.tools;

  function toolMeta(t: ToolDef): Record<string, unknown> {
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations } : {}),
    };
  }

  function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
  }

  return {
    async handle(message) {
      if (!message || typeof message !== 'object') {
        return rpcError(null, ERR_INVALID_REQUEST, '请求需为 JSON-RPC 2.0 对象');
      }
      const msg = message as Record<string, unknown>;
      if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
        return rpcError((msg.id as JsonRpcId) ?? null, ERR_INVALID_REQUEST, '缺少 jsonrpc:"2.0" 或 method');
      }
      const id = (msg.id ?? null) as JsonRpcId;
      const isNotification = msg.id === undefined || msg.id === null;
      const params = (msg.params ?? {}) as Record<string, unknown>;

      // notification：客户端生命周期通知，无需响应
      if (isNotification) return null;

      switch (msg.method) {
        case 'initialize': {
          const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : LATEST_VERSION;
          const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : LATEST_VERSION;
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: serverName, version: serverVersion },
              ...(opts.instructions ? { instructions: opts.instructions } : {}),
            },
          };
        }
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };
        case 'tools/list':
          return { jsonrpc: '2.0', id, result: { tools: tools.map(toolMeta) } };
        case 'tools/call': {
          const name = typeof params.name === 'string' ? params.name : '';
          const tool = tools.find((t) => t.name === name);
          if (!tool) {
            return rpcError(id, ERR_INVALID_PARAMS, `未知工具：${name || '(空)'}（tools/list 查看可用工具）`);
          }
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          try {
            const result = await tool.execute(opts.client, args);
            return { jsonrpc: '2.0', id, result: result as unknown };
          } catch (err) {
            if (err instanceof McpToolError) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: `${err.code}: ${err.message}` }],
                  isError: true,
                } satisfies ToolCallResult as unknown,
              };
            }
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `TOOL_EXECUTION_FAILED: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
              } satisfies ToolCallResult as unknown,
            };
          }
        }
        default:
          return rpcError(id, ERR_METHOD_NOT_FOUND, `不支持的方法：${msg.method}`);
      }
    },
  };
}
