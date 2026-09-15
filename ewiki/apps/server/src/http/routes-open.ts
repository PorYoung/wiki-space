// ---------------------------------------------------------------------------
// 开放面 /api/open/v1（OPEN-API-MCP-DESIGN §7；不在 /api/v1/* JWT 守卫作用域内）
//   架构 = 受控网关投影：PAT 认证 → scope 门 → 团队策略（IP 白名单）→ 限流 →
//   用量记账 → 进程内回环调用内部 /api/v1 同源路由（铸造 15min JWT，不出进程）。
//   回环保证开放写与内部写行为逐字节一致（副作用收敛点/版本快照/索引入队零旁路，
//   ADR-O4 的"收敛点复用"按构造成立）；开放面自身只做鉴权翻译与治理。
//   D1 公开检索（匿名）不走回环：直接消费 SearchService（slug 即授权 / 匿名可读集合）。
// ---------------------------------------------------------------------------

import type { Context } from 'hono';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { HTTPException } from 'hono/http-exception';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHttpFetchClient, createMcpServer, KB_TOOLS } from '@ewiki/mcp';
import { siteDir, siteVersionDir } from '@ewiki/storage';
import { PgSearchService } from '../adapters/pg/search.js';
import { signAccessToken } from '../auth/utils.js';
import { getSearchSettings, resolveEmbeddings } from '../lib/search-settings.js';
import { getOpenSettings } from '../lib/open-settings.js';
import { createPgRateLimiter } from '../lib/rate-limit-pg.js';
import { effectiveTokenPolicyFor, hashApiToken, ipInAllowlist } from '../lib/open-tokens.js';
import { anonymousReadableProjectIds, denyIfNot, projectAccess } from '../lib/permissions.js';
import { getNasRoot } from '../lib/nas.js';
import { aiClassifyRuns, apiIdempotencyKeys, apiTokenUsage, apiTokens, auditLogs, documents, projects, publishSites, users } from '../db/schema.js';
import { buildOpenApiDoc } from '../lib/openapi-doc.js';
import type { AppDeps } from './app.js';

/** 辅助函数的结构化上下文（Hono Context 结构兼容） */
interface OpenCtx {
  req: {
    header(name: string): string | undefined;
    url: string;
    method: string;
    query(name: string): string | undefined;
    param(name: string): string;
    text(): Promise<string>;
  };
  header(name: string, value: string): void;
}

/** MCP 工具 → scope 门（工具定义在 @ewiki/mcp；scope 映射属开放面契约，放本文件） */
const READ_TOOLS = new Set(['kb_read_document', 'kb_list_projects', 'kb_list_documents', 'kb_get_versions', 'kb_suggest_organization']);
const WRITE_TOOLS = new Set(['kb_create_document', 'kb_update_document', 'kb_move_document', 'kb_set_tags', 'kb_delete_document', 'kb_create_project']);

const MCP_INSTRUCTIONS =
  'ewiki 知识库服务：先用 kb_search 检索、kb_read_document 读全文来回答知识问题；' +
  '为用户保存新知识时先查重再 kb_create_document；整理归档用 kb_suggest_organization 获取建议、' +
  '经用户确认后用 kb_move_document / kb_set_tags 执行；删除是软删，执行前必须复述目标文档并取得用户确认。';

type Dim = 'search' | 'read' | 'write';

/** 机器可读错误：message 以 "CODE: 文案" 抛出，app.onError 对 /api/open/* 提取为信封 code */
function fail(status: 400 | 401 | 403 | 404 | 409 | 415 | 429 | 503, code: string, message: string): never {
  throw new HTTPException(status, { message: `${code}: ${message}` });
}

export function registerOpenRoutes(app: Hono, deps: AppDeps): void {
  const { config, db } = deps;
  const limiter = createPgRateLimiter(db);

  // ---- CORS（OPEN-API-MCP-DESIGN §15.5：浏览器 MCP 客户端与自定义域名站点检索）----
  // 开放面为 token/匿名鉴权（无 cookie），Origin 反射 + 通配默认是安全的；可用
  // OPENAPI_CORS_ORIGINS 收紧为白名单（逗号分隔）。
  const corsOrigins = (config.OPENAPI_CORS_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    '/api/open/*',
    cors({
      origin: (origin) => {
        if (corsOrigins.includes('*')) return origin ?? '*';
        return origin && corsOrigins.includes(origin) ? origin : null;
      },
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'Mcp-Session-Id', 'Last-Event-ID', 'Idempotency-Key', 'X-Requested-With'],
      exposeHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Mcp-Session-Id', 'Idempotency-Replayed'],
      maxAge: 86_400,
    }),
  );

  // 与 routes.ts 同参的检索服务实例（D1 专用；keyword 模式，不触 embedding 外呼）
  const searchService = new PgSearchService(
    db,
    async () => {
      const settings = await getSearchSettings(db, process.env);
      return {
        embeddings: resolveEmbeddings(settings),
        vectorEnabled: settings.vectorEnabled,
        semanticMinScore: settings.semanticMinScore,
        embeddingModel: settings.model,
      };
    },
    config.SEARCH_FTS_CONFIG,
  );

  function clientIp(c: OpenCtx): string {
    const fwd = c.req.header('x-forwarded-for');
    if (fwd) return fwd.split(',')[0]!.trim();
    return c.req.header('x-real-ip') ?? 'unknown';
  }

  function setRateLimitHeaders(c: OpenCtx, limit: number, remaining: number, resetMs: number): void {
    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(resetMs / 1000)));
  }

  async function recordUsage(tokenId: string, dim: Dim | null, rejected: boolean): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const inc = {
      searchCount: dim === 'search' ? 1 : 0,
      readCount: dim === 'read' ? 1 : 0,
      writeCount: dim === 'write' ? 1 : 0,
      rejectedCount: rejected ? 1 : 0,
    };
    try {
      await db
        .insert(apiTokenUsage)
        .values({ tokenId, day, ...inc })
        .onConflictDoUpdate({
          target: [apiTokenUsage.tokenId, apiTokenUsage.day],
          set: {
            searchCount: sql`${apiTokenUsage.searchCount} + ${inc.searchCount}`,
            readCount: sql`${apiTokenUsage.readCount} + ${inc.readCount}`,
            writeCount: sql`${apiTokenUsage.writeCount} + ${inc.writeCount}`,
            rejectedCount: sql`${apiTokenUsage.rejectedCount} + ${inc.rejectedCount}`,
            updatedAt: new Date(),
          },
        });
    } catch {
      // 用量记账失败不阻塞业务请求（管理视图容忍小幅低估）
    }
  }

  async function auditOpen(action: string, resourceType: string, resourceId: string | null, ip: string, meta: Record<string, unknown>): Promise<void> {
    try {
      await db.insert(auditLogs).values({ action, resourceType, resourceId, ip, meta });
    } catch {
      // 审计失败不阻塞业务（与用量同策略）
    }
  }

  interface OpenAuth {
    token: typeof apiTokens.$inferSelect;
    user: { id: string; name: string; email: string; globalRole: string };
  }

  /**
   * PAT 认证 + scope 门 + 团队策略 + 限流 + 用量记账。
   * scope=null 仅要求有效令牌（/mcp 握手）：不限流不记维度用量（工具执行才计）。
   */
  async function authenticate(c: OpenCtx, scope: Dim | null): Promise<OpenAuth> {
    const header = c.req.header('Authorization') ?? '';
    if (!header.startsWith('Bearer ')) fail(401, 'UNAUTHENTICATED', '需要 Bearer 令牌（Web 端 设置 → API 令牌 签发）');
    const plaintext = header.slice(7).trim();
    if (!plaintext.startsWith('ewk_')) fail(401, 'TOKEN_INVALID', '令牌无效');
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashApiToken(plaintext))).limit(1);
    if (!row || row.revokedAt) fail(401, 'TOKEN_INVALID', '令牌无效或已吊销');
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) fail(401, 'TOKEN_EXPIRED', '令牌已过期，请重新签发');

    const [user] = await db
      .select({ id: users.id, name: users.name, email: users.email, globalRole: users.globalRole, status: users.status })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    if (!user || user.status === 'disabled') fail(403, 'ACCOUNT_DISABLED', '令牌属主账号不可用');

    // 团队令牌策略（评审决议 3）：IP 白名单在请求侧强制
    const policy = await effectiveTokenPolicyFor(db, user.id);
    const ip = clientIp(c);
    if (policy.ipAllowlist.length > 0 && !ipInAllowlist(ip, policy.ipAllowlist)) {
      await recordUsage(row.id, null, true);
      await auditOpen('token.policy_denied', 'api_token', row.id, ip, { tokenId: row.id, tokenName: row.name });
      fail(403, 'TOKEN_POLICY_IP_DENIED', '来源地址不在团队令牌策略白名单内');
    }

    if (scope) {
      if (!row.scopes.includes(scope)) {
        fail(403, 'INSUFFICIENT_SCOPE', `该操作需要 ${scope} 权限；请重新签发含该 scope 的令牌`);
      }
      const settings = await getOpenSettings(db);
      const quota = { search: settings.searchPerMin, read: settings.readPerMin, write: settings.writePerMin }[scope];
      const rl = await limiter.hit(`t:${scope}:${row.id}`, quota, 60_000);
      setRateLimitHeaders(c, rl.limit, rl.remaining, rl.resetMs);
      if (!rl.allowed) {
        await recordUsage(row.id, null, true);
        fail(429, 'RATE_LIMITED', `请求超过配额（${quota} 次/分），请 ${Math.ceil(rl.resetMs / 1000)} 秒后重试`);
      }
      await recordUsage(row.id, scope, false);
      if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
        await db.update(apiTokens).set({ lastUsedAt: new Date(), lastIp: ip }).where(eq(apiTokens.id, row.id));
      }
    }
    return { token: row, user: { id: user.id, name: user.name, email: user.email, globalRole: user.globalRole } };
  }

  /** 进程内回环：以令牌属主身份调用内部 /api/v1 同源路由（行为单源，ADR-O4/O5） */
  async function loopback(
    auth: OpenAuth,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    internalPath: string,
    opts?: { query?: string; body?: unknown },
  ): Promise<Response> {
    const jwt = await signAccessToken(config.JWT_SECRET, { sub: auth.user.id, globalRole: auth.user.globalRole, name: auth.user.name });
    const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
    let body: string | undefined;
    if (opts?.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['content-type'] = 'application/json';
    }
    // query 兼容两种形态：URL.search（自带前导 ?）与裸 "a=b"；避免拼出 "??" 使参数名带 "?" 被丢弃
    const qs = !opts?.query ? '' : opts.query.startsWith('?') ? opts.query : `?${opts.query}`;
    return await app.request(internalPath + qs, { method, headers, body });
  }

  async function passthrough(res: Response): Promise<Response> {
    const text = await res.text();
    const headers = new Headers();
    const ct = res.headers.get('content-type');
    if (ct) headers.set('content-type', ct);
    return new Response(text, { status: res.status, headers });
  }

  async function readJsonBody(c: OpenCtx): Promise<Record<string, unknown>> {
    const text = await c.req.text();
    if (!text) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      fail(400, 'VALIDATION_FAILED', '请求体需为合法 JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'VALIDATION_FAILED', '请求体需为 JSON 对象');
    return parsed as Record<string, unknown>;
  }

  /**
   * 写接口幂等（评审决议 6）：携带 `Idempotency-Key` 时，2xx 响应快照按 (token, key) 落库；
   * 重放返回原响应（Idempotency-Replayed: true），同键不同 method/path → 409 IDEMPOTENCY_CONFLICT。
   * 仅存 2xx（失败可安全重试）；键冲突插入失败 = 并发双执行（罕见，两响应均有效）。
   */
  async function withIdempotency(c: OpenCtx, auth: OpenAuth, exec: () => Promise<Response>): Promise<Response> {
    const key = (c.req.header('Idempotency-Key') ?? '').trim();
    if (!key) return exec();
    if (key.length > 200) fail(400, 'VALIDATION_FAILED', 'Idempotency-Key 最长 200 字符');
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    const [existing] = await db
      .select()
      .from(apiIdempotencyKeys)
      .where(and(eq(apiIdempotencyKeys.tokenId, auth.token.id), eq(apiIdempotencyKeys.idemKey, key)))
      .limit(1);
    if (existing) {
      if (existing.method !== method || existing.path !== path) {
        fail(409, 'IDEMPOTENCY_CONFLICT', '该幂等键已用于其他请求（method/path 不一致）');
      }
      return new Response(existing.responseBody, {
        status: existing.status,
        headers: { 'content-type': 'application/json', 'idempotency-replayed': 'true' },
      });
    }

    const res = await exec();
    if (res.ok) {
      const text = await res.text();
      try {
        await db.insert(apiIdempotencyKeys).values({ tokenId: auth.token.id, idemKey: key, method, path, status: res.status, responseBody: text });
      } catch {
        // 唯一冲突/写失败不阻断：本次响应正常返回
      }
      // 概率性清理 24h 前的幂等快照（与限流窗口清理同策略）
      if (Math.random() < 0.02) {
        void db
          .execute(sql`DELETE FROM ${apiIdempotencyKeys} WHERE created_at < ${new Date(Date.now() - 24 * 3_600_000)}`)
          .catch(() => {});
      }
      return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } });
    }
    return res;
  }

  // ---- 契约文档（ADR-O1：OpenAPI 3.1 自动产出） ----
  app.get('/api/open/v1/openapi.json', (c) => c.json(buildOpenApiDoc()));

  // =========================================================================
  // D1 公开检索（匿名；ADR-O6：窄开口 + kill switch + IP 限流 + noindex）
  // =========================================================================

  app.get('/api/open/v1/sites/:slug/search', async (c) => {
    const settings = await getOpenSettings(db);
    if (!config.OPENAPI_ENABLED || !settings.publicSearchEnabled) fail(404, 'NOT_FOUND', '资源不存在');
    const rl = await limiter.hit(`ip:${clientIp(c)}`, settings.publicPerIpPerMin, 60_000);
    setRateLimitHeaders(c, rl.limit, rl.remaining, rl.resetMs);
    if (!rl.allowed) fail(429, 'RATE_LIMITED', `请求过于频繁，请 ${Math.ceil(rl.resetMs / 1000)} 秒后重试`);

    const slug = c.req.param('slug');
    const [site] = await db
      .select({ projectId: publishSites.projectId, ownerId: projects.ownerId })
      .from(publishSites)
      .innerJoin(projects, eq(publishSites.projectId, projects.id))
      .where(and(eq(publishSites.slug, slug), isNull(projects.deletedAt)))
      .limit(1);
    if (!site) fail(404, 'NOT_FOUND', '资源不存在');

    const q = (c.req.query('q') ?? '').trim();
    if (!q) return c.json({ items: [], tookMs: 0 });

    // 发布清单 = path 白名单（防未发布内容泄露，R3 缓解态）；旧站点无 manifest 时
    // 退化为活库检索并以 degraded 标注
    const nasRoot = await getNasRoot(config);
    const [ownerRow] = await db.select({ name: users.name }).from(users).where(eq(users.id, site.ownerId)).limit(1);
    const ownerName = ownerRow?.name ?? 'unknown';
    let manifestPaths: Set<string> | null = null;
    let publishedAt: string | null = null;
    try {
      const current = JSON.parse(await fs.readFile(path.join(siteDir(nasRoot, ownerName, slug), 'current.json'), 'utf8')) as {
        version?: number;
        publishedAt?: string;
      };
      publishedAt = current.publishedAt ?? null;
      if (typeof current.version === 'number') {
        const manifest = JSON.parse(
          await fs.readFile(path.join(siteVersionDir(nasRoot, ownerName, slug, current.version), 'manifest.json'), 'utf8'),
        ) as { docs?: Array<{ path?: string }> };
        manifestPaths = new Set((manifest.docs ?? []).map((d) => d.path).filter((p): p is string => typeof p === 'string'));
      }
    } catch {
      manifestPaths = null;
    }

    const started = Date.now();
    const res = await searchService.search({ q, mode: 'keyword', projectIds: [site.projectId], limit: 20 });
    const items = (manifestPaths ? res.items.filter((it) => manifestPaths.has(it.path)) : res.items).map((it) => ({
      path: it.path,
      title: it.title,
      snippet: it.snippet,
      heading: it.heading ?? null,
      score: it.score,
    }));
    c.header('X-Robots-Tag', 'noindex');
    return c.json({
      items,
      hasMore: res.hasMore,
      publishedAt,
      ...(manifestPaths === null ? { degraded: 'manifest-missing' as const } : res.degraded ? { degraded: res.degraded } : {}),
      tookMs: Date.now() - started,
    });
  });

  app.get('/api/open/v1/public/search', async (c) => {
    const settings = await getOpenSettings(db);
    if (!config.OPENAPI_ENABLED || !settings.publicSearchEnabled) fail(404, 'NOT_FOUND', '资源不存在');
    const rl = await limiter.hit(`ip:${clientIp(c)}`, settings.publicPerIpPerMin, 60_000);
    setRateLimitHeaders(c, rl.limit, rl.remaining, rl.resetMs);
    if (!rl.allowed) fail(429, 'RATE_LIMITED', `请求过于频繁，请 ${Math.ceil(rl.resetMs / 1000)} 秒后重试`);

    const q = (c.req.query('q') ?? '').trim();
    if (!q) return c.json({ items: [], tookMs: 0 });
    const readable = await anonymousReadableProjectIds();
    if (readable.length === 0) return c.json({ items: [], tookMs: 0 });
    const started = Date.now();
    const res = await searchService.search({ q, mode: 'keyword', projectIds: readable, limit: 20 });
    c.header('X-Robots-Tag', 'noindex');
    return c.json({
      items: res.items.map((it) => ({
        projectId: it.projectId,
        path: it.path,
        title: it.title,
        snippet: it.snippet,
        heading: it.heading ?? null,
        score: it.score,
      })),
      hasMore: res.hasMore,
      tookMs: Date.now() - started,
    });
  });

  // =========================================================================
  // D2 个人检索（scope: search / read；回环内部同源路由）
  // =========================================================================

  app.get('/api/open/v1/search', async (c) => {
    const auth = await authenticate(c, 'search');
    return passthrough(await loopback(auth, 'GET', '/api/v1/search', { query: new URL(c.req.url).search }));
  });

  app.get('/api/open/v1/projects', async (c) => {
    const auth = await authenticate(c, 'read');
    return passthrough(await loopback(auth, 'GET', '/api/v1/projects'));
  });

  app.get('/api/open/v1/projects/:id/documents', async (c) => {
    const auth = await authenticate(c, 'read');
    return passthrough(await loopback(auth, 'GET', `/api/v1/projects/${c.req.param('id')}/documents`, { query: new URL(c.req.url).search }));
  });

  app.get('/api/open/v1/documents/:id', async (c) => {
    const auth = await authenticate(c, 'read');
    return passthrough(await loopback(auth, 'GET', `/api/v1/documents/${c.req.param('id')}`));
  });

  app.get('/api/open/v1/documents/:id/versions', async (c) => {
    const auth = await authenticate(c, 'read');
    return passthrough(await loopback(auth, 'GET', `/api/v1/documents/${c.req.param('id')}/versions`));
  });

  // AI 整理建议（评审决议 4：只读开放；执行仍需显式 move/set_tags）——直接查询不走回环
  app.get('/api/open/v1/projects/:id/ai-suggestions', async (c: Context) => {
    const auth = await authenticate(c, 'read');
    const projectId = c.req.param('id')!;
    const access = await projectAccess(projectId, auth.user.id, auth.user.globalRole);
    denyIfNot(access.canRead, 'FORBIDDEN');

    const runs = await db
      .select({ stats: aiClassifyRuns.stats, createdAt: aiClassifyRuns.createdAt })
      .from(aiClassifyRuns)
      .where(and(eq(aiClassifyRuns.projectId, projectId), eq(aiClassifyRuns.status, 'done')))
      .orderBy(desc(aiClassifyRuns.createdAt))
      .limit(100);
    // 每文档取最新一条建议（runs 按时间倒序，首个即最新）
    const perDoc = new Map<string, { folder: string | null; tags: string[]; at: Date }>();
    for (const r of runs) {
      const s = r.stats as { action?: string; documentId?: string; suggestion?: { folder?: string; tags?: string[] } } | null;
      if (s?.action !== 'classify' || !s.documentId || perDoc.has(s.documentId)) continue;
      perDoc.set(s.documentId, { folder: s.suggestion?.folder ?? null, tags: s.suggestion?.tags ?? [], at: r.createdAt });
    }
    const ids = [...perDoc.keys()];
    const docRows = ids.length
      ? await db
          .select({ id: documents.id, path: documents.path, title: documents.title })
          .from(documents)
          .where(and(inArray(documents.id, ids), isNull(documents.deletedAt)))
      : [];
    const items = docRows.map((d) => ({ documentId: d.id, path: d.path, title: d.title, suggestion: perDoc.get(d.id) }));
    return c.json({ items, total: items.length });
  });

  // =========================================================================
  // D3 个人管理（scope: write；回环 → 副作用收敛点原样生效；写审计）
  // =========================================================================

  app.post('/api/open/v1/projects', async (c: Context) => {
    const auth = await authenticate(c, 'write');
    const body = await readJsonBody(c);
    return withIdempotency(c, auth, async () => {
      const res = await loopback(auth, 'POST', '/api/v1/projects', { body });
      if (res.ok) {
        await auditOpen('open.write.project', 'project', null, clientIp(c), {
          tokenId: auth.token.id,
          tokenName: auth.token.name,
          route: 'POST /api/open/v1/projects',
        });
      }
      return res;
    });
  });

  app.post('/api/open/v1/projects/:id/documents', async (c: Context) => {
    const auth = await authenticate(c, 'write');
    const body = await readJsonBody(c);
    return withIdempotency(c, auth, async () => {
      const res = await loopback(auth, 'POST', `/api/v1/projects/${c.req.param('id')}/documents`, { body });
      if (res.ok) {
        await auditOpen('open.write.document', 'document', null, clientIp(c), {
          tokenId: auth.token.id,
          tokenName: auth.token.name,
          route: 'POST /api/open/v1/projects/:id/documents',
          path: body.path ?? null,
        });
      }
      return res;
    });
  });

  app.put('/api/open/v1/documents/:id', async (c: Context) => {
    const auth = await authenticate(c, 'write');
    const id = c.req.param('id')!;
    const body = await readJsonBody(c);
    return withIdempotency(c, auth, async () => {
      const res = await loopback(auth, 'PUT', `/api/v1/documents/${id}`, { body });
      if (res.ok) {
        await auditOpen('open.write.document', 'document', id, clientIp(c), {
          tokenId: auth.token.id,
          tokenName: auth.token.name,
          route: 'PUT /api/open/v1/documents/:id',
        });
      }
      return res;
    });
  });

  // 标签单独端点（AI 整理高频动作）：映射为内部 PUT 的 tags-only 保存
  app.put('/api/open/v1/documents/:id/tags', async (c: Context) => {
    const auth = await authenticate(c, 'write');
    const id = c.req.param('id')!;
    const body = await readJsonBody(c);
    // 拒绝缺失 tags：避免落空更新（内部 PUT 对无字段保存仍会产生版本快照）
    if (!Array.isArray(body.tags)) fail(400, 'VALIDATION_FAILED', 'tags 需为字符串数组');
    return withIdempotency(c, auth, async () => {
      const res = await loopback(auth, 'PUT', `/api/v1/documents/${id}`, { body: { tags: body.tags } });
      if (res.ok) {
        await auditOpen('open.write.document', 'document', id, clientIp(c), {
          tokenId: auth.token.id,
          tokenName: auth.token.name,
          route: 'PUT /api/open/v1/documents/:id/tags',
        });
      }
      return res;
    });
  });

  app.patch('/api/open/v1/documents/:id', async (c: Context) => {
    const auth = await authenticate(c, 'write');
    const id = c.req.param('id')!;
    const body = await readJsonBody(c);
    return withIdempotency(c, auth, async () => {
      const res = await loopback(auth, 'PATCH', `/api/v1/documents/${id}`, { body });
      if (res.ok) {
        await auditOpen('open.write.document', 'document', id, clientIp(c), {
          tokenId: auth.token.id,
          tokenName: auth.token.name,
          route: 'PATCH /api/open/v1/documents/:id',
        });
      }
      return res;
    });
  });

  app.delete('/api/open/v1/documents/:id', async (c: Context) => {
    const auth = await authenticate(c, 'write');
    const id = c.req.param('id')!;
    return withIdempotency(c, auth, async () => {
      const res = await loopback(auth, 'DELETE', `/api/v1/documents/${id}`);
      if (res.ok) {
        await auditOpen('open.write.document', 'document', id, clientIp(c), {
          tokenId: auth.token.id,
          tokenName: auth.token.name,
          route: 'DELETE /api/open/v1/documents/:id',
        });
      }
      return res;
    });
  });

  // =========================================================================
  // MCP 托管端点（Streamable HTTP；OPEN-API-MCP-DESIGN §15.5 完整传输面）：
  //   POST JSON-RPC：按 Accept 协商 —— 含 text/event-stream 时以 SSE 单消息流回包
  //   （兼容官方 SDK 客户端），否则 application/json；notification → 202。
  //   GET：服务端→客户端通知流（无状态部署无消息可推，SSE 注释心跳保活）。
  //   会话：无状态不签发 Mcp-Session-Id；客户端带来的会话/版本头被容忍（不校验）。
  // =========================================================================

  app.post('/api/open/v1/mcp', async (c: Context) => {
    const auth = await authenticate(c, null);
    const scopes = auth.token.scopes;
    const allowed = KB_TOOLS.filter((t) =>
      t.name === 'kb_search'
        ? scopes.includes('search')
        : READ_TOOLS.has(t.name)
          ? scopes.includes('read')
          : WRITE_TOOLS.has(t.name)
            ? scopes.includes('write')
            : false,
    );
    // 工具执行回环本机开放面：鉴权/scope/限流/用量对 MCP 与 REST 客户端完全同源（ADR-O5）
    const client = createHttpFetchClient({
      baseUrl: `http://127.0.0.1:${config.PORT_SERVER}`,
      token: (c.req.header('Authorization') ?? '').slice(7),
    });
    const server = createMcpServer({ client, tools: allowed, instructions: MCP_INSTRUCTIONS });

    let message: unknown;
    try {
      message = JSON.parse(await c.req.text());
    } catch {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } }, 400);
    }
    const result = await server.handle(message);
    if (!result) return c.body(null, 202); // notification：无响应体
    if ((c.req.header('Accept') ?? '').includes('text/event-stream')) {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: 'message', data: JSON.stringify(result) });
      });
    }
    return c.json(result);
  });

  app.get('/api/open/v1/mcp', async (c: Context) => {
    await authenticate(c, null);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          let closed = false;
          const cleanup = (): void => {
            if (closed) return;
            closed = true;
            clearInterval(timer);
            try {
              controller.close();
            } catch {
              /* 已关闭 */
            }
          };
          const push = (chunk: string): void => {
            if (closed) return;
            try {
              controller.enqueue(enc.encode(chunk));
            } catch {
              cleanup();
            }
          };
          const timer = setInterval(() => push(':keep-alive\n\n'), 25_000);
          c.req.raw.signal.addEventListener('abort', cleanup);
          push(':connected\n\n');
        },
      }),
      { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } },
    );
  });
  app.delete('/api/open/v1/mcp', (c) => c.json({}));
}
