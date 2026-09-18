import { describe, expect, it } from 'vitest';
import { buildCommitMessage, buildPushChanges, decideFlush, enqueueGitFlush, foldOps, type PendingOpRow } from './git.js';

let seq = 0;
function op(partial: Partial<PendingOpRow> & Pick<PendingOpRow, 'op' | 'path'>): PendingOpRow {
  seq += 1;
  return {
    seq,
    fromPath: null,
    kind: 'text',
    documentId: null,
    actorName: '张三',
    actorEmail: 'zhang@example.com',
    message: null,
    createdAt: Date.now(),
    ...partial,
  };
}

describe('decideFlush', () => {
  const base = { now: 1_000_000, firstPendingAt: 1_000_000 - 600_000, lastActivityAt: 1_000_000 - 600_000 };

  it('静默达到 debounce → flush', () => {
    const d = decideFlush({ ...base, lastActivityAt: base.now - 300_000 }, 300_000, 1_800_000);
    expect(d.action).toBe('flush');
  });

  it('距窗口起点达到 maxWait → flush（持续编辑不无限等待）', () => {
    const d = decideFlush(
      { now: base.now, firstPendingAt: base.now - 1_800_000, lastActivityAt: base.now - 1_000 },
      300_000,
      1_800_000,
    );
    expect(d.action).toBe('flush');
  });

  it('窗口内静默未满 → rearm 剩余时间（debounce 与 max-wait 取小）', () => {
    // elapsed=600s，maxWait=1800s → 剩 1200s；idle=100s，debounce=300s → 剩 200s → 取 200s
    const d = decideFlush(
      { now: base.now, firstPendingAt: base.now - 600_000, lastActivityAt: base.now - 100_000 },
      300_000,
      1_800_000,
    );
    expect(d).toEqual({ action: 'rearm', delayMs: 200_000 });
  });

  it('边界值：恰好等于 debounce 即 flush', () => {
    const d = decideFlush({ ...base, lastActivityAt: base.now - 300_000 }, 300_000, 1_800_000);
    expect(d.action).toBe('flush');
  });
});

describe('foldOps', () => {
  it('move 展开为 delete(from)+upsert(to)，后续编辑覆盖目标路径', () => {
    const steps = foldOps([
      op({ op: 'move', path: 'b.md', fromPath: 'a.md', documentId: 'd1' }),
      op({ op: 'upsert', path: 'b.md', documentId: 'd1', message: '补一段' }),
    ]);
    expect(steps).toHaveLength(2);
    const a = steps.find((s) => s.path === 'a.md');
    const b = steps.find((s) => s.path === 'b.md');
    expect(a).toMatchObject({ op: 'delete' });
    expect(b).toMatchObject({ op: 'upsert', documentId: 'd1', message: '补一段' });
  });

  it('同路径 latest-wins：先删后建 → upsert；先存后删 → delete', () => {
    const recreate = foldOps([
      op({ op: 'delete', path: 'x.md' }),
      op({ op: 'upsert', path: 'x.md', documentId: 'd2' }),
    ]);
    expect(recreate).toEqual([expect.objectContaining({ path: 'x.md', op: 'upsert' })]);

    const del = foldOps([
      op({ op: 'upsert', path: 'x.md', documentId: 'd2' }),
      op({ op: 'delete', path: 'x.md' }),
    ]);
    expect(del).toEqual([expect.objectContaining({ path: 'x.md', op: 'delete' })]);
  });

  it('checkpoint 行不产生文件变更', () => {
    const steps = foldOps([op({ op: 'checkpoint', path: '' })]);
    expect(steps).toHaveLength(0);
  });

  it('seq 乱序输入仍按 seq 定序折叠', () => {
    const upsert = { ...op({ op: 'upsert', path: 'y.md', documentId: 'd3' }), seq: 1 };
    const del = { ...op({ op: 'delete', path: 'y.md' }), seq: 2 };
    const steps = foldOps([del, upsert]); // 传入顺序与 seq 相反
    expect(steps).toEqual([expect.objectContaining({ op: 'delete' })]);
  });
});

describe('buildPushChanges', () => {
  const docs = new Map([
    ['live.md', { content: '# live', kind: 'text' as const, deleted: false }],
    ['gone.md', { content: '', kind: 'text' as const, deleted: true }],
    ['pic.png', { content: null, kind: 'binary' as const, deleted: false }],
  ]);
  const lookup = (p: string) => docs.get(p);

  it('upsert 取最新内容；行缺失/软删 → delete 兜底；binary 跳过', () => {
    const changes = buildPushChanges(
      [
        { path: 'live.md', op: 'upsert', documentId: null, kind: 'text', actorName: '张三', message: null },
        { path: 'gone.md', op: 'upsert', documentId: null, kind: 'text', actorName: '张三', message: null },
        { path: 'pic.png', op: 'upsert', documentId: null, kind: 'binary', actorName: '张三', message: null },
        { path: 'del.md', op: 'delete', documentId: null, kind: 'text', actorName: '张三', message: null },
      ],
      lookup,
    );
    expect(changes).toEqual([
      { path: 'live.md', op: 'upsert', content: '# live' },
      { path: 'gone.md', op: 'delete' },
      { path: 'del.md', op: 'delete' },
    ]);
  });
});

describe('buildCommitMessage', () => {
  it('单文档更新：沿用 docs(<path>) subject，用户备注进明细', () => {
    const msg = buildCommitMessage({
      ops: [op({ op: 'upsert', path: 'guide/intro.md', message: '修复安装步骤' })],
      projectName: '产品手册',
    });
    expect(msg.split('\n')[0]).toBe('docs(guide/intro.md): 平台内更新（张三）');
    expect(msg).toContain('- M guide/intro.md（张三） 修复安装步骤');
  });

  it('单文档删除', () => {
    const msg = buildCommitMessage({ ops: [op({ op: 'delete', path: 'old.md' })], projectName: 'P' });
    expect(msg).toBe('docs(old.md): 删除文档（张三）');
  });

  it('多文档聚合：计数 + 多人 Co-authored-by（排除首操作者）', () => {
    const msg = buildCommitMessage({
      ops: [
        op({ op: 'upsert', path: 'a.md' }),
        op({ op: 'upsert', path: 'b.md', actorName: '李四', actorEmail: 'li@example.com' }),
        op({ op: 'delete', path: 'c.md', actorName: '李四', actorEmail: 'li@example.com' }),
      ],
      projectName: '团队库',
    });
    expect(msg.split('\n')[0]).toBe('docs(团队库): 聚合更新 3 项（张三 等 2 人）');
    expect(msg).toContain('变更明细:');
    expect(msg).toContain('- D c.md（李四）');
    expect(msg).toContain('Co-authored-by: 李四 <li@example.com>');
    expect(msg.match(/Co-authored-by/g)).toHaveLength(1);
  });

  it('checkpoint 备注：首行截断 72 字符作为 subject', () => {
    const long = '发布'.repeat(50);
    const msg = buildCommitMessage({
      ops: [
        op({ op: 'upsert', path: 'a.md' }),
        op({ op: 'checkpoint', path: '', message: `${long}\n第二行不进 subject` }),
      ],
      projectName: 'P',
    });
    expect(msg.split('\n')[0]).toBe(`docs(P): ${'发布'.repeat(35)}…`);
    expect(msg).not.toContain('第二行');
  });

  it('明细超过 20 行折叠为省略行', () => {
    const ops = Array.from({ length: 25 }, (_, i) => op({ op: 'upsert', path: `f${i}.md` }));
    const msg = buildCommitMessage({ ops, projectName: 'P' });
    expect(msg).toContain('…等 25 项');
    expect(msg).not.toContain('f24.md');
  });
});

describe('enqueueGitFlush', () => {
  it('singletonKey=projectId，startAfter 向上取整，失败不抛出', async () => {
    const sent: Array<{ queue: string; data: unknown; options: object }> = [];
    const send = async (queue: string, data: unknown, options?: object) => {
      sent.push({ queue, data, options: options ?? {} });
      return 'job-id';
    };
    await enqueueGitFlush({ send }, 'p1', { startAfterSeconds: 1.2, retryLimit: 3 });
    expect(sent).toEqual([
      {
        queue: 'git-flush',
        data: { projectId: 'p1' },
        options: expect.objectContaining({ singletonKey: 'p1', startAfter: 2, retryLimit: 3, retryBackoff: true }),
      },
    ]);

    const failing = async () => {
      throw new Error('boom');
    };
    await expect(enqueueGitFlush({ send: failing }, 'p2')).resolves.toBeUndefined();
  });
});
