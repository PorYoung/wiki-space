// ---------------------------------------------------------------------------
// P5 补单测：server/lib/blob-gc — runBlobGC 纯逻辑
//   - orphan 识别（磁盘有、DB 无）
//   - 二次确认安全网（refCount > 0 拦截）
//   - limit 截断
//   - 删除失败走 failed 列表
//   - activities 写失败不影响主流程
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { runBlobGC, type BlobGCRunInput } from './blob-gc.js';

// ---- helpers ----
const makeRef = (hexPrefix: string) =>
  `sha256:${hexPrefix}${'a'.repeat(62 - hexPrefix.length)}`;

function buildMockDeps(opts: {
  docRows?: Array<{ ref: string }>;
  verRows?: Array<{ ref: string }>;
  onDiskRefs?: string[];
  refCounts?: Record<string, number>; // ref → refCount 返回值
  deleteErrors?: Record<string, Error>; // ref → delete 抛错
  activitiesOk?: boolean;
  snapshotsOk?: boolean;
  snapshotsCount?: number;
  limit?: number;
}) {
  const onDiskRefs = opts.onDiskRefs ?? [];
  const refCounts = opts.refCounts ?? {};
  const deleteErrors = opts.deleteErrors ?? {};

  const insertedActivities: any[] = [];

  const mockDb: any = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          // 根据调用次数决定返回 docRows 还是 verRows
          // 简化：我们直接把 docRows/verRows 放两个独立 select
          return null; // 真实 where() 的返回由下面 override 控制
        }),
      })),
    })),
  };

  // 更简化的方式：直接让 select().from().where() 按调用栈返回
  // 由于 runBlobGC 调用了两次 select（documents 和 versions），
  // 我们用一个内部计数器来区分
  let selectCall = 0;
  const docRows = opts.docRows ?? [];
  const verRows = opts.verRows ?? [];

  mockDb.select = vi.fn(() => {
    selectCall++;
    const rows = selectCall === 1 ? docRows : verRows;
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => rows),
      })),
    };
  });

  // 删除 ydoc_snapshots
  mockDb.delete = vi.fn(() => {
    if (!opts.snapshotsOk) {
      throw new Error('snapshots down');
    }
    return {
      where: vi.fn((_cond: any) => {
        // snapshots 删除条件不关心，只要返回数组就行
        return opts.snapshotsCount !== undefined
          ? Array.from({ length: opts.snapshotsCount }, () => ({ id: 1 }))
          : [];
      }),
    };
  });

  // insert activities
  mockDb.insert = vi.fn(() => ({
    values: vi.fn((v: any) => {
      if (!opts.activitiesOk) {
        throw new Error('activities down');
      }
      insertedActivities.push(v);
      return { returning: vi.fn(() => []) };
    }),
  }));

  const mockStore = {
    listAllRefs: vi.fn(async () => onDiskRefs),
    refCount: vi.fn(async (ref: string) => refCounts[ref] ?? 0),
    delete: vi.fn(async (ref: string) => {
      const err = deleteErrors[ref];
      if (err) throw err;
    }),
  };

  return { mockDb, mockStore, insertedActivities, getSelectCall: () => selectCall };
}

function run(input: Partial<BlobGCRunInput> & {
  docRows?: Array<{ ref: string }>;
  verRows?: Array<{ ref: string }>;
  onDiskRefs?: string[];
  refCounts?: Record<string, number>;
  deleteErrors?: Record<string, Error>;
  activitiesOk?: boolean;
  snapshotsOk?: boolean;
  snapshotsCount?: number;
  limit?: number;
}) {
  const { docRows, verRows, onDiskRefs, refCounts, deleteErrors, activitiesOk, snapshotsOk, snapshotsCount, limit, ...rest } = input;
  const { mockDb, mockStore, insertedActivities } = buildMockDeps({
    docRows, verRows, onDiskRefs, refCounts, deleteErrors, activitiesOk, snapshotsOk, snapshotsCount,
  });

  // 需要先准备好 select 的调用顺序，因为 doc 和 ver select 会交替
  const gcInput: BlobGCRunInput = {
    db: mockDb,
    store: mockStore as any,
    limit,
    ...rest,
  };
  return runBlobGC(gcInput).then((res) => ({ res, mockDb, mockStore, insertedActivities }));
}

describe('runBlobGC', () => {
  it('无 orphan → 全 0 删除', async () => {
    const refA = makeRef('aa');
    const refB = makeRef('bb');
    const { res } = await run({
      docRows: [{ ref: refA }],
      verRows: [],
      onDiskRefs: [refA, refB],
      refCounts: {}, // 都返回 0，说明 refB 也是 orphan
    });
    expect(res.totalOnDisk).toBe(2);
    expect(res.totalReferenced).toBe(1);
    expect(res.candidates).toBe(1);
    expect(res.safetyNetRejected).toBe(0);
    expect(res.deleted).toBe(1);
    expect(res.failed).toHaveLength(0);
  });

  it('refCount > 0 命中安全网 → 跳过', async () => {
    const refA = makeRef('aa');
    const refB = makeRef('bb');
    const { res } = await run({
      docRows: [{ ref: refA }],
      verRows: [],
      onDiskRefs: [refA, refB],
      refCounts: { [refB]: 5 }, // refB 被并发写入挂住了
    });
    expect(res.candidates).toBe(1);
    expect(res.safetyNetRejected).toBe(1);
    expect(res.deleted).toBe(0);
  });

  it('limit 截断：超过 limit 后 truncated 剩余', async () => {
    const orphans = [makeRef('10'), makeRef('20'), makeRef('30'), makeRef('40')];
    const { res } = await run({
      docRows: [],
      verRows: [],
      onDiskRefs: orphans,
      refCounts: {}, // 全 0
      limit: 2,
    });
    expect(res.candidates).toBe(4);
    expect(res.deleted).toBe(2);
    expect(res.truncated).toBe(2);
  });

  it('store.delete 抛错 → 进 failed 列表，不中断循环', async () => {
    const okRef = makeRef('10');
    const badRef = makeRef('20');
    const { res } = await run({
      docRows: [],
      verRows: [],
      onDiskRefs: [okRef, badRef],
      refCounts: {},
      deleteErrors: { [badRef]: new Error('EIO') },
    });
    expect(res.deleted).toBe(1);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].ref).toBe(badRef);
    expect(res.failed[0].error).toContain('EIO');
  });

  it('safetyNet + delete 错误 + success 混合', async () => {
    const refs = [makeRef('10'), makeRef('20'), makeRef('30'), makeRef('40')];
    const { res } = await run({
      docRows: [],
      verRows: [],
      onDiskRefs: refs,
      refCounts: { [refs[1]]: 1 }, // 安全网拦截
      deleteErrors: { [refs[2]]: new Error('boom') },
    });
    expect(res.safetyNetRejected).toBe(1);
    expect(res.failed).toHaveLength(1);
    expect(res.deleted).toBe(2); // refs[0] + refs[3]
  });

  it('activities 写失败不影响主流程', async () => {
    const orphans = [makeRef('aa'), makeRef('bb')];
    const { res, insertedActivities } = await run({
      docRows: [],
      verRows: [],
      onDiskRefs: orphans,
      refCounts: {},
      activitiesOk: false,
    });
    expect(res.deleted).toBe(2);
    expect(insertedActivities).toHaveLength(0); // 失败了
  });

  it('activities 成功写入 targetType=system / verb=gc_blob', async () => {
    const orphans = [makeRef('aa')];
    const { insertedActivities } = await run({
      docRows: [],
      verRows: [],
      onDiskRefs: orphans,
      refCounts: {},
      activitiesOk: true,
    });
    expect(insertedActivities).toHaveLength(1);
    const act = insertedActivities[0];
    expect(act.projectId).toBeNull();
    expect(act.verb).toBe('gc_blob');
    expect(act.targetType).toBe('system');
    expect(act.meta.deleted).toBe(1);
    expect(act.meta.candidates).toBe(1);
  });
});
