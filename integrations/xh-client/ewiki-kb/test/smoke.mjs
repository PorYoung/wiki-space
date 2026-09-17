/**
 * ewiki-kb 插件装载冒烟（AI-FIRST-CLIENT-INTEGRATION-DESIGN §6/§9）：
 *   ① 用 edith 官方校验器 parsePluginManifest 校验 plugin.json；
 *   ② 以 mock ctx 装载 backend/main.mjs（贡献完整性断言）；
 *   ③ 对 ewiki REST 桩实测端到端：连接保存（SecretStore 托管）→ 连接测试 → 检索/读/写工具 → 失败结构化。
 *
 * 运行（edith 仓库根）：npx tsx data/plugins/ewiki-kb/test/smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { parsePluginManifest } from '../../../../src/plugin-system/host/plugin-manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '..');

let passed = 0;
function ok(cond, label) {
  if (!cond) throw new Error(`断言失败：${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

// ── ① manifest 官方校验器 ──
const manifest = parsePluginManifest(join(pluginRoot, 'plugin.json'));
ok(manifest.id === 'ewiki-kb' && manifest.trust === 'official', 'manifest 通过 edith 官方校验（id/trust 合法）');
const declared = manifest.contributes.tools.map((t) => t.id);
ok(declared.length === 11 && declared.length <= 12, `工具预算 ${declared.length}/12（maxTools 内）`);
ok(manifest.contributes.tools.some((t) => t.dangerous === true), '删除工具声明 dangerous（HITL 确认卡）');
ok(manifest.permissions.some((p) => typeof p === 'object' && p.name === 'secret.scoped' && p.value === 'ewiki-kb/*'), 'secret.scoped 权限按 ewiki-kb/* 最小声明');

// ── mock ctx（SecretStore/KV 内存实现，语义对齐平台契约） ──
const kv = new Map();
const secretBox = new Map();
const ctx = {
  featureId: 'ewiki-kb',
  source: 'plugin:ewiki-kb',
  logger: { info() {}, warn() {}, error() {} },
  config: { get: (_k, d) => d },
  storage: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    set: async (k, v) => void kv.set(k, v),
    delete: async (k) => void kv.delete(k),
    keys: async () => [...kv.keys()],
  },
  services: {
    secrets: {
      set: async (owner, key, plain) => {
        const ref = `eds:${owner}:${key}`;
        secretBox.set(ref, plain);
        return ref;
      },
      resolve: async (ref, pattern) => {
        if (pattern !== 'ewiki-kb/*' && !String(ref).startsWith('eds:ewiki-kb:')) return null;
        return secretBox.get(ref) ?? null;
      },
      delete: async (owner, key) => secretBox.delete(`eds:${owner}:${key}`),
      exists: async (owner, key) => secretBox.has(`eds:${owner}:${key}`),
    },
  },
};

// ── ewiki REST 桩 ──
const TOKEN = 'ewk_plugin_smoke_token';
const hits = [];
const rest = createServer((req, res) => {
  const url = new URL(req.url, 'http://stub');
  hits.push(`${req.method} ${url.pathname}${url.search}`);
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if ((req.headers.authorization ?? '') !== `Bearer ${TOKEN}`) {
    if (url.pathname === '/api/open/v1/openapi.json') return json(200, { openapi: '3.1.0' }); // 真实 ewiki：免认证
    return json(401, { code: 'unauthorized', message: '令牌无效' });
  }
  if (url.pathname === '/api/open/v1/search') return json(200, { items: [{ documentId: 'doc-1', path: 'ops/x.md', title: '部署手册', snippet: '…', score: 0.9 }], hasMore: false });
  if (url.pathname === '/api/open/v1/projects') return json(200, { items: [{ id: 'p1', name: '手册', visibility: 'private' }], total: 1 });
  if (url.pathname === '/api/open/v1/documents/doc-1' && req.method === 'DELETE') return json(200, { ok: true });
  if (url.pathname === '/api/open/v1/documents/doc-1') return json(200, { id: 'doc-1', path: 'ops/x.md', title: '部署手册', content: '# X', latestVersionNo: 3 });
  return json(404, { code: 'not_found', message: 'nf' });
});
const restPort = await new Promise((r) => rest.listen(0, '127.0.0.1', () => r(rest.address().port)));
const stubBase = `http://127.0.0.1:${restPort}`;

// ── ② 装载 + 贡献完整性 ──
const { default: create } = await import(pathToFileURL(join(pluginRoot, 'backend', 'main.mjs')).href);
const contrib = await create(ctx);
ok(Array.isArray(contrib.tools) && contrib.tools.length === 11, `入口产出 11 个工具（与 manifest 等长）`);
for (const t of manifest.contributes.tools) {
  const rt = contrib.tools.find((x) => x.id === t.id);
  ok(rt && typeof rt.handler === 'function', `工具 ${t.id} 元数据 × handler 合成`);
}
ok(contrib.routes && contrib.bridge && contrib.skills?.length === 1 && contrib.agents?.length === 1 && contrib.ui?.length === 3, 'routes/bridge/skills/agents/ui 贡献齐备');
ok(contrib.ui.every((u) => u.renderer.type === 'iframe-app' && u.viewId.startsWith('ewiki-kb:')), 'UI 全部 iframe-app 且 viewId 命名空间化（零宿主改动）');
ok(contrib.skills[0].content && contrib.skills[0].content.includes('查重'), '技能内容内联（pkg 快照安全）');

// 未配置态：结构化失败，不抛错
const before = contrib.tools.find((t) => t.id === 'ewiki.search');
const notConfigured = await before.handler({ q: 'x' });
ok(notConfigured.success === false && notConfigured.error === 'EWIKI_NOT_CONFIGURED', '未配置 → 结构化失败（不抛错、不触发自动停用计数）');

// ── ③ 端到端（桥通道保存连接 → REST 桩实测） ──
const save = await contrib.bridge.invoke({ path: '/connection.save', body: { baseUrl: stubBase, token: TOKEN } });
ok(save.ok === true && save.patPrefix === TOKEN.slice(0, 12), '连接保存：PAT 入 SecretStore，只回前缀');
ok([...secretBox.keys()][0] === 'eds:ewiki-kb:pat', 'scopedRef 形态 eds:ewiki-kb:pat（D6：插件不持明文）');
ok(!JSON.stringify(kv.get('connection')).includes(TOKEN), '命名空间 KV 不落令牌明文');

const status = await contrib.tools.find((t) => t.id === 'ewiki.connection_status').handler({});
ok(status.configured === true && status.baseUrl === stubBase, 'connection_status 自诊断');

const test = await contrib.bridge.invoke({ path: '/connection.test' });
ok(test.ok === true && test.steps.reachable.ok && test.steps.auth.ok, '连接分步测试：可达 + 认证');

const searched = await contrib.tools.find((t) => t.id === 'ewiki.search').handler({ q: '部署' });
ok(searched.success !== false && searched.items?.[0]?.documentId === 'doc-1', 'ewiki.search 打通 REST 桩（items 直通）');
ok(hits.some((h) => h.startsWith('GET /api/open/v1/search')), '工具执行回环 /api/open/v1/search');

const doc = await contrib.tools.find((t) => t.id === 'ewiki.read_document').handler({ documentId: 'doc-1' });
ok(doc.content === '# X' && doc.latestVersionNo === 3, 'ewiki.read_document 全文读取');

const missing = await contrib.tools.find((t) => t.id === 'ewiki.read_document').handler({});
ok(missing.success === false && missing.error === 'INVALID_ARGUMENTS', '缺必填参数 → 结构化 INVALID_ARGUMENTS');

// 换坏令牌验证 401 路径（消息面向用户可执行），再恢复正常连接供解绑断言
await contrib.bridge.invoke({ path: '/connection.save', body: { baseUrl: stubBase, token: 'ewk_wrong' } });
const unauthorized = await contrib.bridge.invoke({ path: '/kb/projects' });
ok(unauthorized.ok === false && /令牌|401/.test(unauthorized.message), 'REST 401 → 桥结构化失败（消息面向用户可执行）');
await contrib.bridge.invoke({ path: '/connection.save', body: { baseUrl: stubBase, token: TOKEN } });

const unlink = await contrib.bridge.invoke({ path: '/connection.delete' });
ok(unlink.ok === true && secretBox.size === 0, '解绑：SecretStore 密文同步清理');

console.log(`\n[ewiki-kb smoke] PASS：${passed} 项断言全绿`);
rest.close();
process.exit(0);
