// ---------------------------------------------------------------------------
// 平台化扩展路由（本期 10 项基础需求）：
//   1. 系统管理（admin）：用户管理 / 数据库状态 / 存储基础设施 / 审计台账
//   2. 注册 + 注册即得个人示例知识库（LDAP 预留接口）
//   3. 存储配置：GitLab / Gitea 连接配置 CRUD + 连通性验证
//   4. 新建文档库向导：模板或空库 × 云文档或 Git 仓库（自动建仓/关联）
//   5. 文档副作用：NAS 落盘镜像 + Git 自动提交推送（供 routes.ts 文档路由调用）
//   6. 发布站点公开访问：/sites/:slug/*（子路径，无需登录）
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import {
  activities,
  auditLogs,
  documents,
  platformSettings,
  projectMembers,
  projects,
  publishSites,
  refreshTokens,
  sources,
  storageConnections,
  syncJobs,
  users,
} from '../db/schema.js';
import { encryptJson } from '@ewiki/db';
import { safeJoin, siteDir, siteVersionDir } from '@ewiki/storage';
import { db } from '../db/client.js';
import { hashPassword, generateRefreshToken, hashToken, signAccessToken } from '../auth/utils.js';
import { ldapAutoLogin } from '../lib/ldap.js';
import {
  ensureRepo,
  findRepo,
  validateConnection,
  GitHostError,
  type ConnLike,
} from '../lib/git-host.js';
import { commitAndPush, ensureWorkdir, seedWorkdirFiles } from '../lib/git-push.js';
import { getLibraryTemplate, LIBRARY_TEMPLATES, type TemplateDoc } from '../lib/library-templates.js';
import { ensureWritableDir, getNasRoot, getReposRoot, mirrorDoc, NAS_ROOT_SETTING_KEY } from '../lib/nas.js';
import { denyIfNot } from '../lib/permissions.js';
import type { AppDeps } from './app.js';

type C = any; // Hono context（ContextVariableMap 已在 app.ts 扩充）

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function firstHeading(content: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '未命名';
}

async function audit(
  db: AppDeps['db'],
  row: { actorId?: string | null; action: string; resourceType: string; resourceId?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: row.actorId ?? null,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId ?? null,
    meta: row.meta ?? {},
  });
}

// ---------------------------------------------------------------------------
// 文档副作用（NAS 镜像 + Git 自动提交）：由 routes.ts 的文档写路由调用
// ---------------------------------------------------------------------------

export interface DocEffectResult {
  mirrored: boolean;
  mirrorError?: string;
  git: {
    attempted: boolean;
    ok: boolean;
    pushed: boolean;
    noop?: boolean;
    commitHash?: string;
    error?: string;
  };
}

export async function docStorageEffects(
  deps: AppDeps,
  project: { id: string; name: string; ownerId: string },
  docPath: string,
  content: string | null,
  actor: { id: string; name: string; email: string },
): Promise<DocEffectResult> {
  const out: DocEffectResult = { mirrored: false, git: { attempted: false, ok: true, pushed: false } };

  // 1) NAS 镜像（模拟 NAS 盘：文件真实落盘，目录与平台结构一一对应）
  try {
    const nasRoot = await getNasRoot(deps.config);
    const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, project.ownerId)).limit(1);
    await mirrorDoc(nasRoot, { username: owner?.name ?? 'unknown', projectName: project.name, projectId: project.id }, docPath, content);
    out.mirrored = true;
  } catch (e) {
    out.mirrorError = e instanceof Error ? e.message : String(e);
  }

  // 2) Git 自动提交（仅「新建文档库向导」创建的 git 源，configPublic.autoCommit === true）
  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.projectId, project.id), eq(sources.type, 'git'), isNull(sources.deletedAt)))
    .limit(1);
  const pub = (source?.configPublic ?? {}) as Record<string, unknown>;
  if (!source || pub.autoCommit !== true) return out;
  out.git.attempted = true;

  try {
    const conn: ConnLike = {
      kind: String(pub.kind ?? 'gitlab'),
      baseUrl: String(pub.host ?? ''),
      tokenEncrypted: String(source.configEncrypted ?? ''),
      defaultNamespace: (pub.namespace as string) ?? null,
    };
    const login = String(pub.namespace ?? 'owner');
    const { workdir } = await ensureWorkdir(
      getReposRoot(deps.config),
      source.id,
      conn,
      String(pub.url ?? ''),
      login,
      String(source.defaultBranch ?? 'main'),
    );
    const message =
      content === null
        ? `docs(${docPath}): 删除文档（${actor.name}）`
        : `docs(${docPath}): 平台内更新（${actor.name}）`;
    const result = await commitAndPush(
      workdir,
      [{ path: docPath, op: content === null ? 'delete' : 'upsert', content: content ?? undefined }],
      { name: actor.name, email: actor.email },
      message,
    );
    out.git = { attempted: true, ok: result.ok, pushed: result.pushed, noop: result.noop, commitHash: result.commitHash, error: result.error };
    if (result.ok) {
      await db
        .update(sources)
        .set({ status: 'synced', lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(sources.id, source.id));
      await db.insert(syncJobs).values({
        sourceId: source.id,
        trigger: 'push',
        commitHash: result.commitHash ?? null,
        status: 'succeeded',
        stats: { pushed: result.pushed, noop: result.noop ?? false, actor: actor.name },
        finishedAt: new Date(),
      });
      await audit(db, {
        actorId: actor.id,
        action: 'git.auto_commit',
        resourceType: 'source',
        resourceId: source.id,
        meta: { project: project.id, path: docPath, commit: result.commitHash, pushed: result.pushed, noop: result.noop ?? false },
      });
    } else {
      await db
        .update(sources)
        .set({ status: 'error', lastError: result.error?.slice(0, 500) ?? 'push failed', updatedAt: new Date() })
        .where(eq(sources.id, source.id));
      await db.insert(syncJobs).values({
        sourceId: source.id,
        trigger: 'push',
        commitHash: result.commitHash ?? null,
        status: 'failed',
        error: result.error?.slice(0, 500) ?? null,
        finishedAt: new Date(),
      });
      await audit(db, {
        actorId: actor.id,
        action: 'git.push_failed',
        resourceType: 'source',
        resourceId: source.id,
        meta: { project: project.id, path: docPath, error: result.error },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out.git = { attempted: true, ok: false, pushed: false, error: msg };
    await db
      .update(sources)
      .set({ status: 'error', lastError: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(sources.id, source.id));
    await audit(db, {
      actorId: actor.id,
      action: 'git.push_failed',
      resourceType: 'source',
      resourceId: source.id,
      meta: { project: project.id, path: docPath, error: msg },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 主注册函数
// ---------------------------------------------------------------------------

export function registerPlatformRoutes(app: Hono, deps: AppDeps): void {
  const { db, config } = deps;
  const userId = (c: C): string => c.get('userId') as string;
  const actorOf = async (id: string) => {
    const [u] = await db.select({ id: users.id, name: users.name, email: users.email, globalRole: users.globalRole }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) throw new HTTPException(401, { message: 'UNAUTHENTICATED' });
    return u;
  };

  // ---- 注册（需求 3）+ 注册即得个人示例知识库（需求 4） ----
  app.post('/api/v1/auth/register', async (c: C) => {
    const body = (await c.req.json()) as { email?: string; password?: string; name?: string };
    const email = (body.email ?? '').trim().toLowerCase();
    const name = (body.name ?? '').trim();
    const password = body.password ?? '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 邮箱格式不正确' });
    if (password.length < 8) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 密码至少 8 位' });
    if (!name || name.length > 40) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 请填写姓名（40 字以内）' });

    const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (dup) throw new HTTPException(409, { message: 'EMAIL_EXISTS: 该邮箱已注册' });

    const [user] = await db
      .insert(users)
      .values({ email, name, passwordHash: hashPassword(password), globalRole: 'user', status: 'active' })
      .returning();
    await audit(db, { actorId: user.id, action: 'user.register', resourceType: 'user', resourceId: user.id, meta: { email, name } });

    // 自动创建个人示例知识库
    const tpl = getLibraryTemplate('personal-sample')!;
    const [project] = await db
      .insert(projects)
      .values({ name: `${name}的示例知识库`, description: tpl.description, visibility: 'private', template: tpl.id, ownerId: user.id })
      .returning();
    await db.insert(projectMembers).values({ projectId: project.id, userId: user.id, role: 'owner' });
    for (const doc of tpl.docs) {
      await db.insert(documents).values({
        projectId: project.id,
        sourceId: null,
        path: doc.path,
        title: firstHeading(doc.content),
        content: doc.content,
        contentHash: sha256(doc.content),
        status: 'untracked',
        wordCount: doc.content.length,
        updatedBy: user.id,
      });
    }
    try {
      const nasRoot = await getNasRoot(config);
      await mirrorDoc(nasRoot, { username: name, projectName: project.name, projectId: project.id }, '__占位__.md', null).catch(() => undefined);
      for (const doc of tpl.docs) {
        await mirrorDoc(nasRoot, { username: name, projectName: project.name, projectId: project.id }, doc.path, doc.content);
      }
    } catch {
      // NAS 不可写不阻断注册；系统管理页可查存储告警
    }
    await db.insert(activities).values({
      projectId: project.id,
      actorId: user.id,
      verb: 'create',
      targetType: 'project',
      targetId: project.id,
      targetTitle: project.name,
      meta: { sample: true },
    });
    await audit(db, { actorId: user.id, action: 'kb.sample_created', resourceType: 'project', resourceId: project.id, meta: { name: project.name } });

    const accessToken = await signAccessToken(config.JWT_SECRET, { sub: user.id, globalRole: user.globalRole });
    const refreshToken = generateRefreshToken();
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + config.REFRESH_TTL_DAYS * 86_400_000),
    });
    return c.json(
      {
        accessToken,
        refreshToken,
        user: { id: user.id, email: user.email, name: user.name, globalRole: user.globalRole },
        sampleProject: { id: project.id, name: project.name },
      },
      201,
    );
  });

  // ---- LDAP 预留接口（需求 3：本期只开放注册，LDAP 架构预留） ----
  app.get('/api/v1/auth/ldap/status', (c: C) =>
    c.json({
      enabled: false,
      mode: 'reserved',
      message: '企业 LDAP 自动登录注册为预留接口，本期开放邮箱注册；字段 sso_subject 已预留外部主体映射。',
    }),
  );
  app.post('/api/v1/auth/ldap/login', async (c: C) => {
    const body = (await c.req.json()) as { username?: string; password?: string };
    const r = await ldapAutoLogin(body.username ?? '', body.password ?? '');
    if (!r.ok) throw new HTTPException(501, { message: 'LDAP_NOT_ENABLED: ' + (r.message ?? '未启用') });
    return c.json({ ok: true });
  });

  // ---- 文档库模板列表（新建文档库向导，需求 5） ----
  app.get('/api/v1/library-templates', (c: C) =>
    c.json({
      items: [
        { id: 'empty', name: '空文档库', description: '从零开始，不预置任何文档', docCount: 0 },
        ...LIBRARY_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, docCount: t.docs.length })),
      ],
    }),
  );

  // ---- 存储配置（需求 6）：连接配置 CRUD + 验证 ----
  app.get('/api/v1/connections', async (c: C) => {
    const uid = userId(c);
    const me = await actorOf(uid);
    const rows = await db
      .select()
      .from(storageConnections)
      .where(me.globalRole === 'admin' ? undefined : eq(storageConnections.ownerId, uid))
      .orderBy(desc(storageConnections.createdAt));
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        baseUrl: r.baseUrl,
        defaultNamespace: r.defaultNamespace,
        status: r.status,
        lastCheckAt: r.lastCheckAt,
        lastCheckMsg: r.lastCheckMsg,
        createdAt: r.createdAt,
      })),
    });
  });

  app.post('/api/v1/connections', async (c: C) => {
    const uid = userId(c);
    const body = (await c.req.json()) as {
      name?: string;
      kind?: string;
      baseUrl?: string;
      token?: string;
      defaultNamespace?: string;
    };
    const kind = body.kind ?? 'gitlab';
    if (!['gitlab', 'gitea'].includes(kind)) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 目前仅支持 GitLab（及兼容演示 Gitea）连接' });
    if (!body.name?.trim()) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 请填写配置名称' });
    const baseUrl = (body.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(baseUrl)) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 服务地址需以 http(s):// 开头' });
    if (!body.token?.trim()) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 请填写访问令牌（Token）' });

    const conn: ConnLike = { kind, baseUrl, tokenEncrypted: encryptJson({ token: body.token.trim() }), defaultNamespace: body.defaultNamespace ?? null };
    const v = await validateConnection(conn);

    const [row] = await db
      .insert(storageConnections)
      .values({
        ownerId: uid,
        name: body.name.trim(),
        kind,
        baseUrl,
        tokenEncrypted: conn.tokenEncrypted,
        defaultNamespace: body.defaultNamespace?.trim() || null,
        status: v.ok ? 'ok' : 'error',
        lastCheckAt: new Date(),
        lastCheckMsg: v.ok ? `已连接：${v.name}（@${v.login}）` : v.message ?? '验证失败',
      })
      .returning();
    await audit(db, {
      actorId: uid,
      action: v.ok ? 'connection.create' : 'connection.create_failed',
      resourceType: 'storage_connection',
      resourceId: row.id,
      meta: { name: row.name, kind, baseUrl, result: v.ok ? `@${v.login}` : v.message },
    });
    if (!v.ok) {
      return c.json(
        { id: row.id, status: row.status, message: `连接已保存但验证失败：${v.message}` },
        201,
      );
    }
    return c.json({ id: row.id, status: row.status, message: `连接成功：${v.name}（@${v.login}）` }, 201);
  });

  app.post('/api/v1/connections/:id/validate', async (c: C) => {
    const uid = userId(c);
    const [row] = await db.select().from(storageConnections).where(eq(storageConnections.id, c.req.param('id')!)).limit(1);
    if (!row) throw new HTTPException(404, { message: 'NOT_FOUND' });
    denyIfNot(row.ownerId === uid || c.get('globalRole') === 'admin');
    const v = await validateConnection(row);
    await db
      .update(storageConnections)
      .set({
        status: v.ok ? 'ok' : 'error',
        lastCheckAt: new Date(),
        lastCheckMsg: v.ok ? `已连接：${v.name}（@${v.login}）` : v.message ?? '验证失败',
        updatedAt: new Date(),
      })
      .where(eq(storageConnections.id, row.id));
    await audit(db, {
      actorId: uid,
      action: v.ok ? 'connection.validate' : 'connection.validate_failed',
      resourceType: 'storage_connection',
      resourceId: row.id,
      meta: { result: v.ok ? `@${v.login}` : v.message },
    });
    if (!v.ok) throw new HTTPException(400, { message: `验证失败：${v.message}` });
    return c.json({ ok: true, login: v.login, name: v.name, message: `连接成功：${v.name}（@${v.login}）` });
  });

  app.patch('/api/v1/connections/:id', async (c: C) => {
    const uid = userId(c);
    const [row] = await db.select().from(storageConnections).where(eq(storageConnections.id, c.req.param('id')!)).limit(1);
    if (!row) throw new HTTPException(404, { message: 'NOT_FOUND' });
    denyIfNot(row.ownerId === uid || c.get('globalRole') === 'admin');
    const body = (await c.req.json()) as { name?: string; baseUrl?: string; token?: string; defaultNamespace?: string };
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name?.trim()) set.name = body.name.trim();
    if (body.baseUrl?.trim()) set.baseUrl = body.baseUrl.trim().replace(/\/+$/, '');
    if (body.defaultNamespace !== undefined) set.defaultNamespace = body.defaultNamespace?.trim() || null;
    if (body.token?.trim()) {
      set.tokenEncrypted = encryptJson({ token: body.token.trim() });
      set.status = 'unverified';
    }
    await db.update(storageConnections).set(set).where(eq(storageConnections.id, row.id));
    await audit(db, { actorId: uid, action: 'connection.update', resourceType: 'storage_connection', resourceId: row.id, meta: { fields: Object.keys(set) } });
    return c.json({ ok: true });
  });

  app.delete('/api/v1/connections/:id', async (c: C) => {
    const uid = userId(c);
    const [row] = await db.select().from(storageConnections).where(eq(storageConnections.id, c.req.param('id')!)).limit(1);
    if (!row) throw new HTTPException(404, { message: 'NOT_FOUND' });
    denyIfNot(row.ownerId === uid || c.get('globalRole') === 'admin');
    await db.delete(storageConnections).where(eq(storageConnections.id, row.id));
    await audit(db, { actorId: uid, action: 'connection.delete', resourceType: 'storage_connection', resourceId: row.id, meta: { name: row.name } });
    return c.json({ ok: true });
  });

  // ---- 新建文档库向导（需求 5/7）：模板或空库 × 云文档或 Git 仓库 ----
  app.post('/api/v1/projects/with-storage', async (c: C) => {
    const uid = userId(c);
    const me = await actorOf(uid);
    const body = (await c.req.json()) as {
      name?: string;
      description?: string;
      visibility?: 'private' | 'team' | 'public';
      template?: string; // 'empty' | 富模板 id | starter-pack id
      storageType?: 'cloud' | 'git';
      git?: { connectionId?: string; repoName?: string; autoInit?: boolean };
    };
    const name = (body.name ?? '').trim();
    if (!name) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 请填写知识库名称' });
    const storageType = body.storageType ?? 'cloud';
    const templateId = body.template ?? 'empty';

    // 模板解析：富模板 > starter-pack 骨架占位 > 空
    const { STARTER_PACKS } = await import('./routes-starter.js');
    const rich = getLibraryTemplate(templateId);
    const pack = STARTER_PACKS.find((p) => p.id === templateId);
    let docs: TemplateDoc[] = [];
    if (rich) docs = rich.docs;
    else if (pack) {
      docs = pack.tree.map((p) => ({
        path: p,
        content: `# ${path.basename(p).replace(/\.(md|markdown)$/i, '')}\n\n${pack.description}。\n\n> 本文档由模板「${pack.name}」初始化生成，点击编辑开始撰写。`,
      }));
    }

    const [project] = await db
      .insert(projects)
      .values({ name, description: body.description ?? (rich?.description ?? pack?.description ?? null), visibility: body.visibility ?? 'private', template: templateId === 'empty' ? null : templateId, ownerId: uid })
      .returning();
    await db.insert(projectMembers).values({ projectId: project.id, userId: uid, role: 'owner' });
    await audit(db, { actorId: uid, action: 'project.create', resourceType: 'project', resourceId: project.id, meta: { storageType, template: templateId, name } });

    // 文档初始化 + NAS 镜像
    for (const doc of docs) {
      await db.insert(documents).values({
        projectId: project.id,
        sourceId: null,
        path: doc.path,
        title: firstHeading(doc.content),
        content: doc.content,
        contentHash: sha256(doc.content),
        status: 'untracked',
        wordCount: doc.content.length,
        updatedBy: uid,
      });
    }
    const nasRoot = await getNasRoot(config);
    for (const doc of docs) {
      await mirrorDoc(nasRoot, { username: me.name, projectName: project.name, projectId: project.id }, doc.path, doc.content).catch(() => undefined);
    }
    await db.insert(activities).values({
      projectId: project.id,
      actorId: uid,
      verb: 'create',
      targetType: 'project',
      targetId: project.id,
      targetTitle: project.name,
      meta: { storageType, template: templateId, docs: docs.length },
    });

    if (storageType === 'cloud') {
      return c.json({ project, storageType, docs: docs.length }, 201);
    }

    // ---- Git 仓库存储源 ----
    const gitBody = body.git ?? {};
    const repoName = (gitBody.repoName ?? '').trim();
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repoName)) {
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: 仓库名称仅支持字母/数字/._-（1-100 位）' });
    }
    const [conn] = await db.select().from(storageConnections).where(eq(storageConnections.id, gitBody.connectionId ?? '')).limit(1);
    if (!conn) throw new HTTPException(404, { message: 'CONNECTION_NOT_FOUND: 请选择已添加的连接配置' });
    denyIfNot(conn.ownerId === uid || c.get('globalRole') === 'admin', '无权使用该连接配置');

    const autoInit = gitBody.autoInit !== false; // 默认自动初始化
    const connLike: ConnLike = { kind: conn.kind, baseUrl: conn.baseUrl, tokenEncrypted: conn.tokenEncrypted, defaultNamespace: conn.defaultNamespace };
    const v = await validateConnection(connLike);
    if (!v.ok) throw new HTTPException(400, { message: `连接验证失败：${v.message}` });

    let repo;
    let created = false;
    try {
      if (!autoInit) {
        const found = await findRepo(connLike, repoName, v.login!);
        if (!found.found || !found.repo) {
          throw new HTTPException(404, { message: '仓库不存在（自动初始化未开启）：请先在 Git 服务端创建仓库，或开启自动初始化' });
        }
        repo = found.repo;
      } else {
        const r = await ensureRepo(connLike, repoName, v.login!);
        repo = r.repo;
        created = r.created;
      }
    } catch (e) {
      if (e instanceof GitHostError) {
        throw new HTTPException(e.status === 409 ? 409 : 400, { message: `仓库创建/关联失败：${e.message}` });
      }
      throw e;
    }
    if (!repo) throw new HTTPException(500, { message: '仓库信息获取失败' });

    const [source] = await db
      .insert(sources)
      .values({
        projectId: project.id,
        type: 'git',
        name: `${repoName}（Git · ${created ? '新建' : '已关联'}）`,
        configPublic: {
          url: repo.cloneUrl,
          host: conn.baseUrl,
          kind: conn.kind,
          namespace: v.login,
          repoName,
          autoCommit: true,
          connectionId: conn.id,
        },
        configEncrypted: conn.tokenEncrypted,
        defaultBranch: repo.defaultBranch || 'main',
        autoSync: false,
        intervalSeconds: 0,
        status: 'connected',
      })
      .returning();

    // 工作副本准备 + 模板初始化 / 已有内容导入
    let gitMessage = created ? `仓库不存在，已自动初始化并完成首次提交` : '仓库已存在，已关联现有仓库';
    try {
      const { workdir, hadCommits } = await ensureWorkdir(getReposRoot(config), source.id, connLike, repo.cloneUrl, v.login!, repo.defaultBranch || 'main');
      if (!hadCommits) {
        // 空仓库：写入模板并做首次提交推送
        if (docs.length > 0) {
          await seedWorkdirFiles(workdir, docs);
          await commitAndPush(workdir, docs.map((d) => ({ path: d.path, op: 'upsert' as const, content: d.content })), { name: me.name, email: me.email }, 'chore: 初始化知识库模板');
          await audit(db, { actorId: uid, action: 'git.init', resourceType: 'source', resourceId: source.id, meta: { repo: repo.fullPath, docs: docs.length, created } });
        } else {
          await seedWorkdirFiles(workdir, [{ path: 'README.md', content: `# ${name}\n\n由 ewiki 知识平台自动初始化。` }]);
          await commitAndPush(workdir, [{ path: 'README.md', op: 'upsert', content: `# ${name}\n\n由 ewiki 知识平台自动初始化。` }], { name: me.name, email: me.email }, 'chore: 初始化仓库');
          await audit(db, { actorId: uid, action: 'git.init', resourceType: 'source', resourceId: source.id, meta: { repo: repo.fullPath, docs: 0, created } });
        }
      } else if (docs.length > 0) {
        // 已有内容的仓库：保留远端内容，模板文档只在平台侧预置（不覆盖远端）
        gitMessage = '仓库已存在且有内容，已关联；模板文档仅在平台侧预置，未覆盖远端文件';
      }
      await db.update(sources).set({ status: 'connected', lastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(sources.id, source.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.update(sources).set({ status: 'error', lastError: msg.slice(0, 500), updatedAt: new Date() }).where(eq(sources.id, source.id));
      throw new HTTPException(502, { message: `仓库初始化失败：${msg.slice(0, 200)}` });
    }

    return c.json({ project, storageType, docs: docs.length, source, git: { created, repo: repo.fullPath, branch: repo.defaultBranch || 'main', webUrl: repo.webUrl, message: gitMessage } }, 201);
  });

  // ---- 系统管理（需求 1） ----
  const requireAdmin = (c: C): void => {
    if (c.get('globalRole') !== 'admin') throw new HTTPException(403, { message: 'FORBIDDEN: 仅管理员可访问' });
  };

  app.get('/api/v1/admin/users', async (c: C) => {
    requireAdmin(c);
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        globalRole: users.globalRole,
        status: users.status,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        projectCount: sql<number>`(select count(*) from ${projectMembers} pm where pm.user_id = ${users.id})`,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
    return c.json({ items: rows, total: rows.length });
  });

  app.patch('/api/v1/admin/users/:id', async (c: C) => {
    requireAdmin(c);
    const adminId = userId(c);
    const targetId = c.req.param('id')!;
    const body = (await c.req.json()) as { status?: 'active' | 'disabled' };
    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) throw new HTTPException(404, { message: 'NOT_FOUND' });
    if (!body.status || !['active', 'disabled'].includes(body.status)) {
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: status 需为 active | disabled' });
    }
    if (target.globalRole === 'admin' && body.status === 'disabled' && target.id === adminId) {
      throw new HTTPException(400, { message: 'CANNOT_DISABLE_SELF: 不能禁用自己' });
    }
    const [updated] = await db
      .update(users)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(users.id, targetId))
      .returning({ id: users.id, status: users.status });
    if (body.status === 'disabled') {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, targetId));
    }
    await audit(db, { actorId: adminId, action: `admin.user_${body.status === 'active' ? 'enable' : 'disable'}`, resourceType: 'user', resourceId: targetId, meta: { email: target.email } });
    return c.json(updated);
  });

  app.post('/api/v1/admin/users/:id/password', async (c: C) => {
    requireAdmin(c);
    const adminId = userId(c);
    const targetId = c.req.param('id')!;
    const body = (await c.req.json()) as { password?: string };
    if (!body.password || body.password.length < 8) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 新密码至少 8 位' });
    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) throw new HTTPException(404, { message: 'NOT_FOUND' });
    await db.update(users).set({ passwordHash: hashPassword(body.password), updatedAt: new Date() }).where(eq(users.id, targetId));
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, targetId));
    await audit(db, { actorId: adminId, action: 'admin.user_reset_password', resourceType: 'user', resourceId: targetId, meta: { email: target.email } });
    return c.json({ ok: true });
  });

  app.patch('/api/v1/admin/users/:id/role', async (c: C) => {
    requireAdmin(c);
    const adminId = userId(c);
    const targetId = c.req.param('id')!;
    const body = (await c.req.json()) as { globalRole?: 'admin' | 'user' };
    if (!body.globalRole || !['admin', 'user'].includes(body.globalRole)) {
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: globalRole 需为 admin | user' });
    }
    if (targetId === adminId && body.globalRole !== 'admin') {
      throw new HTTPException(400, { message: 'CANNOT_DEMOTE_SELF' });
    }
    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) throw new HTTPException(404, { message: 'NOT_FOUND' });
    await db.update(users).set({ globalRole: body.globalRole, updatedAt: new Date() }).where(eq(users.id, targetId));
    await audit(db, { actorId: adminId, action: 'admin.user_role', resourceType: 'user', resourceId: targetId, meta: { email: target.email, from: target.globalRole, to: body.globalRole } });
    return c.json({ ok: true });
  });

  app.get('/api/v1/admin/system', async (c: C) => {
    requireAdmin(c);
    const [dbInfo] = (await db.execute(
      sql`select version() as version, pg_database_size(current_database()) as bytes`,
    )) as unknown as Array<{ version: string; bytes: string }>;
    const tableRows: Array<{ table: string; rows: number }> = [];
    for (const t of ['users', 'projects', 'documents', 'document_versions', 'sources', 'sync_jobs', 'storage_connections', 'publish_sites', 'publish_jobs', 'audit_logs', 'activities', 'notifications']) {
      const [r] = (await db.execute(sql`select count(*)::int as c from ${sql.raw(`"${t}"`)}`)) as unknown as Array<{ c: number }>;
      tableRows.push({ table: t, rows: Number(r?.c ?? 0) });
    }

    const nasRoot = await getNasRoot(config);
    const reposRoot = getReposRoot(config);
    let nasWritable = true;
    try {
      await ensureWritableDir(nasRoot);
    } catch {
      nasWritable = false;
    }
    const perUser: Array<{ user: string; bytes: number; files: number }> = [];
    try {
      const usersDir = path.join(nasRoot, 'users');
      for (const u of await fs.readdir(usersDir, { withFileTypes: true })) {
        if (!u.isDirectory()) continue;
        let bytes = 0;
        let files = 0;
        const walk = async (dir: string): Promise<void> => {
          for (const e of await fs.readdir(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) await walk(p);
            else {
              const st = await fs.stat(p);
              bytes += st.size;
              files += 1;
            }
          }
        };
        await walk(path.join(usersDir, u.name));
        perUser.push({ user: u.name, bytes, files });
      }
    } catch {
      // users 目录不存在时忽略
    }
    perUser.sort((a, b) => b.bytes - a.bytes);

    let gitVersionStr = 'git 不可用';
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      gitVersionStr = (await promisify(execFile)('git', ['--version'])).stdout.trim();
    } catch {
      /* ignore */
    }

    const [{ c: userCount } = { c: 0 }] = (await db.execute(sql`select count(*)::int as c from users`)) as unknown as Array<{ c: number }>;
    const [{ c: projectCount } = { c: 0 }] = (await db.execute(sql`select count(*)::int as c from projects where deleted_at is null`)) as unknown as Array<{ c: number }>;
    const [{ c: docCount } = { c: 0 }] = (await db.execute(sql`select count(*)::int as c from documents where deleted_at is null`)) as unknown as Array<{ c: number }>;
    const [{ c: siteCount } = { c: 0 }] = (await db.execute(sql`select count(*)::int as c from publish_sites`)) as unknown as Array<{ c: number }>;
    const [{ c: connCount } = { c: 0 }] = (await db.execute(sql`select count(*)::int as c from storage_connections`)) as unknown as Array<{ c: number }>;

    return c.json({
      db: {
        version: dbInfo?.version?.split(' on ')[0] ?? 'PostgreSQL',
        bytes: Number(dbInfo?.bytes ?? 0),
        tables: tableRows,
      },
      storage: {
        nasRoot,
        nasWritable,
        reposRoot,
        perUser: perUser.slice(0, 20),
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        uptimeSeconds: Math.round(process.uptime()),
        git: gitVersionStr,
      },
      counts: {
        users: Number(userCount ?? 0),
        projects: Number(projectCount ?? 0),
        documents: Number(docCount ?? 0),
        publishSites: Number(siteCount ?? 0),
        connections: Number(connCount ?? 0),
      },
    });
  });

  app.post('/api/v1/admin/storage/nas-root', async (c: C) => {
    requireAdmin(c);
    const adminId = userId(c);
    const body = (await c.req.json()) as { path?: string };
    const p = (body.path ?? '').trim();
    if (!path.isAbsolute(p)) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 请填写绝对路径（如 D:/nas/wiki 或 /srv/nas/wiki）' });
    try {
      await ensureWritableDir(p);
    } catch (e) {
      throw new HTTPException(400, { message: `目录不可写：${e instanceof Error ? e.message : String(e)}` });
    }
    const [prev] = await db.select().from(platformSettings).where(eq(platformSettings.key, NAS_ROOT_SETTING_KEY)).limit(1);
    await db
      .insert(platformSettings)
      .values({ key: NAS_ROOT_SETTING_KEY, value: p, updatedBy: adminId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: p, updatedBy: adminId, updatedAt: new Date() } });
    await audit(db, { actorId: adminId, action: 'admin.storage_nas_change', resourceType: 'platform_setting', resourceId: null, meta: { from: prev?.value ?? null, to: p } });
    return c.json({ ok: true, root: p });
  });

  app.get('/api/v1/admin/audit', async (c: C) => {
    requireAdmin(c);
    const q = c.req.query();
    const limit = Math.min(Number(q.limit ?? 200) || 200, 500);
    const conds = [];
    if (q.action) conds.push(ilike(auditLogs.action, `%${q.action}%`));
    if (q.actor) conds.push(or(ilike(users.name, `%${q.actor}%`), ilike(users.email, `%${q.actor}%`)));
    if (q.from) conds.push(gte(auditLogs.createdAt, new Date(q.from)));
    if (q.to) conds.push(lte(auditLogs.createdAt, new Date(q.to)));
    const rows = await db
      .select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        ip: auditLogs.ip,
        meta: auditLogs.meta,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
    return c.json({ items: rows, total: rows.length });
  });

  // ---- 发布站点公开访问（需求 10）：/sites/:slug/*，无需登录 ----
  async function resolveSiteDir(slug: string): Promise<string | null> {
    const [row] = await db
      .select({ site: publishSites, ownerName: users.name })
      .from(publishSites)
      .innerJoin(projects, eq(publishSites.projectId, projects.id))
      .innerJoin(users, eq(projects.ownerId, users.id))
      .where(eq(publishSites.slug, slug))
      .limit(1);
    if (!row) return null;
    const nasRoot = await getNasRoot(config);
    const base = siteDir(nasRoot, row.ownerName, slug);
    try {
      const cur = JSON.parse(await fs.readFile(path.join(base, 'current.json'), 'utf8')) as { version?: number };
      const v = cur.version ?? 1;
      return siteVersionDir(nasRoot, row.ownerName, slug, v);
    } catch {
      return null;
    }
  }

  function notFoundPage(): Response {
    return new Response(
      '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;color:#555"><div style="text-align:center"><div style="font-size:44px;margin-bottom:8px">404</div><div>站点不存在或尚未发布</div></div></body>',
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  async function serveSiteFile(c: C, slugRaw: string, relRaw: string): Promise<Response> {
    let slug = slugRaw;
    let rel = relRaw;
    try {
      slug = decodeURIComponent(slugRaw);
      rel = decodeURIComponent(relRaw || '');
    } catch {
      /* keep raw */
    }
    const vdir = await resolveSiteDir(slug);
    if (!vdir) return notFoundPage();
    let relPath = rel.replace(/^\/+/, '');
    if (!relPath || relPath.endsWith('/')) relPath += 'index.html';
    let abs: string;
    try {
      abs = safeJoin(vdir, relPath);
    } catch {
      return notFoundPage();
    }
    const st = await fs.stat(abs).catch(() => null);
    if (!st) return notFoundPage();
    if (st.isDirectory()) abs = path.join(abs, 'index.html');
    const buf = await fs.readFile(abs).catch(() => null);
    if (!buf) return notFoundPage();
    const ext = path.extname(abs).toLowerCase();
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      },
    });
  }

  app.get('/sites/:slug', (c: C) => serveSiteFile(c, c.req.param('slug')!, 'index.html'));
  app.get('/sites/:slug/*', (c: C) => {
    const slug = c.req.param('slug')!;
    const rest = c.req.path.replace(new RegExp(`^/sites/${encodeURIComponent(slug)}/?`), '');
    return serveSiteFile(c, slug, rest);
  });
}
