import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalBlobStore } from './blob-store.js';

describe('LocalBlobStore', () => {
  let root: string;
  let store: LocalBlobStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ewiki-blob-'));
    store = new LocalBlobStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('put/get roundtrip 且 ref 与路径符合 blobs/<前2>/<余62>', async () => {
    const buf = Buffer.from('hello-blob\n');
    const ref = await store.put(buf);
    expect(ref).toMatch(/^sha256:[0-9a-f]{64}$/);
    const hex = ref.slice('sha256:'.length);
    const file = path.join(root, 'blobs', hex.slice(0, 2), hex.slice(2));
    expect(await readFile(file)).toEqual(buf);
    expect(await store.get(ref)).toEqual(buf);
  });

  it('相同内容去重：只保留一份物理对象', async () => {
    const buf = Buffer.from('dedup-content');
    const r1 = await store.put(buf);
    const r2 = await store.put(Buffer.from('dedup-content'));
    expect(r1).toBe(r2);
    const shards = await readdir(path.join(root, 'blobs'));
    const files = await readdir(path.join(root, 'blobs', shards[0]));
    expect(files).toHaveLength(1);
    expect(await store.exists(r1)).toBe(true);
    expect((await store.stat(r1)).size).toBe(buf.length);
  });

  it('createReadStream 可流式读取', async () => {
    const buf = Buffer.from('stream-me');
    const ref = await store.put(buf);
    const stream = store.createReadStream(ref);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks)).toEqual(buf);
  });

  it('delete 后 exists 为 false，再 get 抛错', async () => {
    const ref = await store.put(Buffer.from('bye'));
    await store.delete(ref);
    expect(await store.exists(ref)).toBe(false);
    await expect(store.get(ref)).rejects.toBeTruthy();
  });

  it('非法 ref 被拒绝（exists/get/stat/delete）', async () => {
    for (const bad of ['', 'sha256:nope', 'md5:abc', 'sha256:' + 'z'.repeat(64)]) {
      await expect(store.exists(bad)).rejects.toThrow('BLOB_BAD_REF');
      await expect(store.get(bad)).rejects.toThrow('BLOB_BAD_REF');
      await expect(store.stat(bad)).rejects.toThrow('BLOB_BAD_REF');
    }
  });

  it('伪造的 ref 无法通过 shard 路径逃逸（hex 约束拒绝分隔符）', async () => {
    const evil = 'sha256:' + 'ab'.repeat(32) + '/../pwned';
    await expect(store.exists(evil)).rejects.toThrow('BLOB_BAD_REF');
    await expect(store.get(evil)).rejects.toThrow('BLOB_BAD_REF');
    const outside = path.join(path.dirname(root), 'pwned');
    await expect(stat(outside)).rejects.toBeTruthy();
  });
});
