// ---------------------------------------------------------------------------
// P2 二进制文件链路（文件管理重构 §4.3 / §5.2 / §5.4）：
//   POST /api/v1/projects/:id/files/upload-session  预检（大小/路径冲突）
//   POST /api/v1/projects/:id/files/upload          multipart 上传（error/replace/rename）
//   GET  /api/v1/documents/:id/raw                  原始内容（Bearer 或 HMAC query 签名）
//   POST /api/v1/documents/:id/versions/upload      multipart 替换上传（新版本）
//
// raw 路由由 app.ts 在全局 Bearer 守卫「之前」挂载，处理器内自验 Bearer/签名；
// 其余三条在 routes.ts 的守卫之后挂载，自动受保护。
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import path from 'node:path';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { basenameOf, extOf, resolveFileType } from '@ewiki/shared';
import { LocalBlobStore, resolveRoot, type BlobStore } from '@ewiki/storage';
import type { AppDeps } from './app.js';
import { db } from '../db/client.js';
import {
  activities,
  documentVersions,
  documents,
  projects,
  users,
} from '../db/schema.js';
import { verifyAccessToken } from '../auth/utils.js';
import { projectAccess, denyIfNot } from '../lib/permissions.js';
import { docStorageEffectsBatch } from './routes-platform.js';
import { buildRawUrl, verifyRawToken } from '../lib/raw-sign.js';
import { effectiveMime } from '../lib/sniff.js';

const API = '/api/v1';

/** 与 routes.ts normalizeTreePath 同规则，额外拒绝任意位置的 .git / .well-known 段 */
function normalizeUploadPath(raw: unknown): string | null {
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
    if (seg === '.git' || seg === '.well-known') return null;
    if (seg.length > 128) return null;
    if (/[<>:"|?*\u0000-\u001f]/.test(seg)) return null;
    if (!(dotFile)) {
      if (/[ .]$/.test(seg) || seg === '.') return null;
    }
    if (isLast && !dotFile && !extOf(seg)) return null;
  }
  return p;
}

function titleFromPath(p: string): string {
  const base = basenameOf(p);
  const ext = extOf(base);
  const name = ext ? base.slice(0, -(ext.length + 1)) : base;
  return name || base;
}

let blobStoreSingleton: BlobStore | null = null;
function getBlobStore(deps: AppDeps): BlobStore {
  if (!blobStoreSingleton) {
    const root = deps.config.BLOB_LOCAL_ROOT?.trim()
      ? path.resolve(deps.config.BLOB_LOCAL_ROOT.trim())
      : path.join(resolveRoot(deps.config.FS_NAS_ROOT), 'blobs');
    blobStoreSingleton = new LocalBlobStore(root);
  }
  return blobStoreSingleton;
}

async function actorOf(userId: string) {
  const [u] = await db
    .select({ id: users.id, name: users.name, email: users.email, globalRole: users.globalRole, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw new HTTPException(401, { message: 'UNAUTHENTICATED' });
  if (u.status === 'disabled') throw new HTTPException(403, { message: 'ACCOUNT_DISABLED' });
  return u;
}

async function projectRow(projectId: string) {
  const [p] = await db
    .select({ id: projects.id, name: projects.name, ownerId: projects.ownerId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!p) throw new HTTPException(404, { message: 'NOT_FOUND' });
  return p;
}

/** 全量唯一索引（含软删行）占用查询：返回占用人（活行/软删行） */
async function findPathOccupant(projectId: string, p: string, excludeId?: string) {
  const [row] = await db
    .select({ id: documents.id, deletedAt: documents.deletedAt })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        eq(documents.path, p),
        excludeId ? ne(documents.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** rename 策略：在扩展名前持续追加 -1/-2…直到不撞全量唯一索引（含软删行） */
async function resolveRenamePath(projectId: string, p: string): Promise<string> {
  const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
  const base = basenameOf(p);
  const ext = extOf(base);
  const stem = ext ? base.slice(0, -(ext.length + 1)) : base;
  for (let i = 1; i < 10000; i++) {
    const candidate = `${dir}${stem}-${i}${ext ? `.${ext}` : ''}`;
    if (!(await findPathOccupant(projectId, candidate))) return candidate;
  }
  throw new HTTPException(409, { message: 'RENAME_EXHAUSTED: 无法生成不冲突的文件名' });
}

async function broadcast(projectId: string, payload: Record<string, unknown>): Promise<void> {
  await db.execute(sql`select pg_notify(${sql.raw(`'ewiki_events'`)}, ${JSON.stringify({
    channel: 'sync',
    payload: { room: `project:${projectId}`, event: 'document.updated', payload },
  })})`);
}

type DbLike = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

async function nextVersionNo(documentId: string, tx: DbLike = db): Promise<number> {
  const [row] = await tx
    .select({ v: sql<string>`coalesce(max(${documentVersions.versionNo}), 0)` })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));
  return Number(row?.v ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// 受保护路由（在 routes.ts 的 Bearer 守卫之后注册）
// ---------------------------------------------------------------------------

export function registerFileRoutes(app: Hono, deps: AppDeps): void {
  const { config } = deps;
  const store = getBlobStore(deps);

  // ---- 上传预检：逐项 accept / conflict / reject ----
  app.post(`${API}/projects/:id/files/upload-session`, async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    const globalRole = c.get('globalRole') as string;
    const access = await projectAccess(projectId, userId, globalRole);
    denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');

    const body = (await c.req.json().catch(() => null)) as
      | { files?: Array<{ path?: unknown; size?: unknown; mime?: unknown }> }
      | null;
    const rawFiles = Array.isArray(body?.files) ? body!.files : null;
    if (!rawFiles || rawFiles.length === 0 || rawFiles.length > 100) {
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: files 需为 1–100 项的数组' });
    }

    const items = [] as Array<{ path: string; size: number; mime: string | null; decision: 'accept' | 'conflict' | 'reject'; reason: string }>;
    for (const f of rawFiles) {
      const norm = normalizeUploadPath(f?.path);
      const size = typeof f?.size === 'number' && Number.isFinite(f.size) ? f.size : NaN;
      const mime = typeof f?.mime === 'string' && f.mime.length <= 200 ? f.mime : null;
      if (!norm) {
        items.push({ path: String(f?.path ?? ''), size: Number.isNaN(size) ? 0 : size, mime, decision: 'reject', reason: 'INVALID_PATH: 路径不合法（含 ..、.git/.well-known 段、Windows 非法字符或缺扩展名）' });
        continue;
      }
      if (!Number.isFinite(size) || size < 0) {
        items.push({ path: norm, size: 0, mime, decision: 'reject', reason: 'VALIDATION_FAILED: size 需为非负数字节数' });
        continue;
      }
      if (size > config.UPLOAD_MAX_BYTES) {
        items.push({ path: norm, size, mime, decision: 'reject', reason: `FILE_TOO_LARGE: 超过上传上限 ${config.UPLOAD_MAX_BYTES} 字节` });
        continue;
      }
      const occupant = await findPathOccupant(projectId, norm);
      if (occupant) {
        items.push({
          path: norm,
          size,
          mime,
          decision: 'conflict',
          reason: occupant.deletedAt ? 'PATH_OCCUPIED_SOFT_DELETED: 同名路径被软删文档占用（唯一索引占位）' : 'DOCUMENT_EXISTS: 同名文档已存在',
        });
        continue;
      }
      items.push({ path: norm, size, mime, decision: 'accept', reason: 'OK' });
    }

    return c.json({
      uploadMaxBytes: config.UPLOAD_MAX_BYTES,
      items,
    });
  });

  // ---- 上传单文件（multipart） ----
  app.post(`${API}/projects/:id/files/upload`, async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    const globalRole = c.get('globalRole') as string;
    const access = await projectAccess(projectId, userId, globalRole);
    denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');

    const form = await c.req.parseBody();
    const pathField = typeof form.path === 'string' ? form.path : null;
    const norm = normalizeUploadPath(pathField);
    if (!norm) {
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: path 不合法（须含扩展名，拒绝 .. 与 .git/.well-known 段及 Windows 非法字符）' });
    }
    const fileField = form.file;
    if (!(fileField instanceof File)) {
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: file 需为 multipart 文件字段' });
    }
    const policy = form.policy === 'replace' || form.policy === 'rename' ? form.policy : 'error';
    const idempotencyKey = typeof form.idempotencyKey === 'string' ? form.idempotencyKey.slice(0, 200) : null;

    const buffer = Buffer.from(await fileField.arrayBuffer());
    if (buffer.length > config.UPLOAD_MAX_BYTES) {
      throw new HTTPException(413, { message: `FILE_TOO_LARGE: 超过上传上限 ${config.UPLOAD_MAX_BYTES} 字节` });
    }

    // 魔数探测优先于客户端声明 MIME；随后扩展名 + 有效 MIME 决定 kind
    const declared = fileField.type || null;
    const mimeSniffed = effectiveMime(buffer, declared);
    const ft = resolveFileType(norm, mimeSniffed);
    const isBinary = ft.kind === 'binary';
    const finalMime = ft.mime || mimeSniffed || 'application/octet-stream';

    const occupant = await findPathOccupant(projectId, norm);
    if (occupant) {
      if (occupant.deletedAt) {
        throw new HTTPException(409, { message: 'PATH_OCCUPIED_SOFT_DELETED: 该路径被软删文档占用，请使用 rename 策略或更换路径' });
      }
      if (policy === 'error') throw new HTTPException(409, { message: 'DOCUMENT_EXISTS' });
      // replace → 下方替换分支；rename → 下方解析不冲突新路径
    }
    const replaceTarget = occupant && !occupant.deletedAt && policy === 'replace' ? occupant.id : null;
    const finalPath =
      occupant && !occupant.deletedAt && policy === 'rename'
        ? await resolveRenamePath(projectId, norm)
        : norm;

    const proj = await projectRow(projectId);
    const me = await actorOf(userId);

    // blob 先于事务落盘（内容寻址，失败则整请求失败；去重不产生重复对象）
    const storageRef = isBinary ? await store.put(buffer) : null;
    const textContent = buffer.toString('utf8');
    const hashHex = createHash('sha256').update(buffer).digest('hex');
    const textWordCount = isBinary ? 0 : [...textContent.matchAll(/[\p{L}\p{N}]/gu)].length;

    const result = await db.transaction(async (tx) => {
      if (replaceTarget) {
        const [existing] = await tx
          .select()
          .from(documents)
          .where(and(eq(documents.id, replaceTarget), isNull(documents.deletedAt)))
          .limit(1);
        if (!existing) throw new HTTPException(404, { message: 'NOT_FOUND' });

        const versionNo = await nextVersionNo(existing.id, tx);
        const [v] = await tx
          .insert(documentVersions)
          .values({
            documentId: existing.id,
            versionNo,
            authorId: userId,
            content: isBinary ? '' : textContent,
            storageRef: isBinary ? storageRef : null,
            size: buffer.length,
          })
          .returning({ id: documentVersions.id, versionNo: documentVersions.versionNo });

        const [updated] = await tx
          .update(documents)
          .set({
            content: isBinary ? null : textContent,
            contentHash: hashHex,
            kind: isBinary ? 'binary' : 'text',
            ext: existing.ext,
            mime: finalMime,
            size: buffer.length,
            storageRef: isBinary ? storageRef : null,
            status: 'modified',
            wordCount: textWordCount,
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, existing.id))
          .returning();

        await tx.insert(activities).values({
          projectId,
          actorId: userId,
          verb: 'upload',
          targetType: 'document',
          targetId: existing.id,
          targetTitle: existing.title ?? existing.path,
          meta: { action: 'upload', replace: true, size: buffer.length, mime: finalMime },
        });

        return { doc: updated!, versionNo: v!.versionNo, replaced: true, oldPath: existing.path };
      }

      // 新建（rename 已在外部解析 finalPath；软删占位已在前置拦截）
      const title = titleFromPath(finalPath);
      const [doc] = await tx
        .insert(documents)
        .values({
          projectId,
          path: finalPath,
          title,
          content: isBinary ? null : textContent,
          contentHash: hashHex,
          kind: isBinary ? 'binary' : 'text',
          ext: ft.ext,
          mime: finalMime,
          size: buffer.length,
          storageRef: isBinary ? storageRef : null,
          status: 'modified',
          wordCount: textWordCount,
          updatedBy: userId,
        })
        .returning();

      const versionNo = await nextVersionNo(doc!.id, tx);
      await tx.insert(documentVersions).values({
        documentId: doc!.id,
        versionNo,
        authorId: userId,
        content: isBinary ? '' : textContent,
        storageRef: isBinary ? storageRef : null,
        size: buffer.length,
      });

      await tx.insert(activities).values({
        projectId,
        actorId: userId,
        verb: 'upload',
        targetType: 'document',
        targetId: doc!.id,
        targetTitle: title,
        meta: { action: 'upload', size: buffer.length, mime: finalMime, ...(finalPath !== norm ? { renamedFrom: norm } : {}) },
      });

      return { doc: doc!, versionNo, replaced: false, oldPath: null };
    });

    const effects = await docStorageEffectsBatch(
      deps,
      proj,
      [
        isBinary
          ? { op: 'upsert' as const, path: result.doc.path, kind: 'binary' as const, buffer, mime: finalMime, storageRef, documentId: result.doc.id }
          : { op: 'upsert' as const, path: result.doc.path, kind: 'text' as const, content: buffer.toString('utf8'), documentId: result.doc.id },
      ],
      { id: userId, name: me.name, email: me.email },
      `docs(${result.doc.path}): 上传文件（${me.name}）`,
    );

    await broadcast(projectId, {
      documentId: result.doc.id,
      path: result.doc.path,
      created: !result.replaced,
      versionNo: result.versionNo,
      by: me.name,
      byId: userId,
    });

    return c.json(
      {
        document: result.doc,
        version: result.versionNo,
        replaced: result.replaced,
        path: result.doc.path,
        requestedPath: norm,
        idempotencyKey,
        effects,
        rawUrl: isBinary ? buildRawUrl(config.JWT_SECRET, API, result.doc, userId, config.RAW_URL_TTL_SECONDS) : null,
      },
      result.replaced ? 200 : 201,
    );
  });

  // ---- 替换上传：为现存文档追加二进制/任意内容版本（ext/path 不变） ----
  app.post(`${API}/documents/:id/versions/upload`, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const globalRole = c.get('globalRole') as string;

    const [existing] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!existing) throw new HTTPException(404, { message: 'NOT_FOUND' });
    const access = await projectAccess(existing.projectId, userId, globalRole);
    denyIfNot(access.canWrite, 'FORBIDDEN: 需要该项目空间的编辑权限');

    const form = await c.req.parseBody();
    const fileField = form.file;
    if (!(fileField instanceof File)) {
      throw new HTTPException(400, { message: 'VALIDATION_FAILED: file 需为 multipart 文件字段' });
    }
    const buffer = Buffer.from(await fileField.arrayBuffer());
    if (buffer.length > config.UPLOAD_MAX_BYTES) {
      throw new HTTPException(413, { message: `FILE_TOO_LARGE: 超过上传上限 ${config.UPLOAD_MAX_BYTES} 字节` });
    }

    // kind/mime 以内容探测为准；ext/path 保持不变（§5.2：PATCH 之外的内容替换由服务端重算）
    const mimeSniffed = effectiveMime(buffer, fileField.type || null);
    const ft = resolveFileType(existing.path, mimeSniffed);
    const isBinary = ft.kind === 'binary';
    const finalMime = ft.mime || mimeSniffed || existing.mime || 'application/octet-stream';

    const proj = await projectRow(existing.projectId);
    const me = await actorOf(userId);
    const storageRef = isBinary ? await store.put(buffer) : null;
    const textContent = buffer.toString('utf8');
    const hashHex = createHash('sha256').update(buffer).digest('hex');
    const textWordCount = isBinary ? 0 : [...textContent.matchAll(/[\p{L}\p{N}]/gu)].length;

    const { versionNo, updated } = await db.transaction(async (tx) => {
      const versionNo = await nextVersionNo(existing.id, tx);
      await tx.insert(documentVersions).values({
        documentId: existing.id,
        versionNo,
        authorId: userId,
        content: isBinary ? '' : textContent,
        storageRef: isBinary ? storageRef : null,
        size: buffer.length,
      });
      const [updated] = await tx
        .update(documents)
        .set({
          content: isBinary ? null : textContent,
          contentHash: hashHex,
          kind: isBinary ? 'binary' : 'text',
          mime: finalMime,
          size: buffer.length,
          storageRef: isBinary ? storageRef : null,
          status: 'modified',
          wordCount: textWordCount,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, existing.id))
        .returning();
      await tx.insert(activities).values({
        projectId: existing.projectId,
        actorId: userId,
        verb: 'upload',
        targetType: 'document',
        targetId: existing.id,
        targetTitle: existing.title ?? existing.path,
        meta: { action: 'upload', version: true, size: buffer.length, mime: finalMime },
      });
      return { versionNo, updated: updated! };
    });

    const effects = await docStorageEffectsBatch(
      deps,
      proj,
      [
        isBinary
          ? { op: 'upsert' as const, path: existing.path, kind: 'binary' as const, buffer, mime: finalMime, storageRef, documentId: existing.id }
          : { op: 'upsert' as const, path: existing.path, kind: 'text' as const, content: buffer.toString('utf8'), documentId: existing.id },
      ],
      { id: userId, name: me.name, email: me.email },
      `docs(${existing.path}): 上传新版本（${me.name}）`,
    );

    await broadcast(existing.projectId, {
      documentId: existing.id,
      path: existing.path,
      versionNo,
      by: me.name,
      byId: userId,
    });

    return c.json({
      document: updated,
      version: versionNo,
      effects,
      rawUrl: isBinary ? buildRawUrl(config.JWT_SECRET, API, updated, userId, config.RAW_URL_TTL_SECONDS) : null,
    });
  });
}

// ---------------------------------------------------------------------------
// raw 路由：在 Bearer 守卫之前挂载；处理器内自验 Authorization 或 ?exp=&token=&u=
// ---------------------------------------------------------------------------

export function registerRawRoute(app: Hono, deps: AppDeps): void {
  const { config } = deps;
  const store = getBlobStore(deps);

  app.get(`${API}/documents/:id/raw`, async (c) => {
    const id = c.req.param('id')!;

    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!doc) throw new HTTPException(404, { message: 'NOT_FOUND' });

    // 双轨鉴权：优先 Bearer；缺失时验 HMAC query 签名（绑定 doc+user+exp）
    const authHeader = c.req.header('Authorization') ?? '';
    let userId: string;
    let globalRole: string;
    if (authHeader.startsWith('Bearer ')) {
      try {
        const payload = await verifyAccessToken(config.JWT_SECRET, authHeader.slice(7));
        userId = payload.sub;
        globalRole = payload.globalRole;
      } catch {
        throw new HTTPException(401, { message: 'TOKEN_EXPIRED' });
      }
      const [meStatus] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
      if (meStatus?.status === 'disabled') throw new HTTPException(403, { message: 'ACCOUNT_DISABLED' });
    } else {
      const token = c.req.query('token') ?? c.req.query('sig');
      const expRaw = c.req.query('exp');
      const signedUser = c.req.query('u');
      const exp = Number(expRaw);
      if (!token || !signedUser || !Number.isFinite(exp)) {
        throw new HTTPException(401, { message: 'UNAUTHENTICATED' });
      }
      try {
        verifyRawToken(config.JWT_SECRET, token, { documentId: doc.id, userId: signedUser, exp });
      } catch {
        throw new HTTPException(401, { message: 'RAW_TOKEN_INVALID' });
      }
      userId = signedUser;
      globalRole = (await db.select({ globalRole: users.globalRole }).from(users).where(eq(users.id, userId)).limit(1))?.[0]?.globalRole ?? 'user';
    }

    const access = await projectAccess(doc.projectId, userId, globalRole);
    denyIfNot(access.canRead);

    const download = c.req.query('download') === '1';
    const base = basenameOf(doc.path);
    const dispositionType = download ? 'attachment' : 'inline';
    const disposition = `${dispositionType}; filename="file"; filename*=UTF-8''${encodeURIComponent(base)}`;

    if (doc.kind === 'binary') {
      if (!doc.storageRef) throw new HTTPException(404, { message: 'BLOB_MISSING' });
      const headers: Record<string, string> = {
        'Content-Type': doc.mime || 'application/octet-stream',
        'Content-Disposition': disposition,
        'Accept-Ranges': 'none',
      };
      if (doc.mime === 'image/svg+xml') {
        headers['Content-Security-Policy'] = "sandbox; default-src 'none'";
        headers['X-Content-Type-Options'] = 'nosniff';
      }
      const nodeStream = store.createReadStream(doc.storageRef);
      const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
      return c.body(webStream, 200, headers);
    }

    // 文本类：content UTF-8；mime 以注册表为准（html/svg 等可执行面加 sandbox）
    const ft = resolveFileType(doc.path, doc.mime);
    const headers: Record<string, string> = {
      'Content-Type': `${ft.mime}; charset=utf-8`,
      'Content-Disposition': disposition,
    };
    if (ft.mime === 'text/html' || doc.mime === 'image/svg+xml') {
      headers['Content-Security-Policy'] = "sandbox; default-src 'none'";
      headers['X-Content-Type-Options'] = 'nosniff';
    }
    return c.body((doc.content ?? '') as never, 200, headers);
  });
}
