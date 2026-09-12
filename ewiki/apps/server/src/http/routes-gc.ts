// ---------------------------------------------------------------------------
// Blob GC 手动触发端点（POST /api/v1/admin/gc-blob）
//
// 需 admin 权限（globalRole === 'admin'）；自动继承 routes.ts 的 Bearer 守卫。
// 返回 GC 执行结果摘要（不返回详细 orphan ref 列表，避免信息泄漏）。
//
// 设计文档 §7.4（风险对策 → blob 垃圾累积）
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import path from 'node:path';
import { LocalBlobStore, resolveRoot, type BlobStore } from '@ewiki/storage';
import type { AppDeps } from './app.js';
import { runBlobGC } from '../lib/blob-gc.js';

const API = '/api/v1';

/** BlobStore 单例（与 routes-files.ts / worker 同解析规则，避免重复 env 逻辑） */
let blobStoreSingleton: BlobStore | null = null;
function getBlobStore(): BlobStore {
  if (!blobStoreSingleton) {
    const root = process.env.BLOB_LOCAL_ROOT?.trim()
      ? path.resolve(process.env.BLOB_LOCAL_ROOT.trim())
      : path.join(resolveRoot(process.env.FS_NAS_ROOT), 'blobs');
    blobStoreSingleton = new LocalBlobStore(root);
  }
  return blobStoreSingleton;
}

export function registerGCRoutes(app: Hono, deps: AppDeps): void {
  const admin = new Hono();

  admin.post('/gc-blob', async (c) => {
    // admin 权限校验（routes.ts 已注入 globalRole 到 context）
    if (c.get('globalRole') !== 'admin') {
      throw new HTTPException(403, { message: 'ADMIN_REQUIRED' });
    }

    const body = (await c.req.json().catch(() => ({}))) as { limit?: number };
    const limit = Number.isFinite(body.limit) && body.limit! > 0 ? Math.min(body.limit!, 50_000) : undefined;

    const result = await runBlobGC({
      db: deps.db,
      store: getBlobStore(),
      limit,
    });

    return c.json({ ok: true, result });
  });

  app.route(`${API}/admin`, admin);
}
