// ---------------------------------------------------------------------------
// Blob GC（垃圾回收）核心逻辑 —— 设计文档 §7.4（风险对策 → blob 垃圾累积）
//
// 一期策略「不主动回收」已结束：
//   documents.storageRef + document_versions.storageRef 是 blob 的唯二引用点；
//   软删文档（deletedAt IS NOT NULL）的 blob 视为可回收；
//   物理文件删除前必须过「二次确认安全网」（见 runBlobGC 内循环）。
//
// 本模块纯逻辑（无 HTTP 路由），server/worker 均可调用：
//   - worker：gc-blob pg-boss 队列（每日 03:00 cron）
//   - server：POST /api/v1/admin/gc-blob 手动触发（需 admin）
// ---------------------------------------------------------------------------

import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { BlobStore } from '@ewiki/storage';
import type { BlobRefs } from '@ewiki/storage';
import { documentVersions, documents, activities, ydocSnapshots } from '../db/schema.js';

export interface BlobGCRunInput {
  db: any; // drizzle instance
  store: BlobStore;
  /** 单次运行最多删除多少 orphan 就停（避免长时间阻塞；缺省 10000） */
  limit?: number;
}

export interface BlobGCRunResult {
  /** blob 目录物理存在的 ref 总数 */
  totalOnDisk: number;
  /** DB（documents + document_versions 含历史）去重后的 active refs 总数 */
  totalReferenced: number;
  /** 初次扫到的 orphan 数（磁盘有、DB 无） */
  candidates: number;
  /** 二次确认安全网拦截的（扫描过程中被新引用挂住的） */
  safetyNetRejected: number;
  /** 最终删除的文件数 */
  deleted: number;
  /** 跳过超限的（limit 截断） */
  truncated: number;
  /** 删除时出错的 ref 列表 */
  failed: Array<{ ref: string; error: string }>;
}

/**
 * 一次性 GC 扫描执行（无事务——删的是文件系统对象，单文件删除已幂等）。
 *
 * 算法：
 *   1. SELECT DISTINCT storage_ref FROM documents WHERE storage_ref IS NOT NULL AND deleted_at IS NULL
 *      + SELECT DISTINCT storage_ref FROM document_versions WHERE storage_ref IS NOT NULL
 *      → activeRefs Set
 *   2. store.listAllRefs() → onDiskRefs Set
 *   3. orphan = onDiskRefs - activeRefs
 *   4. 对每个 orphan 调 store.refCount(ref, refs) 二次确认（可能被新写入挂住）
 *      → refCount === 0 才真正 store.delete(ref)
 *   5. 写 activities 一条（verb='gc_blob'，无 projectId 则 targetType=system）
 */
export async function runBlobGC(input: BlobGCRunInput): Promise<BlobGCRunResult> {
  const { db, store } = input;
  const limit = input.limit ?? 10_000;

  // ---- 1. 盘点 DB 中的活跃 refs ----
  const docRows = await db
    .select({ ref: documents.storageRef })
    .from(documents)
    .where(and(isNull(documents.deletedAt), sql`${documents.storageRef} IS NOT NULL`));
  const verRows = await db
    .select({ ref: documentVersions.storageRef })
    .from(documentVersions)
    .where(sql`${documentVersions.storageRef} IS NOT NULL`);

  const activeRefs = new Set<string>();
  for (const r of docRows) if (typeof r.ref === 'string') activeRefs.add(r.ref);
  for (const r of verRows) if (typeof r.ref === 'string') activeRefs.add(r.ref);

  // ---- 2. 盘点磁盘 ----
  const onDiskRefs = await store.listAllRefs();

  // ---- 3. 差集 ----
  const candidates: string[] = [];
  for (const ref of onDiskRefs) {
    if (!activeRefs.has(ref)) candidates.push(ref);
  }

  // ---- 4. BlobRefs 注入（refCount 用） ----
  const refs: BlobRefs = {
    sql: sql as any,
    eq: eq as any,
    isNull: isNull as any,
    and: and as any,
    db: db as any,
    documentTable: documents as any,
    versionTable: documentVersions as any,
    documentStorageRefCol: documents.storageRef as any,
    versionStorageRefCol: documentVersions.storageRef as any,
    documentDeletedAtCol: documents.deletedAt as any,
  };

  const failed: BlobGCRunResult['failed'] = [];
  let deleted = 0;
  let safetyNetRejected = 0;
  let truncated = 0;

  for (const ref of candidates) {
    if (deleted >= limit) {
      truncated = candidates.length - limit;
      break;
    }

    // ---- 二次确认安全网：扫描过程中可能有新文档引用了同一个 blob ----
    // refCount > 0 说明有并发写入挂住了该 blob，跳过
    try {
      const count = await store.refCount(ref, refs);
      if (count > 0) {
        safetyNetRejected++;
        continue;
      }
    } catch (err) {
      failed.push({ ref, error: (err as Error).message });
      continue;
    }

    try {
      await store.delete(ref);
      deleted++;
    } catch (err) {
      failed.push({ ref, error: (err as Error).message });
    }
  }

  // ---- P4-6：ydoc_snapshots 过期清理（7 天 TTL） ----
  // ydoc_snapshots 每 30s 写入一次，但 Y.Doc 重启恢复只需要 7 天窗口，
  // 超过的永远堆积。和 blob GC 同一次 cron 一起做。
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let expiredSnapshots = 0;
  try {
    const delRes = await db
      .delete(ydocSnapshots)
      .where(lt(ydocSnapshots.updatedAt, sevenDaysAgo))
      .returning({ id: ydocSnapshots.id });
    expiredSnapshots = delRes?.length ?? 0;
  } catch (err) {
    // snapshots 清理失败不影响 blob GC 本身
    console.error(JSON.stringify({ level: 'warn', msg: 'ydoc_snapshots expired cleanup failed', err: String(err) }));
  }

  const result: BlobGCRunResult = {
    totalOnDisk: onDiskRefs.length,
    totalReferenced: activeRefs.size,
    candidates: candidates.length,
    safetyNetRejected,
    deleted,
    truncated,
    failed,
  };

  // ---- 5. activities 留痕（targetType=system，无 projectId） ----
  try {
    await db.insert(activities).values({
      projectId: null,
      verb: 'gc_blob',
      targetType: 'system',
      targetId: 'blob-store',
      targetTitle: 'blob-store',
      meta: {
        ...result,
        // P4-6：ydoc_snapshots 过期清理数量（7 天 TTL）
        expiredSnapshots,
        triggeredAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    // activities 写失败不影响 GC 本身——日志兜底
    console.error(JSON.stringify({ level: 'warn', msg: 'gc_blob activity write failed', err: String(err) }));
  }

  return result;
}
