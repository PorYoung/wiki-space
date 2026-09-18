// ---------------------------------------------------------------------------
// Git 提交聚合（GIT-COMMIT-COALESCING-DESIGN §3/§7/§8）：纯函数 + 入队助手。
// 写路径只记录 git_pending_ops 台账并防抖入队；worker『git-flush』队列在窗口关闭
// 时把窗口内操作折叠为一个提交。本模块不依赖 pg-boss / git 二进制（入队走结构化
// 最小面 PgBossSendLike，与 enqueueSearchIndex 同款约束）。
// ---------------------------------------------------------------------------

import type { PgBossSendLike } from './search.js';

export const GIT_FLUSH_DEFAULTS = {
  debounceSeconds: 300,
  maxWaitSeconds: 1800,
};

export type PendingOpKind = 'upsert' | 'delete' | 'move' | 'checkpoint';

/** git_pending_ops 行的最小结构面（server/worker/shared 共用） */
export interface PendingOpRow {
  seq: number;
  op: PendingOpKind;
  path: string;
  fromPath?: string | null;
  kind?: 'text' | 'binary';
  documentId?: string | null;
  actorName: string;
  actorEmail?: string | null;
  message?: string | null;
  createdAt: Date | number | string;
}

// ---------------------------------------------------------------------------
// 窗口判定（§7.2）：静默 ≥ debounce 或 距窗口起点 ≥ maxWait → flush；
// 否则重排（剩余时间取小）。防抖是 trailing-edge 语义（pg-boss singletonKey
// 去重不延长 pending 任务延迟，因此判定必须在 job 体里做，见设计 §4 D3）。
// ---------------------------------------------------------------------------

export interface FlushDecision {
  action: 'flush' | 'rearm';
  delayMs: number;
}

export function decideFlush(
  clock: { now: number; firstPendingAt: number; lastActivityAt: number },
  debounceMs: number,
  maxWaitMs: number,
): FlushDecision {
  const idle = clock.now - clock.lastActivityAt;
  const elapsed = clock.now - clock.firstPendingAt;
  if (idle >= debounceMs || elapsed >= maxWaitMs) return { action: 'flush', delayMs: 0 };
  return { action: 'rearm', delayMs: Math.min(debounceMs - idle, maxWaitMs - elapsed) };
}

// ---------------------------------------------------------------------------
// 台账折叠（§7.3）：move 展开为 delete(from)+upsert(to)，按 seq 定序后逐路径
// latest-wins；checkpoint 行只承载备注/触发意图，不产生文件变更。
// ---------------------------------------------------------------------------

export interface FoldedStep {
  path: string;
  op: 'upsert' | 'delete';
  documentId: string | null;
  kind: 'text' | 'binary';
  actorName: string;
  message: string | null;
}

export function foldOps(rows: PendingOpRow[]): FoldedStep[] {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const byPath = new Map<string, FoldedStep>();
  for (const r of ordered) {
    if (r.op === 'checkpoint') continue;
    const base = {
      documentId: r.documentId ?? null,
      kind: r.kind ?? 'text',
      actorName: r.actorName,
      message: r.message ?? null,
    };
    if (r.op === 'move') {
      if (r.fromPath) {
        byPath.set(r.fromPath, { path: r.fromPath, op: 'delete', ...base });
      }
      byPath.set(r.path, { path: r.path, op: 'upsert', ...base });
    } else {
      byPath.set(r.path, { path: r.path, op: r.op, ...base });
    }
  }
  return [...byPath.values()];
}

export interface PushLikeChange {
  path: string;
  op: 'upsert' | 'delete';
  content?: string;
}

/**
 * 折叠步骤 → git 写盘指令（§7.3）：内容一律取文档表最新行（latest-wins，由调用方
 * 提供 lookup）；步骤为 upsert 但行已不存在/已软删 → 按 delete 兜底；binary 跳过
 * （二进制不入 git 的既有规则）。
 */
export function buildPushChanges(
  steps: FoldedStep[],
  lookup: (path: string) => { content: string | null; kind: 'text' | 'binary'; deleted: boolean } | undefined,
): PushLikeChange[] {
  const changes: PushLikeChange[] = [];
  for (const s of steps) {
    if (s.op === 'delete') {
      changes.push({ path: s.path, op: 'delete' });
      continue;
    }
    const row = lookup(s.path);
    if (!row || row.deleted) {
      changes.push({ path: s.path, op: 'delete' });
    } else if (row.kind === 'binary') {
      continue;
    } else {
      changes.push({ path: s.path, op: 'upsert', content: row.content ?? '' });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// 提交信息（§8）：subject 沿用 docs(...) 前缀习惯；用户备注进 body 明细；
// 多人窗口以 Co-authored-by 列全参与者（GitHub 可渲染署名）。
// ---------------------------------------------------------------------------

export interface CommitMessageInput {
  ops: PendingOpRow[];
  projectName: string;
}

const SUBJECT_MAX = 72;
const DETAIL_MAX_LINES = 20;
const NOTE_MAX = 50;

function firstLineClamped(s: string): string {
  const line = (s ?? '').split('\n', 1)[0]?.trim() ?? '';
  // -2 给省略号留位，避免截断点落在多字节汉字对中间
  return line.length > SUBJECT_MAX ? `${line.slice(0, SUBJECT_MAX - 2)}…` : line;
}

export function buildCommitMessage(input: CommitMessageInput): string {
  const fileOps = input.ops.filter((o) => o.op !== 'checkpoint');
  const checkpoint = input.ops.find((o) => o.op === 'checkpoint');
  const steps = foldOps(fileOps);
  const ordered = [...fileOps].sort((a, b) => a.seq - b.seq);
  const firstActor = ordered[0]?.actorName ?? 'unknown';
  const actors = [...new Set(fileOps.map((o) => o.actorName))];

  let subject: string;
  if (checkpoint?.message?.trim()) {
    subject = `docs(${input.projectName}): ${firstLineClamped(checkpoint.message.trim())}`;
  } else if (steps.length === 1) {
    const s = steps[0]!;
    subject =
      s.op === 'delete'
        ? `docs(${s.path}): 删除文档（${firstActor}）`
        : `docs(${s.path}): 平台内更新（${firstActor}）`;
  } else {
    const suffix = actors.length > 1 ? `（${firstActor} 等 ${actors.length} 人）` : `（${firstActor}）`;
    subject = `docs(${input.projectName}): 聚合更新 ${steps.length} 项${suffix}`;
  }

  const lines: string[] = [];
  const hasNotes = steps.some((s) => s.message);
  if (steps.length > 1 || hasNotes || checkpoint?.message?.trim()) {
    lines.push('变更明细:');
    const shown = steps.slice(0, DETAIL_MAX_LINES);
    for (const s of shown) {
      const mark = s.op === 'delete' ? 'D' : 'M';
      const note = s.message ? ` ${s.message.slice(0, NOTE_MAX)}` : '';
      lines.push(`- ${mark} ${s.path}（${s.actorName}）${note}`.trimEnd());
    }
    if (steps.length > shown.length) lines.push(`…等 ${steps.length} 项`);
  }
  for (const name of actors) {
    if (name === firstActor) continue;
    const email = [...fileOps].reverse().find((o) => o.actorName === name)?.actorEmail ?? '';
    lines.push(`Co-authored-by: ${name}${email ? ` <${email}>` : ''}`);
  }
  return lines.length > 0 ? `${subject}\n\n${lines.join('\n')}` : subject;
}

// ---------------------------------------------------------------------------
// 入队助手：singletonKey=projectId 窗口去重（重复保存不重置延迟）；失败不抛出
// —— 台账仍在，下一次任意写操作/checkpoint 会再次触发（对齐 enqueueSearchIndex）。
// ---------------------------------------------------------------------------

export interface GitFlushEnqueueOptions {
  /** >0 = 指定延迟秒数（job 重排 / checkpoint 立即触发）；缺省 = 立即入队由 job 体判窗 */
  startAfterSeconds?: number;
  retryLimit?: number;
  retryDelaySeconds?: number;
  /**
   * 缺省 = projectId（窗口去重：防抖 pending 期间重复入队被忽略）。
   * checkpoint 传 `cp:${projectId}`：独立去重键绕开防抖任务的 pending 去重，
   * 否则「立即提交」最坏要等满防抖窗口才被执行。
   */
  singletonKey?: string;
}

export function enqueueGitFlush(
  send: PgBossSendLike,
  projectId: string,
  opts: GitFlushEnqueueOptions = {},
): Promise<void> {
  const options: Record<string, unknown> = {
    singletonKey: opts.singletonKey ?? projectId,
    retryLimit: opts.retryLimit ?? 5,
    retryDelay: opts.retryDelaySeconds ?? 60,
    retryBackoff: true,
  };
  const delay = Math.ceil(opts.startAfterSeconds ?? 0);
  if (delay > 0) options.startAfter = delay;
  return (async () => {
    try {
      await send.send('git-flush', { projectId }, options);
    } catch (err) {
      console.error(
        JSON.stringify({ level: 'warn', msg: 'git-flush enqueue failed', projectId, err: String(err) }),
      );
    }
  })();
}
