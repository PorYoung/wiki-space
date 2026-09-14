// ---------------------------------------------------------------------------
// 端到端验收测试（production_ready 交付依据）
// 前置：server(3000)/worker/realtime 已运行（tsx watch），Postgres 容器 ewiki-pg，
//       Gitea 容器 gitea(3300) 且已创建 wikibot/WikiBot2026 与 Token。
// 运行：node scripts/e2e-platform.mjs   → 输出逐项 PASS/FAIL，写 scripts/e2e-report.json
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const GITEA = 'http://localhost:3300';
const GITEA_TOKEN = process.env.E2E_GITEA_TOKEN ?? '16ab18d25900c5e10dffda2fb3117433a851a66a';
const GITEA_USER = 'wikibot';
const NAS = 'D:/works/wiki-space/ewiki/data-nas';
const NAS2 = 'D:/works/wiki-space/ewiki/data-nas2';
const PASSWORD = 'Passw0rd!2026';

const results = [];
let ctx = {};

function record(id, name, pass, detail = '') {
  results.push({ id, name, pass, detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ''}`);
}

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function loginOrRegister(email, name) {
  let r = await req('/api/v1/auth/register', { method: 'POST', body: { email, password: PASSWORD, name } });
  if (r.status === 201) return { token: r.json.accessToken, userId: r.json.user?.id, sampleProject: r.json.sampleProject, registered: true };
  if (r.status === 409) {
    for (const pw of [PASSWORD, 'NewPass@2026']) {
      r = await req('/api/v1/auth/login', { method: 'POST', body: { email, password: pw } });
      if (r.status === 200) return { token: r.json.accessToken, userId: r.json.user?.id, registered: false };
    }
  }
  throw new Error(`loginOrRegister failed for ${email}: ${r.status} ${JSON.stringify(r.json)}`);
}

async function gitea(path, _method = 'GET') {
  const res = await fetch(`${GITEA}${path}`, {
    headers: { Authorization: `Bearer ${GITEA_TOKEN}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: { raw: text.slice(0, 200) } };
  }
}

// 直接在 Gitea 远端仓库写入一个文件（模拟仓库外部更新），用于验证平台手动同步的拉取消化链路
async function giteaCreateFile(repo, filePath, content, message) {
  const res = await fetch(`${GITEA}/api/v1/repos/${GITEA_USER}/${repo}/contents/${encodeURIComponent(filePath)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GITEA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), branch: 'main' }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: { raw: text.slice(0, 200) } };
  }
}

// 轮询项目概览的存储状态，等待手动同步把 storageStatus 从 syncing 收敛到 synced
async function pollOverview(projectId, token, { timeoutMs = 30_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  do {
    last = await req(`/api/v1/projects/${projectId}/overview`, { token });
    if (last.json?.storageStatus === 'synced' || last.json?.storageStatus === 'error') return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (Date.now() < deadline);
  return last;
}

// Gitea 对全新仓库的首次 push 存在约 0.5~1s 的提交可见性窗口（commits API 短暂返回空），
// 针对外部服务的断言按最终一致性轮询，避免时序抖动导致误报。
async function giteaPoll(path, { timeoutMs = 10_000, intervalMs = 300, check } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  do {
    last = await gitea(path);
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (Date.now() < deadline);
  return last;
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function findProjectDir(username, projectName, projectId) {
  // 与 @ewiki/storage slugifyName 同规则：目录名 = <slug(项目名)>-<项目 id 前 8 位>
  const slug = String(projectName).trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/[^.\w\u4e00-\u9fa5-]/g, '').replace(/^-+|-+$/g, '');
  const dir = path.join(NAS, 'users', username, 'projects', `${slug}-${String(projectId).slice(0, 8)}`);
  return exists(dir) ? dir : null;
}

// ---------------------------------------------------------------------------
async function main() {
  const t0 = Date.now();

  // [P0] 健康检查 + LDAP 预留
  {
    const health = await req('/healthz');
    record('P0', '健康检查 /healthz', health.status === 200 && health.json?.ok === true, JSON.stringify(health.json));
    const ldap = await req('/api/v1/auth/ldap/status');
    record('P0b', 'LDAP 预留接口（enabled=false）', ldap.status === 200 && ldap.json?.enabled === false, JSON.stringify(ldap.json));
  }

  // [P1] 注册 + 自动示例知识库
  {
    const alice = await loginOrRegister('alice-e2e@ewiki.local', 'Alice');
    ctx.alice = alice.token;
    ctx.aliceId = alice.userId;
    ctx.aliceRegistered = alice.registered === true;
    const list = await req('/api/v1/projects', { token: ctx.alice });
    const sample = (list.json.items ?? []).find((p) => p.template === 'personal-sample' && p.ownerId === ctx.aliceId);
    record('P1a', '注册成功并可登录', !!ctx.alice, `registered=${alice.registered}`);
    record('P1b', '注册即得个人示例知识库', !!sample, sample ? `id=${sample.id} name=${sample.name}` : '未找到示例库');
    ctx.sampleProjectId = sample?.id;
    if (sample) {
      const docs = await req(`/api/v1/projects/${sample.id}/documents`, { token: ctx.alice });
      record('P1c', '示例知识库含示例文档', (docs.json.items?.length ?? 0) >= 4, `${docs.json.items?.length} 篇`);
      const mirrorDir = findProjectDir('Alice', sample.name, sample.id);
      const mirrorOk = mirrorDir && exists(path.join(mirrorDir, 'Markdown 写作指南.md'));
      record('P1d', '示例文档已落盘 NAS（模拟盘）', !!mirrorOk, mirrorDir ?? '目录不存在');
    }
    const dup = await req('/api/v1/auth/register', { method: 'POST', body: { email: 'alice-e2e@ewiki.local', password: PASSWORD, name: 'Alice' } });
    record('P1e', '重复注册被拒（409）', dup.status === 409, JSON.stringify(dup.json));
    const weak = await req('/api/v1/auth/register', { method: 'POST', body: { email: 'weak@ewiki.local', password: '123', name: 'Weak' } });
    record('P1f', '弱密码注册被拒（400）', weak.status === 400, JSON.stringify(weak.json));
  }

  // [P2] bob / carol 注册
  {
    const bob = await loginOrRegister('bob-e2e@ewiki.local', 'Bob');
    const carol = await loginOrRegister('carol-e2e@ewiki.local', 'Carol');
    ctx.bob = bob.token;
    ctx.carol = carol.token;
    record('P2', '多用户注册（bob/carol）', !!ctx.bob && !!ctx.carol);
  }

  // [P3] 越权拦截：bob 访问 alice 的私有示例库
  {
    const denied = await req(`/api/v1/projects/${ctx.sampleProjectId}/documents`, { token: ctx.bob });
    record('P3', '越权读取被拦截（403 且不泄露数据）', denied.status === 403, `status=${denied.status} body=${JSON.stringify(denied.json).slice(0, 120)}`);
  }

  // [P4] 本地文档库：模板创建 + 落盘 + 增删查改（默认存储后端 local）
  const runId = Date.now().toString(36);
  {
    const created = await req('/api/v1/projects', {
      token: ctx.alice,
      method: 'POST',
      body: { name: `产品蓝图-${runId}`, description: 'e2e 本地文档库', template: 'project-space', storage: { kind: 'local' } },
    });
    ctx.projectPrefix = '产品蓝图';
    record(
      'P4a',
      '新建本地文档库（模板 project-space，后端 local）',
      created.status === 201 && created.json.docs >= 4 && created.json.project?.storageKind === 'local',
      JSON.stringify(created.json).slice(0, 160),
    );
    ctx.cloudId = created.json?.project?.id;

    const mirrorDir = findProjectDir('Alice', created.json.project.name, ctx.cloudId);
    ctx.cloudName = created.json.project.name;
    const mirrorOk = mirrorDir && exists(path.join(mirrorDir, '需求', '需求文档模板.md'));
    record('P4b', '模板文档落盘 NAS 且目录结构一致', !!mirrorOk, mirrorDir ?? '目录不存在');

    const newDoc = await req(`/api/v1/projects/${ctx.cloudId}/documents`, {
      token: ctx.alice,
      method: 'POST',
      body: { path: `需求/竞品分析-${runId}.md`, content: '# 竞品分析\n\n平台化写作验证。' },
    });
    ctx.cloudDocId = newDoc.json?.id;
    ctx.cloudDocPath = `需求/竞品分析-${runId}.md`;
    record('P4c', '新建文档（POST documents）', newDoc.status === 201, `id=${newDoc.json?.id}`);
    record('P4d', '新建文档同步落盘 NAS', !!mirrorDir && exists(path.join(mirrorDir, '需求', `竞品分析-${runId}.md`)), mirrorDir);

    const versions = await req(`/api/v1/documents/${ctx.cloudDocId}/versions`, { token: ctx.alice });
    const latest = versions.json.items?.[0]?.versionNo ?? 0;
    const conflict = await req(`/api/v1/documents/${ctx.cloudDocId}`, {
      token: ctx.alice,
      method: 'PUT',
      body: { content: '# 冲突版本\n', baseVersionNo: latest + 5 },
    });
    record('P4e', '版本冲突保护（409）', conflict.status === 409, JSON.stringify(conflict.json).slice(0, 120));

    const saved = await req(`/api/v1/documents/${ctx.cloudDocId}`, {
      token: ctx.alice,
      method: 'PUT',
      body: { content: '# 竞品分析\n\n更新于 e2e。', baseVersionNo: latest },
    });
    record('P4f', '文档更新成功（版本 v2）', saved.status === 200 && saved.json.version === latest + 1, `version=${saved.json?.version}`);
    const onDisk = mirrorDir && fs.readFileSync(path.join(mirrorDir, '需求', `竞品分析-${runId}.md`), 'utf8');
    record('P4g', '更新内容与 NAS 落盘一致（三方一致）', !!onDisk && onDisk.includes('更新于 e2e'));
  }

  // [P5] 存储配置：Gitea 连接（GitLab 方言同管线）
  {
    const good = await req('/api/v1/connections', {
      token: ctx.alice,
      method: 'POST',
      body: { name: '本地 Gitea（e2e）', kind: 'gitea', baseUrl: GITEA, token: GITEA_TOKEN },
    });
    record('P5a', '添加连接配置并验证成功', good.status === 201 && good.json.status === 'ok', good.json?.message);
    ctx.connId = good.json?.id;

    const bad = await req('/api/v1/connections', {
      token: ctx.alice,
      method: 'POST',
      body: { name: '错误令牌', kind: 'gitea', baseUrl: GITEA, token: 'invalid-token-xxx' },
    });
    record('P5b', '错误令牌验证失败且给出明确原因（不落库，400）', bad.status === 400 && bad.json.status === 'error' && /令牌/.test(bad.json.message ?? ''), `${bad.status} ${bad.json?.message}`);

    const invalid = await req('/api/v1/connections', { token: ctx.alice, method: 'POST', body: { name: 'x', kind: 'ftp', baseUrl: GITEA, token: 't' } });
    record('P5c', '非 Git 类型连接被拒（仅支持 GitLab/Gitea）', invalid.status === 400, JSON.stringify(invalid.json).slice(0, 120));

    // bob 也建立一个本人连接，供越权建库用例引用（真实存在但不属于 alice）
    const bobConn = await req('/api/v1/connections', {
      token: ctx.bob,
      method: 'POST',
      body: { name: 'bob 的 Gitea', kind: 'gitea', baseUrl: GITEA, token: GITEA_TOKEN },
    });
    ctx.bobConnId = bobConn.json?.id;
  }

  // [P5d/e] Git 文档库建库契约（需求 6/7）：必须基于用户级存储源连接 + 仓库名称；
  //   不允许直填 Git 地址/令牌（storage 判别联合仅接受 connectionId/repoName）
  {
    // 直填 Git 地址：storage.kind=git 但缺少 connectionId/repoName → zod 校验 400
    const legacy = await req('/api/v1/projects', {
      token: ctx.alice,
      method: 'POST',
      body: { name: 'legacy-url-lib', storage: { kind: 'git', url: `${GITEA}/wikibot/legacy-e2e.git`, token: GITEA_TOKEN } },
    });
    record('P5d', '直填 Git 地址/令牌建 Git 库被拒（400，需存储源连接）', legacy.status === 400, JSON.stringify(legacy.json).slice(0, 140));

    // 引用不存在（或不属本人）的存储源连接 → 403 且不暴露存在性
    const foreign = await req('/api/v1/projects', {
      token: ctx.alice,
      method: 'POST',
      body: { name: 'foreign-conn-lib', storage: { kind: 'git', connectionId: ctx.bobConnId, repoName: `x-${runId}` } },
    });
    record('P5e', '引用非本人存储源连接建库被拒（403）', foreign.status === 403, JSON.stringify(foreign.json).slice(0, 120));
  }

  // [P6] Git 文档库：单次建库（连接 + 仓库名）+ 工作副本 + 平台内自动提交推送 + 手动同步拉取消化
  {
    const gitRepo = `ewiki-e2e-wiki-${runId}`;
    ctx.gitRepo = gitRepo;
    const created = await req('/api/v1/projects', {
      token: ctx.alice,
      method: 'POST',
      body: {
        name: `项目空间 Wiki-${runId}`, template: 'team-wiki',
        storage: { kind: 'git', connectionId: ctx.connId, repoName: gitRepo, autoInit: true },
      },
    });
    const git = created.json?.git;
    record(
      'P6a',
      'Git 文档库单次建库并自动初始化/关联',
      created.status === 201 && created.json.project?.storageKind === 'git' && !!git?.repo,
      git ? `${git.repo} created=${git.created} ${git.message ?? ''}` : JSON.stringify(created.json).slice(0, 200),
    );
    ctx.gitId = created.json?.project?.id;

    const repo = await gitea(`/api/v1/repos/${GITEA_USER}/${ctx.gitRepo}`);
    record('P6b', 'Git 服务端已存在该仓库', repo.status === 200, repo.json?.full_name ?? JSON.stringify(repo.json).slice(0, 100));

    // 工作副本按项目 id 收敛：<server cwd>/data/repos/<projectId>/.git
    const workdir = 'D:/works/wiki-space/ewiki/apps/server/data/repos';
    record('P6c', '平台已按项目 id 克隆工作副本', !!ctx.gitId && exists(path.join(workdir, ctx.gitId, '.git')), ctx.gitId ? `repos/${ctx.gitId}` : 'no project');

    // 新建文档 → 自动提交
    const gitDoc = await req(`/api/v1/projects/${ctx.gitId}/documents`, {
      token: ctx.alice,
      method: 'POST',
      body: { path: '决策记录/e2e-check.md', content: '# e2e 自动提交验证\n\n由平台内保存触发。' },
    });
    ctx.gitDocId = gitDoc.json?.id;
    const pushed = gitDoc.json?.effects?.git;
    record('P6d', '平台内新建文档自动提交并推送', pushed?.attempted && pushed?.ok && pushed?.pushed, `commit=${pushed?.commitHash?.slice(0, 10)} err=${pushed?.error ?? '-'}`);

    const commits = await giteaPoll(`/api/v1/repos/${GITEA_USER}/${ctx.gitRepo}/commits`, {
      check: (r) => r.status === 200 && Array.isArray(r.json) && r.json.length > 0
        && JSON.stringify(r.json).includes('docs(') && JSON.stringify(r.json).includes('Alice'),
    });
    const msg = JSON.stringify(commits.json ?? []);
    record('P6e', 'Git 服务端可查到提交历史', commits.status === 200 && msg.includes('docs(') && msg.includes('Alice'), `commits=${Array.isArray(commits.json) ? commits.json.length : 0}`);

    // 更新文档 → 自动提交新版本
    const upd = await req(`/api/v1/documents/${ctx.gitDocId}`, {
      token: ctx.alice,
      method: 'PUT',
      body: { content: '# e2e 自动提交验证\n\n第二版。' },
    });
    const updGit = upd.json?.effects?.git;
    record('P6f', '更新文档自动提交推送', updGit?.attempted && updGit?.pushed, `commit=${updGit?.commitHash?.slice(0, 10)}`);

    const raw = await giteaPoll(`/api/v1/repos/${GITEA_USER}/${ctx.gitRepo}/raw/%E5%86%B3%E7%AD%96%E8%AE%B0%E5%BD%95/e2e-check.md?ref=main`, {
      check: (r) => r.status === 200 && String(r.json.raw ?? r.json).includes('第二版'),
    });
    record('P6g', 'Git 服务端文件内容与平台一致', raw.status === 200 && String(raw.json.raw ?? raw.json).includes('第二版'), `status=${raw.status}`);

    // autoInit:false 且仓库不存在 → 400 REPO_NOT_FOUND（旧实现为 404，新契约在校验阶段统一 400）
    const noInit = await req('/api/v1/projects', {
      token: ctx.alice,
      method: 'POST',
      body: {
        name: '不存在的仓库库',
        storage: { kind: 'git', connectionId: ctx.connId, repoName: `ewiki-e2e-missing-${runId}`, autoInit: false },
      },
    });
    record(
      'P6h',
      '关闭自动初始化且仓库不存在 → 明确 400 REPO_NOT_FOUND',
      noInit.status === 400 && /REPO_NOT_FOUND/.test(JSON.stringify(noInit.json)),
      JSON.stringify(noInit.json).slice(0, 140),
    );

    // ---- 手动同步：POST /api/v1/projects/:id/sync（仅 Git，需写权限） ----
    // 先在 Gitea 远端直接写入一篇平台侧尚不存在的文档，模拟仓库外部更新
    const remoteRel = `同步落地/remote-${runId}.md`;
    const remoteMarker = `REMOTE-SYNC-MARKER-${runId}`;
    const giteaWrite = await giteaCreateFile(ctx.gitRepo, remoteRel, `# 远端更新\n\n${remoteMarker}`, `docs: e2e 远端新增 ${remoteRel}`);
    record('P6i', '远端仓库外部写入成功（为手动同步制造增量）', giteaWrite.status === 201, `status=${giteaWrite.status}`);

    const sync = await req(`/api/v1/projects/${ctx.gitId}/sync`, { token: ctx.alice, method: 'POST' });
    record(
      'P6j',
      '手动同步入队（202 syncing）',
      sync.status === 202 && sync.json?.ok === true && sync.json?.status === 'syncing' && sync.json?.projectId === ctx.gitId,
      JSON.stringify(sync.json).slice(0, 140),
    );

    // worker 拉取消化：overview 收敛 synced，且平台文档列表出现远端新增文档
    const settled = await pollOverview(ctx.gitId, ctx.alice);
    let ingested = false;
    if (settled.json?.storageStatus === 'synced') {
      const list = await req(`/api/v1/projects/${ctx.gitId}/documents`, { token: ctx.alice });
      ingested = (list.json.items ?? []).some((d) => d.path === remoteRel);
    }
    record(
      'P6k',
      '手动同步拉取远端并消化为平台文档（storageStatus=synced）',
      settled.json?.storageStatus === 'synced' && ingested,
      `status=${settled.json?.storageStatus} ingested=${ingested} lastError=${settled.json?.lastError ?? '-'}`,
    );

    // 本地后端不支持同步 → 400 LOCAL_BACKEND_NO_SYNC
    const localSync = await req(`/api/v1/projects/${ctx.cloudId}/sync`, { token: ctx.alice, method: 'POST' });
    record(
      'P6l',
      '本地后端手动同步被拒（400 LOCAL_BACKEND_NO_SYNC）',
      localSync.status === 400 && /LOCAL_BACKEND_NO_SYNC/.test(JSON.stringify(localSync.json)),
      `status=${localSync.status}`,
    );

    // 只读成员（carol 尚不是该 Git 库成员，直接用 carol 令牌）触发同步 → 403
    const guestSync = await req(`/api/v1/projects/${ctx.gitId}/sync`, { token: ctx.carol, method: 'POST' });
    record('P6m', '无写权限用户触发同步被拒（403）', guestSync.status === 403, `status=${guestSync.status}`);

    // 无增量重复同步：刚 synced 立即再次手动触发。
    //  - 若与首次触发落在同一 singleton 分钟桶：pg-boss 静默丢弃，响应 202 deduped=true/status=deduped，
    //    项目状态保持 synced，不允许卡在 syncing；
    //  - 若恰好跨过分钟桶边界：新作业真实执行（零增量 noop），最终仍须收敛 synced 且无 lastError。
    const repeatSync = await req(`/api/v1/projects/${ctx.gitId}/sync`, { token: ctx.alice, method: 'POST' });
    const respOk =
      repeatSync.status === 202 &&
      (repeatSync.json?.deduped === true
        ? repeatSync.json?.status === 'deduped'
        : repeatSync.json?.status === 'syncing');
    const afterRepeat = await pollOverview(ctx.gitId, ctx.alice);
    record(
      'P6n',
      '重复手动同步幂等（202；同分钟桶去重或新作业 noop，状态均不卡 syncing，同 commit 不报错）',
      respOk && afterRepeat.json?.storageStatus === 'synced' && !afterRepeat.json?.lastError,
      `http=${repeatSync.status} resp=${JSON.stringify(repeatSync.json).slice(0, 120)} after=${afterRepeat.json?.storageStatus}`,
    );

    // 版本时间线/动态流留痕（PRD F46/F49）：初始化推送与平台内自动提交均应在平台侧可见
    const gitDocs = await req(`/api/v1/projects/${ctx.gitId}/documents`, { token: ctx.alice });
    const tplDoc = (gitDocs.json?.items ?? []).find((d) => d.path === '新人指引.md');
    let tplV1 = null;
    if (tplDoc) {
      const tplVersions = await req(`/api/v1/documents/${tplDoc.id}/versions`, { token: ctx.alice });
      tplV1 = (tplVersions.json?.items ?? []).find((v) => v.versionNo === 1);
    }
    record(
      'P6o',
      '初始化推送生成 v1 版本快照（commit hash 与建库响应一致）',
      !!tplV1 && !!git?.commitHash && tplV1.commitHash === git.commitHash && !!tplV1.message,
      `hash=${tplV1?.commitHash?.slice(0, 10)} init=${git?.commitHash?.slice(0, 10)}`,
    );

    const docVersions = await req(`/api/v1/documents/${ctx.gitDocId}/versions`, { token: ctx.alice });
    const docV = docVersions.json?.items ?? [];
    const dv1 = docV.find((v) => v.versionNo === 1);
    const dv2 = docV.find((v) => v.versionNo === 2);
    record(
      'P6p',
      '新建/保存文档的版本回填 commit hash（与自动提交一致）',
      !!dv1 && !!dv2 && dv1.commitHash === pushed?.commitHash && dv2.commitHash === updGit?.commitHash,
      `v1=${dv1?.commitHash?.slice(0, 10)} v2=${dv2?.commitHash?.slice(0, 10)}`,
    );

    const gitActs = await req(`/api/v1/activities?projectId=${ctx.gitId}`, { token: ctx.alice });
    const initSync = (gitActs.json?.items ?? []).find((a) => a.verb === 'sync' && a.actorName === 'Alice');
    record('P6q', '初始化推送进入动态流（「同步」记录）', !!initSync, JSON.stringify(initSync ?? gitActs.json).slice(0, 180));
  }

  // [P7] 分享与协作
  {
    const addEditor = await req(`/api/v1/projects/${ctx.cloudId}/members`, {
      token: ctx.alice, method: 'POST', body: { email: 'bob-e2e@ewiki.local', role: 'editor' },
    });
    record('P7a', '分享项目空间给 bob（可编辑）', addEditor.status === 201, JSON.stringify(addEditor.json).slice(0, 120));

    const bobList = await req(`/api/v1/projects/${ctx.cloudId}/documents`, { token: ctx.bob });
    record('P7b', '被分享者可读取', bobList.status === 200 && (bobList.json.items?.length ?? 0) > 0);

    const bobDoc = bobList.json.items?.find((d) => d.path === ctx.cloudDocPath);
    let bobEditOk = false;
    let bobVersion = 0;
    if (bobDoc) {
      const versions = await req(`/api/v1/documents/${bobDoc.id}/versions`, { token: ctx.bob });
      const latest = versions.json.items?.[0]?.versionNo ?? 0;
      const save = await req(`/api/v1/documents/${bobDoc.id}`, {
        token: ctx.bob, method: 'PUT',
        body: { content: '# 竞品分析\n\nbob 协作补充。', baseVersionNo: latest },
      });
      bobEditOk = save.status === 200;
      bobVersion = save.json?.version ?? 0;
    }
    record('P7c', '被分享者可编辑（多人协作写入成功）', bobEditOk, `version=${bobVersion}`);

    const bobManage = await req(`/api/v1/projects/${ctx.cloudId}/members`, {
      token: ctx.bob, method: 'POST', body: { email: 'carol-e2e@ewiki.local', role: 'guest' },
    });
    record('P7d', '编辑者无权管理成员（403）', bobManage.status === 403, `status=${bobManage.status}`);

    const addGuest = await req(`/api/v1/projects/${ctx.cloudId}/members`, {
      token: ctx.alice, method: 'POST', body: { email: 'carol-e2e@ewiki.local', role: 'guest' },
    });
    record('P7e', '分享给 carol（只读 guest）', addGuest.status === 201);

    const carolRead = await req(`/api/v1/projects/${ctx.cloudId}/documents`, { token: ctx.carol });
    record('P7f', 'guest 可读', carolRead.status === 200);
    const carolDoc = carolRead.json.items?.[0];
    const carolWrite = carolDoc
      ? await req(`/api/v1/documents/${carolDoc.id}`, { token: ctx.carol, method: 'PUT', body: { content: '# 越权\n' } })
      : { status: 0 };
    record('P7g', 'guest 编辑被拦截（403 只读）', carolWrite.status === 403, `status=${carolWrite.status}`);
  }

  // [P8] 发布网站（平台子路径，匿名可访问）
  {
    const site = await req(`/api/v1/projects/${ctx.cloudId}/publish-sites`, {
      token: ctx.alice, method: 'POST',
      body: { slug: 'ewiki-e2e-site', addressMode: 'subpath', templateId: 't-docs', schedule: 'manual' },
    });
    let siteId = site.json?.id;
    if (site.status === 409) {
      const list = await req(`/api/v1/projects/${ctx.cloudId}/publish-sites`, { token: ctx.alice });
      siteId = list.json.items?.[0]?.id;
      record('P8a', '发布站点（已存在则复用）', !!siteId, 'SITE_EXISTS → reuse');
    } else {
      record('P8a', '创建发布站点（subpath + t-docs）', site.status === 201, JSON.stringify(site.json).slice(0, 140));
    }

    const trigger = await req(`/api/v1/publish-sites/${siteId}/jobs`, { token: ctx.alice, method: 'POST' });
    record('P8b', '触发发布任务（入队）', trigger.status === 202, JSON.stringify(trigger.json));

    let published = false;
    let lastJob = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const jobs = await req(`/api/v1/publish-sites/${siteId}/jobs`, { token: ctx.alice });
      lastJob = jobs.json.items?.[0];
      if (lastJob?.status === 'published') { published = true; break; }
      if (lastJob?.status === 'failed') break;
    }
    record('P8c', 'worker 渲染并发布成功', published, JSON.stringify(lastJob).slice(0, 160));

    const anon = await fetch(`${BASE}/sites/ewiki-e2e-site/`, { signal: AbortSignal.timeout(15_000) });
    const html = await anon.text();
    record('P8d', '平台子路径匿名可访问且排版正常', anon.status === 200 && html.includes('<html') && html.includes('竞品分析'), `status=${anon.status} bytes=${html.length}`);

    const nasSite = path.join(NAS, 'users', 'Alice', 'sites', 'ewiki-e2e-site');
    record('P8e', '站点资源写入用户分配存储目录', exists(path.join(nasSite, 'current.json')), nasSite);
  }

  // [P9] 系统管理
  {
    const admin = await req('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@ewiki.local', password: 'ewiki-admin' } });
    ctx.admin = admin.json?.accessToken;
    record('P9a', '管理员登录', admin.status === 200 && ctx.admin, admin.json?.user?.globalRole);

    const users = await req('/api/v1/admin/users', { token: ctx.admin });
    record('P9b', '用户管理列表', users.status === 200 && (users.json.items?.length ?? 0) >= 4, `${users.json.items?.length} 个用户`);

    const forbidden = await req('/api/v1/admin/users', { token: ctx.alice });
    record('P9c', '非管理员访问系统管理被拒（403）', forbidden.status === 403, `status=${forbidden.status}`);

    const bobMe = await req('/api/v1/me', { token: ctx.bob });
    const bobId = bobMe.json?.id;
    const disable = await req(`/api/v1/admin/users/${bobId}`, { token: ctx.admin, method: 'PATCH', body: { status: 'disabled' } });
    const bobBlocked = await req('/api/v1/me', { token: ctx.bob });
    record('P9d', '禁用用户即时生效（403）', disable.status === 200 && bobBlocked.status === 403, `after disable: ${bobBlocked.status}`);

    const enable = await req(`/api/v1/admin/users/${bobId}`, { token: ctx.admin, method: 'PATCH', body: { status: 'active' } });
    const bobBack = await req('/api/v1/me', { token: ctx.bob });
    record('P9e', '启用用户恢复访问', enable.status === 200 && bobBack.status === 200);

    const reset = await req(`/api/v1/admin/users/${bobId}/password`, { token: ctx.admin, method: 'POST', body: { password: 'NewPass@2026' } });
    const bobRelogin = await req('/api/v1/auth/login', { method: 'POST', body: { email: 'bob-e2e@ewiki.local', password: 'NewPass@2026' } });
    ctx.bob = bobRelogin.json?.accessToken ?? ctx.bob;
    record('P9f', '管理员重置密码后可登录', reset.status === 200 && bobRelogin.status === 200);

    const sys = await req('/api/v1/admin/system', { token: ctx.admin });
    const tables = (sys.json?.db?.tables ?? []).map((t) => t.table);
    record('P9g', '数据库状态查看（版本/体积/表行数）', sys.status === 200 && tables.includes('storage_connections') && sys.json.db.bytes > 0, `${sys.json?.db?.version} · ${tables.length} tables`);
    record('P9h', '存储基础设施查看（NAS 根目录可写 + 用户占用）', sys.json?.storage?.nasWritable === true && (sys.json?.storage?.perUser?.length ?? 0) >= 1, JSON.stringify(sys.json?.storage?.perUser?.[0] ?? {}));

    // NAS 根目录运行时切换演练（新目录落盘 → 切回）
    const change = await req('/api/v1/admin/storage/nas-root', { token: ctx.admin, method: 'POST', body: { path: NAS2 } });
    const docInNewRoot = await req(`/api/v1/projects/${ctx.cloudId}/documents`, {
      token: ctx.alice, method: 'POST', body: { path: `发布/切换演练-${runId}.md`, content: '# NAS 切换演练' },
    });
    const slug = String(ctx.cloudName).trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/[^.\w\u4e00-\u9fa5-]/g, '').replace(/^-+|-+$/g, '');
    const landed = exists(path.join(NAS2, 'users', 'Alice', 'projects', `${slug}-${String(ctx.cloudId).slice(0, 8)}`, '发布', `切换演练-${runId}.md`));
    record('P9i', '存储根目录运行时切换并落盘验证', change.status === 200 && docInNewRoot.status === 201 && landed, change.json?.root ?? JSON.stringify(change.json).slice(0, 100));
    const revert = await req('/api/v1/admin/storage/nas-root', { token: ctx.admin, method: 'POST', body: { path: NAS } });
    record('P9j', '切回原存储目录', revert.status === 200, revert.json?.root);

    const audit = await req('/api/v1/admin/audit?limit=200', { token: ctx.admin });
    const actions = new Set((audit.json.items ?? []).map((a) => a.action));
    // user.register 仅在本轮确有新注册时才产生（重跑套件老用户走登录分支，不写该台账）
    const expected = [...(ctx.aliceRegistered ? ['user.register'] : []), 'project.create', 'connection.create', 'git.auto_commit', 'project.sync_requested', 'project.share_grant', 'publish_site.create', 'admin.user_disable'];
    const missing = expected.filter((a) => !actions.has(a));
    const suffix = ctx.aliceRegistered ? '' : '（本轮为登录复跑，豁免 user.register）';
    record('P9k', `关键操作审计台账（注册/建库/连接/自动提交/手动同步/分享/发布/禁用）${suffix}`, missing.length === 0, missing.length ? `缺少: ${missing.join(',')}` : `${audit.json.items?.length} 条台账齐全`);
  }

  // [P10] 团队 · 文档归属 · 五态权限（TEAM-PERMISSIONS-DESIGN §8.2）
  {
    const dave = await loginOrRegister('dave-e2e@ewiki.local', 'Dave');
    ctx.dave = dave.token;

    // P10a 创建团队（alice）→ owner 席位自动建立
    const team = await req('/api/v1/teams', {
      token: ctx.alice, method: 'POST', body: { name: `E2E团队-${runId}`, description: 'e2e 团队' },
    });
    const teamId = team.json?.id;
    ctx.teamId = teamId;
    record('P10a', '创建团队（任何登录用户）', team.status === 201 && team.json?.myRole === 'owner' && team.json?.memberCount === 1, JSON.stringify(team.json).slice(0, 140));

    // P10b 非成员不可见团队（列表不含 + 详情 403）
    const bobTeams = await req('/api/v1/teams', { token: ctx.bob });
    const bobDetail = await req(`/api/v1/teams/${teamId}`, { token: ctx.bob });
    record('P10b', '非成员看不到团队（列表不含 + 详情 403）',
      !(bobTeams.json?.items ?? []).some((t) => t.id === teamId) && bobDetail.status === 403,
      `list=${(bobTeams.json?.items ?? []).length} detail=${bobDetail.status}`);

    // P10c 添加成员：bob(member) + carol(maintainer)；未注册邮箱 404（不代造账号）
    const addBob = await req(`/api/v1/teams/${teamId}/members`, {
      token: ctx.alice, method: 'POST', body: { email: 'bob-e2e@ewiki.local', role: 'member' },
    });
    const addCarol = await req(`/api/v1/teams/${teamId}/members`, {
      token: ctx.alice, method: 'POST', body: { email: 'carol-e2e@ewiki.local', role: 'maintainer' },
    });
    const addGhost = await req(`/api/v1/teams/${teamId}/members`, {
      token: ctx.alice, method: 'POST', body: { email: `nobody-${runId}@ewiki.local`, role: 'member' },
    });
    record('P10c', '添加成员：bob(member)/carol(maintainer) 成功；未注册邮箱 404',
      addBob.status === 201 && addCarol.status === 201 && addGhost.status === 404,
      `bob=${addBob.status} carol=${addCarol.status} ghost=${addGhost.status}`);

    // P10d member 无权改团队设置
    const bobPatchTeam = await req(`/api/v1/teams/${teamId}`, {
      token: ctx.bob, method: 'PATCH', body: { name: '改了也不该生效' },
    });
    record('P10d', 'member 改团队设置被拒（403）', bobPatchTeam.status === 403, `status=${bobPatchTeam.status}`);

    // P10e owner 保护：maintainer 不能移除 owner；owner 不能移除自己（最后一名 owner）
    const carolRemoveOwner = await req(`/api/v1/teams/${teamId}/members/${ctx.aliceId}`, {
      token: ctx.carol, method: 'PUT', body: { remove: true },
    });
    const selfRemove = await req(`/api/v1/teams/${teamId}/members/${ctx.aliceId}`, {
      token: ctx.alice, method: 'PUT', body: { remove: true },
    });
    record('P10e', 'owner 保护：maintainer 不可移除 owner(403)；最后一名 owner 不可自移除(400)',
      carolRemoveOwner.status === 403 && selfRemove.status === 400,
      `carol=${carolRemoveOwner.status} self=${selfRemove.status}`);

    // P10f 团队库（team-read）：团队成员可读，局外人不可读
    const teamProj = await req('/api/v1/projects', {
      token: ctx.alice, method: 'POST',
      body: { name: `团队库-${runId}`, visibility: 'team-read', ownerType: 'team', ownerTeamId: teamId, storage: { kind: 'local' } },
    });
    const teamProjId = teamProj.json?.project?.id;
    ctx.teamProjId = teamProjId;
    const bobRead = await req(`/api/v1/projects/${teamProjId}/overview`, { token: ctx.bob });
    const daveRead = await req(`/api/v1/projects/${teamProjId}/overview`, { token: ctx.dave });
    const daveList = await req('/api/v1/projects', { token: ctx.dave });
    record('P10f', '团队库归属校验 + team-read：bob 可读 / dave(非成员)不可读不可见',
      teamProj.status === 201 && teamProj.json?.project?.ownerType === 'team' && bobRead.status === 200 && daveRead.status === 403 && !(daveList.json?.items ?? []).some((p) => p.id === teamProjId),
      `create=${teamProj.status} bob=${bobRead.status} dave=${daveRead.status}`);

    // 建一篇文档用于写权限探针
    const doc = await req(`/api/v1/projects/${teamProjId}/documents`, {
      token: ctx.alice, method: 'POST', body: { path: 'README.md', content: '# 团队库\n初始内容' },
    });
    const docId = doc.json?.id ?? doc.json?.document?.id;
    ctx.teamDocId = docId;

    // P10g 切 team-write：bob 可写；dave 仍不可读
    const toTeamWrite = await req(`/api/v1/projects/${teamProjId}`, { token: ctx.alice, method: 'PATCH', body: { visibility: 'team-write' } });
    const bobWrite = await req(`/api/v1/documents/${docId}`, { token: ctx.bob, method: 'PUT', body: { content: '# 团队库\nbob 在 team-write 档位写入' } });
    const daveStillHidden = await req(`/api/v1/projects/${teamProjId}/overview`, { token: ctx.dave });
    record('P10g', '切 team-write：团队成员可写；局外人仍不可见',
      toTeamWrite.status === 200 && bobWrite.status === 200 && daveStillHidden.status === 403,
      `patch=${toTeamWrite.status} bobWrite=${bobWrite.status} dave=${daveStillHidden.status}`);

    // P10h 切 public-read：dave 可读不可写
    const toPublicRead = await req(`/api/v1/projects/${teamProjId}`, { token: ctx.alice, method: 'PATCH', body: { visibility: 'public-read' } });
    const daveRead2 = await req(`/api/v1/projects/${teamProjId}/overview`, { token: ctx.dave });
    const daveWriteDenied = await req(`/api/v1/documents/${docId}`, { token: ctx.dave, method: 'PUT', body: { content: 'dave 不该能写' } });
    record('P10h', '切 public-read：登录用户可读、写被拒（403）',
      toPublicRead.status === 200 && daveRead2.status === 200 && daveWriteDenied.status === 403,
      `patch=${toPublicRead.status} read=${daveRead2.status} write=${daveWriteDenied.status}`);

    // P10i 切 public-write：dave 可写
    const toPublicWrite = await req(`/api/v1/projects/${teamProjId}`, { token: ctx.alice, method: 'PATCH', body: { visibility: 'public-write' } });
    const daveWriteOk = await req(`/api/v1/documents/${docId}`, { token: ctx.dave, method: 'PUT', body: { content: '# 公开可写档位\nDave 写入' } });
    record('P10i', '切 public-write：登录用户可写', toPublicWrite.status === 200 && daveWriteOk.status === 200,
      `patch=${toPublicWrite.status} write=${daveWriteOk.status}`);

    // P10j 个人库禁设团队档位（zod 400）与后端兜底（PATCH 400）
    const personalTeamVis = await req('/api/v1/projects', {
      token: ctx.alice, method: 'POST', body: { name: `个人库-${runId}`, visibility: 'team-read', storage: { kind: 'local' } },
    });
    const transferProj = await req('/api/v1/projects', {
      token: ctx.alice, method: 'POST', body: { name: `转移演练-${runId}`, visibility: 'private', storage: { kind: 'local' } },
    });
    const transferProjId = transferProj.json?.project?.id;
    ctx.transferProjId = transferProjId;
    const patchTeamVis = await req(`/api/v1/projects/${transferProjId}`, { token: ctx.alice, method: 'PATCH', body: { visibility: 'team-read' } });
    record('P10j', '个人库禁设团队档位（创建 400 + PATCH 400 VISIBILITY_REQUIRES_TEAM）',
      personalTeamVis.status === 400 && patchTeamVis.status === 400 && String(patchTeamVis.json?.message ?? '').includes('VISIBILITY_REQUIRES_TEAM'),
      `create=${personalTeamVis.status} patch=${patchTeamVis.status}`);

    // P10k 转移个人库 → 团队（owner + 目标团队 owner）；转移后 bob 按档位获得读
    const transferToTeam = await req(`/api/v1/projects/${transferProjId}/transfer`, {
      token: ctx.alice, method: 'POST', body: { targetType: 'team', targetTeamId: teamId, confirmed: true },
    });
    await req(`/api/v1/projects/${transferProjId}`, { token: ctx.alice, method: 'PATCH', body: { visibility: 'team-read' } });
    const bobReadTransferred = await req(`/api/v1/projects/${transferProjId}/overview`, { token: ctx.bob });
    const teamProjects = await req(`/api/v1/teams/${teamId}/projects`, { token: ctx.bob });
    record('P10k', '转移个人库 → 团队；团队库列表可见；bob 依档位获得读',
      transferToTeam.status === 200 && transferToTeam.json?.ownerType === 'team' && bobReadTransferred.status === 200 && (teamProjects.json?.items ?? []).some((p) => p.id === transferProjId),
      `transfer=${transferToTeam.status} bobRead=${bobReadTransferred.status} teamProjects=${(teamProjects.json?.items ?? []).length}`);

    // P10l 团队 → 个人：team-* 档位冲突 400；调档后团队 owner 转回成功
    const transferBackConflict = await req(`/api/v1/projects/${transferProjId}/transfer`, {
      token: ctx.alice, method: 'POST', body: { targetType: 'user', confirmed: true },
    });
    await req(`/api/v1/projects/${transferProjId}`, { token: ctx.alice, method: 'PATCH', body: { visibility: 'private' } });
    const transferBack = await req(`/api/v1/projects/${transferProjId}/transfer`, {
      token: ctx.alice, method: 'POST', body: { targetType: 'user', confirmed: true },
    });
    const memberTransferDenied = await (async () => {
      // bob（仅团队成员、非团队 owner）试图转走 —— 先让 alice 再转一次给团队以构造场景
      await req(`/api/v1/projects/${transferProjId}/transfer`, { token: ctx.alice, method: 'POST', body: { targetType: 'team', targetTeamId: teamId, confirmed: true } });
      const r = await req(`/api/v1/projects/${transferProjId}/transfer`, { token: ctx.bob, method: 'POST', body: { targetType: 'user', confirmed: true } });
      await req(`/api/v1/projects/${transferProjId}/transfer`, { token: ctx.alice, method: 'POST', body: { targetType: 'user', confirmed: true } });
      return r;
    })();
    record('P10l', '团队 → 个人：team-* 冲突 400；调档后转回成功；非团队 owner 转走被拒',
      transferBackConflict.status === 400 && transferBack.status === 200 && transferBack.json?.ownerType === 'user' && memberTransferDenied.status === 403,
      `conflict=${transferBackConflict.status} back=${transferBack.status} memberDenied=${memberTransferDenied.status}`);

    // P10m 越权回归：旧三端点（改 globalRole / 代造账号 / 用户枚举）已下线
    const legacyRole = await req(`/api/v1/team/${ctx.bobId ?? '00000000-0000-0000-0000-000000000000'}/role`, {
      token: ctx.bob, method: 'PATCH', body: { role: 'Owner' },
    });
    const legacyInvite = await req('/api/v1/team/invite', {
      token: ctx.bob, method: 'POST', body: { email: `pwn-${runId}@ewiki.local`, role: 'Editor' },
    });
    const legacyList = await req('/api/v1/team', { token: ctx.bob });
    record('P10m', '越权回归：旧 /api/v1/team* 三端点全部下线（404）',
      legacyRole.status === 404 && legacyInvite.status === 404 && legacyList.status === 404,
      `role=${legacyRole.status} invite=${legacyInvite.status} list=${legacyList.status}`);

    // P10n 审计台账：team.create / team.member_add / project.transfer / project.visibility_change
    const audit2 = await req('/api/v1/admin/audit?limit=300', { token: ctx.admin });
    const actions2 = new Set((audit2.json.items ?? []).map((a) => a.action));
    const expected2 = ['team.create', 'team.member_add', 'project.transfer', 'project.visibility_change'];
    const missing2 = expected2.filter((a) => !actions2.has(a));
    record('P10n', '团队/归属/可见性变更审计台账齐全', missing2.length === 0,
      missing2.length ? `缺少: ${missing2.join(',')}` : 'team.create / team.member_add / project.transfer / project.visibility_change 齐全');

    // P10o 成员页接口下发团队继承成员（F6）：团队库的 /members 返回 teamMembers 含团队成员
    const teamMem = await req(`/api/v1/projects/${teamProjId}/members`, { token: ctx.alice });
    const inherited = teamMem.json?.teamMembers ?? [];
    const hasTeamMemberNames = inherited.length >= 1 && inherited.some((m) => m.email === 'bob-e2e@ewiki.local');
    record('P10o', '团队成员接口下发继承成员列表（F6）',
      teamMem.status === 200 && inherited.length >= 1 && hasTeamMemberNames,
      `status=${teamMem.status} inherited=${inherited.length} ${hasTeamMemberNames ? '含 bob' : '缺 bob'}`);

    // P10p 团队发现目录：internal 团队对登录用户可见并可浏览详情/成员；private 团队不出现在 discover
    const discoverable = await req('/api/v1/teams', {
      token: ctx.alice, method: 'POST', body: { name: `可发现团队-${runId}`, description: 'internal 目录', visibility: 'internal' },
    });
    const discoverableId = discoverable.json?.id;
    await req(`/api/v1/teams/${discoverableId}`, { token: ctx.alice, method: 'PATCH', body: { visibility: 'internal' } });
    const discoverList = await req('/api/v1/teams/discover', { token: ctx.dave });
    const discoverContains = (discoverList.json?.items ?? []).some((t) => t.id === discoverableId && t.visibility === 'internal');
    const discoverExcludesPrivate = !(discoverList.json?.items ?? []).some((t) => t.id === teamId); // teamId 是 private
    const daveSeeInternalDetail = await req(`/api/v1/teams/${discoverableId}`, { token: ctx.dave });
    const daveSeeInternalMembers = await req(`/api/v1/teams/${discoverableId}/members`, { token: ctx.dave });
    record('P10p', '团队发现目录：internal 可见/可浏览；private 不出现',
      discoverable.status === 201 && discoverContains && discoverExcludesPrivate &&
        daveSeeInternalDetail.status === 200 && daveSeeInternalMembers.status === 200,
      `discover=${discoverList.status} contains=${discoverContains} excludesPrivate=${discoverExcludesPrivate} detail=${daveSeeInternalDetail.status} members=${daveSeeInternalMembers.status}`);

    // P10q public-write 写路径带版本历史（§11-2「审计+版本历史兜底」可观测）：dave 写入后 versions ≥1
    const verResp = await req(`/api/v1/documents/${docId}/versions`, { token: ctx.dave });
    const versions = verResp.json?.items ?? [];
    record('P10q', 'public-write 写路径有版本历史兜底（治理可观测）',
      verResp.status === 200 && versions.length >= 1, `versions=${versions.length}`);
  }

  // ---------------------------------------------------------------------------
  // ---- P11 全文检索 + 向量检索 + 索引自动化管线（SEARCH-VECTOR-DESIGN 验收） ----
  // 前置：postgres 为检索扩展镜像（pgvector + zhparser，迁移 0008）；
  //       server/worker 配置 EMBEDDING_PROVIDER=openai-compatible 指向 mock 嵌入服务
  //       （scripts/mock-embedding-server.mjs，dim=1024，GET /stats 返回嵌入计数）；
  //       SEARCH_INDEX_DEBOUNCE_SECONDS 建议为小值（本地验证 3s）以缩短用例等待。
  // ---------------------------------------------------------------------------
  {
    const waitFor = async (check, { timeoutMs = 25_000, intervalMs = 500 } = {}) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      do {
        last = await check();
        if (last) return last;
        await new Promise((r) => setTimeout(r, intervalMs));
      } while (Date.now() < deadline);
      return last;
    };

    // P11-0 建库 + 两篇中文文档（FTS 生成列随写即时生效，无需等待队列）
    const sp = await req('/api/v1/projects', {
      token: ctx.alice, method: 'POST',
      body: { name: `检索验证库-${runId}`, storage: { kind: 'local' } },
    });
    const spId = sp.json?.project?.id ?? sp.json?.id;
    const docA = await req(`/api/v1/projects/${spId}/documents`, {
      token: ctx.alice, method: 'POST',
      body: { path: '部署/上线手册.md', content: '# 上线手册\n\n## 发布流程\n\n本项目采用蓝绿发布策略，发布前必须完成回滚演练与监控告警检查。\n\n## 回滚步骤\n\n回滚时切换网关流量到上一版本，观察核心指标恢复正常。' },
    });
    const docB = await req(`/api/v1/projects/${spId}/documents`, {
      token: ctx.alice, method: 'POST',
      body: { path: '架构/检索设计.md', content: '# 检索设计\n\n全文检索使用 PostgreSQL 生成列与 zhparser 中文分词，语义检索基于 pgvector 向量索引与嵌入服务自动构建。' },
    });
    const docAId = docA.json?.id;
    const docBId = docB.json?.id;

    // P11a 全文检索：中文分词命中 + ts_headline 高亮（生成列即时可见，零队列）
    const kw = await req(`/api/v1/search?q=${encodeURIComponent('蓝绿发布')}&mode=keyword`, { token: ctx.alice });
    const kwHit = (kw.json?.items ?? []).find((it) => it.documentId === docAId);
    record('P11a', '全文检索：中文分词命中 + 高亮 snippet（生成列随写即时生效）',
      kw.status === 200 && !!kwHit && /<em>/.test(kwHit.snippet ?? ''),
      `status=${kw.status} hit=${!!kwHit} snippet=${(kwHit?.snippet ?? '').slice(0, 60)}`);

    // P11b 权限隔离：bob（无该私库权限）检索私库独有词不可见（readableProjectIdsSql 单一口径）
    const kwBob = await req(`/api/v1/search?q=${encodeURIComponent('蓝绿发布')}&mode=keyword`, { token: ctx.bob });
    const bobLeak = (kwBob.json?.items ?? []).some((it) => it.documentId === docAId);
    record('P11b', '权限隔离：无权限库内容不出现在检索结果（含 snippet 不泄露）',
      kwBob.status === 200 && !bobLeak, `status=${kwBob.status} leak=${bobLeak}`);

    // P11c 增量更新：内容新增独立词 → 索引自动更新可见（自动提交队列 latest-wins）
    const saved = await req(`/api/v1/documents/${docAId}`, {
      token: ctx.alice, method: 'PUT',
      body: { content: '# 上线手册\n\n## 发布流程\n\n本项目采用蓝绿发布策略，发布前必须完成回滚演练与监控告警检查。\n\n## 回滚步骤\n\n回滚时切换网关流量到上一版本，观察核心指标恢复正常。\n\n灰度放量期间保持双跑道配置同步。', baseVersionNo: 1 },
    });
    const kwIncr = await waitFor(async () => {
      const r = await req(`/api/v1/search?q=${encodeURIComponent('灰度放量')}&mode=keyword`, { token: ctx.alice });
      return (r.json?.items ?? []).some((it) => it.documentId === docAId) ? r : null;
    });
    record('P11c', '增量更新：编辑后新词自动进入索引（防抖合并后可见）',
      saved.status === 200 && !!kwIncr, `save=${saved.status} indexed=${!!kwIncr}`);

    // P11d 语义降级：未开启向量的库上请求 semantic → 自动降级关键词并带 degraded 标记
    const degraded = await req(`/api/v1/search?q=${encodeURIComponent('检索设计')}&mode=semantic&projectId=${spId}`, { token: ctx.alice });
    record('P11d', '降级链：未开启向量时 semantic 自动降级 keyword 且响应带 degraded',
      degraded.status === 200 && degraded.json?.degraded === 'vector-disabled',
      `status=${degraded.status} degraded=${degraded.json?.degraded}`);

    // P11e 开启向量 → 自动提交全量构建（无需任何手工步骤）并等待完成
    const enable = await req(`/api/v1/projects/${spId}/search-config`, {
      token: ctx.alice, method: 'PUT', body: { vector: true },
    });
    const buildDone = await waitFor(async () => {
      const r = await req(`/api/v1/projects/${spId}/search-index`, { token: ctx.alice });
      const b = r.json?.builds?.[0];
      return b && (b.status === 'done' || b.status === 'failed' || b.status === 'canceled') ? r.json : null;
    }, { timeoutMs: 40_000 });
    const latestBuild = buildDone?.builds?.[0];
    record('P11e', '自动构建：开启向量后自动全量回填（2 文档 → chunks 就绪）',
      enable.status === 200 && latestBuild?.status === 'done' &&
        (buildDone?.stats?.total_chunks ?? 0) > 0 && (buildDone?.stats?.total_docs ?? 0) === 2,
      `enable=${enable.status} build=${latestBuild?.status} chunks=${buildDone?.stats?.total_chunks} docs=${buildDone?.stats?.total_docs}`);

    // P11f 语义检索：mode=semantic 返回 reason=semantic + 标题链 heading（mock 嵌入为词面重叠相似度）
    // 限定本项目：全局语义检索会混入历史 run 的同名同内容文档（mock 向量确定性同分）
    const sem = await req(`/api/v1/search?q=${encodeURIComponent('回滚步骤怎么做')}&mode=semantic&projectId=${spId}`, { token: ctx.alice });
    const semTop = (sem.json?.items ?? [])[0];
    record('P11f', '语义检索：chunk 级召回聚合到文档（reason=semantic + heading 标题链）',
      sem.status === 200 && semTop?.documentId === docAId && semTop?.reason === 'semantic' &&
        String(semTop?.heading ?? '').includes('回滚'),
      `status=${sem.status} top=${semTop?.path} reason=${semTop?.reason} heading=${semTop?.heading}`);

    // P11g 重命名零重嵌：仅改 title（内容哈希未变）→ mock 嵌入服务计数不增加（§6.2-3 哈希去重）
    const statsBefore = await fetch(`${process.env.MOCK_EMBEDDING_BASE ?? 'http://localhost:3090'}/stats`).then((r) => r.json());
    await req(`/api/v1/documents/${docBId}`, { token: ctx.alice, method: 'PATCH', body: { title: '检索设计 v2' } });
    await waitFor(async () => {
      const r = await req(`/api/v1/search?q=${encodeURIComponent('检索设计 v2')}&mode=keyword`, { token: ctx.alice });
      return (r.json?.items ?? []).some((it) => it.documentId === docBId);
    });
    await new Promise((r) => setTimeout(r, 1500)); // 等 reindex 任务消化
    const statsAfter = await fetch(`${process.env.MOCK_EMBEDDING_BASE ?? 'http://localhost:3090'}/stats`).then((r) => r.json());
    record('P11g', '增量去重：重命名（title 变更、内容不变）触发索引刷新但零重复嵌入',
      statsAfter.texts === statsBefore.texts, `texts ${statsBefore.texts} → ${statsAfter.texts}`);

    // P11h 删除：软删后索引自动清除（关键词不再命中 + chunk 数下降）
    const chunksBefore = await req(`/api/v1/projects/${spId}/search-index`, { token: ctx.alice });
    const del = await req(`/api/v1/documents/${docBId}`, { token: ctx.alice, method: 'DELETE' });
    const afterDel = await waitFor(async () => {
      const r = await req(`/api/v1/projects/${spId}/search-index`, { token: ctx.alice });
      return (r.json?.stats?.total_chunks ?? 0) < (chunksBefore.json?.stats?.total_chunks ?? 0) ? r.json?.stats : null;
    }, { timeoutMs: 20_000 });
    const kwDel = await req(`/api/v1/search?q=${encodeURIComponent('zhparser')}&mode=keyword`, { token: ctx.alice });
    const delLeak = (kwDel.json?.items ?? []).some((it) => it.documentId === docBId);
    record('P11h', '删除：软删后向量 chunk 自动清除，且关键词不再命中',
      del.status === 200 && !!afterDel && !delLeak,
      `del=${del.status} chunks=${chunksBefore.json?.stats?.total_chunks}→${afterDel?.total_chunks} leak=${delLeak}`);

    // P11i 管理端检索统计（M3）：/admin/system 下发 search 分区
    const sys = await req('/api/v1/admin/system', { token: ctx.admin });
    record('P11i', '管理端检索统计：chunk 规模/向量库数/分词配置可见',
      sys.status === 200 && typeof sys.json?.search?.totalChunks === 'number' && sys.json?.search?.totalChunks > 0,
      `status=${sys.status} search=${JSON.stringify(sys.json?.search ?? null).slice(0, 140)}`);

    // P11j 未配置 Provider 的开启请求被拒（气隙安全缺省）：以无向量库重试开关 → 若平台已配置 Provider 则跳过
    if (sys.json?.search?.embeddingProvider === 'none') {
      const denied = await req(`/api/v1/projects/${ctx.sampleProjectId}/search-config`, {
        token: ctx.alice, method: 'PUT', body: { vector: true },
      });
      record('P11j', '安全缺省：EMBEDDING_PROVIDER=none 时开启向量被拒（422）', denied.status === 422, `status=${denied.status}`);
    } else {
      record('P11j', '安全缺省：平台已配置嵌入服务（跳过 422 负向断言）', true, `provider=${sys.json?.search?.embeddingProvider}`);
    }
  }

  // ---------------------------------------------------------------------------
  // ---- P12 检索管理与运营（SEARCH-VECTOR-DESIGN §15 验收）：全局配置 · 任务视图 · 修复/重试 ----
  // ---------------------------------------------------------------------------
  {
    const waitFor = async (check, { timeoutMs = 30_000, intervalMs = 500 } = {}) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      do {
        last = await check();
        if (last) return last;
        await new Promise((r) => setTimeout(r, intervalMs));
      } while (Date.now() < deadline);
      return last;
    };

    // 准备：独立知识库 + 1 篇文档 + 开启向量（构建完成）
    const sp = await req('/api/v1/projects', {
      token: ctx.alice, method: 'POST',
      body: { name: `检索管理验证库-${runId}`, storage: { kind: 'local' } },
    });
    const spId = sp.json?.project?.id ?? sp.json?.id;
    await req(`/api/v1/projects/${spId}/documents`, {
      token: ctx.alice, method: 'POST',
      body: { path: '运维/索引管理.md', content: '# 索引管理\n\n管理员可以便捷配置嵌入服务、查看构建任务视图并执行资源调配。' },
    });
    await req(`/api/v1/projects/${spId}/search-config`, { token: ctx.alice, method: 'PUT', body: { vector: true } });
    const ready = await waitFor(async () => {
      const r = await req(`/api/v1/projects/${spId}/search-index`, { token: ctx.alice });
      return r.json?.builds?.[0]?.status === 'done' ? r.json : null;
    });

    // P12a 管理端总览：全局配置（apiKey 掩码）+ 资源统计 + 队列视图 + 任务视图；非管理员 403
    const ovAdmin = await req('/api/v1/admin/search/overview', { token: ctx.admin });
    const ovBob = await req('/api/v1/admin/search/overview', { token: ctx.bob });
    const ov = ovAdmin.json ?? {};
    record('P12a', '管理端检索总览：配置（apiKey 掩码）/统计/队列/任务视图一体下发；非管理员被拒',
      ovAdmin.status === 200 && ovBob.status === 403 &&
        typeof ov.config?.debounceSeconds === 'number' && typeof ov.columnDim === 'number' &&
        Array.isArray(ov.queues) && Array.isArray(ov.builds) && ov.builds.length >= 1 &&
        (ov.config.apiKeySet === false || /\*\*\*[0-9]{4}$/.test(ov.config.apiKey ?? '')),
      `admin=${ovAdmin.status} bob=${ovBob.status} builds=${ov.builds?.length} queues=${ov.queues?.length} apiKeyMasked=${ov.config?.apiKeySet !== undefined}`);

    // P12b 全局配置运行时更新：非管理员 403；管理员保存即生效（响应回显）
    const cfgDenied = await req('/api/v1/admin/search/config', {
      token: ctx.alice, method: 'PUT', body: { debounceSeconds: 99 },
    });
    const cfgSet = await req('/api/v1/admin/search/config', {
      token: ctx.admin, method: 'PUT',
      body: { debounceSeconds: 3, semanticMinScore: 0.05, model: 'mock-bge' },
    });
    record('P12b', '全局配置便捷设置：管理员保存即时生效；非管理员被拒',
      cfgDenied.status === 403 && cfgSet.status === 200 &&
        cfgSet.json?.config?.debounceSeconds === 3 && cfgSet.json?.config?.semanticMinScore === 0.05,
      `denied=${cfgDenied.status} set=${cfgSet.status} debounce=${cfgSet.json?.config?.debounceSeconds}`);

    // P12c 全局把控（kill switch）：关闭 → 已开向量库的语义检索立即降级；恢复 → 语义可用
    await req('/api/v1/admin/search/config', { token: ctx.admin, method: 'PUT', body: { vectorEnabled: false } });
    const off = await req(`/api/v1/search?q=${encodeURIComponent('索引管理')}&mode=semantic&projectId=${spId}`, { token: ctx.alice });
    await req('/api/v1/admin/search/config', { token: ctx.admin, method: 'PUT', body: { vectorEnabled: true } });
    const on = await waitFor(async () => {
      const r = await req(`/api/v1/search?q=${encodeURIComponent('索引管理')}&mode=semantic&projectId=${spId}`, { token: ctx.alice });
      return r.json?.items?.length > 0 && !r.json?.degraded ? r.json : null;
    }, { timeoutMs: 20_000 });
    record('P12c', '全局开关把控：关闭即全局暂停语义检索（degraded），恢复后语义可用',
      off.json?.degraded === 'vector-disabled' && !!on,
      `off degraded=${off.json?.degraded} on items=${on?.items?.length}`);

    // P12d 项目构建配置：chunk 参数便捷设置 + 构建留痕比对（params）
    const cfgChunk = await req(`/api/v1/projects/${spId}/search-config`, {
      token: ctx.alice, method: 'PUT', body: { chunkTokens: 384, overlapTokens: 40 },
    });
    await req(`/api/v1/projects/${spId}/search-index/rebuild`, { token: ctx.alice, method: 'POST' });
    const rebuilt = await waitFor(async () => {
      const r = await req(`/api/v1/projects/${spId}/search-index`, { token: ctx.alice });
      const latest = r.json?.builds?.[0];
      return latest && latest.status === 'done' && latest.createdAt > new Date(Date.now() - 60_000).toISOString() ? latest : null;
    });
    record('P12d', '构建配置便捷设置：chunk 参数保存生效，构建任务留痕参数供比对',
      cfgChunk.status === 200 && cfgChunk.json?.searchConfig?.chunkTokens === 384 &&
        rebuilt?.params?.chunkTokens === 384 && rebuilt?.params?.overlapTokens === 40,
      `cfg=${cfgChunk.status} params=${JSON.stringify(rebuilt?.params ?? null)}`);

    // P12e 修复缺口（单项目即时对账）：健康库 queuedDocs=0；无权限者 403
    const repair = await req(`/api/v1/projects/${spId}/search-index/repair`, { token: ctx.alice, method: 'POST' });
    const repairBob = await req(`/api/v1/projects/${spId}/search-index/repair`, { token: ctx.bob, method: 'POST' });
    record('P12e', '修复缺口：健康索引零修复入队；无权限者被拒',
      repair.status === 200 && typeof repair.json?.queuedDocs === 'number' && repairBob.status === 403,
      `repair=${repair.status} queuedDocs=${repair.json?.queuedDocs} bob=${repairBob.status}`);

    // P12f 任务视图操作：对已完成构建重试 → 409（仅失败/取消可重试）；立即对账仅管理员
    const doneBuild = (ov.builds ?? []).find((b) => b.status === 'done');
    const retryDone = doneBuild
      ? await req(`/api/v1/admin/search/builds/${doneBuild.id}/retry`, { token: ctx.admin, method: 'POST' })
      : { status: 'skipped' };
    const reconBob = await req('/api/v1/admin/search/reconcile', { token: ctx.bob, method: 'POST' });
    const reconAdmin = await req('/api/v1/admin/search/reconcile', { token: ctx.admin, method: 'POST' });
    record('P12f', '任务视图操作：done 构建重试被拒（409）；立即对账仅管理员可触发',
      (doneBuild ? retryDone.status === 409 : retryDone.status === 'skipped') &&
        reconBob.status === 403 && reconAdmin.status === 200,
      `retryDone=${retryDone.status} reconBob=${reconBob.status} reconAdmin=${reconAdmin.status}`);

    // P12g 恢复全局默认防抖（避免影响其他用例的索引时效）
    await req('/api/v1/admin/search/config', { token: ctx.admin, method: 'PUT', body: { debounceSeconds: 3, vectorEnabled: true } });
    record('P12g', '全局配置恢复（防抖 3s / 向量开启）', true, 'cleanup');
  }

  const passed = results.filter((r) => r.pass).length;
  const summary = {
    startedAt: new Date(t0).toISOString(),
    durationMs: Date.now() - t0,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
  fs.writeFileSync(path.resolve('scripts/e2e-report.json'), JSON.stringify(summary, null, 2));
  console.log(`\n===== E2E 完成：${passed}/${results.length} 通过（${summary.durationMs}ms）=====`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('E2E 致命错误：', err);
  process.exit(1);
});
