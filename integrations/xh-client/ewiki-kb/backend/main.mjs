/**
 * ewiki 知识库插件 · 后端入口（文件系统通道，AI-FIRST-CLIENT-INTEGRATION-DESIGN §6）
 *
 * 定位：ewiki 开放 API（/api/open/v1）的插件投影——工具行为与 ewiki MCP 托管端点单源
 * （同一批 REST 端点，鉴权/scope/限流/审计完全一致）。PAT 入平台 SecretStore
 * （scopedRef：eds:ewiki-kb:pat），插件与 iframe UI 永不持明文（D6 纪律）。
 *
 * 生产分发（builtin 通道）：pkg 打包产物内 data/plugins 不可用，需移植为
 * src/plugins/ewiki-kb/（TS，参照 src/plugins/email/），见本插件 README。
 */
import { Hono } from 'hono';

const OWNER = 'ewiki-kb';
const SECRET_PATTERN = 'ewiki-kb/*';
const CONN_KEY = 'connection';
const OPEN_API = '/api/open/v1';

/** 结构化工具失败（不抛错：抛错会计入平台 T4.2 自动停用计数） */
function toolFail(code, message) {
  return { success: false, output: message, error: code };
}

/** ewiki REST 错误 → 面向 AI 可执行的消息（409 提示重读、429 提示等待） */
function explainError(err) {
  const status = err?.status;
  if (err?.code === 'EWIKI_NOT_CONFIGURED' || err?.code === 'EWIKI_TOKEN_MISSING') {
    return err;
  }
  if (status === 401) err.message = `ewiki 令牌无效或已吊销/过期：请在 ewiki Web 端「设置 → API 令牌」重新签发，并在本插件面板更新（${err.message}）`;
  else if (status === 403) err.message = `ewiki 令牌 scope 不足（${err.message}）：该操作需要更高权限，请在 ewiki 端调整或换用读写令牌`;
  else if (status === 409) err.message = `版本冲突：他人已先保存该文档（${err.message}）。请重新 ewiki.read_document 获取最新内容与 latestVersionNo 后重试，禁止盲目覆盖`;
  else if (status === 429) err.message = `ewiki 限流（${err.message}）：请等待 Retry-After 秒后重试`;
  else if (status === 404 && err.code === 'public_search_disabled') err.message = `ewiki 公开检索未开启（${err.message}）`;
  else if (status === 0 || err?.code === 'NETWORK_ERROR') err.message = `无法连接 ewiki 服务：${err.message}。请用 ewiki.connection_status 检查配置，或在插件面板「测试连接」`;
  return err;
}

export default function create(ctx) {
  const log = (...a) => console.log('[ewiki-kb]', ...a);

  async function getConnection() {
    return ctx.storage.get(CONN_KEY); // { baseUrl, patRef, patPrefix }
  }

  async function resolveToken(conn) {
    if (!conn?.patRef) return null;
    const secrets = ctx.services.secrets;
    if (!secrets) throw Object.assign(new Error('平台未提供密钥托管（ctx.services.secrets）'), { code: 'NO_SECRET_STORE' });
    return secrets.resolve(conn.patRef, SECRET_PATTERN);
  }

  /** 开放 API 调用（与 ewiki MCP 托管端点的回环客户端同一批端点） */
  async function callOpenApi(method, path, opts = {}) {
    const conn = await getConnection();
    if (!conn?.baseUrl) {
      throw Object.assign(new Error('尚未配置 ewiki 连接：请打开「ewiki 知识库」面板，填写服务地址与访问令牌'), { code: 'EWIKI_NOT_CONFIGURED' });
    }
    const token = await resolveToken(conn);
    if (!token) {
      throw Object.assign(new Error('ewiki 令牌引用失效：请在本插件面板重新保存访问令牌'), { code: 'EWIKI_TOKEN_MISSING' });
    }
    const url = new URL(conn.baseUrl.replace(/\/+$/, '') + OPEN_API + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
    const init = { method, headers: { Authorization: `Bearer ${token}` } };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw explainError(Object.assign(new Error(`${e?.message ?? e}`), { code: 'NETWORK_ERROR', status: 0 }));
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      throw explainError(Object.assign(new Error(json?.message ?? res.statusText), { code: json?.code ?? `HTTP_${res.status}`, status: res.status }));
    }
    return json;
  }

  /** 连接分步自检：① 服务可达（openapi.json 免认证）② 令牌有效（projects 带 PAT） */
  async function testConnection() {
    const conn = await getConnection();
    if (!conn?.baseUrl) return { ok: false, step: 'config', message: '尚未配置连接' };
    const base = conn.baseUrl.replace(/\/+$/, '');
    const steps = {};
    try {
      const r1 = await fetch(`${base}${OPEN_API}/openapi.json`);
      steps.reachable = { ok: r1.ok, status: r1.status };
      if (!r1.ok) return { ok: false, steps, message: `服务不可达（HTTP ${r1.status}）：检查地址与服务端 OPENAPI_ENABLED` };
    } catch (e) {
      steps.reachable = { ok: false, error: String(e?.message ?? e) };
      return { ok: false, steps, message: `无法连接 ${base}：${e?.message ?? e}` };
    }
    const token = await resolveToken(conn);
    if (!token) return { ok: false, steps, message: '令牌引用失效，请重新保存访问令牌' };
    try {
      const r2 = await fetch(`${base}${OPEN_API}/projects?page=1&pageSize=1`, { headers: { Authorization: `Bearer ${token}` } });
      steps.auth = { ok: r2.ok, status: r2.status };
      if (r2.status === 401) return { ok: false, steps, message: '令牌无效/已吊销/已过期：请重新签发并保存' };
      if (r2.status === 403) return { ok: false, steps, message: '令牌 scope 不足（至少需要 read）：建议签发「只读」预设' };
      if (!r2.ok) return { ok: false, steps, message: `认证请求失败（HTTP ${r2.status}）` };
    } catch (e) {
      steps.auth = { ok: false, error: String(e?.message ?? e) };
      return { ok: false, steps, message: `认证请求异常：${e?.message ?? e}` };
    }
    return { ok: true, steps, message: '连接正常：服务可达，令牌有效' };
  }

  async function saveConnection(body) {
    const baseUrl = String(body?.baseUrl ?? '').trim().replace(/\/+$/, '');
    const token = String(body?.token ?? '').trim();
    if (!/^https?:\/\//.test(baseUrl)) return { ok: false, message: '服务地址需以 http(s):// 开头' };
    if (!token) return { ok: false, message: '缺少访问令牌（ewiki Web 端「设置 → API 令牌」签发）' };
    const secrets = ctx.services.secrets;
    if (!secrets) return { ok: false, message: '平台未提供密钥托管，无法保存令牌' };
    // 换令牌时清理旧凭据，避免孤儿密文
    const old = await getConnection();
    if (old?.patRef) {
      await secrets.delete(OWNER, 'pat').catch(() => {});
    }
    const patRef = await secrets.set(OWNER, 'pat', token);
    await ctx.storage.set(CONN_KEY, { baseUrl, patRef, patPrefix: token.slice(0, 12), savedAt: Date.now() });
    log('connection saved:', baseUrl);
    return { ok: true, baseUrl, patPrefix: token.slice(0, 12) };
  }

  // ── 工具 handler（REST 投影；manifest 元数据 × 此处真实 handler 按 id 合成） ──
  function apiTool(id, run) {
    return {
      id,
      category: 'API',
      handler: async (args) => {
        try {
          return await run(args ?? {});
        } catch (err) {
          log(`tool ${id} failed:`, err?.code, err?.message);
          return toolFail(err?.code ?? 'EWIKI_ERROR', err?.message ?? String(err));
        }
      },
    };
  }

  function str(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  }
  function reqStr(args, key, tool) {
    const v = str(args[key]);
    if (!v) throw Object.assign(new Error(`${tool}: 缺少必填参数 ${key}`), { code: 'INVALID_ARGUMENTS', status: 400 });
    return v;
  }

  const tools = [
    apiTool('ewiki.search', async (args) => {
      const q = reqStr(args, 'q', 'ewiki.search');
      return callOpenApi('GET', '/search', { query: { q, mode: str(args.mode), projectId: str(args.projectId), limit: args.limit != null ? String(args.limit) : undefined } });
    }),
    apiTool('ewiki.read_document', async (args) => {
      const id = reqStr(args, 'documentId', 'ewiki.read_document');
      return callOpenApi('GET', `/documents/${encodeURIComponent(id)}`);
    }),
    apiTool('ewiki.list_projects', async () => callOpenApi('GET', '/projects')),
    apiTool('ewiki.list_documents', async (args) => {
      const projectId = reqStr(args, 'projectId', 'ewiki.list_documents');
      return callOpenApi('GET', `/projects/${encodeURIComponent(projectId)}/documents`, { query: { q: str(args.q), tag: str(args.tag) } });
    }),
    apiTool('ewiki.get_versions', async (args) => {
      const id = reqStr(args, 'documentId', 'ewiki.get_versions');
      return callOpenApi('GET', `/documents/${encodeURIComponent(id)}/versions`);
    }),
    apiTool('ewiki.create_document', async (args) => {
      const projectId = reqStr(args, 'projectId', 'ewiki.create_document');
      const body = { path: reqStr(args, 'path', 'ewiki.create_document'), content: reqStr(args, 'content', 'ewiki.create_document') };
      if (str(args.title)) body.title = str(args.title);
      const json = await callOpenApi('POST', `/projects/${encodeURIComponent(projectId)}/documents`, { body });
      return { ok: true, document: { id: json?.id, path: json?.path, title: json?.title } };
    }),
    apiTool('ewiki.update_document', async (args) => {
      const id = reqStr(args, 'documentId', 'ewiki.update_document');
      const body = { content: reqStr(args, 'content', 'ewiki.update_document') };
      if (str(args.title)) body.title = str(args.title);
      if (str(args.message)) body.message = str(args.message);
      if (typeof args.baseVersionNo === 'number') body.baseVersionNo = args.baseVersionNo;
      const json = await callOpenApi('PUT', `/documents/${encodeURIComponent(id)}`, { body });
      return { ok: true, version: json?.version };
    }),
    apiTool('ewiki.move_document', async (args) => {
      const id = reqStr(args, 'documentId', 'ewiki.move_document');
      const body = {};
      if (str(args.path)) body.path = str(args.path);
      if (str(args.title)) body.title = str(args.title);
      if (Object.keys(body).length === 0) throw Object.assign(new Error('ewiki.move_document: 需要 path 或 title 至少其一'), { code: 'INVALID_ARGUMENTS', status: 400 });
      const json = await callOpenApi('PATCH', `/documents/${encodeURIComponent(id)}`, { body });
      return { ok: true, path: json?.document?.path, title: json?.document?.title };
    }),
    apiTool('ewiki.set_tags', async (args) => {
      const id = reqStr(args, 'documentId', 'ewiki.set_tags');
      const tags = Array.isArray(args.tags) ? args.tags.filter((t) => typeof t === 'string') : [];
      await callOpenApi('PUT', `/documents/${encodeURIComponent(id)}/tags`, { body: { tags } });
      return { ok: true, tags };
    }),
    apiTool('ewiki.delete_document', async (args) => {
      const id = reqStr(args, 'documentId', 'ewiki.delete_document');
      await callOpenApi('DELETE', `/documents/${encodeURIComponent(id)}`);
      return { ok: true, deleted: true, note: '软删：可在 ewiki Web 端恢复' };
    }),
    {
      id: 'ewiki.connection_status',
      category: 'API',
      handler: async () => {
        const conn = await getConnection();
        if (!conn?.baseUrl) {
          return toolFail('EWIKI_NOT_CONFIGURED', 'ewiki 未连接。请引导用户打开「ewiki 知识库」面板，填写服务地址，并在 ewiki Web 端「设置 → API 令牌」签发令牌后粘贴保存');
        }
        return { configured: true, baseUrl: conn.baseUrl, patPrefix: `${conn.patPrefix}…`, savedAt: conn.savedAt };
      },
    },
  ];

  // ── REST 面（平台 JWT 保护；与桥通道等价，便于外部诊断） ──
  const routes = new Hono();
  routes.get('/status', (c) => c.json({ ok: true, plugin: ctx.featureId, at: Date.now() }));
  routes.get('/connection', async (c) => {
    const conn = await getConnection();
    return c.json({ configured: Boolean(conn?.baseUrl), baseUrl: conn?.baseUrl ?? null, patPrefix: conn ? `${conn.patPrefix}…` : null });
  });
  routes.post('/connection', async (c) => c.json(await saveConnection(await c.req.json().catch(() => ({})))));
  routes.delete('/connection', async (c) => {
    const conn = await getConnection();
    if (conn?.patRef) await ctx.services.secrets?.delete(OWNER, 'pat').catch(() => {});
    await ctx.storage.delete(CONN_KEY);
    return c.json({ ok: true });
  });
  routes.post('/connection/test', async (c) => c.json(await testConnection()));

  // ── 桥后端：iframe UI 经 plugin.invoke 调用（最小授权 plugin.invoke；UI 不持令牌） ──
  async function bridgeRoute(path, body) {
    switch (path) {
      case '/connection': {
        const conn = await getConnection();
        return { ok: true, configured: Boolean(conn?.baseUrl), baseUrl: conn?.baseUrl ?? null, patPrefix: conn ? `${conn.patPrefix}…` : null };
      }
      case '/connection.save':
        return saveConnection(body);
      case '/connection.delete': {
        const conn = await getConnection();
        if (conn?.patRef) await ctx.services.secrets?.delete(OWNER, 'pat').catch(() => {});
        await ctx.storage.delete(CONN_KEY);
        return { ok: true };
      }
      case '/connection.test':
        return testConnection();
      case '/kb/search': {
        const json = await callOpenApi('GET', '/search', { query: { q: String(body?.q ?? ''), projectId: str(body?.projectId), limit: body?.limit != null ? String(body.limit) : undefined } });
        return { ok: true, ...json };
      }
      case '/kb/projects':
        return { ok: true, ...(await callOpenApi('GET', '/projects')) };
      case '/kb/documents': {
        const projectId = reqStr(body ?? {}, 'projectId', 'kb.documents');
        return { ok: true, ...(await callOpenApi('GET', `/projects/${encodeURIComponent(projectId)}/documents`, { query: { q: str(body?.q) } })) };
      }
      case '/kb/document': {
        const id = reqStr(body ?? {}, 'documentId', 'kb.document');
        return { ok: true, ...(await callOpenApi('GET', `/documents/${encodeURIComponent(id)}`)) };
      }
      default:
        return { ok: false, message: `未知桥路径 ${path ?? ''}` };
    }
  }

  return {
    routes,
    tools,
    bridge: {
      invoke: async ({ path, body }) => {
        try {
          return await bridgeRoute(path, body);
        } catch (err) {
          log('bridge', path, 'failed:', err?.code, err?.message);
          return { ok: false, code: err?.code ?? 'EWIKI_ERROR', message: err?.message ?? String(err) };
        }
      },
    },

    skills: [
      {
        id: 'knowledge-retrieval',
        name: '知识库检索',
        description: '使用 ewiki 知识库回答问题与沉淀文档（依托 ewiki.* 工具）',
        invocationMode: 'auto',
        triggerKeywords: ['知识库', 'ewiki', 'wiki', '检索文档', '归档', '沉淀'],
        content: [
          '# ewiki 知识库使用守则',
          '',
          '用户问到团队知识、内部规范、历史方案时，优先检索 ewiki 知识库，而不是凭空回答：',
          '',
          '1. **检索**：`ewiki.search`（回答知识性问题前必须先调用）；引用结果时给出 `path` 与 `heading`。',
          '2. **深读**：命中后用 `ewiki.read_document` 获取全文再作答。',
          '3. **采集入库**：先 `ewiki.search` 查重，确认无重复后再 `ewiki.create_document`；path 用 POSIX 路径并带 .md 扩展名。',
          '4. **修改文档**：标准序列 `ewiki.read_document` → 修改 → `ewiki.update_document`（携带 latestVersionNo 作为 baseVersionNo）；收到 409 必须重读后重试，禁止盲写覆盖。',
          '5. **删除**：`ewiki.delete_document` 是软删（Web 端可恢复），但执行前必须向用户复述目标文档标题与路径并确认。',
          '6. **未连接时**：调用 `ewiki.connection_status` 检查；未配置则引导用户打开「ewiki 知识库」面板完成连接（服务地址 + ewiki「设置 → API 令牌」签发的令牌）。',
        ].join('\n'),
        tools: ['ewiki.search', 'ewiki.read_document', 'ewiki.list_projects', 'ewiki.list_documents', 'ewiki.create_document', 'ewiki.update_document', 'ewiki.delete_document'],
      },
    ],

    agents: [
      {
        id: 'kb-assistant',
        name: '知识库助理',
        description: '专职 ewiki 知识库场景：答疑检索、采集入库、整理归档、过期内容治理',
        mode: 'subagent',
        prompt: [
          '你是 ewiki 知识库助理。职责：',
          '1. 答疑：先 ewiki.search 检索，必要时 ewiki.read_document 深读，回答必须引用 path/heading 来源。',
          '2. 沉淀：用户要保存内容时，先查重再创建（path 规范：目录/日期-主题.md），创建后汇报所在库与路径。',
          '3. 整理：移动/打标前向用户复述方案；更新文档走乐观并发序列，409 重读重试。',
          '4. 治理：用 ewiki.list_documents + ewiki.get_versions 识别长期未更新文档，给出清单而非直接删除。',
          '未连接 ewiki 时，引导用户到「ewiki 知识库」面板完成配置。',
        ].join('\n'),
      },
    ],

    // ── UI 贡献运行时定义（与 manifest 一致；ui 以入口产出为准） ──
    ui: [
      {
        slot: 'work.main.view',
        viewId: 'ewiki-kb:main',
        title: 'ewiki 知识库',
        icon: 'book',
        renderer: { type: 'iframe-app', entry: 'ui/index.html', requiredBridgeCaps: ['plugin.invoke'] },
      },
      {
        slot: 'work.home.quick',
        viewId: 'ewiki-kb:quick',
        title: '知识库',
        label: '知识库',
        icon: 'book',
        renderer: { type: 'iframe-app', entry: 'ui/index.html', requiredBridgeCaps: ['plugin.invoke'] },
        scenes: ['办公', '编码'],
        action: { type: 'open-panel', viewId: 'ewiki-kb:main' },
        order: 50,
      },
      {
        slot: 'settings.section',
        viewId: 'ewiki-kb:settings',
        title: 'ewiki 知识库',
        icon: 'book',
        renderer: { type: 'iframe-app', entry: 'ui/index.html', requiredBridgeCaps: ['plugin.invoke'] },
      },
    ],
  };
}
