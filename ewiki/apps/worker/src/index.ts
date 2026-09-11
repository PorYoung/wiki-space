import 'dotenv/config';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import PgBoss from 'pg-boss';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  activities,
  aiClassifyRuns,
  createDb,
  decryptJson,
  documentLinks,
  documents,
  importJobs,
  notifications,
  projectMembers,
  projects,
  publishJobs,
  publishSites,
  sources,
  users,
} from '@ewiki/db';
import { resolveRoot, safeJoin, siteDir, siteVersionDir } from '@ewiki/storage';
import { extractDocLinks, type Job } from '@ewiki/shared';
import type { ClassifyProvider, ImportProvider, Notifier, NotificationType } from '@ewiki/shared';
import { renderSite } from '@ewiki/render';

// Worker（SDD ADR-1：与 server 分池伸缩）
// sync 队列为真实实现（SDD 5.1）：git/local → MD 消化 → 状态机 → 动态写入 → LISTEN/NOTIFY 广播

const exec = promisify(execFile);
const { sql, db } = createDb();
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL ?? 'postgres://ewiki:ewiki@localhost:5432/ewiki',
});

const log = (msg: string, extra?: object): void =>
  console.log(JSON.stringify({ level: 'info', msg, ...extra })); // pino 接入点（SDD 6.4）

type SourceRow = typeof sources.$inferSelect;

async function git(args: string[], cwd?: string): Promise<void> {
  await exec('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 });
}

async function walkMd(dir: string, root: string, out: Array<{ rel: string; abs: string }>): Promise<void> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await walkMd(abs, root, out);
    else if (/\.(md|markdown)$/i.test(e.name)) {
      out.push({ rel: path.relative(root, abs).replace(/\\/g, '/'), abs });
    }
  }
}

async function harvestDocsFromDir(
  source: SourceRow,
  root: string,
): Promise<{ docsUpserted: number; docsRemoved: number }> {
  const found: Array<{ rel: string; abs: string }> = [];
  await walkMd(root, root, found);

  let docsUpserted = 0;
  for (const f of found) {
    const content = await fs.readFile(f.abs, 'utf8');
    const contentHash = createHash('sha256').update(content).digest('hex');
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(f.rel);
    const wordCount = content.length; // 中文近似：按字符数（TODO：分词计数，SDD 7.3）
    await db
      .insert(documents)
      .values({
        projectId: source.projectId,
        sourceId: source.id,
        path: f.rel,
        title,
        content,
        contentHash,
        status: 'synced',
        wordCount,
      })
      .onConflictDoUpdate({
        target: [documents.projectId, documents.path],
        set: { title, content, contentHash, status: 'synced', wordCount, deletedAt: null, updatedAt: new Date() },
      });
    docsUpserted++;
  }

  // 源内已消失的文档 → 软删除（状态机 untracked→deleted 语义，SDD 5.1）
  const seen = new Set(found.map((f) => f.rel));
  const existing = await db
    .select({ id: documents.id, path: documents.path })
    .from(documents)
    .where(and(eq(documents.sourceId, source.id), isNull(documents.deletedAt)));
  let docsRemoved = 0;
  for (const d of existing) {
    if (!seen.has(d.path)) {
      await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, d.id));
      docsRemoved++;
    }
  }
  return { docsUpserted, docsRemoved };
}

async function notifySyncStatus(projectId: string, sourceId: string, status: string): Promise<void> {
  await sql`select pg_notify('ewiki_events', ${JSON.stringify({
    channel: 'sync',
    payload: { room: `project:${projectId}`, event: 'sync.status_changed', payload: { sourceId, status } },
  })})`;
}

// ---------------------------------------------------------------------------
// 通知（EXT-PLATFORM-PLAN ADR-P3）：站内收件箱为兜底渠道的 Notifier 注册表。
//   语义与 activities 分离：activities = 项目公共动态流；notifications = 个人收件箱（带已读）。
//   渠道是并行增装（邮件/webhook 适配器实现 Notifier 后加入 channels），站内永远兜底。
//   事件准入控制音量：sync 仅失败通知（成功走 activities）；publish/import 完成/失败通知。
// ---------------------------------------------------------------------------

const inboxNotifier: Notifier = {
  channel: 'inbox',
  async send(input) {
    await db.insert(notifications).values({
      userId: input.userId,
      type: input.type,
      payload: input.payload,
    });
    // realtime 已 LISTEN ewiki_events：按 user 房间广播（WsEventName.notification.new 预留位）
    await sql`select pg_notify('ewiki_events', ${JSON.stringify({
      channel: 'notifications',
      payload: { room: `user:${input.userId}`, event: 'notification.new', payload: { type: input.type, ...input.payload } },
    })})`;
  },
};
// 渠道数组：站内兜底；邮件/webhook 适配器实现 Notifier 后并行增装（env 未配置即不装）
const notifierChannels: Notifier[] = [inboxNotifier];

async function notifyUsers(
  userIds: Array<string | null>,
  type: NotificationType,
  payload: { projectId?: string; title: string; message: string; link?: string },
): Promise<void> {
  const unique = [...new Set(userIds.filter((id): id is string => !!id))];
  for (const userId of unique) {
    for (const channel of notifierChannels) {
      try {
        await channel.send({ userId, type, payload });
      } catch (err) {
        // 单渠道失败不阻断业务流（站内写失败极罕见；记录后续补偿）
        log('notify failed', { channel: channel.channel, userId, err: String(err) });
      }
    }
  }
}

/** 项目全员通知（publish 完成等公共事件） */
async function notifyProjectMembers(
  projectId: string,
  type: NotificationType,
  payload: { title: string; message: string; link?: string },
): Promise<void> {
  const rows = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  await notifyUsers(rows.map((r) => r.userId), type, { ...payload, projectId });
}

// 链接爬虫（PRD F32）：全项目重算 document_links（先删 from 集合旧边，再批量插入新边）
async function rebuildProjectLinks(projectId: string): Promise<number> {
  const rows = await db
    .select({ id: documents.id, path: documents.path, content: documents.content })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)));
  if (rows.length === 0) return 0;

  const links = extractDocLinks(rows);
  if (links.length === 0) return 0;

  await db.delete(documentLinks).where(inArray(documentLinks.fromDocumentId, rows.map((r) => r.id)));
  const CHUNK = 500;
  for (let i = 0; i < links.length; i += CHUNK) {
    await db.insert(documentLinks).values(links.slice(i, i + CHUNK));
  }
  return links.length;
}

async function syncSource(sourceId: string, trigger: string): Promise<{ docsUpserted: number; docsRemoved: number; links: number }> {
  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.id, sourceId), isNull(sources.deletedAt)))
    .limit(1);
  if (!source) throw new Error(`source not found: ${sourceId}`);

  await db.update(sources).set({ status: 'syncing', updatedAt: new Date() }).where(eq(sources.id, sourceId));

  const out = { docsUpserted: 0, docsRemoved: 0, links: 0 };
  try {
    if (source.type === 'git') {
      const pub = source.configPublic as { url?: string };
      let url = pub.url ?? '';
      if (!url) throw new Error('Git 源缺少仓库地址');
      // 凭据：仅支持 token 内嵌 URL（SSH/OAuth 见 SDD 5.1 TODO）
      if (source.configEncrypted) {
        try {
          const sec = decryptJson<{ token?: string }>(source.configEncrypted as string);
          if (sec.token && url.startsWith('https://')) url = url.replace('https://', `https://oauth2:${sec.token}@`);
        } catch {
          // 解密失败按匿名拉取处理
        }
      }
      const workdir = path.resolve(process.cwd(), process.env.FS_ROOT ?? './data', 'repos', sourceId);
      const cloned = await fs
        .access(path.join(workdir, '.git'))
        .then(() => true, () => false);
      if (!cloned) {
        await git(['clone', '--depth', '1', url, workdir]);
      } else {
        await git(['pull', '--ff-only'], workdir);
      }
      if (source.defaultBranch) {
        await git(['checkout', source.defaultBranch], workdir).catch(() => undefined);
      }
      Object.assign(out, await harvestDocsFromDir(source, workdir));
    } else if (source.type === 'local') {
      const pub = source.configPublic as { path?: string };
      if (!pub.path) throw new Error('本地源缺少文件夹路径');
      Object.assign(out, await harvestDocsFromDir(source, pub.path));
    } else {
      // web/database：接入点见 SDD 5.1 TODO（网页抓取 → 单页归档；数据库 → 只读快照）
      throw new Error(`${source.type} 类型同步尚未实现`);
    }

    out.links = await rebuildProjectLinks(source.projectId);

    await db
      .update(sources)
      .set({ status: 'synced', lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(sources.id, sourceId));
    await db.insert(activities).values({
      projectId: source.projectId,
      verb: 'sync',
      targetType: 'source',
      targetId: source.id,
      targetTitle: source.name,
      meta: { trigger, ...out },
    });
    await notifySyncStatus(source.projectId, sourceId, 'synced');
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(sources)
      .set({ status: 'error', lastError: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(sources.id, sourceId));
    await db.insert(activities).values({
      projectId: source.projectId,
      verb: 'sync',
      targetType: 'source',
      targetId: source.id,
      targetTitle: source.name,
      meta: { trigger, error: msg.slice(0, 200) },
    });
    await notifySyncStatus(source.projectId, sourceId, 'error');
    // 同步失败通知项目全员（成功走 activities，控制通知音量；EXT-PLATFORM ADR-P3）
    await notifyProjectMembers(source.projectId, 'sync.error', {
      title: source.name,
      message: `数据源「${source.name}」同步失败：${msg.slice(0, 120)}`,
      link: `/projects/${source.projectId}/settings`,
    });
    throw err; // 交回 pg-boss 按退避策略重试（SDD 6.5）
  }
}

async function handleSync(job: Job): Promise<void> {
  const data = job.data as { sourceId?: string; trigger?: string };
  if (!data.sourceId) throw new Error('VALIDATION_FAILED');
  const out = await syncSource(data.sourceId, data.trigger ?? 'manual');
  log('sync finished', { jobId: job.id, sourceId: data.sourceId, ...out });
}

// ---------------------------------------------------------------------------
// SDD 5.2 publish pipeline —— 渲染实现已抽至 @ewiki/render（EXT-PLATFORM ADR-P2），
// 本文件仅保留 DB 查询与工件落盘；worker/server 预览共用同一渲染器。
// ---------------------------------------------------------------------------

async function renderDocsToHtml(
  projectId: string,
  templateId: string | null,
): Promise<{ pages: Array<{ rel: string; html: string }>; hash: string }> {
  const rows = await db
    .select({ path: documents.path, title: documents.title, content: documents.content })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)))
    .orderBy(documents.path);

  return renderSite({ docs: rows, siteTitle: rows[0]?.title ?? 'Wiki', templateId });
}

async function writeArtifacts(
  siteId: string,
  slug: string,
  ownerName: string,
  versionNo: number,
  pages: Array<{ rel: string; html: string }>,
): Promise<string> {
  // 站点资源写入用户分配的存储目录（模拟 NAS）：<NAS>/users/<owner>/sites/<slug>/vN
  const nasRoot = resolveRoot(process.env.FS_NAS_ROOT);
  const root = siteVersionDir(nasRoot, ownerName, slug, versionNo);
  await fs.mkdir(root, { recursive: true });
  for (const p of pages) {
    const abs = safeJoin(root, p.rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, p.html, 'utf8');
  }
  // 原子切换：写 current.json 指针（server /sites/:slug 读取该指针定位当前版本）
  const siteRoot = siteDir(nasRoot, ownerName, slug);
  await fs.writeFile(
    path.join(siteRoot, 'current.json'),
    JSON.stringify({ version: versionNo, publishedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
  log('publish artifacts written', { siteId, slug, owner: ownerName, versionNo, files: pages.length, root });
  return root;
}

async function handlePublish(job: Job): Promise<void> {
  const data = job.data as { siteId?: string; trigger?: string };
  if (!data.siteId) throw new Error('VALIDATION_FAILED: siteId required');

  const [site] = await db.select().from(publishSites).where(eq(publishSites.id, data.siteId)).limit(1);
  if (!site) throw new Error(`publish site not found: ${data.siteId}`);
  if (site.mode !== 'hosted') throw new Error(`publish site mode not supported: ${site.mode}`);

  const nextVersion = (site.currentVersion ?? 0) + 1;

  // 幂等保护：同 (siteId, versionNo) 不能重复建
  const existing = await db
    .select({ id: publishJobs.id })
    .from(publishJobs)
    .where(and(eq(publishJobs.siteId, site.id), eq(publishJobs.versionNo, nextVersion)))
    .limit(1);
  if (existing.length > 0) {
    log('publish idempotent skip', { jobId: job.id, siteId: site.id, versionNo: nextVersion });
    return;
  }

  const projectId = site.projectId;
  const [siteMeta] = await db
    .select({ slug: publishSites.slug, ownerId: projects.ownerId })
    .from(publishSites)
    .innerJoin(projects, eq(publishSites.projectId, projects.id))
    .where(eq(publishSites.id, site.id))
    .limit(1);
  const slugForSite = siteMeta?.slug ?? site.id;
  const [ownerRow] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, siteMeta?.ownerId ?? ''))
    .limit(1);
  const ownerNameForSite = ownerRow?.name ?? 'unknown';

  let artifactRef = '';
  let contentHash = '';
  let pagesCount = 0;

  // 先插 publishJobs，状态 queued → building
  const [jobRow] = await db
    .insert(publishJobs)
    .values({
      siteId: site.id,
      versionNo: nextVersion,
      contentHash: '',
      status: 'building',
    })
    .returning({ id: publishJobs.id });

  try {
    const { pages, hash } = await renderDocsToHtml(projectId, site.templateId ?? null);
    contentHash = hash;
    pagesCount = pages.filter((p) => p.rel.endsWith('.html')).length;

    await writeArtifacts(site.id, slugForSite, ownerNameForSite, nextVersion, pages);
    artifactRef = `v${nextVersion}`;

    // 状态机：building → published
    await db
      .update(publishJobs)
      .set({
        status: 'published',
        contentHash,
        artifactRef,
        finishedAt: new Date(),
      })
      .where(eq(publishJobs.id, jobRow.id));

    await db
      .update(publishSites)
      .set({ currentVersion: nextVersion, updatedAt: new Date() })
      .where(eq(publishSites.id, site.id));

    await db.insert(activities).values({
      projectId,
      verb: 'publish',
      targetType: 'publish_site',
      targetId: site.id,
      targetTitle: site.slug ?? site.id,
      meta: { trigger: data.trigger ?? 'manual', version: nextVersion, pages: pagesCount, hash: contentHash },
    });

    // 发布完成 → 项目全员通知（EXT-PLATFORM ADR-P3）
    await notifyProjectMembers(projectId, 'publish.finished', {
      title: site.slug ?? site.id,
      message: `站点「${site.slug ?? site.id}」第 ${nextVersion} 版发布完成（${pagesCount} 页）`,
      link: `/projects/${projectId}/publish`,
    });

    log('publish finished', {
      jobId: job.id,
      siteId: site.id,
      version: nextVersion,
      pages: pagesCount,
      hash: contentHash,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(publishJobs)
      .set({
        status: 'failed',
        contentHash: contentHash || '',
        artifactRef,
        error: msg.slice(0, 500),
        finishedAt: new Date(),
      })
      .where(eq(publishJobs.id, jobRow.id));

    await db.insert(activities).values({
      projectId,
      verb: 'publish',
      targetType: 'publish_site',
      targetId: site.id,
      targetTitle: site.slug ?? site.id,
      meta: { trigger: data.trigger ?? 'manual', version: nextVersion, error: msg.slice(0, 200) },
    });

    throw err; // 交回 pg-boss 按退避策略重试
  }
}

// ---------------------------------------------------------------------------
// ai-classify（SDD 5.4 生成段）：Provider 注册表（EXT-PLATFORM ADR-P1）。
//   默认 heuristic = 关键词启发式；换 LLM 实现 = 同接口适配器 + AI_CLASSIFY_PROVIDER=…。
//   实际表结构用 scope/stats jsonb 承载 documentId/action/suggestion 语义。
// ---------------------------------------------------------------------------

function classifyDoc(docPath: string, title: string): string {
  const p = toPosixPath(docPath).toLowerCase();
  const top = p.split('/')[0] ?? '';
  const hay = `${p} ${title.toLowerCase()}`;
  if (top === 'architecture' || /architecture|架构/.test(hay)) return 'architecture';
  if (top === 'guide' || /guide|快速|开始/.test(hay)) return 'guide';
  if (top === 'ops' || /ops|运维|故障/.test(hay)) return 'ops';
  return 'general';
}

const heuristicClassifyProvider: ClassifyProvider = {
  id: 'heuristic',
  async suggest(docs) {
    return docs.map((d) => {
      const folder = classifyDoc(d.path, d.title);
      return { documentId: d.id, path: d.path, title: d.title, folder, tags: [folder] };
    });
  },
};

const classifyProviders: Record<string, ClassifyProvider> = {
  heuristic: heuristicClassifyProvider,
};
const classifyProvider: ClassifyProvider =
  classifyProviders[process.env.AI_CLASSIFY_PROVIDER ?? 'heuristic'] ?? heuristicClassifyProvider;

async function handleAiClassify(job: Job): Promise<void> {
  const data = job.data as { projectId?: string };
  if (!data.projectId) throw new Error('VALIDATION_FAILED: projectId required');

  const rows = await db
    .select({ id: documents.id, path: documents.path, title: documents.title })
    .from(documents)
    .where(and(eq(documents.projectId, data.projectId), isNull(documents.deletedAt)))
    .limit(50);

  const suggestions = await classifyProvider.suggest(
    rows.map((d) => ({ id: d.id, path: d.path, title: d.title ?? d.path })),
  );
  const now = new Date();
  for (const s of suggestions) {
    await db.insert(aiClassifyRuns).values({
      projectId: data.projectId,
      scope: 'all',
      status: 'done',
      stats: { action: 'classify', documentId: s.documentId, suggestion: { folder: s.folder, tags: s.tags } },
      finishedAt: now,
    });
  }

  await db.insert(activities).values({
    projectId: data.projectId,
    verb: 'ai_classify',
    targetType: 'project',
    targetId: data.projectId,
    meta: { runs: suggestions.length, provider: classifyProvider.id },
  });
  log('ai-classify finished', { jobId: job.id, projectId: data.projectId, runs: suggestions.length, provider: classifyProvider.id });
}

// ---------------------------------------------------------------------------
// import（SDD F27）：ImportProvider 注册表（EXT-PLATFORM ADR-P1）。
//   folder = 递归 *.md；basic-crawler = 单页抓取（无深度/robots，见计划边界声明）。
//   notion/obsidian 深度连接器 = 后期同接口适配器（server 白名单先拦 400）。
// ---------------------------------------------------------------------------

const toPosixPath = (p: string): string => p.replace(/\\/g, '/');

async function upsertImportedDoc(projectId: string, docPath: string, content: string): Promise<void> {
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? docPath;
  const contentHash = createHash('md5').update(content).digest('hex');
  const wordCount = content.length;
  await db
    .insert(documents)
    .values({ projectId, sourceId: null, path: docPath, title, content, contentHash, status: 'synced', wordCount })
    .onConflictDoUpdate({
      target: [documents.projectId, documents.path],
      set: { title, content, contentHash, status: 'synced', wordCount, deletedAt: null, updatedAt: new Date() },
    });
}

/** 剥除 HTML → 纯文本，并从 URL 推导文档 path（URL path 优先，空则域名 slug） */
function htmlToDoc(url: string, html: string): { docPath: string; title: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  let slug = '';
  try {
    const u = new URL(url);
    slug = u.pathname
      .replace(/\.html?$/i, '')
      .replace(/^\/+|\/+$/g, '')
      .replace(/[^\w\u4e00-\u9fa5/-]/g, '_');
    if (!slug) slug = u.hostname;
  } catch {
    slug = url.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
  }
  return { docPath: `${slug}.md`, title: title || `${slug}.md`, text };
}

const importProviders: Record<string, ImportProvider> = {
  folder: {
    id: 'folder',
    supportedParams: ['path'],
    async run(params, sink) {
      const root = String(params.path ?? '');
      if (!root) throw new Error('folder 导入缺少 params.path');
      const found: Array<{ rel: string; abs: string }> = [];
      await walkMd(root, root, found);
      let docs = 0;
      for (const f of found) {
        const content = await fs.readFile(f.abs, 'utf8');
        await sink.upsertDoc(f.rel, content);
        docs++;
        if (docs % 10 === 0) await sink.onProgress(docs);
      }
      return { docs };
    },
  },
  // key 与 shared Importer 枚举/server 白名单一致；自研实现为单页抓取（深度爬取后期换适配器）
  'web-crawler': {
    id: 'web-crawler',
    supportedParams: ['url'],
    async run(params, sink) {
      const url = String(params.url ?? '');
      if (!url) throw new Error('web-crawler 导入缺少 params.url');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch failed with status ${res.status}`);
      const { docPath, title, text } = htmlToDoc(url, await res.text());
      await sink.upsertDoc(docPath, `# ${title}\n\n${text}`);
      await sink.onProgress(1);
      return { docs: 1 };
    },
  },
};
// server 白名单与 worker 注册表保持同一 id 集合（server 侧另校验 shared Importer 枚举）

async function handleImport(job: Job): Promise<void> {
  const data = job.data as {
    projectId?: string;
    importJobId?: string;
    importer?: string;
    startedBy?: string;
    params?: Record<string, unknown>;
  };
  if (!data.projectId || !data.importJobId || !data.importer) {
    throw new Error('VALIDATION_FAILED: projectId/importJobId/importer required');
  }
  const params = data.params ?? {};

  await db.update(importJobs).set({ status: 'running', error: null }).where(eq(importJobs.id, data.importJobId));

  const provider = importProviders[data.importer];
  try {
    if (!provider) throw new Error(`importer not supported: ${data.importer}`);
    const result = await provider.run(params, {
      upsertDoc: (docPath, content) => upsertImportedDoc(data.projectId!, docPath, content),
      onProgress: async (done) => {
        await db.update(importJobs).set({ progress: done }).where(eq(importJobs.id, data.importJobId!));
      },
    });

    await db
      .update(importJobs)
      .set({ status: 'done', progress: result.docs, stats: { docs: result.docs, provider: provider.id }, finishedAt: new Date() })
      .where(eq(importJobs.id, data.importJobId));
    // 导入完成 → 通知触发者（startedBy 由 server 入队时随 job 下发）
    await notifyUsers([data.startedBy ?? null], 'import.finished', {
      projectId: data.projectId,
      title: data.importer,
      message: `导入完成：${result.docs} 篇文档已入库`,
      link: `/projects/${data.projectId}/browse`,
    });
    log('import finished', { jobId: job.id, importJobId: data.importJobId, importer: data.importer, docs: result.docs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(importJobs)
      .set({ status: 'failed', error: msg.slice(0, 500), finishedAt: new Date() })
      .where(eq(importJobs.id, data.importJobId));
    await notifyUsers([data.startedBy ?? null], 'import.failed', {
      projectId: data.projectId,
      title: data.importer,
      message: `导入失败：${msg.slice(0, 120)}`,
      link: `/projects/${data.projectId}/settings`,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// export（F45 最小实现）：全库 JSON 导出到 FS_ROOT/exports
// ---------------------------------------------------------------------------

async function handleExport(job: Job): Promise<void> {
  const data = job.data as { projectId?: string };
  if (!data.projectId) throw new Error('VALIDATION_FAILED: projectId required');

  const rows = await db
    .select({ path: documents.path, title: documents.title, content: documents.content })
    .from(documents)
    .where(and(eq(documents.projectId, data.projectId), isNull(documents.deletedAt)))
    .orderBy(documents.path);

  const root = path.resolve(process.cwd(), process.env.FS_ROOT ?? './data', 'exports', data.projectId);
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, `${Date.now()}.json`);
  await fs.writeFile(
    file,
    JSON.stringify({ exportedAt: new Date().toISOString(), project: { id: data.projectId }, docs: rows }, null, 2),
    'utf8',
  );

  await db.insert(activities).values({
    projectId: data.projectId,
    verb: 'export',
    targetType: 'project',
    targetId: data.projectId,
    meta: { docs: rows.length, file },
  });
  log('export finished', { jobId: job.id, projectId: data.projectId, docs: rows.length, file });
}

// ---------------------------------------------------------------------------
// compensate（ADR-12 最小实现）：重试最近 20 条 publish_jobs 内失败的 site
// ---------------------------------------------------------------------------

async function handleCompensate(): Promise<void> {
  const recent = await db
    .select({ siteId: publishJobs.siteId, status: publishJobs.status })
    .from(publishJobs)
    .orderBy(desc(publishJobs.createdAt))
    .limit(20);
  const siteIds = [...new Set(recent.filter((j) => j.status === 'failed').map((j) => j.siteId))];

  for (const siteId of siteIds) {
    await boss.send('publish', { siteId, trigger: 'compensate' });
  }
  log('compensate sweep finished', { scanned: recent.length, retried: siteIds.length });
}

async function main(): Promise<void> {
  await boss.start();
  for (const q of ['sync', 'publish', 'ai-classify', 'import', 'export', 'compensate']) {
    await boss.createQueue(q);
  }

  await boss.work('sync', { batchSize: 5 }, async (jobs) => {
    for (const j of jobs) await handleSync({ id: j.id, queue: 'sync', data: j.data });
  });
  await boss.work('publish', { batchSize: 2 }, async (jobs) => {
    for (const j of jobs) await handlePublish({ id: j.id, queue: 'publish', data: j.data });
  });
  await boss.work('ai-classify', { batchSize: 1 }, async (jobs) => {
    for (const j of jobs) await handleAiClassify({ id: j.id, queue: 'ai-classify', data: j.data });
  });
  await boss.work('import', { batchSize: 1 }, async (jobs) => {
    for (const j of jobs) await handleImport({ id: j.id, queue: 'import', data: j.data });
  });
  await boss.work('export', { batchSize: 1 }, async (jobs) => {
    for (const j of jobs) await handleExport({ id: j.id, queue: 'export', data: j.data });
  });
  await boss.work('compensate', { batchSize: 10 }, async () => handleCompensate());

  // 定时任务：每日 03:00 发布调度检查（PRD F35）
  await boss.schedule('publish', '0 3 * * *', { trigger: 'daily' });

  log('worker started', { queues: ['sync', 'publish', 'ai-classify', 'import', 'export', 'compensate'] });
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
