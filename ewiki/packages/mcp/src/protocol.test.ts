import { describe, expect, it } from 'vitest';
import {
  createMcpServer,
  McpToolError,
  textResult,
  type McpClient,
  type ToolDef,
} from './protocol.js';
import { KB_TOOLS } from './tools.js';

function fakeClient(respond: (method: string, path: string, body?: unknown) => unknown): McpClient {
  return {
    async call(method, path, opts) {
      return { status: 200, json: respond(method, path, opts?.body) };
    },
  };
}

const echoTool: ToolDef = {
  name: 'echo',
  title: 'Echo',
  description: 'test tool',
  inputSchema: { type: 'object', properties: { v: { type: 'string' } }, required: ['v'] },
  execute: async (_client, args) => textResult(`echo:${String(args.v)}`, { v: args.v }),
};

describe('MCP 协议层（OPEN-API-MCP-DESIGN §8，零依赖 JSON-RPC）', () => {
  it('initialize 协商协议版本并下发能力', async () => {
    const server = createMcpServer({ client: fakeClient(() => ({})), tools: [echoTool] });
    const res = (await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }))!;
    expect(res.error).toBeUndefined();
    const result = res.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe('2025-03-26');
    expect((result.capabilities as Record<string, unknown>).tools).toBeDefined();
    expect((result.serverInfo as Record<string, unknown>).name).toBe('ewiki-mcp');
  });

  it('未知协议版本回退最新支持版', async () => {
    const server = createMcpServer({ client: fakeClient(() => ({})), tools: [] });
    const res = (await server.handle({ jsonrpc: '2.0', id: 'a', method: 'initialize', params: { protocolVersion: '1999-01-01' } }))!;
    expect((res.result as Record<string, unknown>).protocolVersion).toBe('2025-06-18');
  });

  it('notification（无 id）返回 null，不产生响应', async () => {
    const server = createMcpServer({ client: fakeClient(() => ({})), tools: [] });
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  it('tools/list 下发元数据（不含 execute）', async () => {
    const server = createMcpServer({ client: fakeClient(() => ({})), tools: [echoTool] });
    const res = (await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))!;
    const tools = (res.result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('echo');
    expect(tools[0]!.execute).toBeUndefined();
  });

  it('tools/call 返回 text + structuredContent', async () => {
    const seen: Array<{ method: string; path: string }> = [];
    const client: McpClient = {
      async call(method, path) {
        seen.push({ method, path });
        return { status: 200, json: { ok: true } };
      },
    };
    const server = createMcpServer({ client, tools: [echoTool] });
    const res = (await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { v: 'hi' } } }))!;
    expect(seen).toEqual([]); // echo 不经 client，仅验证结构
    const result = res.result as { content: Array<{ type: string; text: string }>; structuredContent: unknown; isError?: boolean };
    expect(result.content[0]!.text).toBe('echo:hi');
    expect(result.isError).toBeFalsy();
  });

  it('未知工具 → -32602；未知方法 → -32601；坏消息 → -32600', async () => {
    const server = createMcpServer({ client: fakeClient(() => ({})), tools: [echoTool] });
    const badTool = (await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } }))!;
    expect(badTool.error?.code).toBe(-32602);
    const badMethod = (await server.handle({ jsonrpc: '2.0', id: 5, method: 'resources/list' }))!;
    expect(badMethod.error?.code).toBe(-32601);
    const badMsg = (await server.handle({ hello: 1 }))!;
    expect(badMsg.error?.code).toBe(-32600);
  });

  it('工具抛 McpToolError → isError 结果（携带 REST code），而非协议错误', async () => {
    const tool: ToolDef = {
      ...echoTool,
      name: 'boom',
      execute: async () => {
        throw new McpToolError(409, 'DOCUMENT_VERSION_CONFLICT', '请重新读取文档后重试');
      },
    };
    const server = createMcpServer({ client: fakeClient(() => ({})), tools: [tool] });
    const res = (await server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'boom', arguments: {} } }))!;
    const result = res.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('DOCUMENT_VERSION_CONFLICT');
    expect(res.error).toBeUndefined();
  });
});

describe('KB 工具清单（开放 REST 投影）', () => {
  it('12 个工具齐全；写工具齐备（评审决议 1/4：kb_create_project / kb_suggest_organization 在列）', () => {
    const names = KB_TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'kb_search', 'kb_read_document', 'kb_list_projects', 'kb_list_documents', 'kb_get_versions',
        'kb_suggest_organization', 'kb_create_project', 'kb_create_document', 'kb_update_document',
        'kb_move_document', 'kb_set_tags', 'kb_delete_document',
      ]),
    );
    expect(names).toHaveLength(12);
    // 工具描述守则：检索优先 / 409 重试 / 软删声明
    expect(KB_TOOLS.find((t) => t.name === 'kb_create_document')!.description).toContain('查重');
    expect(KB_TOOLS.find((t) => t.name === 'kb_update_document')!.description).toContain('409');
    expect(KB_TOOLS.find((t) => t.name === 'kb_delete_document')!.description).toContain('软删');
    expect(KB_TOOLS.find((t) => t.name === 'kb_delete_document')!.annotations?.destructiveHint).toBe(true);
  });

  it('kb_search → GET /search（query 传参）；kb_create_document → POST 文档端点', async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, string | undefined>; body?: unknown }> = [];
    const client: McpClient = {
      async call(method, path, opts) {
        calls.push({ method, path, query: opts?.query, body: opts?.body });
        return { status: 200, json: { items: [], hasMore: false } };
      },
    };
    const search = KB_TOOLS.find((t) => t.name === 'kb_search')!;
    await search.execute(client, { q: '向量检索', mode: 'auto', limit: 5 });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/search', query: { q: '向量检索', mode: 'auto', limit: '5' } });

    const create = KB_TOOLS.find((t) => t.name === 'kb_create_document')!;
    await create.execute(client, { projectId: 'p1', path: 'notes/a.md', content: '# hi' });
    expect(calls[1]).toMatchObject({ method: 'POST', path: '/projects/p1/documents', body: { path: 'notes/a.md', content: '# hi' } });
  });

  it('缺必填参数 → McpToolError（isError 结果路径）', async () => {
    const search = KB_TOOLS.find((t) => t.name === 'kb_search')!;
    await expect(search.execute(fakeClient(() => ({})), {})).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
  });
});
