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

async function gitea(path, method = 'GET') {
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

  // [P4] 云文档库：模板创建 + 落盘 + 增删查改
  const runId = Date.now().toString(36);
  {
    const created = await req('/api/v1/projects/with-storage', {
      token: ctx.alice,
      method: 'POST',
      body: { name: `产品蓝图-${runId}`, description: 'e2e 云文档库', template: 'project-space', storageType: 'cloud' },
    });
    ctx.projectPrefix = '产品蓝图';
    record('P4a', '新建云文档库（模板 project-space）', created.status === 201 && created.json.docs >= 4, JSON.stringify(created.json).slice(0, 160));
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
    record('P5b', '错误令牌验证失败且给出明确原因', bad.status === 201 && bad.json.status === 'error' && /令牌/.test(bad.json.message ?? ''), bad.json?.message);

    const invalid = await req('/api/v1/connections', { token: ctx.alice, method: 'POST', body: { name: 'x', kind: 'ftp', baseUrl: GITEA, token: 't' } });
    record('P5c', '非 Git 类型连接被拒（仅支持 GitLab/Gitea）', invalid.status === 400, JSON.stringify(invalid.json).slice(0, 120));
  }

  // [P6] Git 仓库库：自动初始化 + 自动提交
  {
    const gitRepo = `ewiki-e2e-wiki-${runId}`;
    ctx.gitRepo = gitRepo;
    const created = await req('/api/v1/projects/with-storage', {
      token: ctx.alice,
      method: 'POST',
      body: {
        name: `项目空间 Wiki-${runId}`, template: 'team-wiki', storageType: 'git',
        git: { connectionId: ctx.connId, repoName: gitRepo, autoInit: true },
      },
    });
    const git = created.json?.git;
    record('P6a', 'Git 仓库自动初始化/关联', created.status === 201 && !!git?.repo, git ? `${git.repo} created=${git.created} ${git.message}` : JSON.stringify(created.json).slice(0, 200));
    ctx.gitId = created.json?.project?.id;

    const repo = await gitea(`/api/v1/repos/${GITEA_USER}/${ctx.gitRepo}`);
    record('P6b', 'Git 服务端已存在该仓库', repo.status === 200, repo.json?.full_name ?? JSON.stringify(repo.json).slice(0, 100));

    const workdir = 'D:/works/wiki-space/ewiki/apps/server/data/repos';
    const srcId = created.json?.source?.id;
    record('P6c', '平台已克隆工作副本', !!srcId && exists(path.join(workdir, srcId, '.git')), srcId ? `repos/${srcId}` : 'no source');

    // 新建文档 → 自动提交
    const gitDoc = await req(`/api/v1/projects/${ctx.gitId}/documents`, {
      token: ctx.alice,
      method: 'POST',
      body: { path: '决策记录/e2e-check.md', content: '# e2e 自动提交验证\n\n由平台内保存触发。' },
    });
    ctx.gitDocId = gitDoc.json?.id;
    const pushed = gitDoc.json?.effects?.git;
    record('P6d', '平台内新建文档自动提交并推送', pushed?.attempted && pushed?.ok && pushed?.pushed, `commit=${pushed?.commitHash?.slice(0, 10)} err=${pushed?.error ?? '-'}`);

    const commits = await gitea(`/api/v1/repos/${GITEA_USER}/${ctx.gitRepo}/commits`);
    const msg = JSON.stringify(commits.json ?? []);
    record('P6e', 'Git 服务端可查到提交历史', commits.status === 200 && msg.includes('docs(') && msg.includes('Alice'), `commits=${commits.json?.length ?? 0}`);

    // 更新文档 → 自动提交新版本
    const upd = await req(`/api/v1/documents/${ctx.gitDocId}`, {
      token: ctx.alice,
      method: 'PUT',
      body: { content: '# e2e 自动提交验证\n\n第二版。' },
    });
    const updGit = upd.json?.effects?.git;
    record('P6f', '更新文档自动提交推送', updGit?.attempted && updGit?.pushed, `commit=${updGit?.commitHash?.slice(0, 10)}`);

    const raw = await gitea(`/api/v1/repos/${GITEA_USER}/${ctx.gitRepo}/raw/%E5%86%B3%E7%AD%96%E8%AE%B0%E5%BD%95/e2e-check.md?ref=main`);
    record('P6g', 'Git 服务端文件内容与平台一致', raw.status === 200 && String(raw.json.raw ?? raw.json).includes('第二版'), `status=${raw.status}`);

    const noInit = await req('/api/v1/projects/with-storage', {
      token: ctx.alice,
      method: 'POST',
      body: {
        name: '不存在的仓库库', storageType: 'git',
        git: { connectionId: ctx.connId, repoName: `ewiki-e2e-missing-${runId}`, autoInit: false },
      },
    });
    record('P6h', '关闭自动初始化且仓库不存在 → 明确 404', noInit.status === 404, JSON.stringify(noInit.json).slice(0, 140));
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
      const detail = await req(`/api/v1/documents/${bobDoc.id}`, { token: ctx.bob });
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
    const expected = ['user.register', 'project.create', 'connection.create', 'git.auto_commit', 'project.share_grant', 'publish_site.create', 'admin.user_disable'];
    const missing = expected.filter((a) => !actions.has(a));
    record('P9k', '关键操作审计台账（注册/建库/连接/自动提交/分享/发布/禁用）', missing.length === 0, missing.length ? `缺少: ${missing.join(',')}` : `${audit.json.items?.length} 条台账齐全`);
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
