// ---------------------------------------------------------------------------
// P5 补单测：storage/blob-store-gc —— listAllRefs + refCount 核心行为
// ---------------------------------------------------------------------------

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalBlobStore, type BlobRefs } from './blob-store.js';

describe('LocalBlobStore — listAllRefs / refCount', () => {
  let root: string;
  let store: LocalBlobStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ewiki-blob-gc-'));
    store = new LocalBlobStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('空 blob 根 → listAllRefs 返回 []', async () => {
    const refs = await store.listAllRefs();
    expect(refs).toEqual([]);
  });

  it('put 3 个 blob → listAllRefs 返回 3（去重前）', async () => {
    const r1 = await store.put(Buffer.from('a'));
    const r2 = await store.put(Buffer.from('b'));
    const r3 = await store.put(Buffer.from('c'));
    const refs = await store.listAllRefs();
    expect(refs.sort()).toEqual([r1, r2, r3].sort());
    expect(refs).toHaveLength(3);
  });

  it('listAllRefs 去重：相同内容只计 1', async () => {
    const r1 = await store.put(Buffer.from('dup'));
    const r2 = await store.put(Buffer.from('dup'));
    expect(r1).toBe(r2);
    expect(await store.listAllRefs()).toHaveLength(1);
  });

  it('delete 1 个 → listAllRefs 减少 1', async () => {
    const r1 = await store.put(Buffer.from('a'));
    const r2 = await store.put(Buffer.from('b'));
    await store.delete(r1);
    const refs = await store.listAllRefs();
    expect(refs).toEqual([r2]);
  });

  it('listAllRefs 跳过非 hex 前缀目录和非 hex 文件名（鲁棒性）', async () => {
    const r = await store.put(Buffer.from('ok'));
    const fs = await import('node:fs/promises');
    const root_blobs = path.join(root, 'blobs');
    await fs.mkdir(path.join(root_blobs, 'ZZ'), { recursive: true }); // 非 hex 前缀
    await fs.writeFile(path.join(root_blobs, 'ZZ', 'garbage'), 'x');
    await fs.mkdir(path.join(root_blobs, 'aa', 'nested'), { recursive: true }); // 非文件
    const refs = await store.listAllRefs();
    expect(refs).toEqual([r]);
  });

  it('refCount: 非法 ref 立即抛 BLOB_BAD_REF', async () => {
    const mockRefs = buildMockRefs({ docRows: [{ c: 1 }], verRows: [{ c: 1 }] });
    await expect(store.refCount('bad-ref', mockRefs)).rejects.toThrow('BLOB_BAD_REF');
  });

  it('refCount: documents 命中 + document_versions 命中 = 合计', async () => {
    const targetRef = 'sha256:' + 'a'.repeat(64);
    // docRows 是 select(documents) 的结果，verRows 是 select(versions) 的结果
    const mockRefs = buildMockRefs({ docRows: [{ c: 2 }], verRows: [{ c: 3 }] });
    const count = await store.refCount(targetRef, mockRefs);
    expect(count).toBe(5);
  });

  it('refCount: 无匹配 → 0', async () => {
    const targetRef = 'sha256:' + 'b'.repeat(64);
    const mockRefs = buildMockRefs({ docRows: [{ c: 0 }], verRows: [{ c: 0 }] });
    const count = await store.refCount(targetRef, mockRefs);
    expect(count).toBe(0);
  });

  it('refCount: null coalesce 兜底空结果集为 0', async () => {
    const targetRef = 'sha256:' + 'c'.repeat(64);
    // 空数组 → [docRow] = undefined → docRow?.c = undefined → Number(undefined ?? 0) = 0
    const mockRefs = buildMockRefs({ docRows: [], verRows: [] });
    const count = await store.refCount(targetRef, mockRefs);
    expect(count).toBe(0);
  });
});

// ---- refCount 需要的 BlobRefs mock ----
// 关键：refs.db.select().from(table).where(cond) 被调用两次
// 第一次 from(documentTable) → 返回 docRows
// 第二次 from(versionTable)  → 返回 verRows
function buildMockRefs(overrides: { docRows?: any[]; verRows?: any[] } = {}): BlobRefs {
  const docRows = overrides.docRows ?? [{ c: 1 }];
  const verRows = overrides.verRows ?? [{ c: 1 }];

  let rowsPool: any[] = [];

  const dbSelect: any = vi.fn(() => ({
    from: vi.fn((table: any) => {
      // 根据 table 决定返回哪组 rows
      rowsPool = table?.$ref === 'versions' ? verRows : docRows;
      return {
        where: vi.fn((_cond: any) => rowsPool),
      };
    }),
  }));

  // 给 table 加个标识，让我们判断是 document 还是 version
  const documentTable = { _name: 'documents', $ref: 'documents' };
  const versionTable = { _name: 'document_versions', $ref: 'versions' };

  return {
    sql: vi.fn((strings: TemplateStringsArray, ..._vals: unknown[]) => strings.join('')),
    eq: vi.fn((_col: any, _val: unknown) => ({ _op: 'eq' })),
    isNull: vi.fn((_col: any) => ({ _op: 'isNull' })),
    and: vi.fn((...conds: unknown[]) => ({ _op: 'and', conds })),
    db: { select: dbSelect } as any,
    documentTable,
    versionTable,
    documentStorageRefCol: { _col: 'storage_ref' },
    versionStorageRefCol: { _col: 'storage_ref' },
    documentDeletedAtCol: { _col: 'deleted_at' },
  };
}
