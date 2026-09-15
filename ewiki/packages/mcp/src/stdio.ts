// ---------------------------------------------------------------------------
// ewiki-mcp stdio 桥（本地 AI 客户端接入，OPEN-API-MCP-DESIGN §4/§8.3）
//   用法（在 AI 客户端的 mcp 配置中）：
//     command: npx tsx <repo>/packages/mcp/src/stdio.ts
//     env: EWIKI_BASE_URL=https://wiki.example.com   # ewiki 服务地址
//          EWIKI_TOKEN=ewk_xxx                       # 个人访问令牌（PAT）
//          EWIKI_ALLOW_WRITE=0                       # 可选：只读接入（过滤全部写工具）
//   传输：MCP stdio —— stdin/stdout 逐行 JSON-RPC 2.0（UTF-8）；日志一律走 stderr。
// ---------------------------------------------------------------------------

import { createHttpFetchClient } from './http-client.js';
import { createMcpServer } from './protocol.js';
import { KB_TOOLS } from './tools.js';

function fail(msg: string): never {
  process.stderr.write(`[ewiki-mcp] ${msg}\n`);
  process.exit(1);
}

const baseUrl = process.env.EWIKI_BASE_URL;
const token = process.env.EWIKI_TOKEN;
if (!baseUrl) fail('缺少环境变量 EWIKI_BASE_URL（ewiki 服务地址，如 https://wiki.example.com）');
if (!token) fail('缺少环境变量 EWIKI_TOKEN（在 ewiki Web 端「设置 → API 令牌」签发）');

const WRITE_TOOLS = new Set([
  'kb_create_document',
  'kb_update_document',
  'kb_move_document',
  'kb_set_tags',
  'kb_delete_document',
  'kb_create_project',
]);

const allowWrite = process.env.EWIKI_ALLOW_WRITE !== '0';
const tools = allowWrite ? KB_TOOLS : KB_TOOLS.filter((t) => !WRITE_TOOLS.has(t.name));

const server = createMcpServer({
  client: createHttpFetchClient({ baseUrl, token }),
  tools,
  serverName: 'ewiki-mcp',
  instructions:
    'ewiki 知识库服务：先用 kb_search 检索、kb_read_document 读全文来回答知识问题；' +
    '为用户保存新知识时先查重再 kb_create_document；整理归档用 kb_suggest_organization 获取建议、' +
    '经用户确认后用 kb_move_document / kb_set_tags 执行；删除是软删，执行前必须复述目标文档并取得用户确认。',
});

process.stderr.write('[ewiki-mcp] stdio bridge started\n');

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let idx: number;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) void handleLine(line);
  }
});
process.stdin.on('end', () => process.exit(0));

async function handleLine(line: string): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    respond({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } });
    return;
  }
  try {
    const result = await server.handle(message);
    if (result) respond(result);
  } catch (err) {
    process.stderr.write(`[ewiki-mcp] handler error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    const id = (message as { id?: unknown } | null)?.id;
    respond({
      jsonrpc: '2.0',
      id: typeof id === 'string' || typeof id === 'number' || id === null ? id : null,
      error: { code: -32603, message: '内部错误' },
    });
  }
}

function respond(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
