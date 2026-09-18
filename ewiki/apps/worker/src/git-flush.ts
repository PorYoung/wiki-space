// ---------------------------------------------------------------------------
// worker『git-flush』队列（GIT-COMMIT-COALESCING-DESIGN §7）：
//   窗口判定（防抖/max-wait，checkpoint 行强制关闭）→ 工作副本锁 → 台账折叠
//   （latest-wins，内容以 documents 表为准）→ 单次 commitAndPush → 状态/版本回填
//   → git.flushed 广播 → flush 后复查（§4 D4 自愈）。
// 失败不消费台账：pg-boss 退避重试，或下次任意写操作/checkpoint 重放。
// ---------------------------------------------------------------------------

import path from 'node:path';
import type PgBoss from 'pg-boss';
import type postgres from 'postgres';
import { and, eq, inArray, isNull, lte, sql as dsql } from 'drizzle-orm';
import {
  auditLogs,
  createDb,
  documents,
  documentVersions,
  gitPendingOps,
  projects,
  storageConnections,
  syncJobs,
} from '@ewiki/db';
import { commitAndPush, ensureWorkdir, type ConnLike } from '@ewiki/git';
import { reposRoot } from '@ewiki/storage';
import {
  buildCommitMessage,
  buildPushChanges,
  decideFlush,
  enqueueGitFlush,
  foldOps,
  GIT_FLUSH_DEFAULTS,
  type PendingOpRow,
} from '@ewiki/shared';
import { PgLockService } from '@ewiki/server/src/adapters/pg/lock.js';

type Db = ReturnType<typeof createDb>['db'];
type PendingRow = typeof gitPendingOps.$inferSelect;

export interface GitFlushCtx {
  db: Db;
  sql: postgres.Sql;
  boss: PgBoss;
  lock: PgLockService;
  env: NodeJS.ProcessEnv;
  log: (msg: string, extra?: object) => void;
}

/**
 * 窗口判定入口（§7.2 + §9）：checkpoint 行强制关闭窗口（立即提交语义，
 * 绕过防抖）；防抖时钟只看文件操作行——checkpoint 本身不是「编辑活动」。
 */
export function planFlush(
  rows: Array<{ op: string; createdAt: Date | number | string }>,
  now: number,
  debounceMs: number,
  maxWaitMs: number,
): { action: 'flush' } | { action: 'rearm'; delayMs: number } {
  const fileRows = rows.filter((r) => r.op !== 'checkpoint');
  if (fileRows.length === 0) return { action: 'flush' }; // 仅 checkpoint：无可等操作
  if (rows.length > fileRows.length) return { action: 'flush' };
  const times = fileRows.map((r) => {
    const t = r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt).getTime();
    return Number.isFinite(t) ? t : now;
  });
  return decideFlush(
    { now, firstPendingAt: Math.min(...times), lastActivityAt: Math.max(...times) },
    debounceMs,
    maxWaitMs,
  );
}

function envSeconds(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const n = Math.floor(Number(env[key] ?? ''));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function syncDocsStatus(db: Db, rows: PendingRow[]): Promise<void> {
  const ids = [
    ...new Set(
      rows
        .filter((r) => (r.op === 'upsert' || r.op === 'move') && (r.kind ?? 'text') === 'text' && r.documentId)
        .map((r) => r.documentId as string),
    ),
  ];
  if (ids.length === 0) return;
  await db
    .update(documents)
    .set({ status: 'synced', updatedAt: new Date() })
    .where(and(inArray(documents.id, ids), isNull(documents.deletedAt)));
}

async function flushWindow(ctx: GitFlushCtx, projectId: string, rows: PendingRow[]): Promise<void> {
  const { db, sql, log } = ctx;
  const ids = rows.map((r) => r.id);
  const consume = (commitHash: string | null): Promise<unknown> =>
    db.update(gitPendingOps).set({ consumedAt: new Date(), commitHash }).where(inArray(gitPendingOps.id, ids));

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      storageKind: projects.storageKind,
      storageConfig: projects.storageConfig,
      storageConnectionId: projects.storageConnectionId,
      defaultBranch: projects.defaultBranch,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) {
    await consume(null);
    log('git-flush skip: project gone', { projectId });
    return;
  }
  const cfg = (project.storageConfig ?? {}) as Record<string, unknown>;
  if (!project.storageConnectionId || project.storageKind !== 'git' || cfg.autoCommit !== true) {
    // 镜像型/未开启自动提交的后端：台账直接了结（与 inline 分支的 attempted=false 语义一致）
    await consume(null);
    log('git-flush skip: backend not git/autocommit', { projectId });
    return;
  }

  const startedAt = new Date();
  let failed = false;
  try {
    const opRows = rows as unknown as PendingOpRow[];
    const steps = foldOps(opRows);
    const docRows = await db
      .select({ path: documents.path, content: documents.content, kind: documents.kind, deletedAt: documents.deletedAt })
      .from(documents)
      .where(eq(documents.projectId, projectId));
    const byPath = new Map(docRows.map((d) => [d.path, d]));
    const changes = buildPushChanges(steps, (p) => {
      const d = byPath.get(p);
      if (!d) return undefined;
      return { content: d.content, kind: d.kind === 'binary' ? 'binary' : 'text', deleted: d.deletedAt !== null };
    });

    const docIds = [
      ...new Set(rows.filter((r) => r.op !== 'checkpoint' && r.documentId).map((r) => r.documentId as string)),
    ];
    if (changes.length === 0) {
      // 无差异（noop 或纯 checkpoint）：窗口了结；在线文档状态对账为 synced（远端本就一致）
      await consume(null);
      await syncDocsStatus(db, rows);
      log('git-flush noop', { projectId, ops: rows.length });
      return;
    }

    const [connRow] = await db
      .select({ tokenEncrypted: storageConnections.tokenEncrypted })
      .from(storageConnections)
      .where(eq(storageConnections.id, project.storageConnectionId))
      .limit(1);
    if (!connRow) throw new Error('存储连接配置已删除');
    const conn: ConnLike = {
      kind: String(cfg.kind ?? 'gitlab'),
      baseUrl: String(cfg.host ?? ''),
      tokenEncrypted: connRow.tokenEncrypted,
      defaultNamespace: (cfg.namespace as string) ?? null,
    };

    const ordered = [...rows].sort((a, b) => a.seq - b.seq);
    const firstActor = ordered.find((r) => r.op !== 'checkpoint')!;
    const message = buildCommitMessage({ ops: opRows, projectName: project.name });

    const root = reposRoot(path.resolve(process.cwd(), process.env.FS_ROOT ?? './data'));
    const { workdir } = await ensureWorkdir(
      root,
      project.id,
      conn,
      String(cfg.url ?? ''),
      String(cfg.namespace ?? 'owner'),
      String(project.defaultBranch ?? 'main'),
    );
    const result = await commitAndPush(
      workdir,
      changes,
      { name: firstActor.actorName, email: firstActor.actorEmail || 'ewiki@local' },
      message,
    );
    if (!result.ok) throw new Error(result.error ?? 'git commit/push failed');

    await consume(result.commitHash ?? null);
    await syncDocsStatus(db, rows);
    // 窗口内创建的版本快照统一挂上本次提交号（无 commitHash 的行才回填，幂等）
    if (docIds.length > 0) {
      await db
        .update(documentVersions)
        .set({ commitHash: result.commitHash ?? null })
        .where(
          and(
            inArray(documentVersions.documentId, docIds),
            isNull(documentVersions.commitHash),
            lte(documentVersions.createdAt, startedAt),
          ),
        );
    }
    const actors = [...new Set(rows.filter((r) => r.op !== 'checkpoint').map((r) => r.actorName))];
    await db.insert(syncJobs).values({
      projectId,
      trigger: 'flush',
      commitHash: result.commitHash ?? null,
      status: 'succeeded',
      stats: { ops: rows.length, pushed: result.pushed, noop: false, actors },
      finishedAt: new Date(),
    });
    await db
      .update(projects)
      .set({ storageStatus: 'synced', lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    await db.insert(auditLogs).values({
      actorId: firstActor.actorId,
      action: 'git.flush',
      resourceType: 'project',
      resourceId: projectId,
      meta: { ops: rows.length, commit: result.commitHash, pushed: result.pushed, actors },
    });
    await sql`select pg_notify('ewiki_events', ${JSON.stringify({
      channel: 'sync',
      payload: {
        room: `project:${projectId}`,
        event: 'git.flushed',
        payload: { projectId, documentIds: docIds, commitHash: result.commitHash ?? null },
      },
    })})`;
    log('git-flush done', { projectId, ops: rows.length, commit: result.commitHash, pushed: result.pushed });
  } catch (err) {
    failed = true;
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .insert(syncJobs)
      .values({ projectId, trigger: 'flush', status: 'failed', error: msg.slice(0, 500), finishedAt: new Date() })
      .catch(() => undefined);
    await db
      .update(projects)
      .set({ storageStatus: 'error', lastError: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .catch(() => undefined);
    log('git-flush failed', { projectId, err: msg });
    throw err;
  } finally {
    if (!failed) {
      // §4 D4 自愈：flush 执行期间新到的操作，其入队可能被 pg-boss 对 active 任务的
      // 同 key 去重吞掉——复查台账非空则立即补触发，保证不丢提交。
      const [still] = await db
        .select({ c: dsql<number>`count(*)::int` })
        .from(gitPendingOps)
        .where(and(eq(gitPendingOps.projectId, projectId), isNull(gitPendingOps.consumedAt)));
      if (Number(still?.c ?? 0) > 0) await enqueueGitFlush(ctx.boss, projectId, { startAfterSeconds: 1 });
    }
  }
}

export function createGitFlushHandler(
  ctx: GitFlushCtx,
): (job: { id?: number | string; data: { projectId?: string } }) => Promise<void> {
  const debounceMs = envSeconds(ctx.env, 'GIT_FLUSH_DEBOUNCE_SECONDS', GIT_FLUSH_DEFAULTS.debounceSeconds) * 1000;
  const maxWaitMs = envSeconds(ctx.env, 'GIT_FLUSH_MAX_WAIT_SECONDS', GIT_FLUSH_DEFAULTS.maxWaitSeconds) * 1000;

  return async (job) => {
    const projectId = job.data?.projectId ?? '';
    if (!projectId) throw new Error('VALIDATION_FAILED: projectId required');
    const rows = await ctx.db
      .select()
      .from(gitPendingOps)
      .where(and(eq(gitPendingOps.projectId, projectId), isNull(gitPendingOps.consumedAt)))
      .orderBy(gitPendingOps.seq);
    if (rows.length === 0) return;
    const decision = planFlush(rows, Date.now(), debounceMs, maxWaitMs);
    if (decision.action === 'rearm') {
      await enqueueGitFlush(ctx.boss, projectId, { startAfterSeconds: Math.ceil(decision.delayMs / 1000) + 1 });
      return;
    }
    await ctx.lock.withLock(`git-workdir:${projectId}`, () => flushWindow(ctx, projectId, rows));
  };
}
