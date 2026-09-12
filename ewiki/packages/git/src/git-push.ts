// ---------------------------------------------------------------------------
// Git 工作副本管线：平台内保存/删除文档 → 工作副本写文件 → add/commit/push；
// worker 同步 → 确保工作副本存在 → 拉取远端最新 → 消化 Markdown。
// 工作副本位于 <FS_ROOT>/repos/<projectId>；首次使用时用连接配置克隆（完整克隆，可推送）。
// 每条 git 命令限时 120s；凭据仅注入远端 URL，不落盘。
// 本包由 server 与 worker 共用，不归属任一 app。
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
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
      GCM_INTERACTIVE: 'never',
      NO_PROXY: 'localhost,127.0.0.1,::1',
      no_proxy: 'localhost,127.0.0.1,::1',
    },
  });
  return stdout;
}

// 回环地址直连：本机代理（git 全局 http.proxy）对 `localhost` 主机名的路由处理不可靠
// （实测 push 96s、clone 挂死 120s+），而 `127.0.0.1` 直连稳定毫秒级。
// 策略：回环 URL 一律重写主机名为 127.0.0.1 + 显式清空代理；非回环主机保持用户代理配置。
export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

export function loopbackDirectUrl(url: string): string {
  try {
    const u = new URL(url);
    if (isLoopbackHost(u.hostname) && u.hostname !== '127.0.0.1') {
      u.hostname = '127.0.0.1';
      return u.toString();
    }
  } catch {
    /* 非 URL 形态远端（ssh scp 语法等）不处理 */
  }
  return url;
}

export function proxyBypassArgs(url: string): string[] {
  try {
    if (isLoopbackHost(new URL(url).hostname)) {
      return ['-c', 'http.proxy=', '-c', 'https.proxy='];
    }
  } catch {
    /* 非 URL 形态远端不处理 */
  }
  return [];
}

async function hasCommits(workdir: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', 'HEAD'], workdir);
    return true;
  } catch {
    return false;
  }
}

/** 确保工作副本存在（缺失时完整克隆）；返回是否已有提交与当前分支名 */
export async function ensureWorkdir(
  root: string,
  projectId: string,
  conn: ConnLike,
  repoCloneUrl: string,
  login: string,
  defaultBranch: string,
): Promise<{ workdir: string; hadCommits: boolean; branch: string }> {
  // root 即 Git 工作副本根目录（<FS_ROOT>/repos），工作副本 = <root>/<projectId>
  const workdir = path.join(root, projectId);
  const cloned = await fs
    .access(path.join(workdir, '.git'))
    .then(() => true, () => false);
  if (!cloned) {
    await fs.mkdir(path.dirname(workdir), { recursive: true });
    const cloneUrl = loopbackDirectUrl(
      authenticatedCloneUrl(
        conn,
        { fullPath: '', cloneUrl: repoCloneUrl, defaultBranch, webUrl: '' },
        login,
      ),
    );
    try {
      await git([...proxyBypassArgs(cloneUrl), 'clone', cloneUrl, workdir]);
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

/**
 * 拉取远端最新（worker 周期/手动同步用）：
 * 先 fetch 指定分支，再按快进方式合并到当前分支；工作副本不允许本地提交，
 * 因此出现分叉时直接硬重置到远端（平台副本只是远端的镜像）。
 * 返回拉取后的 HEAD 提交哈希，以及本次是否真正前进（advanced=false 表示远端无增量）。
 */
export async function pullWorkdir(
  workdir: string,
  branch: string,
): Promise<{ commitHash: string | null; advanced: boolean }> {
  const remote = (await git(['remote', 'get-url', 'origin'], workdir).catch(() => '')).trim();
  if (!remote) throw new Error('工作副本缺少 origin 远端，无法同步');
  const directUrl = loopbackDirectUrl(remote);
  if (directUrl && directUrl !== remote) {
    await git(['remote', 'set-url', 'origin', directUrl], workdir).catch(() => undefined);
  }
  const ref = branch || 'main';
  await git([...proxyBypassArgs(directUrl || remote), 'fetch', 'origin', ref], workdir);
  const local = (await git(['rev-parse', 'HEAD'], workdir).catch(() => '')).trim();
  const remoteHead = (await git(['rev-parse', 'FETCH_HEAD'], workdir).catch(() => '')).trim();
  if (!remoteHead) {
    // 远端仍为空仓库（无任何提交）：无内容可拉取
    return { commitHash: local || null, advanced: false };
  }
  let advanced = false;
  if (local !== remoteHead) {
    // 快进合并失败（本地与远端分叉）时硬重置为远端：工作副本无本地提交语义
    await git(['merge', '--ff-only', 'FETCH_HEAD'], workdir).catch(() =>
      git(['reset', '--hard', 'FETCH_HEAD'], workdir),
    );
    advanced = true;
  }
  const commitHash = (await git(['rev-parse', 'HEAD'], workdir)).trim();
  return { commitHash: commitHash || null, advanced };
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
      // push 前读取远端地址：回环主机重写为 127.0.0.1 直连并同步回工作副本配置
      const remoteUrl = (await git(['remote', 'get-url', 'origin'], workdir).catch(() => '')).trim();
      const directUrl = loopbackDirectUrl(remoteUrl);
      if (directUrl && directUrl !== remoteUrl) {
        await git(['remote', 'set-url', 'origin', directUrl], workdir).catch(() => undefined);
      }
      await git([...proxyBypassArgs(directUrl || remoteUrl), 'push', 'origin', 'HEAD'], workdir);
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

/** 向工作副本直接写入一批文件（模板初始化用，不提交） */
export async function seedWorkdirFiles(workdir: string, files: Array<{ path: string; content: string }>): Promise<void> {
  for (const f of files) {
    const abs = safeJoin(workdir, f.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, f.content, 'utf8');
  }
}

export { connToken };
