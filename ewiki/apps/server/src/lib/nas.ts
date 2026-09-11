// ---------------------------------------------------------------------------
// NAS 落盘镜像（需求 2）与平台设置读取：
//   - 云文档在 PG 之外，同步镜像到 <NAS_ROOT>/users/<user>/projects/<proj>/<path>
//   - NAS 根目录可被管理员在「系统管理」运行时覆盖（platform_settings.storage.nas_root）
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { resolveRoot, projectMirrorDir, safeJoin } from '@ewiki/storage';
import { db } from '../db/client.js';
import { platformSettings } from '../db/schema.js';
import type { Config } from '../config.js';

export const NAS_ROOT_SETTING_KEY = 'storage.nas_root';

/** NAS 根目录：管理员设置 > env(FS_NAS_ROOT) > ./data-nas（均解析为绝对路径） */
export async function getNasRoot(config: Config): Promise<string> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, NAS_ROOT_SETTING_KEY))
    .limit(1);
  return resolveRoot(row?.value || config.FS_NAS_ROOT);
}

/** Git 工作副本根目录（平台基础设施，置于 FS_ROOT 下，与 NAS 用户文件分离） */
export function getReposRoot(config: Config): string {
  return path.resolve(process.cwd(), config.FS_ROOT, 'repos');
}

export interface MirrorTarget {
  username: string;
  projectName: string;
  projectId: string;
}

export function mirrorDirFor(nasRoot: string, t: MirrorTarget): string {
  return projectMirrorDir(nasRoot, t.username, t.projectName, t.projectId);
}

/** 写入/更新镜像文件；content=null 表示删除 */
export async function mirrorDoc(nasRoot: string, t: MirrorTarget, docPath: string, content: string | null): Promise<void> {
  const dir = mirrorDirFor(nasRoot, t);
  const abs = safeJoin(dir, docPath);
  if (content === null) {
    await fs.rm(abs, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

/** 目录可写验证：写入探针文件后删除 */
export async function ensureWritableDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const probe = path.join(dir, `.write-test-${Date.now()}`);
  await fs.writeFile(probe, 'ok', 'utf8');
  await fs.rm(probe, { force: true });
}
