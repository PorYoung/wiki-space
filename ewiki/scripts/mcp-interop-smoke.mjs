// ---------------------------------------------------------------------------
// MCP 互操作冒烟（AI-FIRST-CLIENT-INTEGRATION-DESIGN §7）：
//   用 edith（企业自研客户端）同款官方 SDK（@modelcontextprotocol/sdk 1.29.0）的
//   StreamableHTTPClientTransport 实连 ewiki 托管端点的传输语义复刻 + 协议层，
//   工具执行经 createHttpFetchClient 回环打真实 REST 桩——拓扑与
//   routes-open.ts 托管端点一致（Accept 协商 / notification 202 / 无状态无会话头）。
//
//   运行（ewiki 仓库根）：
//     cd packages/mcp && npx tsx ../../scripts/mcp-interop-smoke.mjs \
//       [--sdk-root D:/works/xh_client-plugin/node_modules]
//   零新增依赖：SDK 借企业客户端仓的 node_modules（与线上消费方同版本才有互操作代表性）。
// ---------------------------------------------------------------------------
import { createHttpFetchClient, createMcpServer, KB_TOOLS } from '../packages/mcp/src/index.js';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const sdkRootArg = args.includes('--sdk-root') ? args[args.indexOf('--sdk-root') + 1] : undefined;
const DEFAULT_SDK_ROOTS = ['D:/works/xh_client-plugin/node_modules', '../xh_client-plugin/node_modules'];
const sdkRoot = [sdkRootArg, ...DEFAULT_SDK_ROOTS].find((p) => p && existsSync(join(p, '@modelcontextprotocol/sdk')));
if (!sdkRoot) {
  console.error('[interop] 未找到 @modelcontextprotocol/sdk：用 --sdk-root 指向 edith 的 node_modules');
  process.exit(1);
}
const sdk = await import(pathToFileURL(join(sdkRoot, '@modelcontextprotocol/sdk/dist/esm/client/index.js')).href);
const { StreamableHTTPClientTransport } = await import(
  pathToFileURL(join(sdkRoot, '@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js')).href
);
const sdkVersion = JSON.parse(await import('node:fs').then((m) => m.readFileSync(join(sdkRoot, '@modelcontextprotocol/sdk/package.json'), 'utf8'))).version;

const TOKEN = 'ewk_interop_smoke';
const BASE = 'http://127.0.0.1';

let passed = 0;
function ok(cond, label) {
  if (!cond) throw new Error(`断言失败：${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ── REST 桩（开放面最小投影：auth + /search + /documents/{id}）──────────────
const restHits = [];
const rest = createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  restHits.push({ method: req.method, path: url.pathname, q: Object.fromEntries(url.searchParams) });
  if ((req.headers.authorization ?? '') !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ code: 'unauthorized', message: '令牌无效' }));
  }
  if (req.method === 'GET' && url.pathname === '/api/open/v1/search') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(
      JSON.stringify({
        items: [
          {
            documentId: 'doc-1',
            projectId: 'proj-1',
            projectName: '部署手册',
            path: 'ops/vector.md',
            title: '向量检索与全文索引',
            snippet: '…<em>向量检索</em>的构建走 search-build 队列…',
            score: 0.83,
            reason: 'keyword',
          },
        ],
        hasMore: false,
        tookMs: 1,
      }),
    );
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 'not_found', message: 'not found' }));
});
const restPort = await listen(rest);

// ── MCP 托管端点复刻（routes-open.ts POST 语义：auth → handle → 202/SSE/JSON）──
const client = createHttpFetchClient({ baseUrl: `${BASE}:${restPort}`, token: TOKEN });
const server = createMcpServer({ client, tools: KB_TOOLS, instructions: '检索知识库前先 kb_search。' });
const mcp = createServer(async (req, res) => {
  if ((req.headers.authorization ?? '') !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ code: 'unauthorized', message: '令牌无效' }));
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  let message;
  try {
    message = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } }));
  }
  const result = await server.handle(message);
  if (!result) {
    res.writeHead(202);
    return res.end();
  }
  if ((req.headers.accept ?? '').includes('text/event-stream')) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    return res.end(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(result));
});
const mcpPort = await listen(mcp);

// ── 官方 SDK 客户端实连（edith client-factory 同款 transport）────────────────
const transport = new StreamableHTTPClientTransport(new URL(`${BASE}:${mcpPort}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
});
const client2 = new sdk.Client({ name: 'interop-smoke', version: '0.0.1' });

console.log(`[interop] sdk=${sdkVersion} rest=:${restPort} mcp=:${mcpPort}`);
try {
  await client2.connect(transport);
  ok(client2.getServerVersion() != null, 'initialize 握手成功（notifications/initialized → 202 链路）');
  ok(client2.getServerVersion().name === 'ewiki-mcp', `服务端身份 ${client2.getServerVersion().name}（SDK 校验协议版本，协商失败即连接失败）`);

  // 裸 JSON-RPC 直查协议细节（不经 SDK）：版本协商 + instructions 下发
  const rawInit = await fetch(`${BASE}:${mcpPort}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0.0.0' } } }),
  }).then((r) => r.json());
  ok(rawInit.result?.protocolVersion === '2025-06-18', 'initialize 返回协议版本 2025-06-18');
  ok(typeof rawInit.result?.instructions === 'string', 'instructions 下发');
  const rawOld = await fetch(`${BASE}:${mcpPort}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'raw', version: '0.0.0' } } }),
  }).then((r) => r.json());
  ok(rawOld.result?.protocolVersion === '2025-06-18', '未知版本请求 → 回落服务端最新版');

  const tools = await client2.listTools();
  ok(tools.tools.length === KB_TOOLS.length, `tools/list 返回 ${tools.tools.length} 个工具（与 KB_TOOLS 等长）`);
  const search = tools.tools.find((t) => t.name === 'kb_search');
  ok(search?.annotations?.readOnlyHint === true, 'kb_search 带 readOnlyHint 注解');

  restHits.length = 0;
  const call = await client2.callTool({ name: 'kb_search', arguments: { q: '向量检索', limit: 5 } });
  ok(Array.isArray(call.content) && call.content[0].type === 'text', 'tools/call 返回 text content');
  ok(Array.isArray(call.structuredContent?.items) && call.structuredContent.items[0].documentId === 'doc-1', 'structuredContent.items 直通 REST 原样 JSON');
  const hit = restHits.find((h) => h.path === '/api/open/v1/search');
  ok(hit?.q.q === '向量检索' && hit.q.limit === '5', `工具执行回环 REST（GET /search?q=…&limit=…）`);

  const bad = await client2.callTool({ name: 'kb_search', arguments: {} });
  ok(bad.isError === true, '缺必填参数 → isError（McpToolError 包装）');

  let unknownErr = null;
  try {
    await client2.callTool({ name: 'no_such_tool', arguments: {} });
  } catch (err) {
    unknownErr = err;
  }
  ok(unknownErr?.code === -32602, '未知工具 → 协议错误 -32602（SDK 抛 McpError，edith 侧同形态）');

  console.log(`\n[interop] PASS：${passed} 项断言全绿（官方 SDK 客户端 ↔ ewiki 托管语义互通）`);
} finally {
  await client2.close().catch(() => {});
  transport.close();
  mcp.close();
  rest.close();
}
