import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import {
  basenameOf,
  CreateProjectSchema,
  extOf,
  resolveFileType,
  UpdateProjectSchema,
} from '@ewiki/shared';
import { renderDocPage } from '@ewiki/render';
import type { AppDeps } from './app.js';
import {
  generateRefreshToken,
  hashPassword,
  hashToken,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from '../auth/utils.js';
import { and, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  activities,
  aiClassifyRuns,
  auditLogs,
  documentLinks,
  documentVersions,
  documents,
  exportJobs,
  importJobs,
  notifications,
  projectMembers,
  projects,
  publishJobs,
  publishSites,
  refreshTokens,
  storageConnections,
  syncJobs,
  userPrefs,
  users,
} from '../db/schema.js';
import {
  commitAndPush,
  ensureRepo,
  ensureWorkdir,
  findRepo,
  GitHostError,
  seedWorkdirFiles,
  validateConnection,
  type ConnLike,
  type HostRepo,
} from '@ewiki/git';
import { getLibraryTemplate } from '../lib/library-templates.js';
import { buildAddedSummary, buildChangedSummary } from '../lib/diff-summary.js';
import { getNasRoot, getReposRoot, mirrorDoc } from '../lib/nas.js';
import { safeJoin } from '@ewiki/storage';
import { registerStarterRoutes } from './routes-starter.js';
import { docStorageEffects, docStorageEffectsBatch, registerPlatformRoutes, type DocEffectResult } from './routes-platform.js';
import { registerFileRoutes } from './routes-files.js';
import { buildRawUrl } from '../lib/raw-sign.js';
import { denyIfNot, projectAccess } from '../lib/permissions.js';

// ---- 发布模板元数据（PLAN 3.5 / 5.2.1：服务端权威源，ThemesPage / PublishPage 从此拉取） ----
// 与原型 Themes.jsx TEMPLATE_META / mock data.js:853-897 对齐
const PUBLISH_TEMPLATES = [
  {
    id: 't-docs',
    name: '标准文档 Docs',
    zhLabel: '文档站',
    desc: '左侧导航 + 右侧内容，技术文档的经典形态。',
    layout: 'sidebar-wide',
    accent: '#0ea5e9',
    target: '文档',
    emoji: '📚',
    stars: 1284,
  },
  {
    id: 't-blog',
    name: '博客 Blog',
    zhLabel: '博客',
    desc: '杂志风卡片 + 精选推荐位，适合发布产品故事。',
    layout: 'sidebar',
    accent: '#f43f5e',
    target: '博客',
    emoji: '✍️',
    stars: 932,
  },
  {
    id: 't-product',
    name: '产品官网 Product Site',
    zhLabel: '产品首页',
    desc: 'Hero + 特性三栏 + 定价 CTA，营销导向的单页模板。',
    layout: 'hero',
    accent: '#14b8a6',
    target: '官网',
    emoji: '🌐',
    stars: 756,
  },
  {
    id: 't-wiki',
    name: '团队 Wiki',
    zhLabel: '知识库',
    desc: '树形目录 + 知识图谱视图，沉淀组织的第二大脑。',
    layout: 'grid',
    accent: '#8b5cf6',
    target: '知识库',
    emoji: '🧠',
    stars: 1120,
  },
  {
    id: 't-api',
    name: 'API 参考 API Ref',
    zhLabel: 'API 参考',
    desc: '端点分组 + Try-it 面板，代码优先的 API 文档模板。',
    layout: 'split',
    accent: '#f59e0b',
    target: 'API',
    emoji: '🔗',
    stars: 640,
  },
] as const;

// ---- B5: documents count 短 TTL 缓存 ----
// 列表接口每次都跑 count(*)，万行级表上 PG 也慢。30s TTL 让用户看到近似准确计数，
// 编辑/创建/删除时主动清空缓存（下一次列表请求重新 COUNT），避免数据不一致窗口过长。
const docCountCache = new Map<string, { count: number; expireAt: number }>();
const DOC_COUNT_CACHE_TTL = 30_000;

function getCachedCount(key: string, compute: () => Promise<number>): Promise<number> {
  const cached = docCountCache.get(key);
  if (cached && cached.expireAt > Date.now()) return Promise.resolve(cached.count);
  return compute().then((count) => {
    docCountCache.set(key, { count, expireAt: Date.now() + DOC_COUNT_CACHE_TTL });
    return count;
  });
}

/** 文档写操作（insert / update / delete）后调用，清空所有 count 缓存 */
function invalidateDocCountCache(): void {
  docCountCache.clear();
}

/**
 * 文档内容摘要（PLAN 3.4 残留：DocumentCard 内容摘要）。
 * 列表接口不下发全文，读取时从 content 派生 ~140 字符纯文本摘要：
 * 剥代码块/图片/链接语法/标题井号/行内强调符，压平为单行后截断。
 */
function documentSummary(content: string | null): string {
  if (!content) return '';
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').replace(/[`*_>-]/g, '').trim())
    .filter(Boolean)
    .join(' ');
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

/**
 * 目录树路径规范化（移动/重命名/新建复用）：统一斜杠、拒绝危险段与 NAS/Windows 非法字符。
 * 返回 null 表示路径不合法。
 * - allowDotFile=true 时点开头文件（.keep/.gitignore）豁免尾随点与 basename 扩展名校验；
 * - requireBasename=true 时末段必须含扩展名（用于文件路径；文件夹路径不传）。
 */
function normalizeTreePath(
  raw: unknown,
  opts: { requireBasename?: boolean; allowDotFile?: boolean } = {},
): string | null {
  if (typeof raw !== 'string') return null;
  const p = raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!p || p.length > 512) return null;
  const segments = p.split('/');
  if (segments.length > 24) return null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const isLast = i === segments.length - 1;
    const dotFile = isLast && seg.startsWith('.');
    if (!seg || seg === '..') return null;
    if (seg.length > 128) return null;
    // NAS 落盘在本地文件系统执行，直接拒绝跨平台非法字符
    if (/[<>:"|?*\u0000-\u001f]/.test(seg)) return null;
    if (!(opts.allowDotFile && dotFile)) {
      // 尾随点/空格在 Windows 落盘会被静默裁剪；'.' 单独成段也无意义
      if (/[ .]$/.test(seg) || seg === '.') return null;
    }
    // 文件路径末段必须带扩展名（P0 不允许创建无扩展名文件，.keep 等点文件豁免）
    if (isLast && opts.requireBasename && !dotFile && !extOf(seg)) return null;
  }
  return p;
}

/** 无显式标题时的兜底显示名：markdown 抽 H1，其余文件取不含扩展名的 basename */
function defaultDocTitle(path: string, content: string): string {
  if (resolveFileType(path).typeId === 'markdown') {
    const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (h1) return h1;
  }
  const base = basenameOf(path);
  const dot = base.startsWith('.') ? -1 : base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** UTF-8 字节数（与 PG octet_length 对齐，用于 text 文件 size 回填） */
function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** 路由注册（SDD 4.2 清单的骨架实现；未列出的端点随层 4 迭代补充） */
export function registerRoutes(app: Hono, deps: AppDeps): void {
  const { config, db, boss } = deps;

  // ---- 健康（SYS） ----
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/readyz', async (c) => {
    await db.execute('select 1');
    return c.json({ ok: true, db: true });
  });

  // ---- 认证（A1–A3） ----
  const auth = new Hono();
  auth.post('/login', async (c) => {
    const body = (await c.req.json()) as { email?: string; password?: string };
    if (!body.email || !body.password) throw new HTTPException(400, { message: 'VALIDATION_FAILED' });

    // 邮箱归一化与注册一致（register 为 trim().toLowerCase()），否则大小写/首尾空格差异导致查无此人
    const email = body.email.trim().toLowerCase();
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      throw new HTTPException(401, { message: 'UNAUTHENTICATED: 邮箱或密码不正确' });
    }
    if (user.status === 'disabled') {
      throw new HTTPException(403, { message: 'ACCOUNT_DISABLED: 账号已被禁用，请联系管理员' });
    }

    const accessToken = await signAccessToken(config.JWT_SECRET, {
      sub: user.id,
      globalRole: user.globalRole,
      name: user.name,
    });
    const refreshToken = generateRefreshToken();
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + config.REFRESH_TTL_DAYS * 86_400_000),
    });

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await db.insert(auditLogs).values({
      actorId: user.id,
      action: 'user.login',
      resourceType: 'user',
      resourceId: user.id,
      meta: { email: user.email },
    });

    return c.json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, globalRole: user.globalRole },
    });
  });

  auth.post('/refresh', async (c) => {
    const body = (await c.req.json()) as { refreshToken?: string };
    if (!body.refreshToken) throw new HTTPException(400, { message: 'VALIDATION_FAILED' });
    const hash = hashToken(body.refreshToken);
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt)))
      .limit(1);
    if (!row || row.expiresAt < new Date()) throw new HTTPException(401, { message: 'TOKEN_EXPIRED' });

    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user) throw new HTTPException(401, { message: 'UNAUTHENTICATED' });

    const accessToken = await signAccessToken(config.JWT_SECRET, {
      sub: user.id,
      globalRole: user.globalRole,
      name: user.name,
    });
    const newRefresh = generateRefreshToken();
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(newRefresh),
      expiresAt: new Date(Date.now() + config.REFRESH_TTL_DAYS * 86_400_000),
    });
    return c.json({ accessToken, refreshToken: newRefresh });
  });

  auth.post('/logout', async (c) => {
    const body = (await c.req.json()) as { refreshToken?: string };
    if (body.refreshToken) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, hashToken(body.refreshToken)));
    }
    return c.json({ ok: true });
  });

  app.route('/api/v1/auth', auth);

  // ---- Bearer 认证守卫（auth/open 之外全部生效） ----
  app.use('/api/v1/*', async (c, next) => {
    const path = c.req.path;
    if (path.startsWith('/api/v1/auth') || path.startsWith('/api/v1/open/')) return next();

    const header = c.req.header('Authorization') ?? '';
    if (!header.startsWith('Bearer ')) throw new HTTPException(401, { message: 'UNAUTHENTICATED' });
    try {
      const payload = await verifyAccessToken(config.JWT_SECRET, header.slice(7));
      c.set('userId', payload.sub);
      c.set('globalRole', payload.globalRole);
    } catch {
      throw new HTTPException(401, { message: 'TOKEN_EXPIRED' });
    }
    // 禁用账号即时生效（禁用后已签发的访问令牌也被拦截）
    const [meStatus] = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, c.get('userId') as string))
      .limit(1);
    if (meStatus && meStatus.status === 'disabled') {
      throw new HTTPException(403, { message: 'ACCOUNT_DISABLED' });
    }
    await next();
  });

  // ---- 项目（P1–P4） ----
  const projectsRoute = new Hono();
  projectsRoute.get('/', async (c) => {
    // 可见性过滤：private 仅成员/管理员可见；team/public 任何已登录用户可见
    // （与 GET /:id 的 projectAccess、文档列表的 scoped 过滤保持同一规则）
    const uid = c.get('userId') as string;
    const isAdmin = c.get('globalRole') === 'admin';
    const rows = await db
      .select()
      .from(projects)
      .where(
        isAdmin
          ? isNull(projects.deletedAt)
          : and(
              isNull(projects.deletedAt),
              sql`${projects.visibility} <> 'private' or exists (select 1 from project_members pm where pm.project_id = ${projects.id} and pm.user_id = ${uid})`,
            ),
      )
      .orderBy(desc(projects.updatedAt))
      .limit(100);
    return c.json({ items: rows, page: 1, pageSize: 100, total: rows.length });
  });

  projectsRoute.post('/', async (c) => {
    const userId = c.get('userId') as string;
    const raw = await c.req.json().catch(() => null);
    const parsed = CreateProjectSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          code: 'VALIDATION_FAILED',
          message: 'VALIDATION_FAILED',
          fields: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const body = parsed.data;

    // 模板解析：富模板（带正文）优先；starter-pack 骨架 id 回退为占位文档；空/未知不预置
    const tplId = body.template && body.template !== 'empty' ? body.template : null;
    const richTpl = tplId ? getLibraryTemplate(tplId) : null;
    let tplDocs: Array<{ path: string; content: string }> = [];
    let tplDescription: string | null = null;
    if (richTpl) {
      tplDocs = richTpl.docs;
      tplDescription = richTpl.description;
    } else if (tplId) {
      const { STARTER_PACKS } = await import('./routes-starter.js');
      const pack = STARTER_PACKS.find((p) => p.id === tplId);
      if (pack) {
        tplDocs = pack.tree.map((p) => ({
          path: p,
          content: `# ${p.replace(/\.md$/, '').split('/').pop()}\n\n> 模板「${pack.name}」占位文档，请补充正文。\n`,
        }));
        tplDescription = pack.description;
      }
    }

    const storage = body.storage ?? { kind: 'local' as const };
    const [owner] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!owner) throw new HTTPException(401, { message: 'UNAUTHENTICATED' });

    // ---- Git 后端：全部校验前置，任一失败 MUST NOT 创建项目行 ----
    let gitProvision:
      | {
          conn: ConnLike;
          connectionId: string;
          repo: HostRepo;
          created: boolean;
          login: string;
          branch: string;
        }
      | null = null;
    if (storage.kind === 'git') {
      const [connRow] = await db
        .select()
        .from(storageConnections)
        .where(eq(storageConnections.id, storage.connectionId))
        .limit(1);
      // 不存在或不属于当前用户统一 403（不暴露连接存在性）
      if (!connRow || connRow.ownerId !== userId) {
        throw new HTTPException(403, { message: 'FORBIDDEN: 存储源不存在或不属于当前用户' });
      }
      const conn: ConnLike = {
        kind: connRow.kind,
        baseUrl: connRow.baseUrl,
        tokenEncrypted: connRow.tokenEncrypted,
        defaultNamespace: connRow.defaultNamespace,
      };
      const checked = await validateConnection(conn);
      if (!checked.ok || !checked.login) {
        throw new HTTPException(400, { message: `CONNECTION_INVALID: ${checked.message ?? '连接校验失败'}` });
      }
      try {
        if (storage.autoInit === false) {
          const found = await findRepo(conn, storage.repoName, checked.login);
          if (!found.found || !found.repo) {
            throw new HTTPException(400, { message: 'REPO_NOT_FOUND: 仓库不存在，且未启用自动初始化' });
          }
          gitProvision = {
            conn,
            connectionId: connRow.id,
            repo: found.repo,
            created: false,
            login: checked.login,
            branch: storage.defaultBranch || found.repo.defaultBranch || 'main',
          };
        } else {
          const ensured = await ensureRepo(conn, storage.repoName, checked.login, { private: true });
          gitProvision = {
            conn,
            connectionId: connRow.id,
            repo: ensured.repo,
            created: ensured.created,
            login: checked.login,
            branch: storage.defaultBranch || ensured.repo.defaultBranch || 'main',
          };
        }
      } catch (e) {
        if (e instanceof HTTPException) throw e;
        if (e instanceof GitHostError) {
          throw new HTTPException(e.status === 401 || e.status === 403 ? 400 : e.status === 409 ? 409 : 400, {
            message: `${e.code}: ${e.message}`,
          });
        }
        throw new HTTPException(400, { message: e instanceof Error ? e.message : String(e) });
      }
    }

    // ---- 校验通过，创建项目行（9 个存储列一次性写入） ----
    const [project] = await db
      .insert(projects)
      .values({
        name: body.name,
        description: body.description ?? tplDescription ?? null,
        color: body.color ?? null,
        visibility: body.visibility ?? 'private',
        template: tplId,
        ownerId: userId,
        storageKind: gitProvision ? 'git' : 'local',
        storageConnectionId: gitProvision ? gitProvision.connectionId : null,
        storageConfig: gitProvision
          ? {
              url: gitProvision.repo.cloneUrl,
              host: gitProvision.conn.baseUrl,
              kind: gitProvision.conn.kind,
              namespace: gitProvision.login,
              repoName: storage.kind === 'git' ? storage.repoName : null,
              autoCommit: true,
            }
          : storage.kind === 'local' && storage.path
            ? { path: storage.path }
            : {},
        defaultBranch: gitProvision ? gitProvision.branch : null,
        storageStatus: 'connected',
      })
      .returning();

    await db.insert(projectMembers).values({ projectId: project.id, userId, role: 'owner' });

    // 模板文档：平台侧预置（documents + NAS 镜像）；记录落库行，供初始化推送后生成 v1 版本快照
    const docsCount = tplDocs.length;
    const insertedDocs: Array<{ id: string; content: string }> = [];
    for (const doc of tplDocs) {
      const [row] = await db
        .insert(documents)
        .values({
          projectId: project.id,
          path: doc.path,
          title: doc.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? doc.path.replace(/\.md$/, ''),
          content: doc.content,
          kind: 'text',
          ext: 'md',
          mime: 'text/markdown',
          size: byteLength(doc.content),
          contentHash: createHash('sha256').update(doc.content).digest('hex'),
          status: 'untracked',
          wordCount: [...doc.content.matchAll(/[\p{L}\p{N}]/gu)].length,
          updatedBy: userId,
        })
        .returning({ id: documents.id });
      if (row) insertedDocs.push({ id: row.id, content: doc.content });
    }
    try {
      const nasRoot = await getNasRoot(config);
      await mirrorDoc(nasRoot, { username: owner.name, projectName: project.name, projectId: project.id }, '__占位__.md', null).catch(
        () => undefined,
      );
      for (const doc of tplDocs) {
        await mirrorDoc(nasRoot, { username: owner.name, projectName: project.name, projectId: project.id }, doc.path, doc.content);
      }
    } catch {
      // NAS 不可写不阻断建库；系统管理页可查存储告警
    }
    await db.insert(activities).values({
      projectId: project.id,
      actorId: userId,
      verb: 'create',
      targetType: 'project',
      targetId: project.id,
      targetTitle: project.name,
      meta: { storageKind: project.storageKind },
    });
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'project.create',
      resourceType: 'project',
      resourceId: project.id,
      meta: { storageKind: project.storageKind, template: tplId },
    });

    // ---- Git 后端：克隆工作副本；空库首次提交（模板或 README），已有内容库不覆盖远端 ----
    let git: { repo: string; created: boolean; committed: boolean; commitHash?: string; message?: string } | undefined;
    if (gitProvision) {
      try {
        const { workdir, hadCommits } = await ensureWorkdir(
          getReposRoot(config),
          project.id,
          gitProvision.conn,
          gitProvision.repo.cloneUrl,
          gitProvision.login,
          gitProvision.branch,
        );
        if (!hadCommits) {
          const seedFiles =
            tplDocs.length > 0
              ? tplDocs
              : [{ path: 'README.md', content: `# ${project.name}\n\n由 eWiki 平台创建。\n` }];
          const initMessage = `chore: 初始化文档库（${tplDocs.length} 篇模板文档）`;
          await seedWorkdirFiles(workdir, seedFiles);
          const pushed = await commitAndPush(
            workdir,
            [],
            { name: owner.name, email: owner.email },
            initMessage,
          );
          git = {
            repo: gitProvision.repo.fullPath,
            created: gitProvision.created,
            committed: pushed.ok && pushed.pushed,
            commitHash: pushed.commitHash,
            message: pushed.ok ? undefined : pushed.error,
          };
          if (pushed.ok) {
            await db
              .update(projects)
              .set({ storageStatus: 'synced', lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
              .where(eq(projects.id, project.id));
            await db.insert(syncJobs).values({
              projectId: project.id,
              trigger: 'push',
              commitHash: pushed.commitHash ?? null,
              status: 'succeeded',
              stats: { pushed: pushed.pushed, init: true, docs: seedFiles.length },
              finishedAt: new Date(),
            });
            // 版本时间线留痕（PRD F46）：初始化提交 = 每篇模板文档的 v1 快照，commit hash 与 Gitea 一致
            const initCommitHash = pushed.commitHash;
            if (pushed.pushed && initCommitHash && insertedDocs.length > 0) {
              await db.insert(documentVersions).values(
                insertedDocs.map((doc) => ({
                  documentId: doc.id,
                  versionNo: 1,
                  commitHash: initCommitHash,
                  authorId: userId,
                  message: initMessage,
                  content: doc.content,
                  size: byteLength(doc.content),
                  changedSummary: buildAddedSummary(doc.content),
                })),
              );
              // 文档状态机闭环：模板文档已随初始化提交进入远端，置为 synced（此前停留在 untracked）
              await db
                .update(documents)
                .set({ status: 'synced', updatedAt: new Date() })
                .where(
                  and(
                    inArray(
                      documents.id,
                      insertedDocs.map((d) => d.id),
                    ),
                    isNull(documents.deletedAt),
                  ),
                );
            }
            // 动态流留痕（PRD F49「同步」维度）：初始化推送在项目动态中可见
            await db.insert(activities).values({
              projectId: project.id,
              actorId: userId,
              verb: 'sync',
              targetType: 'project',
              targetId: project.id,
              targetTitle: project.name,
              meta: {
                trigger: 'push',
                backend: 'git',
                init: true,
                docs: seedFiles.length,
                commitHash: initCommitHash ?? null,
                branch: gitProvision.branch,
              },
            });
          } else {
            await db
              .update(projects)
              .set({ storageStatus: 'error', lastError: pushed.error?.slice(0, 500) ?? 'push failed' })
              .where(eq(projects.id, project.id));
            await db.insert(syncJobs).values({
              projectId: project.id,
              trigger: 'push',
              commitHash: pushed.commitHash ?? null,
              status: 'failed',
              error: pushed.error?.slice(0, 500) ?? null,
              finishedAt: new Date(),
            });
          }
        } else {
          git = { repo: gitProvision.repo.fullPath, created: gitProvision.created, committed: false, message: '仓库已有内容，平台侧预置模板不覆盖远端' };
        }
      } catch (e) {
        // 连接/仓库校验已全部前置；此处仅克隆/推送失败：项目保留并标记 error，用户可稍后手动同步
        const msg = e instanceof Error ? e.message : String(e);
        await db
          .update(projects)
          .set({ storageStatus: 'error', lastError: msg.slice(0, 500), updatedAt: new Date() })
          .where(eq(projects.id, project.id));
        await db.insert(auditLogs).values({
          actorId: userId,
          action: 'git.provision_failed',
          resourceType: 'project',
          resourceId: project.id,
          meta: { error: msg.slice(0, 300) },
        });
        git = { repo: gitProvision.repo.fullPath, created: gitProvision.created, committed: false, message: msg.slice(0, 200) };
      }
    }

    return c.json({ project, docs: docsCount, git }, 201);
  });

  // ---- 手动同步：POST /api/v1/projects/:id/sync（仅 Git 后端） ----
  // 必须在 app.route() 挂载之前注册在 projectsRoute 上（Hono 只合并挂载时刻已有的路由）
  projectsRoute.post('/:id/sync', async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    const [project] = await db
      .select({
        id: projects.id,
        storageKind: projects.storageKind,
        storageConnectionId: projects.storageConnectionId,
      })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');
    }
    if (project.storageKind !== 'git' || !project.storageConnectionId) {
      throw new HTTPException(400, { message: 'LOCAL_BACKEND_NO_SYNC: 本地存储后端无需同步' });
    }

    // 去重判定不能依赖 projects.storage_status：worker 提交与本请求读状态存在竞态，
    // 上一作业可能正处于瞬态 syncing。pg-boss 对 singletonMinutes 的节流机制是：
    // pgboss.job 上存在部分唯一索引 (name, singleton_on, singleton_key)
    //   WHERE state <> 'cancelled' AND singleton_on IS NOT NULL，
    // singleton_on 为按分钟对齐的 epoch 时间桶，重复 send 会被 ON CONFLICT DO NOTHING 静默丢弃。
    // 因此这里按同一时间桶复算其去重条件（completed 作业默认滞留 12 小时才归档，无需查 archive）。
    const singletonKey = `sync:${projectId}:manual`;
    const throttleRows = await db.execute<{ throttle_hit: number }>(sql`
      select exists (
        select 1
        from pgboss.job
        where name = 'sync'
          and singleton_key = ${singletonKey}
          and state <> 'cancelled'
          and singleton_on is not null
          and singleton_on = 'epoch'::timestamp
            + interval '1 second' * (60 * floor(extract(epoch from now()) / 60))
      )::int as throttle_hit
    `);
    const deduped = (throttleRows[0]?.throttle_hit ?? 0) === 1;
    await boss.send('sync', { projectId, trigger: 'manual' }, { singletonKey, singletonMinutes: 1 });
    // 仅在作业真正入队时才翻转 syncing；去重请求保持项目当前状态，避免永久卡在 syncing
    if (!deduped) {
      const [cur] = await db
        .select({ storageStatus: projects.storageStatus })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (cur?.storageStatus !== 'syncing') {
        await db
          .update(projects)
          .set({ storageStatus: 'syncing', lastError: null, updatedAt: new Date() })
          .where(eq(projects.id, projectId));
      }
    }
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'project.sync_requested',
      resourceType: 'project',
      resourceId: projectId,
      meta: { deduped },
    });
    return c.json(
      { ok: true, projectId, status: deduped ? 'deduped' : 'syncing', deduped },
      202,
    );
  });

  projectsRoute.get('/:id', async (c) => {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, c.req.param('id')), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(project.id, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    return c.json(project);
  });

  app.route('/api/v1/projects', projectsRoute);

  // ---- 动态（N1 骨架） ----
  // 支持 ?projectId= 过滤：项目动态页只应显示本项目动态（前端 ActivityPage 已在传参，PLAN 5.4.1）
  app.get('/api/v1/activities', async (c) => {
    const projectId = c.req.query('projectId');
    const userId = c.get('userId') as string;
    let whereClause: ReturnType<typeof eq> | undefined;
    if (projectId) {
      const access = await projectAccess(projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canRead);
      whereClause = eq(activities.projectId, projectId);
    } else if (c.get('globalRole') !== 'admin') {
      // 全局动态流仅展示当前用户可读项目（私有项目活动不泄露）
      whereClause = sql`${activities.projectId} in (select p.id from projects p where p.deleted_at is null and (p.visibility <> 'private' or exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = ${userId})))` as never;
    }
    // select 显式列 + leftJoin users 补 actorName：Dashboard/ActivityPage 均按 actorName 渲染操作人
    const rows = await db
      .select({
        id: activities.id,
        projectId: activities.projectId,
        actorId: activities.actorId,
        actorName: users.name,
        verb: activities.verb,
        targetType: activities.targetType,
        targetId: activities.targetId,
        targetTitle: activities.targetTitle,
        createdAt: activities.createdAt,
      })
      .from(activities)
      .leftJoin(users, eq(activities.actorId, users.id))
      .where(whereClause)
      .orderBy(desc(activities.createdAt))
      .limit(20);
    return c.json({ items: rows, page: 1, pageSize: 20, total: rows.length });
  });

  // ---- 当前用户（A4 骨架） ----
  app.get('/api/v1/me', async (c) => {
    const userId = c.get('userId') as string;
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        globalRole: users.globalRole,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new HTTPException(404, { message: 'NOT_FOUND' });
    return c.json(user);
  });

  // ---- 用户偏好（U1 SettingsPage） ----
  app.get('/api/v1/me/prefs', async (c) => {
    const userId = c.get('userId') as string;
    const [prefs] = await db.select().from(userPrefs).where(eq(userPrefs.userId, userId)).limit(1);
    if (!prefs) {
      // 首次访问 → 创建默认行（避免前端每次 GET 都返回 null）
      await db.insert(userPrefs).values({ userId });
      return c.json({ theme: 'fresh-emerald', appearance: 'system', accent: 'emerald', fontSize: 2, prefs: {} });
    }
    return c.json(prefs);
  });

  app.put('/api/v1/me/prefs', async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json()) as {
      theme?: string;
      appearance?: string;
      accent?: string;
      fontSize?: number;
      prefs?: Record<string, unknown>;
    };

    const set: Record<string, unknown> = {};
    if (body.theme !== undefined) set.theme = body.theme;
    if (body.appearance !== undefined) set.appearance = body.appearance;
    if (body.accent !== undefined) set.accent = body.accent;
    if (body.fontSize !== undefined) set.fontSize = body.fontSize;
    if (body.prefs !== undefined) set.prefs = body.prefs;

    const [existing] = await db.select().from(userPrefs).where(eq(userPrefs.userId, userId)).limit(1);
    if (existing) {
      const [updated] = await db.update(userPrefs).set(set).where(eq(userPrefs.userId, userId)).returning();
      return c.json(updated);
    }
    const [inserted] = await db.insert(userPrefs).values({ userId, ...set }).returning();
    return c.json(inserted, 201);
  });

  // ---- 团队（M1：TeamPage 成员列表；PLAN 5.2.1 改造） ----
  // 契约对齐前端 TeamResponse：{ members: [{ id, name, email, role, online, lastActive }] }。
  // role 为展示层 TeamRole（admin→Owner，其余→Editor）；online/lastActive 由该用户最近
  // activity 时间推导（真实行为数据，5 分钟内有活动视为在线），非 mock。
  app.get('/api/v1/team', async (c) => {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        globalRole: users.globalRole,
        avatarUrl: users.avatarUrl,
        status: users.status,
        lastActiveAt: sql<string | null>`(
          select max(${activities.createdAt}) from ${activities} where ${activities.actorId} = ${users.id}
        )`,
      })
      .from(users)
      .limit(200);
    const members = rows.map((u) => {
      const lastActive = u.lastActiveAt ? new Date(u.lastActiveAt).toISOString() : null;
      const online = !!lastActive && Date.now() - new Date(lastActive).getTime() < 5 * 60_000;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: (u.globalRole === 'admin' ? 'Owner' : 'Editor') as 'Owner' | 'Maintainer' | 'Editor' | 'Guest',
        online,
        lastActive,
        avatarUrl: u.avatarUrl,
        status: u.status,
      };
    });
    return c.json({ members });
  });

  // ---- 邀请全局团队成员（PLAN 5.2.1：TeamPage 邀请弹窗，原 404 降级转真实） ----
  // 环境无邮件服务（SDD P18）：直接创建 invited 账号 + 随机临时密码（仅存哈希），
  // 激活/改密流程待做；Owner 为全局管理员不可邀请，Maintainer 及以下为展示层角色（落库均为 user）。
  app.post('/api/v1/team/invite', async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json()) as { email?: string; role?: string; message?: string };
    if (!body.email?.trim()) throw new HTTPException(400, { message: 'VALIDATION_FAILED: email required' });
    const role = body.role ?? 'Editor';
    if (!['Owner', 'Maintainer', 'Editor', 'Guest'].includes(role)) {
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: invalid role' });
    }
    if (role === 'Owner') throw new HTTPException(400, { message: 'CANNOT_INVITE_OWNER' });
    const email = body.email.trim().toLowerCase();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new HTTPException(409, { message: 'ALREADY_MEMBER' });

    const crypto = await import('crypto');
    const [created] = await db
      .insert(users)
      .values({
        email,
        name: email.split('@')[0]!,
        passwordHash: hashPassword(crypto.randomBytes(16).toString('hex')),
        globalRole: 'user',
        status: 'invited',
      })
      .returning();
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'team.invite',
      resourceType: 'user',
      resourceId: created.id,
      meta: { role, message: body.message ?? null },
    });
    // 通知被邀请人（EXT-PLATFORM ADR-P3：server 侧站内渠道；激活登录后收件箱可见）
    await db.insert(notifications).values({
      userId: created.id,
      type: 'team.invite',
      payload: {
        title: '团队邀请',
        message: `你的账号已被加入团队（角色：${role}）。请使用邀请邮件中的临时密码登录。`,
      },
    });
    return c.json({ id: created.id, email: created.email, role, status: created.status }, 201);
  });

  // ---- 修改全局成员角色（PLAN 5.2.1：TeamPage 角色菜单，原 404 降级转真实） ----
  // TeamRole→globalRole 映射：仅 Owner=admin；移除某用户 Owner 时自动降为 user。
  app.patch('/api/v1/team/:id/role', async (c) => {
    const userId = c.get('userId') as string;
    const targetId = c.req.param('id')!;
    const body = (await c.req.json()) as { role?: string };
    const role = body.role;
    if (!role || !['Owner', 'Maintainer', 'Editor', 'Guest'].includes(role)) {
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: invalid role' });
    }
    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) throw new HTTPException(404, { message: 'NOT_FOUND' });
    if (targetId === userId && role !== 'Owner') {
      throw new HTTPException(400, { message: 'CANNOT_DEMOTE_SELF' });
    }
    const [updated] = await db
      .update(users)
      .set({ globalRole: role === 'Owner' ? 'admin' : 'user', updatedAt: new Date() })
      .where(eq(users.id, targetId))
      .returning();
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'team.role_change',
      resourceType: 'user',
      resourceId: targetId,
      meta: { from: target.globalRole, to: updated.globalRole },
    });
    return c.json({ id: updated.id, role });
  });

  // ---- 文档全局列表（D1 + F04 预警数据源；真服务端分页：page/pageSize/total） ----
  // 文件管理重构 §5.2 / §4.1-F1：支持 ?kind=text|binary 类型 facet 过滤；binary 项下发 rawUrl
  app.get('/api/v1/documents', async (c) => {
    const projectId = c.req.query('projectId');
    const status = c.req.query('status');
    const kind = c.req.query('kind');
    const page = Math.max(1, Math.floor(Number(c.req.query('page') ?? '1') || 1));
    const pageSize = Math.min(500, Math.max(1, Math.floor(Number(c.req.query('pageSize') ?? '500') || 500)));
    const uid = c.get('userId') as string;
    const conditions = [isNull(documents.deletedAt)];
    if (projectId) {
      const access = await projectAccess(projectId, uid, c.get('globalRole') as string);
      denyIfNot(access.canRead);
      conditions.push(eq(documents.projectId, projectId));
    } else if (c.get('globalRole') !== 'admin') {
      // 全局文档列表仅返回当前用户可读项目的文档
      conditions.push(sql`${documents.projectId} in (select p.id from projects p where p.deleted_at is null and (p.visibility <> 'private' or exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = ${uid})))`);
    }
    if (status) conditions.push(eq(documents.status, status));
    // 文件管理重构 §4.1-F1：按 kind facet 过滤（缺省全部；非法值忽略）
    if (kind === 'text' || kind === 'binary') conditions.push(eq(documents.kind, kind));
    const where = and(...conditions);
    const total = await getCachedCount(
      `global:${projectId ?? 'all'}:${status ?? ''}:${kind ?? ''}:${c.get('globalRole') === 'admin' ? 'admin' : uid}`,
      async () => {
        const [totalRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(documents)
          .where(where);
        return Number(totalRow?.count ?? 0);
      },
    );
    const rows = await db
      .select({
        id: documents.id,
        projectId: documents.projectId,
        path: documents.path,
        title: documents.title,
        kind: documents.kind,
        ext: documents.ext,
        mime: documents.mime,
        size: documents.size,
        status: documents.status,
        tags: documents.tags,
        wordCount: documents.wordCount,
        contentHash: documents.contentHash,
        updatedBy: documents.updatedBy,
        updatedAt: documents.updatedAt,
        createdAt: documents.createdAt,
        // content 仅用于派生 summary，不随响应下发
        content: documents.content,
      })
      .from(documents)
      .where(where)
      .orderBy(desc(documents.updatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    // 文件管理重构 §5.4：binary 项附带短期签名 rawUrl（img/iframe 直接消费，不必走 Bearer 头）
    const items = rows.map(({ content, kind: k, ...row }) => ({
      ...row,
      kind: k,
      summary: documentSummary(content),
      rawUrl: k === 'binary' ? buildRawUrl(config.JWT_SECRET, '/api/v1', row, uid, config.RAW_URL_TTL_SECONDS) : null,
    }));
    return c.json({ items, page, pageSize, total });
  });

  // ---- 项目详情增强（P3 扩展：附带统计） ----
  // 覆盖已有 GET /api/v1/projects/:id — 通过 docs_count 子查询补充统计
  // 注：已有 routes 中 projectsRoute.get('/:id') 是轻量版；这里不覆盖，保持独立查询
  app.get('/api/v1/projects/:id/overview', async (c) => {
    const projectId = c.req.param('id')!;
    {
      const access = await projectAccess(projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: 'NOT_FOUND' });

    const docCount = await getCachedCount(`overview:${projectId}`, async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(documents)
        .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)));
      return Number(row?.count ?? 0);
    });
    const [memberCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));

    // 存储后端类型直接取项目行内嵌的 storage_kind（git | local）
    return c.json({
      ...project,
      backendKind: project.storageKind,
      docCount,
      memberCount: Number(memberCountRow?.count ?? 0),
    });
  });

  // ---- 项目文档列表（D2 BrowsePage 必需；真服务端分页：page/pageSize/total） ----
  // 文件管理重构 §5.2 / §4.1-F1：支持 ?kind=text|binary 类型 facet；binary 项下发 rawUrl
  // 设计文档 §4.1-F18（导入导出）：复用全局列表的真分页模式，count 子查询 + limit/offset
  app.get('/api/v1/projects/:id/documents', async (c) => {
    const projectId = c.req.param('id')!;
    const uid = c.get('userId') as string;
    {
      const access = await projectAccess(projectId, uid, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    const page = Math.max(1, Math.floor(Number(c.req.query('page') ?? '1') || 1));
    const pageSize = Math.min(500, Math.max(1, Math.floor(Number(c.req.query('pageSize') ?? '500') || 500)));
    const status = c.req.query('status');
    const q = c.req.query('q');
    const kind = c.req.query('kind');
    const conditions = [eq(documents.projectId, projectId), isNull(documents.deletedAt)];
    if (status) conditions.push(eq(documents.status, status));
    // 文件管理重构 §4.1-F1：按 kind facet 过滤（缺省全部；非法值忽略）
    if (kind === 'text' || kind === 'binary') conditions.push(eq(documents.kind, kind));
    if (q) {
      const like = '%' + q + '%';
      conditions.push(sql`(
        ${documents.path} ILIKE ${like} OR
        ${documents.title} ILIKE ${like} OR
        array_to_string(${documents.tags}, ',') ILIKE ${like} OR
        (${documents.kind} = 'text' AND ${documents.content} ILIKE ${like})
      )`);
    }
    const where = and(...conditions);
    const total = await getCachedCount(
      `project:${projectId}:${status ?? ''}:${kind ?? ''}:${q ?? ''}`,
      async () => {
        const [totalRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(documents)
          .where(where);
        return Number(totalRow?.count ?? 0);
      },
    );
    const rows = await db
      .select({
        id: documents.id,
        projectId: documents.projectId,
        path: documents.path,
        title: documents.title,
        kind: documents.kind,
        ext: documents.ext,
        mime: documents.mime,
        size: documents.size,
        status: documents.status,
        tags: documents.tags,
        wordCount: documents.wordCount,
        contentHash: documents.contentHash,
        updatedBy: documents.updatedBy,
        updatedAt: documents.updatedAt,
        createdAt: documents.createdAt,
        // content 仅用于派生 summary，不随响应下发
        content: documents.content,
      })
      .from(documents)
      .where(where)
      .orderBy(documents.path)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    // 文件管理重构 §5.4：binary 项附带短期签名 rawUrl
    const items = rows.map(({ content, kind: k, ...row }) => ({
      ...row,
      kind: k,
      summary: documentSummary(content),
      rawUrl: k === 'binary' ? buildRawUrl(config.JWT_SECRET, '/api/v1', row, uid, config.RAW_URL_TTL_SECONDS) : null,
    }));
    return c.json({ items, page, pageSize, total });
  });

  // ---- 文档详情（D3 BrowsePage 必需：含 content） ----
  app.get('/api/v1/documents/:id', async (c) => {
    const [doc] = await db
      .select({
        id: documents.id,
        projectId: documents.projectId,
        path: documents.path,
        title: documents.title,
        content: documents.content,
        kind: documents.kind,
        ext: documents.ext,
        mime: documents.mime,
        size: documents.size,
        storageRef: documents.storageRef,
        status: documents.status,
        tags: documents.tags,
        wordCount: documents.wordCount,
        contentHash: documents.contentHash,
        updatedBy: documents.updatedBy,
        updatedAt: documents.updatedAt,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(and(eq(documents.id, c.req.param('id')!), isNull(documents.deletedAt)))
      .limit(1);
    if (!doc) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(doc.projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    return c.json({
      ...doc,
      rawUrl:
        doc.kind === 'binary'
          ? buildRawUrl(config.JWT_SECRET, '/api/v1', doc, c.get('userId') as string, config.RAW_URL_TTL_SECONDS)
          : null,
    });
  });

  // ---- 保存文档（D4 BrowsePage 保存：新版本 + 更新 + activity） ----
  // PLAN 5.2.1：版本写入链路落 changedSummary（行级简化 diff，ActivityPage diff 块数据源）
  app.put('/api/v1/documents/:id', async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const body = (await c.req.json()) as {
      content?: string;
      title?: string;
      message?: string;
      tags?: string[];
      baseVersionNo?: number;
    };

    const [existing] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!existing) throw new HTTPException(404, { message: 'NOT_FOUND' });

    {
      const access = await projectAccess(existing.projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');
    }

    // 二进制文件不走文本保存链路（blob 上传 P2 提供）
    if (existing.kind === 'binary') {
      throw new HTTPException(415, { message: 'UNSUPPORTED_MEDIA_KIND: 二进制文件请通过上传接口保存' });
    }

    // 乐观并发保护（多人协作不互相覆盖）：请求携带 baseVersionNo 且与最新版本不符 → 409
    if (typeof body.baseVersionNo === 'number') {
      const [latest] = await db
        .select({ v: sql<number>`coalesce(max(${documentVersions.versionNo}), 0)` })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, id));
      if (Number(latest?.v ?? 0) !== body.baseVersionNo) {
        throw new HTTPException(409, { message: 'DOCUMENT_VERSION_CONFLICT' });
      }
    }

    const newContent = body.content ?? existing.content;
    const wordCount = newContent ? [...newContent.matchAll(/[\p{L}\p{N}]/gu)].length : 0;
    const byteSize = byteLength(newContent ?? '');
    const crypto = await import('crypto');
    const newHash = crypto.createHash('sha256').update(newContent ?? '').digest('hex');

    // 标签清洗：trim 去空、去重、上限 8 个（PLAN 3.4 标签三维）
    const newTags =
      body.tags === undefined
        ? existing.tags
        : [...new Set(body.tags.map((t) => t.trim()).filter(Boolean))].slice(0, 8);

    // 行级简化 diff：共同前缀/后缀之间的行视为删+改，各取前 4 行防超长
    function buildChangedSummaryForSave(): { lines: string[] } | null {
      return buildChangedSummary(existing.content ?? '', newContent ?? '');
    }

    // 创建版本快照
    const [maxVersion] = await db
      .select({ max: sql<number>`coalesce(max(${documentVersions.versionNo}), 0)` })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, id));
    const nextVersion = Number(maxVersion?.max ?? 0) + 1;

    const [versionRow] = await db
      .insert(documentVersions)
      .values({
        documentId: id,
        versionNo: nextVersion,
        authorId: userId,
        message: body.message ?? null,
        content: newContent ?? '',
        size: byteSize,
        changedSummary: buildChangedSummaryForSave(),
      })
      .returning({ id: documentVersions.id });

    // 更新文档
    const [updated] = await db
      .update(documents)
      .set({
        content: newContent,
        title: body.title ?? existing.title,
        tags: newTags,
        wordCount,
        size: byteSize,
        contentHash: newHash,
        status: 'modified',
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id))
      .returning();

    // B5: 文档内容变更后清空 count 缓存（30s 内的列表请求会重新 COUNT）
    invalidateDocCountCache();

    await db.insert(activities).values({
      projectId: existing.projectId,
      actorId: userId,
      verb: 'edit',
      targetType: 'document',
      targetId: existing.id,
      targetTitle: updated?.title ?? existing.path,
    });

    // NAS 镜像 + Git 自动提交（平台化扩展）；再向项目房间广播变更（实时互见）
    const [meUser] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    const [projRow] = await db.select({ name: projects.name, ownerId: projects.ownerId }).from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    const effects = await docStorageEffects(
      deps,
      { id: existing.projectId, name: projRow?.name ?? '', ownerId: projRow?.ownerId ?? '' },
      existing.path,
      newContent ?? '',
      { id: userId, name: meUser?.name ?? 'unknown', email: meUser?.email ?? 'unknown@local' },
      id,
    );
    // Git 推送成功后回填版本提交号（时间线 commit hash 展示；未填保存说明时以提交信息兜底）
    if (versionRow && effects.git.ok && effects.git.pushed && effects.git.commitHash) {
      await db
        .update(documentVersions)
        .set({
          commitHash: effects.git.commitHash,
          ...(body.message ? {} : effects.git.message ? { message: effects.git.message } : {}),
        })
        .where(eq(documentVersions.id, versionRow.id));
    }
    await db.execute(sql`select pg_notify('ewiki_events', ${JSON.stringify({
      channel: 'sync',
      payload: {
        room: `project:${existing.projectId}`,
        event: 'document.updated',
        payload: { documentId: existing.id, path: existing.path, versionNo: nextVersion, by: meUser?.name ?? '', byId: userId },
      },
    })})`);

    return c.json({ ok: true, document: updated, version: nextVersion, effects });
  });

  // ---- 文档版本历史（D5 BrowsePage 历史面板） ----
  // 文件管理重构 §5.4：binary 类型的版本项附带 rawUrl（raw 接口暂不支持版本参数，指向当前 storageRef；
  // 前端可据此渲染下载入口，后续接版本级 raw 时替换即可）
  app.get('/api/v1/documents/:id/versions', async (c) => {
    const id = c.req.param('id')!;
    const uid = c.get('userId') as string;
    const [docRow] = await db
      .select({ projectId: documents.projectId, kind: documents.kind })
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!docRow) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(docRow.projectId, uid, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    const rows = await db
      .select({
        id: documentVersions.id,
        documentId: documentVersions.documentId,
        versionNo: documentVersions.versionNo,
        commitHash: documentVersions.commitHash,
        authorId: documentVersions.authorId,
        message: documentVersions.message,
        changedSummary: documentVersions.changedSummary,
        size: documentVersions.size,
        storageRef: documentVersions.storageRef,
        createdAt: documentVersions.createdAt,
        authorName: users.name,
      })
      .from(documentVersions)
      .leftJoin(users, eq(documentVersions.authorId, users.id))
      .where(eq(documentVersions.documentId, id))
      .orderBy(desc(documentVersions.versionNo))
      .limit(50);
    const isBinary = docRow.kind === 'binary';
    const items = rows.map((r) => ({
      ...r,
      rawUrl: isBinary ? buildRawUrl(config.JWT_SECRET, '/api/v1', { id }, uid, config.RAW_URL_TTL_SECONDS) : null,
    }));
    return c.json({ items, total: rows.length });
  });

  // ---- 单版本详情（diff 对比 / 版本预览 / 恢复前置） ----
  app.get('/api/v1/documents/:id/versions/:vNo', async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const vNo = Number(c.req.param('vNo'));
    if (!Number.isFinite(vNo) || vNo < 1) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 版本号须为正整数' });

    const [docRow] = await db
      .select({ projectId: documents.projectId, kind: documents.kind })
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!docRow) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(docRow.projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }

    const [version] = await db
      .select({
        id: documentVersions.id,
        documentId: documentVersions.documentId,
        versionNo: documentVersions.versionNo,
        authorId: documentVersions.authorId,
        authorName: users.name,
        message: documentVersions.message,
        content: documentVersions.content,
        size: documentVersions.size,
        storageRef: documentVersions.storageRef,
        changedSummary: documentVersions.changedSummary,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .leftJoin(users, eq(documentVersions.authorId, users.id))
      .where(and(eq(documentVersions.documentId, id), eq(documentVersions.versionNo, vNo)))
      .limit(1);

    if (!version) throw new HTTPException(404, { message: 'NOT_FOUND: VERSION_NOT_EXIST' });
    return c.json({ ...version, kind: docRow.kind });
  });

  // ---- 恢复到指定版本（多人协作冲突版本回滚） ----
  app.post('/api/v1/documents/:id/restore', async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const body = (await c.req.json()) as { versionNo?: number; message?: string; baseVersionNo?: number };
    const versionNo = Number(body.versionNo);
    if (!Number.isFinite(versionNo) || versionNo < 1) {
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: versionNo 须为正整数' });
    }

    const [existing] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!existing) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(existing.projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');
    }

    // 乐观并发保护（与 PUT 一致）
    if (typeof body.baseVersionNo === 'number') {
      const [latest] = await db
        .select({ v: sql<number>`coalesce(max(${documentVersions.versionNo}), 0)` })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, id));
      if (Number(latest?.v ?? 0) !== body.baseVersionNo) {
        throw new HTTPException(409, { message: 'DOCUMENT_VERSION_CONFLICT' });
      }
    }

    const [targetVersion] = await db
      .select()
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, id), eq(documentVersions.versionNo, versionNo)))
      .limit(1);
    if (!targetVersion) throw new HTTPException(404, { message: 'NOT_FOUND: VERSION_NOT_EXIST' });

    // 幂等：已是当前最新内容 → 不产生新版本
    const alreadyCurrent =
      targetVersion.content === existing.content &&
      (targetVersion.storageRef ?? null) === (existing.storageRef ?? null) &&
      targetVersion.size === existing.size;
    if (alreadyCurrent) {
      return c.json({ ok: true, restored: false, reason: 'ALREADY_CURRENT', restoredFrom: versionNo });
    }

    const newContent = targetVersion.content;
    const newStorageRef = targetVersion.storageRef;
    const newSize = targetVersion.size;

    // 版本号：取 next（事务内重算避免并发）
    const [maxVersion] = await db
      .select({ max: sql<number>`coalesce(max(${documentVersions.versionNo}), 0)` })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, id));
    const nextVersion = Number(maxVersion?.max ?? 0) + 1;

    // 行级简化 diff（从当前内容恢复到目标内容）
    const summary = existing.kind === 'text'
      ? buildChangedSummary(existing.content ?? '', newContent ?? '')
      : null;

    await db.transaction(async (tx) => {
      await tx.insert(documentVersions).values({
        documentId: id,
        versionNo: nextVersion,
        authorId: userId,
        message: body.message ?? `恢复自 v${versionNo}`,
        content: newContent,
        storageRef: newStorageRef ?? null,
        size: newSize,
        changedSummary: summary,
      });

      if (existing.kind === 'text') {
        const wordCount = newContent ? [...newContent.matchAll(/[\p{L}\p{N}]/gu)].length : 0;
        const crypto = await import('crypto');
        const newHash = crypto.createHash('sha256').update(newContent ?? '').digest('hex');
        await tx.update(documents).set({
          content: newContent,
          size: newSize,
          wordCount,
          contentHash: newHash,
          status: 'modified',
          updatedBy: userId,
          updatedAt: new Date(),
        }).where(eq(documents.id, id));
      } else {
        // binary：恢复 blob 指针
        await tx.update(documents).set({
          storageRef: newStorageRef,
          size: newSize,
          content: '',
          status: 'modified',
          updatedBy: userId,
          updatedAt: new Date(),
        }).where(eq(documents.id, id));
      }
    });

    const [meUser] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    const [projRow] = await db.select({ name: projects.name, ownerId: projects.ownerId }).from(projects).where(eq(projects.id, existing.projectId)).limit(1);

    // NAS / Git 同步（文本：写回 content → NAS 落盘；binary：blob 引用不变但 storageRef 可能变 → 落 blob）
    const effects = await docStorageEffects(
      deps,
      { id: existing.projectId, name: projRow?.name ?? '', ownerId: projRow?.ownerId ?? '' },
      existing.path,
      null,
      { id: userId, name: meUser?.name ?? 'unknown', email: meUser?.email ?? 'unknown@local' },
    );

    await db.insert(activities).values({
      projectId: existing.projectId,
      actorId: userId,
      verb: 'restore',
      targetType: 'document',
      targetId: existing.id,
      targetTitle: existing.title ?? existing.path,
      meta: { fromVersionNo: versionNo, toVersionNo: nextVersion },
    });

    await db.execute(sql`select pg_notify('ewiki_events', ${JSON.stringify({
      channel: 'sync',
      payload: {
        room: `project:${existing.projectId}`,
        event: 'document.updated',
        payload: { documentId: existing.id, path: existing.path, by: meUser?.name ?? '', byId: userId, restoredFrom: versionNo },
      },
    })})`);

    return c.json({ ok: true, restored: true, version: nextVersion, restoredFrom: versionNo, effects });
  });

  // ---- 新建文档（D6 BrowsePage 新建按钮） ----
  app.post('/api/v1/projects/:id/documents', async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    const body = (await c.req.json()) as { path?: string; title?: string; content?: string };

    // 任意扩展名的文本/代码文件均可创建；二进制上传在 P2 提供
    const norm = normalizeTreePath(body.path, { requireBasename: true, allowDotFile: true });
    if (!norm)
      throw new HTTPException(400, {
        message: 'VALIDATION_FAILED: 路径不合法（须含文件扩展名，不含非法字符）',
      });
    const ft = resolveFileType(norm);
    if (ft.kind === 'binary') {
      throw new HTTPException(415, {
        message: `UNSUPPORTED_MEDIA_KIND: 暂不支持通过此接口创建 .${ft.ext || '未知'} 二进制文件（上传能力 P2 提供）`,
      });
    }

    {
      const access = await projectAccess(projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');
    }

    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.projectId, projectId), eq(documents.path, norm), isNull(documents.deletedAt)))
      .limit(1);
    if (existing) throw new HTTPException(409, { message: 'DOCUMENT_EXISTS' });

    const content = body.content ?? '';
    const title = body.title?.trim() || defaultDocTitle(norm, content);
    const crypto = await import('crypto');
    const contentHash = content ? crypto.createHash('sha256').update(content).digest('hex') : null;
    const wordCount = content ? [...content.matchAll(/[\p{L}\p{N}]/gu)].length : 0;
    const byteSize = byteLength(content);

    const [doc] = await db
      .insert(documents)
      .values({
        projectId,
        path: norm,
        title,
        content: content || null,
        kind: 'text',
        ext: ft.ext,
        mime: ft.mime,
        size: byteSize,
        contentHash,
        status: content ? 'modified' : 'untracked',
        wordCount,
        updatedBy: userId,
      })
      .returning();

    // B5: 新建文档后清空 count 缓存
    invalidateDocCountCache();

    await db.insert(activities).values({
      projectId,
      actorId: userId,
      verb: 'create',
      targetType: 'document',
      targetId: doc!.id,
      targetTitle: title,
    });

    // 版本时间线留痕（PRD F46）：新建即生成 v1 快照（空文档无内容，不产生快照）
    let versionId: string | null = null;
    if (content) {
      const [v] = await db
        .insert(documentVersions)
        .values({
          documentId: doc!.id,
          versionNo: 1,
          authorId: userId,
          content,
          size: byteSize,
        })
        .returning({ id: documentVersions.id });
      versionId = v?.id ?? null;
    }

    // NAS 镜像 + Git 自动提交 + 项目房间广播
    const [meUser] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    const [projRow] = await db.select({ name: projects.name, ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    const effects = await docStorageEffects(
      deps,
      { id: projectId, name: projRow?.name ?? '', ownerId: projRow?.ownerId ?? '' },
      norm,
      content,
      { id: userId, name: meUser?.name ?? 'unknown', email: meUser?.email ?? 'unknown@local' },
      doc!.id,
    );
    // Git 推送成功后回填版本提交号（与 Gitea 提交一一对应）
    if (versionId && effects.git.ok && effects.git.pushed && effects.git.commitHash) {
      await db
        .update(documentVersions)
        .set({
          commitHash: effects.git.commitHash,
          ...(effects.git.message ? { message: effects.git.message } : {}),
        })
        .where(eq(documentVersions.id, versionId));
    }
    await db.execute(sql`select pg_notify('ewiki_events', ${JSON.stringify({
      channel: 'sync',
      payload: {
        room: `project:${projectId}`,
        event: 'document.updated',
        payload: { documentId: doc!.id, path: norm, created: true, by: meUser?.name ?? '', byId: userId },
      },
    })})`);

    return c.json({ ...doc, effects }, 201);
  });

  // ---- 删除文档（D7 软删除） ----
  app.delete('/api/v1/documents/:id', async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const [existing] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!existing) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(existing.projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');
    }

    // 反向引用（验收 #7）：哪些未删除文档链接/图片边指向本文件
    const referrers = await db
      .select({
        id: documents.id,
        path: documents.path,
        title: documents.title,
      })
      .from(documents)
      .innerJoin(documentLinks, eq(documentLinks.fromDocumentId, documents.id))
      .where(and(eq(documentLinks.toDocumentId, id), isNull(documents.deletedAt)))
      .limit(10);

    await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, id));

    // B5: 软删除后清空 count 缓存
    invalidateDocCountCache();

    await db.insert(activities).values({
      projectId: existing.projectId,
      actorId: userId,
      verb: 'delete',
      targetType: 'document',
      targetId: existing.id,
      targetTitle: existing.title ?? existing.path,
      meta: {
        referencedCount: referrers.length,
        referencedBy: referrers,
      },
    });

    // NAS 镜像删除 + Git 自动提交删除 + 项目房间广播
    const [meUser] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    const [projRow] = await db.select({ name: projects.name, ownerId: projects.ownerId }).from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    const effects = await docStorageEffects(
      deps,
      { id: existing.projectId, name: projRow?.name ?? '', ownerId: projRow?.ownerId ?? '' },
      existing.path,
      null,
      { id: userId, name: meUser?.name ?? 'unknown', email: meUser?.email ?? 'unknown@local' },
    );
    await db.execute(sql`select pg_notify('ewiki_events', ${JSON.stringify({
      channel: 'sync',
      payload: {
        room: `project:${existing.projectId}`,
        event: 'document.updated',
        payload: { documentId: existing.id, path: existing.path, deleted: true, by: meUser?.name ?? '', byId: userId },
      },
    })})`);

    return c.json({ ok: true, effects });
  });

  // ---- 移动/重命名文档（D8 目录树管理：右键菜单 / 拖拽移动；meta 记录 from→to） ----
  // 路径变更 = Git 工作副本内一次「删除旧路径 + 写入新路径」的原子提交；NAS 镜像同步搬移。
  // 只改 title 不触发存储副作用；移动不产生新版本快照（不污染 baseVersionNo 冲突检测语义）。
  app.patch('/api/v1/documents/:id', async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const body = (await c.req.json().catch(() => null)) as { path?: unknown; title?: unknown } | null;
    if (!body) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 请求体需为 JSON' });

    const [existing] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!existing) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(existing.projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');
    }

    let newTitle: string | undefined;
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
        throw new HTTPException(400, { message: 'VALIDATION_FAILED: 标题需为 1–200 字符' });
      }
      newTitle = body.title.trim();
    }

    let newPath = existing.path;
    let newExt = existing.ext;
    let newMime = existing.mime;
    if (body.path !== undefined) {
      const norm = normalizeTreePath(body.path, { requireBasename: true, allowDotFile: true });
      if (!norm) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 路径不合法（须含文件扩展名，不含非法字符）' });
      if (norm !== existing.path) {
        if (existing.kind !== 'binary') {
          const ft = resolveFileType(norm);
          if (ft.kind === 'binary') {
            throw new HTTPException(415, {
              message: `UNSUPPORTED_MEDIA_KIND: 不能将文件改为 .${ft.ext || '未知'} 二进制类型（请使用上传接口）`,
            });
          }
          newExt = ft.ext;
          newMime = ft.mime;
        }
        // 全量唯一约束（软删除行仍占位）：一经占用即拒绝，避免撞 documents_project_path_uq
        const [dup] = await db
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.projectId, existing.projectId), eq(documents.path, norm), ne(documents.id, id)))
          .limit(1);
        if (dup) throw new HTTPException(409, { message: `DOCUMENT_EXISTS: 目标路径已被占用（${norm}）` });
        newPath = norm;
      }
    }

    const moved = newPath !== existing.path;
    const titleChanged = newTitle !== undefined && newTitle !== existing.title;
    if (!moved && !titleChanged) {
      return c.json({ ok: true, document: existing, effects: null });
    }

    const [updated] = await db
      .update(documents)
      .set({
        path: newPath,
        title: newTitle ?? existing.title,
        ext: newExt,
        mime: newMime,
        status: moved ? 'modified' : existing.status,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id))
      .returning();

    await db.insert(activities).values({
      projectId: existing.projectId,
      actorId: userId,
      verb: moved ? 'move' : 'rename',
      targetType: 'document',
      targetId: existing.id,
      targetTitle: updated?.title ?? newPath,
      meta: moved ? { from: existing.path, to: newPath } : { from: existing.title, to: newTitle },
    });

    // 存储副作用（仅路径变更时触发）：NAS 镜像搬移 + Git 单提交改名
    const [meUser] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    const [projRow] = await db.select({ name: projects.name, ownerId: projects.ownerId }).from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    let effects: DocEffectResult | null = null;
    if (moved) {
      effects = await docStorageEffectsBatch(
        deps,
        { id: existing.projectId, name: projRow?.name ?? '', ownerId: projRow?.ownerId ?? '' },
        [{ op: 'move', path: newPath, fromPath: existing.path, kind: existing.kind === 'binary' ? 'binary' : 'text', content: existing.content, documentId: existing.id }],
        { id: userId, name: meUser?.name ?? 'unknown', email: meUser?.email ?? 'unknown@local' },
        `docs(${existing.path} → ${newPath}): 移动/重命名文档（${meUser?.name ?? ''}）`,
      );
    }
    await db.execute(sql`select pg_notify('ewiki_events', ${JSON.stringify({
      channel: 'sync',
      payload: {
        room: `project:${existing.projectId}`,
        event: 'document.updated',
        payload: {
          documentId: existing.id,
          path: newPath,
          oldPath: moved ? existing.path : undefined,
          moved: moved || undefined,
          by: meUser?.name ?? '',
          byId: userId,
        },
      },
    })})`);

    return c.json({ ok: true, document: updated, effects });
  });

  // ---- 重命名文件夹（D8 目录树管理：批量改 path 前缀，一次 Git 提交） ----
  app.post('/api/v1/projects/:id/folders/rename', async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    const body = (await c.req.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
    const from = normalizeTreePath(body?.from);
    const to = normalizeTreePath(body?.to);
    if (!from || !to) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 文件夹路径不合法' });
    if (from === to) return c.json({ ok: true, moved: 0, effects: null });
    if (to.startsWith(`${from}/`)) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 不能移动到自身的子目录' });

    {
      const access = await projectAccess(projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');
    }

    const rows = await db
      .select({ id: documents.id, path: documents.path, content: documents.content })
      .from(documents)
      .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)));
    const affected = rows.filter((r) => r.path.startsWith(`${from}/`));
    if (affected.length === 0) throw new HTTPException(404, { message: 'FOLDER_NOT_FOUND: 文件夹不存在或没有文档' });

    const affectedIds = new Set(affected.map((r) => r.id));
    const taken = new Set(rows.filter((r) => !affectedIds.has(r.id)).map((r) => r.path));
    const updates = affected.map((r) => ({ id: r.id, from: r.path, to: to + r.path.slice(from.length), content: r.content }));
    for (const u of updates) {
      if (taken.has(u.to)) throw new HTTPException(409, { message: `DOCUMENT_EXISTS: 目标路径已被占用（${u.to}）` });
    }

    const now = new Date();
    for (const u of updates) {
      await db
        .update(documents)
        .set({ path: u.to, status: 'modified', updatedBy: userId, updatedAt: now })
        .where(eq(documents.id, u.id));
    }

    await db.insert(activities).values({
      projectId,
      actorId: userId,
      verb: 'rename',
      targetType: 'folder',
      targetId: null,
      targetTitle: `${from} → ${to}`,
      meta: { from, to, count: updates.length },
    });

    const [meUser] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    const [projRow] = await db.select({ name: projects.name, ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    const effects = await docStorageEffectsBatch(
      deps,
      { id: projectId, name: projRow?.name ?? '', ownerId: projRow?.ownerId ?? '' },
      updates.map((u) => ({
        op: 'move' as const,
        path: u.to,
        fromPath: u.from,
        content: u.content,
        documentId: u.id,
      })),
      { id: userId, name: meUser?.name ?? 'unknown', email: meUser?.email ?? 'unknown@local' },
      `docs(${from}/): 重命名文件夹（${meUser?.name ?? ''}）`,
    );
    await db.execute(sql`select pg_notify('ewiki_events', ${JSON.stringify({
      channel: 'sync',
      payload: {
        room: `project:${projectId}`,
        event: 'document.updated',
        payload: { folder: from, folderTo: to, moved: true, documentIds: updates.map((u) => u.id), by: meUser?.name ?? '', byId: userId },
      },
    })})`);
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'folder.rename',
      resourceType: 'project',
      resourceId: projectId,
      meta: { from, to, count: updates.length },
    });

    return c.json({ ok: true, moved: updates.length, effects });
  });

  // ---- 删除文件夹（D8 目录树管理：批量软删除 + 一次 Git 提交） ----
  app.post('/api/v1/projects/:id/folders/delete', async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    const body = (await c.req.json().catch(() => null)) as { folder?: unknown } | null;
    const folder = normalizeTreePath(body?.folder);
    if (!folder) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 文件夹路径不合法' });

    {
      const access = await projectAccess(projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');
    }

    const rows = await db
      .select({ id: documents.id, path: documents.path })
      .from(documents)
      .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)));
    const affected = rows.filter((r) => r.path.startsWith(`${folder}/`));
    if (affected.length === 0) throw new HTTPException(404, { message: 'FOLDER_NOT_FOUND: 文件夹不存在或没有文档' });

    await db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(inArray(documents.id, affected.map((r) => r.id)));

    await db.insert(activities).values({
      projectId,
      actorId: userId,
      verb: 'delete',
      targetType: 'folder',
      targetId: null,
      targetTitle: folder,
      meta: { count: affected.length },
    });

    const [meUser] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    const [projRow] = await db.select({ name: projects.name, ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    const effects = await docStorageEffectsBatch(
      deps,
      { id: projectId, name: projRow?.name ?? '', ownerId: projRow?.ownerId ?? '' },
      affected.map((r) => ({ op: 'delete' as const, path: r.path })),
      { id: userId, name: meUser?.name ?? 'unknown', email: meUser?.email ?? 'unknown@local' },
      `docs(${folder}/): 删除文件夹（${meUser?.name ?? ''}）`,
    );
    await db.execute(sql`select pg_notify('ewiki_events', ${JSON.stringify({
      channel: 'sync',
      payload: {
        room: `project:${projectId}`,
        event: 'document.updated',
        payload: { folder, deleted: true, documentIds: affected.map((r) => r.id), by: meUser?.name ?? '', byId: userId },
      },
    })})`);
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'folder.delete',
      resourceType: 'project',
      resourceId: projectId,
      meta: { folder, count: affected.length },
    });

    return c.json({ ok: true, deleted: affected.length, effects });
  });

  // ---- PATCH projects/:id（P5 ProjectSettingsPage） ----
  // 注意：必须直接注册在 app 上 —— Hono 的 app.route() 只合并挂载时刻 projectsRoute
  // 已有的路由，写在挂载（:181）之后的 projectsRoute.patch 永远不会生效（曾导致 404）。
  // 项目成员等后补路由同理均直接挂 app（见下）。
  app.patch('/api/v1/projects/:id', async (c) => {
    const projectId = c.req.param('id')!;
    const raw = await c.req.json().catch(() => null);
    const parsed = UpdateProjectSchema.safeParse(raw);
    // .strict()：storageKind/storageConnectionId/storageConfig 等后端更换字段一律拒绝（不可通过 PATCH 更换后端）
    if (!parsed.success) {
      return c.json(
        {
          code: 'VALIDATION_FAILED',
          message: 'VALIDATION_FAILED',
          fields: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const body = parsed.data;

    // 越权修复：此前 PATCH 无任何校验，任何登录用户（含 team 可见性的隐式读者）可改任意项目
    {
      const access = await projectAccess(projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canManage, 'FORBIDDEN: 仅项目所有者/维护者可修改项目');
    }

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined && body.name.trim()) set.name = body.name.trim();
    if (body.description !== undefined) set.description = body.description;
    if (body.color !== undefined) set.color = body.color;
    if (body.visibility !== undefined) set.visibility = body.visibility;
    if (body.autoSync !== undefined) set.autoSync = body.autoSync;
    if (body.intervalSeconds !== undefined) set.intervalSeconds = body.intervalSeconds;
    if (body.defaultBranch !== undefined) set.defaultBranch = body.defaultBranch;

    if (Object.keys(set).length === 1) {
      const [current] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);
      if (!current) throw new HTTPException(404, { message: 'NOT_FOUND' });
      return c.json(current);
    }

    const [updated] = await db
      .update(projects)
      .set(set)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .returning();
    if (!updated) throw new HTTPException(404, { message: 'NOT_FOUND' });

    const userId = c.get('userId') as string;
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'project.update',
      resourceType: 'project',
      resourceId: projectId,
    });

    return c.json(updated);
  });

  // ---- DELETE projects/:id（PLAN 5.2.1：ProjectLayout 更多菜单 / 设置危险区删除项目） ----
  // 软删（projects.deletedAt）：与 documents 一致，列表与详情查询均带 isNull(deletedAt)
  // 过滤，删除后项目自然从全站消失；关联文档不级联物理删除，保留恢复可能。
  // 同样必须直接注册在 app 上（app.route() 挂载时序陷阱，见上方 PATCH 注释）。
  app.delete('/api/v1/projects/:id', async (c) => {
    const projectId = c.req.param('id')!;

    // 越权修复：此前 DELETE 无任何校验，任何登录用户可软删任意项目（比 PATCH 更危险）
    {
      const access = await projectAccess(projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canManage, 'FORBIDDEN: 仅项目所有者/维护者可删除项目');
    }

    const [project] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: 'NOT_FOUND' });

    await db
      .update(projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    const userId = c.get('userId') as string;
    await db.insert(activities).values({
      projectId,
      actorId: userId,
      verb: 'delete',
      targetType: 'project',
      targetId: projectId,
      targetTitle: project.name,
    });
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'project.delete',
      resourceType: 'project',
      resourceId: projectId,
    });

    return c.json({ ok: true });
  });

  // ---- 项目成员（M2 BrowsePage 协作者展示 + MembersPage） ----
  // PLAN 5.2.1：补 online/lastActive（由该用户最近 activity 推导，5 分钟内视为在线）
  app.get('/api/v1/projects/:id/members', async (c) => {
    const projectId = c.req.param('id')!;
    // access 复用给响应：myRole 为当前用户在项目内的实际角色（null = 非成员的隐式读者，
    // 经 team/public 可见性只读访问；全局 admin 兜底为 maintainer），前端据此收起管理控件
    const access = await projectAccess(projectId, c.get('userId') as string, c.get('globalRole') as string);
    denyIfNot(access.canRead);
    const rows = await db
      .select({
        id: projectMembers.id,
        projectId: projectMembers.projectId,
        role: projectMembers.role,
        status: projectMembers.status,
        joinedAt: projectMembers.createdAt,
        userId: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        lastActiveAt: sql<string | null>`(
          select max(${activities.createdAt}) from ${activities} where ${activities.actorId} = ${users.id}
        )`,
      })
      .from(projectMembers)
      .leftJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(desc(projectMembers.createdAt));
    const items = rows.map((m) => {
      const lastActive = m.lastActiveAt ? new Date(m.lastActiveAt).toISOString() : null;
      return {
        ...m,
        lastActive,
        online: !!lastActive && Date.now() - new Date(lastActive).getTime() < 5 * 60_000,
      };
    });
    return c.json({ items, total: items.length, myRole: access.role, visibility: access.project.visibility });
  });

  // ---- 邀请成员（M3 MembersPage） ----
  app.post('/api/v1/projects/:id/members', async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    const body = (await c.req.json()) as { email?: string; role?: 'owner' | 'maintainer' | 'editor' | 'guest' };
    {
      const access = await projectAccess(projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canManage, 'FORBIDDEN: 仅项目所有者/维护者可管理成员');
    }
    if (!body.email) throw new HTTPException(400, { message: 'VALIDATION_FAILED: email required' });
    const role = body.role ?? 'guest';
    if (!['owner', 'maintainer', 'editor', 'guest'].includes(role))
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: invalid role' });

    // 检查项目存在
    const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), isNull(projects.deletedAt))).limit(1);
    if (!project) throw new HTTPException(404, { message: 'NOT_FOUND' });

    // 被邀请用户必须存在（种子场景下只有 admin）
    const [targetUser] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!targetUser) throw new HTTPException(404, { message: 'USER_NOT_FOUND' });

    // 不能邀请自己
    if (targetUser.id === userId) throw new HTTPException(400, { message: 'CANNOT_ADD_SELF' });

    // 检查是否已是成员
    const [existing] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUser.id)))
      .limit(1);
    if (existing) throw new HTTPException(409, { message: 'ALREADY_MEMBER' });

    const [member] = await db
      .insert(projectMembers)
      .values({ projectId, userId: targetUser.id, role, invitedBy: userId })
      .returning();

    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'project.share_grant',
      resourceType: 'project',
      resourceId: projectId,
      meta: { target: targetUser.email, role },
    });

    await db.insert(activities).values({
      projectId,
      actorId: userId,
      verb: 'invite',
      targetType: 'user',
      targetId: targetUser.id,
      targetTitle: targetUser.name,
      meta: { role },
    });

    // 通知被邀请人
    const [inviter] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    const roleLabel: Record<string, string> = { owner: '所有者', maintainer: '维护者', editor: '编辑者', guest: '访客' };
    await db.insert(notifications).values({
      userId: targetUser.id,
      type: 'project.invite',
      payload: {
        projectId,
        title: '项目邀请',
        message: `${inviter?.name ?? '有人'} 邀请你加入项目「${project.name}」（角色：${roleLabel[role] ?? role}）`,
        link: `/projects/${projectId}/browse`,
      },
    });

    return c.json(member, 201);
  });

  // ---- 角色变更 / 移除成员（M4 MembersPage） ----
  app.put('/api/v1/projects/:id/members/:uid', async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    const targetUid = c.req.param('uid')!;
    {
      const access = await projectAccess(projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canManage, 'FORBIDDEN: 仅项目所有者/维护者可管理成员');
    }
    const body = (await c.req.json()) as { role?: 'owner' | 'maintainer' | 'editor' | 'guest'; remove?: boolean };

    const [member] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUid)))
      .limit(1);
    if (!member) throw new HTTPException(404, { message: 'NOT_FOUND' });

    if (body.remove) {
      // 防止移除 owner
      if (member.role === 'owner') throw new HTTPException(400, { message: 'CANNOT_REMOVE_OWNER' });
      await db.delete(projectMembers).where(eq(projectMembers.id, member.id));
      await db.insert(activities).values({
        projectId,
        actorId: userId,
        verb: 'remove',
        targetType: 'user',
        targetId: targetUid,
      });
      return c.json({ ok: true });
    }

    if (body.role) {
      if (!['owner', 'maintainer', 'editor', 'guest'].includes(body.role))
        throw new HTTPException(400, { message: 'VALIDATION_FAILED: invalid role' });
      const [updated] = await db
        .update(projectMembers)
        .set({ role: body.role })
        .where(eq(projectMembers.id, member.id))
        .returning();
      return c.json(updated);
    }

    throw new HTTPException(400, { message: 'VALIDATION_FAILED: role or remove required' });
  });

  // ---- 知识图谱（G1 GraphPage） ----
  app.get('/api/v1/projects/:id/graph', async (c) => {
    const projectId = c.req.param('id')!;
    {
      const access = await projectAccess(projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    // 节点 = 项目下所有文档
    const docs = await db
      .select({ id: documents.id, path: documents.path, title: documents.title })
      .from(documents)
      .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)));

    const docIds = docs.map((d) => d.id);

    // 边：fromDocumentId 在本项目内（toDocumentId 可以在外部）
    let links: Array<{ id: string; fromDocumentId: string; toDocumentId: string | null; externalUrl: string | null; broken: boolean }> = [];
    if (docIds.length > 0) {
      const { inArray } = await import('drizzle-orm');
      links = await db
        .select({
          id: documentLinks.id,
          fromDocumentId: documentLinks.fromDocumentId,
          toDocumentId: documentLinks.toDocumentId,
          externalUrl: documentLinks.externalUrl,
          broken: documentLinks.broken,
        })
        .from(documentLinks)
        .where(inArray(documentLinks.fromDocumentId, docIds));
    }

    return c.json({ nodes: docs, edges: links });
  });

  // ---- 发布站点（PUB1 PublishPage） ----
  app.get('/api/v1/projects/:id/publish-sites', async (c) => {
    const projectId = c.req.param('id')!;
    {
      const access = await projectAccess(projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    const rows = await db
      .select()
      .from(publishSites)
      .where(eq(publishSites.projectId, projectId));
    return c.json({ items: rows, total: rows.length });
  });

  // ---- 发布历史（PUB2 PublishPage） ----
  app.get('/api/v1/publish-sites/:id/jobs', async (c) => {
    const siteId = c.req.param('id')!;
    const [siteRow] = await db
      .select({ projectId: publishSites.projectId })
      .from(publishSites)
      .where(eq(publishSites.id, siteId))
      .limit(1);
    if (!siteRow) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(siteRow.projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    const rows = await db
      .select({
        id: publishJobs.id,
        versionNo: publishJobs.versionNo,
        status: publishJobs.status,
        commitHash: publishJobs.commitHash,
        error: publishJobs.error,
        createdAt: publishJobs.createdAt,
        finishedAt: publishJobs.finishedAt,
      })
      .from(publishJobs)
      .where(eq(publishJobs.siteId, siteId))
      .orderBy(desc(publishJobs.createdAt))
      .limit(30);
    return c.json({ items: rows, total: rows.length });
  });

  // ---- 发布模板列表（PLAN 3.5/5.2.1：PublishPage 模板网格 + Themes「在发布中使用」） ----
  app.get('/api/v1/publish-templates', (c) => c.json({ items: PUBLISH_TEMPLATES }));

  // ---- 创建发布站点（PUB0 PublishPage 空态按钮） ----
  app.post('/api/v1/projects/:id/publish-sites', async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    const body = (await c.req.json()) as {
      slug?: string;
      addressMode?: 'subdomain' | 'subpath';
      schedule?: 'manual' | 'daily' | 'git-push';
      autoSync?: boolean;
      templateId?: string;
    };

    const [project] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canManage, 'FORBIDDEN: 仅项目所有者/维护者可配置发布');
    }

    // 模板 id 校验：必须存在于服务端权威列表（PLAN 3.5 templateId 接线）；参数校验先于冲突检查
    if (body.templateId && !PUBLISH_TEMPLATES.some((t) => t.id === body.templateId)) {
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: unknown templateId' });
    }

    const [dup] = await db
      .select({ id: publishSites.id })
      .from(publishSites)
      .where(eq(publishSites.projectId, projectId))
      .limit(1);
    if (dup) throw new HTTPException(409, { message: 'SITE_EXISTS' });

    const slugify = (s: string): string =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'site';
    let slug = body.slug?.trim() ? slugify(body.slug) : slugify(project.name);
    const [clash] = await db
      .select({ id: publishSites.id })
      .from(publishSites)
      .where(eq(publishSites.slug, slug))
      .limit(1);
    if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const [site] = await db
      .insert(publishSites)
      .values({
        projectId,
        mode: 'hosted',
        slug,
        addressMode: body.addressMode ?? 'subpath',
        schedule: body.schedule ?? 'manual',
        autoSync: body.autoSync ?? false,
        templateId: body.templateId ?? null,
      })
      .returning();

    await db.insert(activities).values({
      projectId,
      actorId: userId,
      verb: 'create',
      targetType: 'publish_site',
      targetId: site.id,
      targetTitle: slug,
    });
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'publish_site.create',
      resourceType: 'publish_site',
      resourceId: site.id,
    });
    return c.json(site, 201);
  });

  // ---- PATCH publish-sites/:id（PLAN 5.2.1：PublishPage 站点设置编辑） ----
  // 可改字段：slug（访问路径，全局唯一，冲突 409）、addressMode（subdomain/subpath）、
  // schedule（manual/daily/git-push）、autoSync（布尔）。customDomain 涉及 TLS 签发流程，
  // 暂不在此端点开放。直接挂 app（挂载时序陷阱同上）。
  app.patch('/api/v1/publish-sites/:id', async (c) => {
    const userId = c.get('userId') as string;
    const siteId = c.req.param('id')!;
    const body = (await c.req.json()) as Partial<{
      slug: string;
      addressMode: 'subdomain' | 'subpath';
      schedule: 'manual' | 'daily' | 'git-push';
      autoSync: boolean;
      templateId: string | null;
    }>;

    const [site] = await db
      .select()
      .from(publishSites)
      .where(eq(publishSites.id, siteId))
      .limit(1);
    if (!site) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(site.projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canManage, 'FORBIDDEN: 仅项目所有者/维护者可修改发布配置');
    }

    const set: Record<string, unknown> = { updatedAt: new Date() };

    if (body.slug !== undefined) {
      const slugify = (s: string): string =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'site';
      const slug = slugify(body.slug);
      if (slug !== site.slug) {
        const [clash] = await db
          .select({ id: publishSites.id })
          .from(publishSites)
          .where(and(eq(publishSites.slug, slug), ne(publishSites.id, siteId)))
          .limit(1);
        if (clash) throw new HTTPException(409, { message: 'SLUG_EXISTS' });
        set.slug = slug;
      }
    }
    if (body.addressMode !== undefined) {
      if (body.addressMode !== 'subdomain' && body.addressMode !== 'subpath') {
        throw new HTTPException(400, { message: 'VALIDATION_FAILED' });
      }
      set.addressMode = body.addressMode;
    }
    if (body.schedule !== undefined) {
      if (body.schedule !== 'manual' && body.schedule !== 'daily' && body.schedule !== 'git-push') {
        throw new HTTPException(400, { message: 'VALIDATION_FAILED' });
      }
      set.schedule = body.schedule;
    }
    if (body.autoSync !== undefined) set.autoSync = !!body.autoSync;
    if (body.templateId !== undefined) {
      // 模板 id 校验：null 允许（清除模板），非 null 必须在权威列表内
      if (body.templateId !== null && !PUBLISH_TEMPLATES.some((t) => t.id === body.templateId)) {
        throw new HTTPException(400, { message: 'VALIDATION_FAILED: unknown templateId' });
      }
      set.templateId = body.templateId;
    }

    // 空更新：直接回读当前行（与 PATCH projects 行为一致）
    if (Object.keys(set).length === 1) return c.json(site);

    const [updated] = await db
      .update(publishSites)
      .set(set)
      .where(eq(publishSites.id, siteId))
      .returning();

    await db.insert(activities).values({
      projectId: site.projectId,
      actorId: userId,
      verb: 'update',
      targetType: 'publish_site',
      targetId: siteId,
      targetTitle: updated.slug ?? siteId,
    });
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'publish_site.update',
      resourceType: 'publish_site',
      resourceId: siteId,
    });

    return c.json(updated);
  });

  // ---- 触发发布构建（PUB3 PublishPage 立即发布） ----
  app.post('/api/v1/publish-sites/:id/jobs', async (c) => {
    const userId = c.get('userId') as string;
    const siteId = c.req.param('id')!;
    const [site] = await db.select().from(publishSites).where(eq(publishSites.id, siteId)).limit(1);
    if (!site) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(site.projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canManage, 'FORBIDDEN: 仅项目所有者/维护者可触发发布');
    }

    // 同分钟重复触发去重（pg-boss v10 id 必须 UUID，幂等用 singletonKey）
    const key = `publish:${siteId}:manual`;
    await boss.send('publish', { siteId, trigger: 'manual' }, { singletonKey: key, singletonMinutes: 1 });
    await db.insert(activities).values({
      projectId: site.projectId,
      actorId: userId,
      verb: 'publish',
      targetType: 'publish_site',
      targetId: siteId,
      targetTitle: site.slug ?? siteId,
    });
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'publish_site.trigger',
      resourceType: 'publish_site',
      resourceId: siteId,
      meta: { slug: site.slug, trigger: 'manual' },
    });
    return c.json({ ok: true, siteId, queued: true }, 202);
  });

  registerStarterRoutes(app);

  // ---- 发布预览（EXT-PLATFORM Step1 / ADR-P2）：与 worker 发布共用 @ewiki/render ----
  // 同步渲染、不落盘、无缓存（原型级文档量可接受）。docId 缺省渲染项目索引页。
  app.get('/api/v1/projects/:id/publish-preview', async (c) => {
    const projectId = c.req.param('id')!;
    {
      const access = await projectAccess(projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    const docId = c.req.query('docId');
    const templateId = c.req.query('templateId');
    const accent = c.req.query('accent');
    const sidebarSide = c.req.query('sidebarSide') === 'right' ? 'right' : 'left';

    const [project] = await db
      .select({ name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: 'NOT_FOUND' });

    if (docId) {
      const [doc] = await db
        .select({ path: documents.path, title: documents.title, content: documents.content })
        .from(documents)
        .where(and(eq(documents.id, docId), eq(documents.projectId, projectId), isNull(documents.deletedAt)))
        .limit(1);
      if (!doc) throw new HTTPException(404, { message: 'NOT_FOUND' });
      const html = renderDocPage(
        { siteTitle: project.name, docPath: doc.path, docTitle: doc.title ?? doc.path, content: doc.content },
        { templateId, accent, sidebarSide },
      );
      return c.json({ html, scope: 'document' });
    }

    // 索引页预览：文档清单 + 模板 chrome
    const rows = await db
      .select({ path: documents.path, title: documents.title, content: documents.content })
      .from(documents)
      .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)))
      .orderBy(documents.path)
      .limit(50);
    const first = rows[0];
    const html = renderDocPage(
      {
        siteTitle: project.name,
        docPath: first?.path ?? 'index',
        docTitle: first?.title ?? `${project.name} · 文档索引`,
        content:
          first?.content ?? (rows.map((r, i) => `${i + 1}. ${r.title ?? r.path}`).join('\n') || '暂无文档'),
      },
      { templateId, accent, sidebarSide },
    );
    return c.json({ html, scope: 'index' });
  });

  // ---- AI 分类（EXT-PLATFORM Step2 / ADR-P1）：入队 + 建议读取 ----
  // 同分钟重复触发去重（pg-boss v10 id 必须 UUID，幂等用 singletonKey）
  app.post('/api/v1/projects/:id/ai-classify', async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    {
      const access = await projectAccess(projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');
    }
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: 'NOT_FOUND' });

    // 同分钟重复触发去重（pg-boss v10 id 必须 UUID，幂等用 singletonKey，与 sync/publish 同款）
    const key = `${projectId}:${Math.floor(Date.now() / 60_000)}`;
    const jobId = await boss.send('ai-classify', { projectId, startedBy: userId }, { singletonKey: key, singletonMinutes: 1 });
    await db.insert(auditLogs).values({ actorId: userId, action: 'ai_classify.start', resourceType: 'project', resourceId: projectId });
    return c.json({ jobId: jobId ?? '', deduped: jobId === null }, jobId === null ? 200 : 202);
  });

  app.get('/api/v1/projects/:id/ai-classify-runs', async (c) => {
    const projectId = c.req.param('id')!;
    {
      const access = await projectAccess(projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    const rows = await db
      .select()
      .from(aiClassifyRuns)
      .where(eq(aiClassifyRuns.projectId, projectId))
      .orderBy(desc(aiClassifyRuns.createdAt))
      .limit(50);
    return c.json({ items: rows, total: rows.length });
  });

  // ---- 外部导入（EXT-PLATFORM Step2 / ADR-P1）：建任务 + 入队 + 进度查询 ----
  // importer 白名单 = worker 注册表当前支持集合；notion/obsidian 深度连接器后期同接口适配器接入。
  const SUPPORTED_IMPORTERS = ['folder', 'web-crawler'] as const;

  app.post('/api/v1/projects/:id/import-jobs', async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    const body = (await c.req.json()) as { importer?: string; params?: Record<string, unknown> };
    const importer = body.importer ?? '';
    if (!SUPPORTED_IMPORTERS.includes(importer as (typeof SUPPORTED_IMPORTERS)[number])) {
      throw new HTTPException(400, { message: 'NOT_IMPLEMENTED: importer 仅支持 folder / web-crawler' });
    }
    const params = body.params ?? {};
    if (importer === 'folder' && !params.path) throw new HTTPException(400, { message: 'VALIDATION_FAILED: params.path required' });
    if (importer === 'web-crawler' && !params.url) throw new HTTPException(400, { message: 'VALIDATION_FAILED: params.url required' });
    {
      const access = await projectAccess(projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');
    }

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: 'NOT_FOUND' });

    const [job] = await db
      .insert(importJobs)
      .values({ projectId, importer, params })
      .returning();
    await boss.send('import', {
      projectId,
      importJobId: job.id,
      importer,
      startedBy: userId,
      params,
    });
    await db.insert(auditLogs).values({ actorId: userId, action: 'import.start', resourceType: 'project', resourceId: projectId, meta: { importer } });
    return c.json(job, 201);
  });

  app.get('/api/v1/projects/:id/import-jobs', async (c) => {
    const projectId = c.req.param('id')!;
    {
      const access = await projectAccess(projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    const rows = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.projectId, projectId))
      .orderBy(desc(importJobs.createdAt))
      .limit(20);
    return c.json({ items: rows, total: rows.length });
  });

  app.get('/api/v1/import-jobs/:id', async (c) => {
    const [job] = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, c.req.param('id')!))
      .limit(1);
    if (!job) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(job.projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    return c.json(job);
  });

  // ---- 整库导出（设计文档 §4.1-F18）：tar.gz 归档到 NAS exports 目录 ----
  // POST → 建 export_jobs + 入 export 队列；GET /:id 查状态；GET /:id/download 流式下载 tar.gz
  app.post('/api/v1/projects/:id/export-jobs', async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    {
      const access = await projectAccess(projectId, userId, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    const [project] = await db
      .select({ id: projects.id, name: projects.name, deletedAt: projects.deletedAt })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project || project.deletedAt) throw new HTTPException(404, { message: 'NOT_FOUND' });

    const [job] = await db
      .insert(exportJobs)
      .values({ projectId, createdBy: userId })
      .returning({ id: exportJobs.id });

    await boss.send('export', { exportJobId: job!.id, projectId });
    return c.json({ jobId: job!.id, status: 'queued' }, 202);
  });

  app.get('/api/v1/export-jobs/:id', async (c) => {
    const [job] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, c.req.param('id')!))
      .limit(1);
    if (!job) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(job.projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    // done 时附带 downloadUrl 提示前端走 download 端点（浏览器直接 fetch 下载）
    return c.json({
      ...job,
      downloadUrl: job.status === 'done' ? `/api/v1/export-jobs/${job.id}/download` : null,
    });
  });

  app.get('/api/v1/export-jobs/:id/download', async (c) => {
    const [job] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, c.req.param('id')!))
      .limit(1);
    if (!job) throw new HTTPException(404, { message: 'NOT_FOUND' });
    {
      const access = await projectAccess(job.projectId, c.get('userId') as string, c.get('globalRole') as string);
      denyIfNot(access.canRead);
    }
    if (job.status !== 'done' || !job.path) throw new HTTPException(409, { message: 'EXPORT_NOT_READY' });
    const nasRoot = await getNasRoot(config);
    const abs = safeJoin(nasRoot, job.path);
    try {
      await fs.access(abs);
    } catch {
      throw new HTTPException(404, { message: 'EXPORT_FILE_MISSING' });
    }
    const filename = job.path.split('/').pop() ?? `export-${job.id}.tar.gz`;
    const safeName = encodeURIComponent(filename);
    try {
      const buf = await fs.readFile(abs);
      c.header('Content-Type', 'application/gzip');
      c.header('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`);
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Content-Length', String(buf.length));
      return c.body(buf);
    } catch (e) {
      console.error('export download error:', e);
      throw new HTTPException(500, { message: `DOWNLOAD_FAIL: ${(e as Error).message}` });
    }
  });

  // ---- 通知中心（EXT-PLATFORM Step3 / ADR-P3）：个人收件箱读侧 ----
  // 游标分页（createdAt）+ 未读计数；写侧由 worker/server 事件点负责（ADR-P3 事件准入）。
  app.get('/api/v1/notifications', async (c) => {
    const userId = c.get('userId') as string;
    const limit = Math.min(Number(c.req.query('limit') ?? 20) || 20, 50);
    const before = c.req.query('before'); // ISO createdAt 游标
    const unreadOnly = c.req.query('unread') === 'true';

    const conditions = [eq(notifications.userId, userId)];
    if (unreadOnly) conditions.push(isNull(notifications.readAt));
    if (before) conditions.push(lt(notifications.createdAt, new Date(before)));

    const items = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    const [unreadRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

    return c.json({
      items,
      unread: Number(unreadRow?.count ?? 0),
      nextCursor: items.length === limit ? items[items.length - 1]!.createdAt : null,
    });
  });

  // read-all 注册在 :id/read 之前，避免参数路由吞噬字面量路径
  app.post('/api/v1/notifications/read-all', async (c) => {
    const userId = c.get('userId') as string;
    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return c.json({ updated: updated.length });
  });

  app.post('/api/v1/notifications/:id/read', async (c) => {
    const userId = c.get('userId') as string;
    const [updated] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, c.req.param('id')!), eq(notifications.userId, userId))) // 只允许操作本人行
      .returning();
    if (!updated) throw new HTTPException(404, { message: 'NOT_FOUND' });
    return c.json({ ok: true });
  });

  // ---- 开放接口：Caddy on_demand TLS 站点校验（SDD 5.3 / O1 前置） ----
  app.get('/api/v1/open/site-check', async (c) => {
    const domain = c.req.query('domain') ?? '';
    if (!domain) return c.text('', 404);

    const suffix = `.${config.EWIKI_BASE_DOMAIN}`;
    const slug = domain.endsWith(suffix) ? domain.slice(0, -suffix.length) : null;

    const byCustom = await db
      .select({ id: publishSites.id })
      .from(publishSites)
      .where(eq(publishSites.customDomain, domain))
      .limit(1);
    if (byCustom.length > 0) return c.text('ok', 200);

    if (slug) {
      const bySlug = await db
        .select({ id: publishSites.id })
        .from(publishSites)
        .where(eq(publishSites.slug, slug))
        .limit(1);
      if (bySlug.length > 0) return c.text('ok', 200);
    }
    return c.text('', 404);
  });

  // ---- 平台化扩展路由（需求 1-10）：注册/系统管理/存储配置/建库向导/站点公开访问 ----
  registerPlatformRoutes(app, deps);
  registerFileRoutes(app, deps);
}
