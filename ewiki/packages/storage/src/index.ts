// ---------------------------------------------------------------------------
// @ewiki/storage —— 平台存储目录解析（server/worker 共用；Node-only）
//
// 目录约定（模拟 NAS 盘，FS_NAS_ROOT 可配置；平台设置 storage.nas_root 可运行时覆盖，
// 由 server 侧读取后以显式 root 参数传入本包函数）：
//   <root>/users/<username>/projects/<projSlug>-<id8>/   云文档镜像（与平台内结构一一对应）
//   <root>/users/<username>/sites/<slug>/                发布站点（current.json + vN/）
//   <root>/repos/<projectId>/                            Git 工作副本（server 推送用）
// ---------------------------------------------------------------------------

import path from 'node:path';

export { LocalBlobStore } from './blob-store.js';
export type { BlobStore, BlobStat, BlobRefs } from './blob-store.js';

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 解析存储根目录：env 未配置时回退 ./data-nas（相对 cwd）→ 绝对路径 */
export function resolveRoot(envRoot: string | undefined | null): string {
  const raw = envRoot && envRoot.trim() ? envRoot : './data-nas';
  return path.resolve(raw);
}

/** 目录名清洗：保留中英文/数字/点/连字符，压缩空白为连字符 */
export function slugifyName(name: string): string {
  const s = toPosix(String(name))
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/[^.\w\u4e00-\u9fa5-]/g, '')
    .replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

export function userRoot(root: string, username: string): string {
  return path.join(root, 'users', slugifyName(username));
}

/** 用户分配存储下的项目（文档库）镜像目录；id 前 8 位防同名冲突 */
export function projectMirrorDir(
  root: string,
  username: string,
  projectName: string,
  projectId: string,
): string {
  return path.join(
    userRoot(root, username),
    'projects',
    `${slugifyName(projectName)}-${projectId.slice(0, 8)}`,
  );
}

export function siteDir(root: string, username: string, slug: string): string {
  return path.join(userRoot(root, username), 'sites', slug);
}

export function siteVersionDir(
  root: string,
  username: string,
  slug: string,
  version: number,
): string {
  return path.join(siteDir(root, username, slug), `v${version}`);
}

export function reposRoot(root: string): string {
  return path.join(root, 'repos');
}

export function repoWorkDir(root: string, projectId: string): string {
  return path.join(reposRoot(root), projectId);
}

/** rel 路径安全拼接：禁止 .. 逃逸与绝对路径注入（PATH_ESCAPED） */
export function safeJoin(base: string, rel: string): string {
  const norm = toPosix(rel).replace(/^\/+/, '');
  if (norm.includes('..')) throw new Error('PATH_ESCAPED');
  const abs = path.resolve(base, norm);
  const baseAbs = path.resolve(base);
  if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) throw new Error('PATH_ESCAPED');
  return abs;
}
