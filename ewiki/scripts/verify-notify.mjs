// Conformance 5 一次性核验：LISTEN ewiki_events，触发一次手动同步，捕获 NOTIFY 载荷并校验 projectId。
// 用法：node scripts/verify-notify.mjs <projectId>
import postgres from '../apps/server/node_modules/postgres/src/index.js';

const [projectId] = process.argv.slice(2);
if (!projectId) {
  console.error('用法: node scripts/verify-notify.mjs <projectId>');
  process.exit(2);
}

const login = await fetch('http://localhost:3000/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'alice-e2e@ewiki.local', password: 'Passw0rd!2026' }),
});
const token = (await login.json()).accessToken;
if (!token) {
  console.error('登录失败，无法取得 token');
  process.exit(2);
}

const sql = postgres('postgres://ewiki:ewiki@localhost:5432/ewiki');
const captured = [];

await sql.listen('ewiki_events', (payload) => {
  captured.push(payload);
  console.log('[NOTIFY]', payload);
});

console.log('[step] LISTEN ewiki_events 已订阅，触发 POST /projects/:id/sync');
const res = await fetch(`http://localhost:3000/api/v1/projects/${projectId}/sync`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
});
console.log('[step] sync HTTP', res.status, await res.text());

await new Promise((r) => setTimeout(r, 10_000));

const syncEvents = captured
  .map((raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })
  .filter((m) => m && m.channel === 'sync' && m.payload?.event === 'sync.status_changed');

const ok = syncEvents.some(
  (m) => m.payload.payload?.projectId === projectId && m.payload.payload?.status === 'synced',
);
console.log(ok ? 'RESULT PASS: NOTIFY 载荷含 projectId 且 status=synced' : 'RESULT FAIL: 未捕获到匹配的 sync.status_changed(synced) 事件');
console.log(`sync 事件数=${syncEvents.length}`);

await sql.end();
process.exit(ok ? 0 : 1);
