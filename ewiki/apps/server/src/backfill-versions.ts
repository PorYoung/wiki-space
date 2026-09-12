// ---------------------------------------------------------------------------
// document_versions 历史回填：从本地 Git 工作副本（<FS_ROOT>/repos/<projectId>）
// 按文件反查 git log，为「没有任何版本记录」的文档补建提交维度快照。
//
// 背景：2026-09-12 初始化提交补写 v1 快照的修复仅对新项目生效；更早的 Git 文档库
// （以及 worker 外部推送同步）没有 document_versions 行，版本时间线缺失。
//
// 幂等策略：文档已有任意版本行 → 整篇跳过（避免与线上 max(version_no)+1 序列冲突）；
//           重复执行不会产生重复数据。
//
// 用法：
//   pnpm --filter @ewiki/server backfill:versions                 # 默认 dry-run，只打印
//   pnpm --filter @ewiki/server backfill:versions --write         # 实际写入
//   pnpm --filter @ewiki/server backfill:versions <projectId>     # 仅处理指定项目
//   pnpm --filter @ewiki/server backfill:versions --repo-root D:/x/repos
// ---------------------------------------------------------------------------

import 'dotenv/config';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { and, eq, isNull } from 'drizzle-orm';
import { db, sql } from './db/client.js';
import { documentVersions, documents, projectMembers, projects, users } from './db/schema.js';
import { buildAddedSummary, buildChangedSummary } from './lib/diff-summary.js';

const exec = promisify(execFile);

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const projectFilter = args.find((a) => !a.startsWith('--')) ?? null;
const repoRootFlag = args.indexOf('--repo-root');
const repoRoot =
  repoRootFlag >= 0 && args[repoRootFlag + 1]
    ? path.resolve(args[repoRootFlag + 1])
    : path.resolve(process.cwd(), process.env.FS_ROOT ?? './data', 'repos');

interface FileCommit {
  hash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
  content: string;
  changedSummary: { lines: string[] } | null;
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout;
}

async function isUsableWorkdir(workdir: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--is-inside-work-tree'], workdir);
    await git(['rev-parse', '--verify', 'HEAD'], workdir);
    return true;
  } catch {
    return false;
  }
}

interface ParsedBlock {
  hash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
  statusLines: string[];
}

// 字段分隔：提交头 \x1e 分隔块、\x1f 分隔字段；正文不进格式，避免解析歧义
async function logFileHistory(workdir: string, docPath: string): Promise<ParsedBlock[]> {
  const raw = await git(
    [
      'log',
      '--follow',
      '--date=iso-strict',
      '--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s',
      '--name-status',
      '--',
      docPath,
    ],
    workdir,
  );
  return raw
    .split('\x1e')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n').filter((l) => l.length > 0);
      const [hash, authorName, authorEmail, date, subject] = lines[0].split('\x1f');
      return { hash, authorName, authorEmail, date, subject, statusLines: lines.slice(1) };
    });
}

interface StatusMatch {
  code: string;
  oldPath: string;
  newPath: string;
}

function matchStatus(line: string, curPath: string): StatusMatch | null {
  const parts = line.split('\t');
  const code = parts[0] ?? '';
  if (code.startsWith('R') || code.startsWith('C')) {
    const oldPath = parts[1] ?? '';
    const newPath = parts[2] ?? '';
    if (newPath === curPath || oldPath === curPath) return { code, oldPath, newPath };
    return null;
  }
  const p = parts[1] ?? '';
  if (p === curPath) return { code, oldPath: p, newPath: p };
  return null;
}

async function showBlob(workdir: string, spec: string): Promise<string | null> {
  try {
    return await git(['show', spec], workdir);
  } catch {
    return null;
  }
}

/** 单文档反查：git log 从新到旧遍历（跟踪重命名），构建后翻转成从旧到新 */
async function buildDocVersions(workdir: string, docPath: string): Promise<FileCommit[]> {
  const blocks = await logFileHistory(workdir, docPath);
  let curPath = docPath;
  const commits: FileCommit[] = [];

  for (const b of blocks) {
    const status =
      b.statusLines
        .map((l) => matchStatus(l, curPath))
        .find((m): m is StatusMatch => m !== null) ?? null;

    let pathInCommit = curPath;
    let parentPath = curPath;
    let isAdd = false;

    if (status) {
      if (status.code.startsWith('R') || status.code.startsWith('C')) {
        pathInCommit = status.newPath;
        parentPath = status.oldPath;
        curPath = status.oldPath;
      } else if (status.code === 'A') {
        pathInCommit = status.newPath;
        isAdd = true;
      } else if (status.code === 'D') {
        // 删除提交不产生快照（同路径后续重新添加的场景，旧生命周期到此为止）
        continue;
      }
    }

    const content = await showBlob(workdir, `${b.hash}:${pathInCommit}`);
    if (content === null) continue;
    const oldContent = isAdd ? '' : (await showBlob(workdir, `${b.hash}^:${parentPath}`)) ?? '';
    const changedSummary = isAdd
      ? buildAddedSummary(content)
      : buildChangedSummary(oldContent, content);

    commits.push({
      hash: b.hash,
      authorName: b.authorName,
      authorEmail: b.authorEmail,
      date: b.date,
      subject: b.subject,
      content,
      changedSummary,
    });
  }

  return commits.reverse();
}

async function projectUsers(projectId: string, ownerId: string): Promise<Array<{ id: string; name: string; email: string }>> {
  const members = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .innerJoin(projectMembers, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId));
  if (!members.some((m) => m.id === ownerId)) {
    const [owner] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1);
    if (owner) members.push(owner);
  }
  return members;
}

function resolveAuthor(
  people: Array<{ id: string; name: string; email: string }>,
  email: string,
  name: string,
): string | null {
  const byEmail = people.find((p) => p.email.toLowerCase() === email.toLowerCase());
  if (byEmail) return byEmail.id;
  const byName = people.find((p) => p.name === name);
  return byName?.id ?? null;
}

async function main(): Promise<void> {
  console.log(`模式：${WRITE ? '写入（--write）' : 'dry-run（仅预览，加 --write 实际写入）'}`);
  console.log(`工作副本根：${repoRoot}`);

  const gitProjects = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.storageKind, 'git'),
        isNull(projects.deletedAt),
        ...(projectFilter ? [eq(projects.id, projectFilter)] : []),
      ),
    );

  if (gitProjects.length === 0) {
    console.log(projectFilter ? `未找到 Git 项目：${projectFilter}` : '没有 Git 类型的文档库');
    return;
  }

  let scannedProjects = 0;
  let skippedNoWorkdir = 0;
  let docsBackfilled = 0;
  let docsAlready = 0;
  let rowsCreated = 0;
  let failed = 0;

  for (const project of gitProjects) {
    const workdir = path.join(repoRoot, project.id);
    if (!(await isUsableWorkdir(workdir))) {
      console.log(`⏭  ${project.name}（${project.id}）：无可用工作副本，跳过`);
      skippedNoWorkdir++;
      continue;
    }
    scannedProjects++;
    console.log(`\n● 项目：${project.name}（${project.id}）`);

    const docs = await db
      .select({ id: documents.id, path: documents.path, title: documents.title })
      .from(documents)
      .where(and(eq(documents.projectId, project.id), isNull(documents.deletedAt)));

    const existing = await db
      .select({ documentId: documentVersions.documentId })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(eq(documents.projectId, project.id));
    const docsWithVersions = new Set(existing.map((r) => r.documentId));

    const people = await projectUsers(project.id, project.ownerId);
    const makeRow = (docId: string, versionNo: number, c: FileCommit) => ({
      documentId: docId,
      versionNo,
      commitHash: c.hash,
      authorId: resolveAuthor(people, c.authorEmail, c.authorName),
      authorNames: [c.authorName].filter(Boolean),
      message: c.subject || null,
      content: c.content,
      changedSummary: c.changedSummary,
      createdAt: new Date(c.date),
    });
    const projectRows: ReturnType<typeof makeRow>[] = [];

    for (const doc of docs) {
      if (docsWithVersions.has(doc.id)) {
        docsAlready++;
        continue;
      }
      let history: FileCommit[];
      try {
        history = await buildDocVersions(workdir, doc.path);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${doc.path}：git 反查失败 — ${(e as Error).message.split('\n')[0]}`);
        continue;
      }
      if (history.length === 0) {
        console.log(`  · ${doc.path}：git 历史中无记录，跳过`);
        continue;
      }
      docsBackfilled++;
      history.forEach((c, i) => projectRows.push(makeRow(doc.id, i + 1, c)));
      const head = history[history.length - 1];
      console.log(
        `  + ${doc.path}：补 ${history.length} 个版本（${history[0].hash.slice(0, 8)} → ${head.hash.slice(0, 8)}）`,
      );
    }

    rowsCreated += projectRows.length;
    if (WRITE && projectRows.length > 0) {
      await db.insert(documentVersions).values(projectRows);
      console.log(`  已写入 ${projectRows.length} 行 document_versions`);
    }
  }

  console.log('\n──────── 汇总 ────────');
  console.log(`扫描项目：${scannedProjects}（无工作副本跳过：${skippedNoWorkdir}）`);
  console.log(`待回填文档：${docsBackfilled}，已有版本跳过文档：${docsAlready}`);
  console.log(`${WRITE ? '已写入版本行' : '将写入版本行（dry-run）'}：${rowsCreated}`);
  if (failed > 0) console.log(`失败文档：${failed}（请查看上方日志）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
