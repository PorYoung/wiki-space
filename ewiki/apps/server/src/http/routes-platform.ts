// ---------------------------------------------------------------------------
// 平台化扩展路由（本期 10 项基础需求）：
//   1. 系统管理（admin）：用户管理 / 数据库状态 / 存储基础设施 / 审计台账
//   2. 注册 + 注册即得个人示例知识库（LDAP 预留接口）
//   3. 存储源：GitLab / Gitea 连接配置 CRUD + 连通性验证
//   4. 新建文档库向导：模板列表（Git 开通已收敛进 POST /api/v1/projects，见 routes.ts）
//   5. 文档副作用：NAS 落盘镜像 + Git 自动提交推送（供 routes.ts 文档路由调用）
//   6. 发布站点公开访问：/sites/:slug/*（子路径，无需登录）
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  activities,
  auditLogs,
  documents,
  gitPendingOps,
  platformSettings,
  projectMembers,
  projects,
  publishSites,
  refreshTokens,
  storageConnections,
  syncJobs,
  users,
} from '../db/schema.js';
import { encryptJson } from '@ewiki/db';
import { safeJoin, siteDir, siteVersionDir } from '@ewiki/storage';
import { db, sql as pgSql } from '../db/client.js';
import { hashPassword, generateRefreshToken, hashToken, signAccessToken } from '../auth/utils.js';
import { ldapAutoLogin } from '../lib/ldap.js';
import { commitAndPush, ensureWorkdir, validateConnection, type ConnLike, type PushChange } from '@ewiki/git';
import { enqueueGitFlush } from '@ewiki/shared';
import { getLibraryTemplate, LIBRARY_TEMPLATES } from '../lib/library-templates.js';
import { ensureWritableDir, getNasRoot, getReposRoot, mirrorDoc, moveMirror, NAS_ROOT_SETTING_KEY } from '../lib/nas.js';
import { denyIfNot } from '../lib/permissions.js';
import { PgLockService } from '../adapters/pg/lock.js';
import { getSearchSettings } from '../lib/search-settings.js';
import type { Context } from 'hono';
import type { AppDeps } from './app.js';

type C = Context; // ContextVariableMap 已在 app.ts 扩充（userId/globalRole/requestId）

// §4.1-F17 发布站点静态服务 MIME 白名单：覆盖 Markdown 相对引用的图片/二进制产物，
// 以及页面自身 html/css/js/json。svg 虽属活动内容，但发布产物已脱离原始库上下文
// （worker 渲染时相对引用已改写为 assets/，站点为离线静态制品，非原始 raw 接口）。
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  // §5.5 链接：Markdown 相对引用图片（worker 发布时经 extractDocLinks 收集并复制进 assets/）
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  // §4.1-F17：PDF 文档作为二进制资源发布（用户 markdown 相对引用 pdf 也能正确响应 Content-Type）
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
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
    /** coalesced 模式：提交已转交 worker git-flush 聚合，本请求不等待 push */
    deferred?: boolean;
    pendingOps?: number;
    etaSeconds?: number;
    commitHash?: string;
    message?: string;
    error?: string;
  };
}

// 工作副本互斥（GIT-COMMIT-COALESCING-DESIGN §11）：inline 分支与 worker 的
// flush/sync 共用同一把 PG advisory lock，消除「并发 commit 同一工作副本」与
// 「sync pull 的 reset --hard 撞上提交」两个竞态。
const gitWorkdirLock = new PgLockService(pgSql);

/** 批量存储副作用操作（单文档保存/删除是 N=1 特例；移动/重命名 → move；文件夹级联 → 多个 move） */
export interface DocStorageOp {
  op: 'upsert' | 'delete' | 'move';
  /** 目标路径（move 为移动后的新路径） */
  path: string;
  /** move 专用：移动前旧路径 */
  fromPath?: string;
  /** upsert/move 携带的文档内容（move 场景用于镜像源缺失时的补偿写入与 Git 落盘） */
  content?: string | null;
  /** 二进制载体（P2）：kind='binary' 时 content 可空，NAS 写 buffer，Git 一期跳过 */
  kind?: 'text' | 'binary';
  buffer?: Buffer;
  mime?: string | null;
  storageRef?: string | null;
  /**
   * 平台库内文档行 ID。提供时：推送成功回填 status='synced'（upsert/move）；
   * delete 为软删除，列表不再展示，无需回填。
   */
  documentId?: string;
}

/**
 * 批量副作用：一次调用 = 一批 NAS 镜像动作 + 一次 Git 提交动作。
 * Git 部分按 GIT_PUSH_MODE 分流（GIT-COMMIT-COALESCING-DESIGN §6）：
 *   - coalesced（默认）：只向 git_pending_ops 记台账 + 防抖入队，worker『git-flush』
 *     在窗口关闭时把窗口内操作折叠为单提交；保存请求不等待 push。
 *   - inline（kill-switch）：既有同步 add/commit/push 链路，包裹工作副本锁。
 * 单文档保存/删除路由也收敛到本函数（docStorageEffects 为其 N=1 薄包装）。
 */
export async function docStorageEffectsBatch(
  deps: AppDeps,
  project: { id: string; name: string; ownerId: string },
  ops: DocStorageOp[],
  actor: { id: string; name: string; email: string },
  message: string,
  userNote?: string | null,
): Promise<DocEffectResult> {
  const out: DocEffectResult = { mirrored: false, git: { attempted: false, ok: true, pushed: false } };

  // 1) NAS 镜像（模拟 NAS 盘：文件真实落盘，目录与平台结构一一对应）
  try {
    const nasRoot = await getNasRoot(deps.config);
    const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, project.ownerId)).limit(1);
    const target = { username: owner?.name ?? 'unknown', projectName: project.name, projectId: project.id };
    for (const op of ops) {
      if (op.op === 'delete') {
        await mirrorDoc(nasRoot, target, op.path, null);
      } else if (op.op === 'upsert') {
        if (op.kind === 'binary') {
          if (!op.buffer) throw new Error('BINARY_BUFFER_REQUIRED');
          await mirrorDoc(nasRoot, target, op.path, { kind: 'binary', buffer: op.buffer });
        } else {
          await mirrorDoc(nasRoot, target, op.path, { kind: 'text', content: op.content ?? '' });
        }
      } else {
        // move：优先原样搬移镜像（保留磁盘上可能存在的最新内容），源文件缺失时按库内内容补偿写入
        const moved = await moveMirror(nasRoot, target, op.fromPath ?? op.path, op.path);
        if (!moved) {
          if (op.kind === 'binary' && op.buffer) {
            await mirrorDoc(nasRoot, target, op.path, { kind: 'binary', buffer: op.buffer });
          } else if (op.kind !== 'binary' && op.content != null) {
            await mirrorDoc(nasRoot, target, op.path, { kind: 'text', content: op.content });
          }
        }
      }
    }
    out.mirrored = true;
  } catch (e) {
    out.mirrorError = e instanceof Error ? e.message : String(e);
  }

  // 2) Git 自动提交（仅 Git 存储后端，且 storageConfig.autoCommit === true）
  const [projRow] = await db
    .select({
      id: projects.id,
      storageKind: projects.storageKind,
      storageConfig: projects.storageConfig,
      storageConnectionId: projects.storageConnectionId,
      defaultBranch: projects.defaultBranch,
    })
    .from(projects)
    .where(and(eq(projects.id, project.id), isNull(projects.deletedAt)))
    .limit(1);
  const cfg = ((projRow?.storageConfig as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  if (!projRow || projRow.storageKind !== 'git' || cfg.autoCommit !== true || !projRow.storageConnectionId) {
    return out;
  }
  out.git.attempted = true;

  // coalesced 模式：git 部分转交 worker 聚合（NAS 镜像已在上方同步落盘）
  if (deps.config.GIT_PUSH_MODE !== 'inline') {
    return commitThroughPendingOps(deps, project.id, ops, actor, userNote ?? null, out);
  }

  const [connRow] = await db
    .select({ tokenEncrypted: storageConnections.tokenEncrypted })
    .from(storageConnections)
    .where(eq(storageConnections.id, projRow.storageConnectionId))
    .limit(1);
  if (!connRow) {
    out.git = { attempted: true, ok: false, pushed: false, error: '存储连接配置已删除' };
    return out;
  }

  // 操作 → Git 写盘指令：move 展开为「删除旧路径 + 写入新路径」双指令，单提交内完成改名。
  // 二进制一期不入 Git：binary op 全部跳过；过滤后无文本变更则直接返回（不建工作副本）。
  const changes: PushChange[] = [];
  for (const op of ops) {
    if ((op.kind ?? 'text') === 'binary') continue;
    if (op.op === 'upsert') changes.push({ path: op.path, op: 'upsert', content: op.content ?? '' });
    else if (op.op === 'delete') changes.push({ path: op.path, op: 'delete' });
    else {
      changes.push({ path: op.fromPath ?? op.path, op: 'delete' });
      changes.push({ path: op.path, op: 'upsert', content: op.content ?? '' });
    }
  }
  if (changes.length === 0) return out;

  try {
    const conn: ConnLike = {
      kind: String(cfg.kind ?? 'gitlab'),
      baseUrl: String(cfg.host ?? ''),
      tokenEncrypted: connRow.tokenEncrypted,
      defaultNamespace: (cfg.namespace as string) ?? null,
    };
    const login = String(cfg.namespace ?? 'owner');
    // inline 分支同样持有工作副本锁：与 worker flush/sync 互斥（§11 锁矩阵）
    const result = await gitWorkdirLock.withLock(`git-workdir:${project.id}`, async () => {
      const { workdir } = await ensureWorkdir(
        getReposRoot(deps.config),
        project.id,
        conn,
        String(cfg.url ?? ''),
        login,
        String(projRow.defaultBranch ?? 'main'),
      );
      return commitAndPush(workdir, changes, { name: actor.name, email: actor.email }, message);
    });
    out.git = { attempted: true, ok: result.ok, pushed: result.pushed, noop: result.noop, commitHash: result.commitHash, message, error: result.error };
    if (result.ok) {
      await db
        .update(projects)
        .set({ storageStatus: 'synced', lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      // 文档状态机闭环：真正提交并推送成功后，受影响的在线文档（upsert/move）回到 synced。
      // noop（无差异）说明远端本就一致，同样应纠正为 synced。仅按 ID 收敛，不误伤同库其它文档。
      const syncedIds = [
        ...new Set(
          ops
            .filter(
              (o) =>
                (o.op === 'upsert' || o.op === 'move') &&
                o.documentId &&
                (o.kind ?? 'text') === 'text',
            )
            .map((o) => o.documentId as string),
        ),
      ];
      if (syncedIds.length > 0) {
        await db
          .update(documents)
          .set({ status: 'synced', updatedAt: new Date() })
          .where(and(inArray(documents.id, syncedIds), isNull(documents.deletedAt)));
      }
      await db.insert(syncJobs).values({
        projectId: project.id,
        trigger: 'push',
        commitHash: result.commitHash ?? null,
        status: 'succeeded',
        stats: { pushed: result.pushed, noop: result.noop ?? false, actor: actor.name, paths: ops.length },
        finishedAt: new Date(),
      });
      await audit(db, {
        actorId: actor.id,
        action: 'git.auto_commit',
        resourceType: 'project',
        resourceId: project.id,
        meta: { path: ops[0]?.path, count: ops.length, commit: result.commitHash, pushed: result.pushed, noop: result.noop ?? false },
      });
    } else {
      await db
        .update(projects)
        .set({ storageStatus: 'error', lastError: result.error?.slice(0, 500) ?? 'push failed', updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      await db.insert(syncJobs).values({
        projectId: project.id,
        trigger: 'push',
        commitHash: result.commitHash ?? null,
        status: 'failed',
        error: result.error?.slice(0, 500) ?? null,
        finishedAt: new Date(),
      });
      await audit(db, {
        actorId: actor.id,
        action: 'git.push_failed',
        resourceType: 'project',
        resourceId: project.id,
        meta: { path: ops[0]?.path, count: ops.length, error: result.error },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out.git = { attempted: true, ok: false, pushed: false, error: msg };
    await db
      .update(projects)
      .set({ storageStatus: 'error', lastError: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(projects.id, project.id));
    await audit(db, {
      actorId: actor.id,
      action: 'git.push_failed',
      resourceType: 'project',
      resourceId: project.id,
      meta: { path: ops[0]?.path, count: ops.length, error: msg },
    });
  }
  return out;
}

/**
 * coalesced 提交路径（GIT-COMMIT-COALESCING-DESIGN §6/§7）：git 部分不在请求内落提交，
 * 向 git_pending_ops 记台账 + 防抖入队即返回；窗口内后续操作由 singletonKey 去重，
 * worker『git-flush』关闭窗口时折叠为单提交（latest-wins，内容以 documents 表为准）。
 */
async function commitThroughPendingOps(
  deps: AppDeps,
  projectId: string,
  ops: DocStorageOp[],
  actor: { id: string; name: string; email: string },
  userNote: string | null,
  out: DocEffectResult,
): Promise<DocEffectResult> {
  const rows = ops.map((op, i) => ({
    projectId,
    documentId: op.documentId ?? null,
    path: op.path,
    op: op.op,
    fromPath: op.fromPath ?? null,
    kind: op.kind ?? 'text',
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    // 批量路由的 message 是自动模板（inline 时进提交 subject）；用户备注只随首个操作入台账
    message: i === 0 ? userNote : null,
  }));
  if (rows.length === 0) return out;
  try {
    await db.insert(gitPendingOps).values(rows);
    await enqueueGitFlush(deps.boss, projectId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 台账/入队失败不阻断保存（DB 真源已落）：如实回报 git 侧异常，夜间 sync 可对账兜底
    out.git = { attempted: true, ok: false, pushed: false, deferred: true, error: `待提交台账写入失败：${msg}` };
    return out;
  }
  out.git = {
    attempted: true,
    ok: true,
    pushed: false,
    deferred: true,
    pendingOps: rows.length,
    etaSeconds: deps.config.GIT_FLUSH_MAX_WAIT_SECONDS,
  };
  return out;
}

/** 单文档副作用（保存/删除）：docStorageEffectsBatch 的 N=1 薄包装，保持既有调用语义不变 */
export async function docStorageEffects(
  deps: AppDeps,
  project: { id: string; name: string; ownerId: string },
  docPath: string,
  content: string | null,
  actor: { id: string; name: string; email: string },
  documentId?: string,
  userNote?: string | null,
): Promise<DocEffectResult> {
  const message =
    content === null
      ? `docs(${docPath}): 删除文档（${actor.name}）`
      : `docs(${docPath}): 平台内更新（${actor.name}）`;
  return docStorageEffectsBatch(
    deps,
    project,
    [{ op: content === null ? 'delete' : 'upsert', path: docPath, content, documentId }],
    actor,
    message,
    userNote,
  );
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
        path: doc.path,
        title: firstHeading(doc.content),
        content: doc.content,
        kind: 'text',
        ext: 'md',
        mime: 'text/markdown',
        size: Buffer.byteLength(doc.content, 'utf8'),
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

    const accessToken = await signAccessToken(config.JWT_SECRET, { sub: user.id, globalRole: user.globalRole, name: user.name });
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
    // 仅验证通过才落库：避免保存「验证失败」的脏配置，逼用户先改正确（修复「测试失败也保存」）
    if (!v.ok) {
      return c.json({ status: 'error', message: `连接验证失败，未保存：${v.message}` }, 400);
    }
    const [row] = await db
      .insert(storageConnections)
      .values({
        ownerId: uid,
        name: body.name.trim(),
        kind,
        baseUrl,
        tokenEncrypted: conn.tokenEncrypted,
        defaultNamespace: body.defaultNamespace?.trim() || null,
        status: 'ok',
        lastCheckAt: new Date(),
        lastCheckMsg: `已连接：${v.name}（@${v.login}）`,
      })
      .returning();
    await audit(db, {
      actorId: uid,
      action: 'connection.create',
      resourceType: 'storage_connection',
      resourceId: row.id,
      meta: { name: row.name, kind, baseUrl, result: `@${v.login}` },
    });
    return c.json({ id: row.id, status: row.status, message: `连接成功：${v.name}（@${v.login}）` }, 201);
  });

  // 仅验证连接、不落库，供「测试连接」按钮使用
  app.post('/api/v1/connections/test', async (c: C) => {
    const body = (await c.req.json()) as {
      kind?: string;
      baseUrl?: string;
      token?: string;
      defaultNamespace?: string;
    };
    const kind = body.kind ?? 'gitlab';
    if (!['gitlab', 'gitea'].includes(kind)) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 目前仅支持 GitLab（及兼容演示 Gitea）连接' });
    const baseUrl = (body.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(baseUrl)) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 服务地址需以 http(s):// 开头' });
    if (!body.token?.trim()) throw new HTTPException(400, { message: 'VALIDATION_FAILED: 请填写访问令牌（Token）' });
    const conn: ConnLike = { kind, baseUrl, tokenEncrypted: encryptJson({ token: body.token.trim() }), defaultNamespace: body.defaultNamespace ?? null };
    const v = await validateConnection(conn);
    if (!v.ok) throw new HTTPException(400, { message: `验证失败：${v.message}` });
    return c.json({ ok: true, login: v.login, name: v.name, message: `连接成功：${v.name}（@${v.login}）` });
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
    const body = (await c.req.json()) as { name?: string; kind?: string; baseUrl?: string; token?: string; defaultNamespace?: string };
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name?.trim()) set.name = body.name.trim();
    if (body.kind && ['gitlab', 'gitea'].includes(body.kind)) set.kind = body.kind;
    if (body.baseUrl?.trim()) set.baseUrl = body.baseUrl.trim().replace(/\/+$/, '');
    if (body.defaultNamespace !== undefined) set.defaultNamespace = body.defaultNamespace?.trim() || null;
    if (body.token?.trim()) {
      set.tokenEncrypted = encryptJson({ token: body.token.trim() });
      set.status = 'unverified';
    }
    await db.update(storageConnections).set(set).where(eq(storageConnections.id, row.id));

    // 任一影响连通性的字段变更后，重新验证以刷新状态与提示
    if (body.kind || body.baseUrl?.trim() || body.token?.trim() || body.defaultNamespace !== undefined) {
      const [updated] = await db.select().from(storageConnections).where(eq(storageConnections.id, row.id)).limit(1);
      const v = await validateConnection(updated);
      await db
        .update(storageConnections)
        .set({
          status: v.ok ? 'ok' : 'error',
          lastCheckAt: new Date(),
          lastCheckMsg: v.ok ? `已连接：${v.name}（@${v.login}）` : v.message ?? '验证失败',
          updatedAt: new Date(),
        })
        .where(eq(storageConnections.id, row.id));
    }

    await audit(db, { actorId: uid, action: 'connection.update', resourceType: 'storage_connection', resourceId: row.id, meta: { fields: Object.keys(set) } });
    return c.json({ ok: true });
  });

  app.delete('/api/v1/connections/:id', async (c: C) => {
    const uid = userId(c);
    const [row] = await db.select().from(storageConnections).where(eq(storageConnections.id, c.req.param('id')!)).limit(1);
    if (!row) throw new HTTPException(404, { message: 'NOT_FOUND' });
    denyIfNot(row.ownerId === uid || c.get('globalRole') === 'admin');
    const referenced = await db
      .select({ projectId: projects.id })
      .from(projects)
      .where(and(eq(projects.storageConnectionId, row.id), isNull(projects.deletedAt)));
    if (referenced.length > 0) {
      await audit(db, {
        actorId: uid,
        action: 'connection.delete_blocked',
        resourceType: 'storage_connection',
        resourceId: row.id,
        meta: { projectIds: referenced.map((r) => r.projectId) },
      });
      return c.json(
        {
          code: 'CONNECTION_IN_USE',
          message: '该存储源仍被文档库引用，无法删除',
          projectIds: referenced.map((r) => r.projectId),
        },
        409,
      );
    }
    await db.delete(storageConnections).where(eq(storageConnections.id, row.id));
    await audit(db, { actorId: uid, action: 'connection.delete', resourceType: 'storage_connection', resourceId: row.id, meta: { name: row.name } });
    return c.json({ ok: true });
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
    for (const t of ['users', 'projects', 'documents', 'document_versions', 'sync_jobs', 'storage_connections', 'publish_sites', 'publish_jobs', 'audit_logs', 'activities', 'notifications']) {
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

    // ---- 检索统计（SEARCH-VECTOR-DESIGN M3）：chunk 规模 / 向量库数 / 待嵌入缺口 / 分词配置 ----
    const [searchStats] = (
      (await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM document_chunks) AS total_chunks,
          (SELECT count(*)::int FROM document_chunks WHERE embedding IS NULL) AS pending_chunks,
          (SELECT count(*)::int FROM projects WHERE deleted_at IS NULL AND search_config->>'vector' = 'true') AS vector_projects,
          (SELECT count(*)::int FROM index_builds WHERE status IN ('pending','running')) AS active_builds,
          (SELECT coalesce(sum(failed_docs), 0)::int FROM index_builds WHERE status = 'done') AS build_failed_docs,
          EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese_zh'
                  AND cfgparser = (SELECT oid FROM pg_ts_parser WHERE prsname = 'zhparser')) AS zhparser
      `)) as unknown as Array<{
        total_chunks: number;
        pending_chunks: number;
        vector_projects: number;
        active_builds: number;
        build_failed_docs: number;
        zhparser: boolean;
      }>
    ) ?? {
      total_chunks: 0,
      pending_chunks: 0,
      vector_projects: 0,
      active_builds: 0,
      build_failed_docs: 0,
      zhparser: false,
    };

    // 生效配置（env ⊕ 管理端运行时覆盖），与查询/索引侧同源；env-only 会让运行时配置"看起来没生效"
    const searchRuntime = await getSearchSettings(db, process.env);
    return c.json({
      db: {
        version: dbInfo?.version?.split(' on ')[0] ?? 'PostgreSQL',
        bytes: Number(dbInfo?.bytes ?? 0),
        tables: tableRows,
      },
      search: {
        ftsConfig: config.SEARCH_FTS_CONFIG,
        zhparser: searchStats?.zhparser ?? false,
        embeddingProvider: searchRuntime.provider,
        embeddingModel: searchRuntime.model,
        embeddingDim: config.EMBEDDING_DIM,
        totalChunks: Number(searchStats?.total_chunks ?? 0),
        pendingChunks: Number(searchStats?.pending_chunks ?? 0),
        vectorProjects: Number(searchStats?.vector_projects ?? 0),
        activeBuilds: Number(searchStats?.active_builds ?? 0),
        buildFailedDocs: Number(searchStats?.build_failed_docs ?? 0),
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

  // ---- 发布页 vendor 资源（同源，内网/气隙可用）：KaTeX 样式/字体 + mermaid ESM ----
  // 渲染管线按需在发布页注入 /assets/vendor/{katex,mermaid}/...，此处自 node_modules dist 目录供出。
  const requireResolve = createRequire(import.meta.url);
  const VENDOR_DIST: Record<string, string> = {};
  for (const pkg of ['katex', 'mermaid']) {
    try {
      VENDOR_DIST[pkg] = path.join(path.dirname(requireResolve.resolve(`${pkg}/package.json`)), 'dist');
    } catch {
      /* 包缺失时该 vendor 路由恒 404 */
    }
  }
  const VENDOR_MIME: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
  };
  const serveVendor = (pkg: string) => async (c: C): Promise<Response> => {
    const dist = VENDOR_DIST[pkg];
    if (!dist) return new Response(null, { status: 404 });
    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path.slice(`/assets/vendor/${pkg}/`.length));
    } catch {
      return new Response(null, { status: 404 });
    }
    let abs: string;
    try {
      abs = safeJoin(dist, rel);
    } catch {
      return new Response(null, { status: 404 });
    }
    const buf = await fs.readFile(abs).catch(() => null);
    if (!buf) return new Response(null, { status: 404 });
    const mime = VENDOR_MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
    return new Response(buf, { status: 200, headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' } });
  };
  app.get('/assets/vendor/katex/*', serveVendor('katex'));
  app.get('/assets/vendor/mermaid/*', serveVendor('mermaid'));
}
