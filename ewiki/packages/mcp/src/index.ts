// @ewiki/mcp —— MCP 服务（OPEN-API-MCP-DESIGN §8）
// 协议层（createMcpServer）与工具清单（KB_TOOLS）为 server 托管 /mcp 与 stdio 桥共用；
// 工具执行统一走开放 REST（createHttpFetchClient），行为与外部 REST 客户端单源。
export {
  createMcpServer,
  textResult,
  McpToolError,
  ERR_PARSE,
  ERR_INVALID_REQUEST,
  ERR_METHOD_NOT_FOUND,
  ERR_INVALID_PARAMS,
} from './protocol.js';
export type {
  McpClient,
  McpServer,
  McpServerOptions,
  ToolDef,
  ToolCallResult,
  ToolAnnotations,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcId,
} from './protocol.js';
export { createHttpFetchClient } from './http-client.js';
export { KB_TOOLS } from './tools.js';
