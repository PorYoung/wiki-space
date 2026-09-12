// ---------------------------------------------------------------------------
// @ewiki/storage —— 内容寻址 Blob 存储（二进制文件；Node-only）
//
// 物理布局：<root>/blobs/<sha256 前2位>/<其余62位>
// ref 格式：sha256:<hex64>；相同内容只落一份物理对象（天然去重）
// ---------------------------------------------------------------------------

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import type { Readable } from 'node:stream';
import path from 'node:path';
import { safeJoin } from './index.js';

const REF_RE = /^sha256:([0-9a-f]{64})$/;

export interface BlobStat {
  size: number;
}

/**
 * refCount 需要的最小依赖注入集合（BlobStore 不依赖 db 包）。
 * 所有字段都是 any —— 运行时再交给 drizzle 处理，BlobStore 只做协议层转发。
 */
export interface BlobRefs {
  /** drizzle-orm 的 sql template literal（用于构造 COALESCE/COUNT 原语） */
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
  /** drizzle eq() 构造器 */
  eq: (col: any, val: unknown) => unknown;
  /** drizzle isNull() 构造器；不传则 refCount 不做软删过滤 */
  isNull?: (col: any) => unknown;
  /** drizzle and() 构造器；不传则单条件查询 */
  and?: (...conds: unknown[]) => unknown;
  /** drizzle db 执行器（any，运行时转发） */
  db: any;
  /** documents 表（drizzle pgTable 返回值） */
  documentTable: any;
  /** document_versions 表（drizzle pgTable 返回值） */
  versionTable: any;
  /** documents.storage_ref 列 */
  documentStorageRefCol: any;
  /** document_versions.storage_ref 列 */
  versionStorageRefCol: any;
  /** documents.deleted_at 列（可选；用于排除软删文档引用） */
  documentDeletedAtCol?: any;
}

export interface BlobStore {
  put(buf: Buffer): Promise<string>;
  get(ref: string): Promise<Buffer>;
  createReadStream(ref: string): Readable;
  stat(ref: string): Promise<BlobStat>;
  exists(ref: string): Promise<boolean>;
  delete(ref: string): Promise<void>;

  /**
   * 遍历 blob 根目录返回所有物理存在的 ref（sha256:hex64）。
   * 物理布局 <root>/blobs/<hex2>/<hex62>；空目录不报错。
   * 用于 GC：盘点「磁盘上有、DB 没引用」的 orphan。
   *
   * 设计文档 §7.4（风险对策 → blob 垃圾累积）。
   */
  listAllRefs(): Promise<string[]>;

  /**
   * 查询该 ref 的活跃引用数（documents.storageRef + document_versions.storageRef）。
   * 排除 documents 软删（deletedAt IS NOT NULL）——软删文档不再被读取，其 blob 视为可回收。
   *
   * refCount 本身不持有 DB 依赖：调用方（GC cron / 手动触发）通过 refs 参数注入 db + table + drizzle 原语。
   * 返回值 = documents 命中数（软删已过滤） + document_versions 命中数。
   */
  refCount(ref: string, refs: BlobRefs): Promise<number>;
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

  async listAllRefs(): Promise<string[]> {
    const blobsDir = path.join(this.root, 'blobs');
    let prefixDirs: Dirent[];
    try {
      prefixDirs = await fs.readdir(blobsDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      throw err;
    }
    const out: string[] = [];
    for (const prefix of prefixDirs) {
      if (!prefix.isDirectory()) continue;
      if (!/^[0-9a-f]{2}$/i.test(prefix.name)) continue;
      const fullPrefix = path.join(blobsDir, prefix.name);
      let files: Dirent[];
      try {
        files = await fs.readdir(fullPrefix, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
        throw err;
      }
      for (const f of files) {
        if (!f.isFile()) continue;
        // ref = sha256:<prefix(2)><suffix(62)> = sha256:<hex64>
        const hex = prefix.name + f.name;
        if (!/^[0-9a-f]{64}$/i.test(hex)) continue;
        out.push(`sha256:${hex}`);
      }
    }
    return out;
  }

  async refCount(ref: string, refs: BlobRefs): Promise<number> {
    // 先确认 ref 格式（避免任意字符串注入）
    const m = REF_RE.exec(ref);
    if (!m) throw new Error('BLOB_BAD_REF');

    // documents.storage_ref 命中数（排除软删）
    const docWhere = refs.documentDeletedAtCol && refs.isNull && refs.and
      ? refs.and(refs.eq(refs.documentStorageRefCol, ref), refs.isNull(refs.documentDeletedAtCol))
      : refs.eq(refs.documentStorageRefCol, ref);

    const [docRow] = await refs.db
      .select({ c: refs.sql`coalesce(count(${refs.documentStorageRefCol}), 0)` })
      .from(refs.documentTable)
      .where(docWhere);

    // document_versions.storage_ref 命中数（版本表无软删列）
    const [verRow] = await refs.db
      .select({ c: refs.sql`coalesce(count(${refs.versionStorageRefCol}), 0)` })
      .from(refs.versionTable)
      .where(refs.eq(refs.versionStorageRefCol, ref));

    const docCount = Number(docRow?.c ?? 0);
    const verCount = Number(verRow?.c ?? 0);
    return docCount + verCount;
  }
}
