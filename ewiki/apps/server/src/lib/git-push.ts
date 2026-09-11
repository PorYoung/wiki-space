// ---------------------------------------------------------------------------
// Git 自动提交管线（需求 8）：平台内保存/删除文档 → 工作副本写文件 → add/commit/push。
// 工作副本位于 <FS_ROOT>/repos/<sourceId>；首次使用时用连接配置克隆（完整克隆，可推送）。
// 每条 git 命令限时 120s；凭据仅注入远端 URL，不落盘。
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { safeJoin } from '@ewiki/storage';
import { authenticatedCloneUrl, connToken, type ConnLike } from './git-host.js';

const exec = promisify(execFile);

export interface PushChange {
  path: string;
  op: 'upsert' | 'delete';
  content?: string;
}

export interface PushResult {
  ok: boolean;
  commitHash?: string;
  pushed: boolean;
  noop?: boolean;
  error?: string;
}

async function git(args: string[], cwd?: string, timeout = 120_000): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
    timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GCM_INTERACTIVE: 'never' },
  });
  return stdout;
}

async function hasCommits(workdir: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', 'HEAD'], workdir);
    return true;
  } catch {
    return false;
  }
}

/** 确保工作副本存在并指向最新远端；返回是否有提交 */
export async function ensureWorkdir(
  root: string,
  sourceId: string,
  conn: ConnLike,
  repoCloneUrl: string,
  login: string,
  defaultBranch: string,
): Promise<{ workdir: string; hadCommits: boolean; branch: string }> {
  // root 即 Git 工作副本根目录（<FS_ROOT>/repos），工作副本 = <root>/<sourceId>
  const workdir = path.join(root, sourceId);
  const cloned = await fs
    .access(path.join(workdir, '.git'))
    .then(() => true, () => false);
  if (!cloned) {
    await fs.mkdir(path.dirname(workdir), { recursive: true });
    const cloneUrl = authenticatedCloneUrl(
      conn,
      { fullPath: '', cloneUrl: repoCloneUrl, defaultBranch, webUrl: '' },
      login,
    );
    try {
      await git(['clone', cloneUrl, workdir]);
    } catch (e) {
      await fs.rm(workdir, { recursive: true, force: true }).catch(() => undefined);
      throw e;
    }
  }
  // 统一分支名（空仓库 clone 后 HEAD 可能仍是 master，规范化为远端默认分支名）
  let branch = defaultBranch || 'main';
  try {
    branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], workdir)).trim() || branch;
  } catch {
    /* ignore */
  }
  return { workdir, hadCommits: await hasCommits(workdir), branch };
}

/** 提交并推送一批文档变更；无差异时返回 noop */
export async function commitAndPush(
  workdir: string,
  changes: PushChange[],
  actor: { name: string; email: string },
  message: string,
): Promise<PushResult> {
  try {
    for (const ch of changes) {
      const abs = safeJoin(workdir, ch.path);
      if (ch.op === 'delete') {
        await fs.rm(abs, { force: true });
      } else {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, ch.content ?? '', 'utf8');
      }
    }
    await git(['add', '-A'], workdir);
    const status = await git(['status', '--porcelain'], workdir);
    if (!status.trim()) return { ok: true, pushed: false, noop: true };

    await git(['-c', `user.name=${actor.name}`, '-c', `user.email=${actor.email}`, 'commit', '-m', message], workdir);
    const commitHash = (await git(['rev-parse', 'HEAD'], workdir)).trim();
    try {
      await git(['push', 'origin', 'HEAD'], workdir);
      return { ok: true, commitHash, pushed: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, commitHash, pushed: false, error: cleanGitError(msg) };
    }
  } catch (e) {
    return { ok: false, pushed: false, error: cleanGitError(e instanceof Error ? e.message : String(e)) };
  }
}

export function cleanGitError(raw: string): string {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('warning:') && !l.startsWith('From ') && !l.startsWith(' * [new'))
    .pop();
  return (line ?? raw).slice(0, 300);
}

/** 向工作副本直接写入一批文件并返回相对路径（模板初始化用，不提交） */
export async function seedWorkdirFiles(workdir: string, files: Array<{ path: string; content: string }>): Promise<void> {
  for (const f of files) {
    const abs = safeJoin(workdir, f.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, f.content, 'utf8');
  }
}

export { connToken };
