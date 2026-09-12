// ---------------------------------------------------------------------------
// @ewiki/storage —— 内容寻址 Blob 存储（二进制文件；Node-only）
//
// 物理布局：<root>/blobs/<sha256 前2位>/<其余62位>
// ref 格式：sha256:<hex64>；相同内容只落一份物理对象（天然去重）
// ---------------------------------------------------------------------------

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { Readable } from 'node:stream';
import path from 'node:path';
import { safeJoin } from './index.js';

const REF_RE = /^sha256:([0-9a-f]{64})$/;

export interface BlobStat {
  size: number;
}

export interface BlobStore {
  put(buf: Buffer): Promise<string>;
  get(ref: string): Promise<Buffer>;
  createReadStream(ref: string): Readable;
  stat(ref: string): Promise<BlobStat>;
  exists(ref: string): Promise<boolean>;
  delete(ref: string): Promise<void>;
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 校验 ref 并返回 hex；非法格式 / 路径逃逸抛 BLOB_BAD_REF */
function resolveBlobPath(root: string, ref: string): { hex: string; file: string } {
  const m = REF_RE.exec(ref);
  if (!m) throw new Error('BLOB_BAD_REF');
  const hex = m[1];
  const rel = path.posix.join('blobs', hex.slice(0, 2), hex.slice(2));
  const file = safeJoin(root, rel);
  return { hex, file };
}

export class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private target(ref: string): { file: string } {
    return { file: resolveBlobPath(this.root, ref).file };
  }

  async put(buf: Buffer): Promise<string> {
    const hex = sha256Hex(buf);
    const ref = `sha256:${hex}`;
    const { file } = this.target(ref);
    try {
      await fs.access(file);
      return ref;
    } catch {
      // 不存在则继续写入
    }
    const dir = path.dirname(file);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.tmp-${hex.slice(0, 16)}-${randomUUID()}`);
    await fs.writeFile(tmp, buf);
    try {
      await fs.rename(tmp, file);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(file, buf);
        return ref;
      }
      throw e;
    }
    return ref;
  }

  async get(ref: string): Promise<Buffer> {
    const { file } = this.target(ref);
    return fs.readFile(file);
  }

  createReadStream(ref: string): Readable {
    const { file } = this.target(ref);
    return createReadStream(file);
  }

  async stat(ref: string): Promise<BlobStat> {
    const { file } = this.target(ref);
    const st = await fs.stat(file);
    return { size: st.size };
  }

  async exists(ref: string): Promise<boolean> {
    const { file } = this.target(ref);
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  async delete(ref: string): Promise<void> {
    const { file } = this.target(ref);
    await fs.rm(file, { force: true });
  }
}
