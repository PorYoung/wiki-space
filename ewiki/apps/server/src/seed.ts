import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, isNull, sql as sqlOp } from 'drizzle-orm';
import { extractDocLinks } from '@ewiki/shared';
import { loadConfig } from './config.js';
import { db, sql } from './db/client.js';
import { hashPassword } from './auth/utils.js';
import {
  documentLinks,
  documentVersions,
  documents,
  projectMembers,
  projects,
  users,
} from './db/schema.js';

/** 幂等种子：管理员账号 + 示例项目（服务器存储后端）+ 内嵌 Markdown 示例文档
 *
 * 幂等策略：
 *   - admin@ewiki.local 存在 → 跳过创建
 *   - 同名项目存在 → 复用并检查服务器存储配置 / documents 完整性
 *   - 文档 upsert 走 select-then-update/insert（跨 PostgreSQL 兼容的幂等模式）
 *
 * 执行: pnpm --filter @ewiki/server run seed
 */

function md5(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

// ---- 内嵌示例 Markdown（6 篇结构化文档，覆盖 BrowsePage 所有渲染元素） ----
const SAMPLE_DOCS: Array<{ relPath: string; title: string; md: string }> = [
  {
    relPath: 'README.md',
    title: 'ewiki 平台说明',
    md: `# ewiki · 文档知识管理平台

**ewiki**（edith-wiki）是面向边缘 Agent 管理场景的团队协作知识库。

## 核心能力

- 📥 **存储后端** — Git 远端仓库 / 服务器存储，文档库开箱即用
- ✍️ **实时协同编辑** — Yjs CRDT + TipTap 富文本
- 🕸️ **知识图谱** — 自动识别文档链接关系，发现断链与孤立节点
- 🚀 **一键发布** — 子域名 / 子路径双形态，Caddy on-demand TLS
- 🤖 **AI 智能整理** — 自动分类、命名、打标签

## 快速开始

\`\`\`bash
# ewiki 自身就是一个 Git 仓库
pnpm install

# 启动后端 + 前端
pnpm --filter @ewiki/server run dev
pnpm --filter @ewiki/web run dev
\`\`\`

## 架构概览

详见 [架构设计](architecture/overview.md)。
`,
  },
  {
    relPath: 'architecture/overview.md',
    title: '架构设计总览',
    md: `# 架构设计总览

ewiki 采用**模块化单体**架构（ADR-1）：一个 server 承载 HTTP API + pg-boss 入队，worker 进程独立消费队列，realtime 进程独立承载 WS。

## 组件拓扑

- **apps/server** — Hono HTTP API（3000）+ pg-boss 注册
- **apps/worker** — pg-boss 消费：sync / publish / ai-classify / import
- **apps/realtime** — Hono + WebSocket（3001）：presence + Yjs
- **apps/web** — React 19 + Vite 前端

## 状态图

### 同步状态机

\`\`\`
connected → syncing → synced
            ↓
           error
\`\`\`

### 文档状态机

\`\`\`
untracked → synced → modified → conflict → synced → deleted
\`\`\`

## 关键决策

> **ADR-1 模块化单体**：前期团队规模小（≤5 人），不拆微服务降低运维复杂度；当 worker 队列规模或 API QPS 超过阈值时按进程拆分。

| 决策 | 备选 | 选择 | 理由 |
|---|---|---|---|
| 任务队列 | BullMQ / RabbitMQ | pg-boss | 零额外基础设施，PostgreSQL 自身即持久化 |
| 认证 | OAuth / LDAP | JWT + refresh | 最小可用，企业 OA 对接预留 ssoSubject 字段 |
| 存储 | S3-only / 本地 | S3 主 + NAS 回退 | 内网场景 NAS 成本更低 |
`,
  },
  {
    relPath: 'architecture/database.md',
    title: '数据库设计',
    md: `# 数据库设计

所有表 **id 统一 UUID**（Postgres \`pgcrypto\` 默认值），时间戳统一 \`timestamptz\`，软删除仅 projects / documents。

## 实体关系

\`\`\`
projects ──1:N──▶ project_members ──N:1──▶ users
   │
   ├──1:N──▶ documents ──1:N──▶ document_versions
   │                    ├──1:N──▶ document_links
   │                    ├──N:M──▶ tags (document_tags)
   │                    └──1:N──▶ comments
   ├──N:1──▶ storage_connections（Git 凭据，用户级）
   ├──1:N──▶ sync_jobs
   ├──1:N──▶ publish_sites ──1:N──▶ publish_jobs
   └──1:N──▶ activities
\`\`\`

## 关键约束

- \`documents(projectId, path)\` 唯一索引 — 路径即文档身份
- \`project_members(projectId, userId)\` 唯一索引 — 不允许重复成员
- \`password_hash\` — bcrypt（auth/utils.ts）
- \`config_encrypted\` — AES-256-GCM 整体加密（packages/db/secretbox.ts）

## 未跟踪字段

- \`ydoc_snapshots\` — Yjs 协同快照，按 document 行存储 state + state_vector
- \`audit_logs\` — 安全审计（IP / actorId / resourceType）
- \`notifications\` — 用户通知
`,
  },
  {
    relPath: 'guides/getting-started.md',
    title: '快速开始指南',
    md: `# 快速开始

本指南带你在 10 分钟内跑通 ewiki。

## 前置要求

- Node.js ≥ 20
- PostgreSQL ≥ 15
- Git ≥ 2.30

## 步骤一：克隆与安装

\`\`\`bash
git clone <ewiki-repo>
cd ewiki
pnpm install
\`\`\`

## 步骤二：环境变量

\`\`\`bash
cp .env.example .env
# 修改 DATABASE_URL / JWT_SECRET / ENCRYPTION_KEY
\`\`\`

## 步骤三：初始化数据库

\`\`\`bash
# 生成表结构（Drizzle）
pnpm --filter @ewiki/server run migrate

# 写入种子数据（admin 用户 + 示例项目）
pnpm --filter @ewiki/server run seed
\`\`\`

## 步骤四：启动服务

\`\`\`bash
# 三个进程（可以分别启动，也可以用 pm2/foreman）
pnpm --filter @ewiki/server run dev     # :3000
pnpm --filter @ewiki/worker run dev     # pg-boss 消费
pnpm --filter @ewiki/realtime run dev   # :3001
pnpm --filter @ewiki/web run dev        # :5173
\`\`\`

## 步骤五：首次登录

- 打开 http://localhost:5173
- 种子账号: \`admin@ewiki.local\` / \`ewiki-admin\`
- 进入"ewiki 帮助文档"项目 → 会看到 6 篇示例文档

## 下一步

- 连接一个 Git 存储源，把文档库建在你的仓库上
- 试试"发布"功能，把知识库变成一个公开网站
- 开启"AI 智能整理"让它帮你自动分类
`,
  },
  {
    relPath: 'ops/runbook.md',
    title: '运维手册',
    md: `# 运维手册

## 进程管理

\`\`\`yaml
# docker compose 一键拉起
services:
  db:       postgres:16
  server:   ewiki-server:latest   # :3000
  worker:   ewiki-worker:latest   # pg-boss
  realtime: ewiki-realtime:latest # :3001
  web:      ewiki-web:latest      # :80（Caddy 反代）
\`\`\`

## pg-boss 队列健康检查

| 队列 | 职责 | 重试策略 |
|---|---|---|
| sync | Git/local → 文档 upsert | exponential backoff，最多 3 次 |
| publish | Markdown → HTML → 版本目录 | 人工介入 |
| ai-classify | LLM 分类建议 | 1 次，失败即标记 |
| import | web-crawler / notion / obsidian | 长超时，checkpoint 恢复 |

## 常见问题

### 文档消失

1. 检查对应项目的 \`storage_status\` 是否 \`synced\`
2. 如果文档 \`deleted_at\` 非空 → 文档已软删除，可手工恢复该行
3. 运行 \`SELECT * FROM documents WHERE deleted_at IS NOT NULL;\` 排查

### pg-boss 队列积压

\`\`\`sql
SELECT queue, count(*) pending FROM pgboss GROUP BY queue;
\`\`\`

如果 queue 积压 > 50：检查 worker 进程是否存活、pg-boss 连接是否健康。

### 发布站点 TLS 失败

Caddy on-demand TLS 需要：
1. \`EWIKI_BASE_DOMAIN\` 正确配置
2. DNS A 记录指向 Caddy 节点
3. 站点在 \`publish_sites\` 表中存在（slug 或 customDomain 匹配）
`,
  },
  {
    relPath: 'ops/troubleshooting.md',
    title: '故障排查',
    md: `# 故障排查手册

## 登录失败

| 现象 | 排查 |
|---|---|
| 401 / TOKEN_EXPIRED | 检查 \`JWT_SECRET\` 是否被替换（替换后所有 refresh 失效） |
| 401 / UNAUTHENTICATED | 用户不存在或密码错 → \`SELECT * FROM users;\` |
| 500 | 检查 PostgreSQL 是否连通，\`refresh_tokens\` 表是否存在 |

## 同步卡死

1. 访问 \`GET /api/v1/projects/:id/overview\` 看 storageStatus 和 lastError
2. 如果是 \`syncing\` 超过 3 分钟 → worker 可能崩了
3. 手动重试：\`POST /api/v1/projects/:id/sync\`（幂等，同分钟去重；仅 Git 后端支持）

## 发布失败

1. \`SELECT * FROM publish_jobs WHERE site_id = ? ORDER BY created_at DESC;\`
2. 看 status 和 error 字段
3. 手动触发：\`POST /api/v1/publish-sites/:id/jobs\`（待实现）

## 数据恢复

- **备份**：PostgreSQL pg_dump 每日 01:00（CRON）
- **恢复**：pg_restore 到临时库 → 数据比对 → 切换
- **文档版本**：\`document_versions\` 表保留最近 50 个版本
`,
  },
];

async function ensureAdmin(adminEmail: string): Promise<string> {
  const [existing] = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
  if (existing) {
    console.log(`[seed] admin exists: ${adminEmail}`);
    return existing.id;
  }
  const [admin] = await db
    .insert(users)
    .values({
      email: adminEmail,
      name: 'ewiki 管理员',
      passwordHash: hashPassword(process.env.SEED_ADMIN_PASSWORD ?? 'ewiki-admin'),
      globalRole: 'admin',
    })
    .returning();
  console.log(`[seed] created admin: ${adminEmail}`);
  return admin.id!;
}

async function ensureProject(ownerId: string): Promise<string> {
  const PROJECT_NAME = 'ewiki 帮助文档';
  const [existing] = await db.select().from(projects).where(eq(projects.name, PROJECT_NAME)).limit(1);
  if (existing) {
    console.log(`[seed] project exists: ${PROJECT_NAME}`);
    // 确保 owner 仍是 owner
    const [owner] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, existing.id), eq(projectMembers.role, 'owner')))
      .limit(1);
    if (!owner) {
      await db
        .update(projectMembers)
        .set({ role: 'owner', status: 'active', invitedBy: ownerId })
        .where(and(eq(projectMembers.projectId, existing.id), eq(projectMembers.userId, ownerId)));
      console.log('[seed] repaired owner membership');
    }
    return existing.id;
  }
  const [project] = await db
    .insert(projects)
    .values({
      name: PROJECT_NAME,
      description: '平台自带示例项目（种子）',
      visibility: 'team',
      ownerId,
      storageKind: 'local',
      storageStatus: 'synced',
    })
    .returning();
  await db.insert(projectMembers).values({
    projectId: project!.id,
    userId: ownerId,
    role: 'owner',
    invitedBy: ownerId,
  });
  console.log(`[seed] created project: ${PROJECT_NAME}`);
  return project!.id;
}

async function ensureLocalStorage(projectId: string, fsRoot: string): Promise<string> {
  const dir = path.resolve(fsRoot, 'local-library', projectId);
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (project?.storageKind === 'git') {
    throw new Error(`[seed] 种子项目 ${projectId} 已绑定 Git 后端，拒绝覆盖为服务器存储`);
  }
  const config = (project?.storageConfig ?? null) as { path?: string } | null;
  if (project?.storageKind === 'local' && typeof config?.path === 'string') {
    console.log(`[seed] local storage exists: ${config.path}`);
    return config.path;
  }
  await db
    .update(projects)
    .set({
      storageKind: 'local',
      storageConnectionId: null,
      storageConfig: { path: dir },
      storageStatus: 'synced',
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));
  console.log(`[seed] ensured local storage: ${dir}`);
  return dir;
}

async function writeSampleMarkdown(fsRoot: string, projectId: string): Promise<void> {
  const root = path.resolve(fsRoot, 'local-library', projectId);
  for (const doc of SAMPLE_DOCS) {
    const abs = path.resolve(root, doc.relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, doc.md, 'utf8');
    console.log(`[seed] wrote sample: ${doc.relPath}`);
  }
}

async function harvestDocsFromDir(projectId: string, dir: string): Promise<void> {
  // 简易版：递归 walk *.md → onConflict upsert
  async function walk(d: string): Promise<string[]> {
    const result: string[] = [];
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) result.push(...(await walk(abs)));
      else if (/\.(md|markdown)$/i.test(e.name)) result.push(abs);
    }
    return result;
  }

  const files = await walk(dir);
  let upserted = 0;
  for (const abs of files) {
    const content = await fs.readFile(abs, 'utf8');
    const rel = path.relative(dir, abs).replace(/\\/g, '/');
    const hash = md5(content);
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(rel, '.md');
    const wordCount = content.length;

    // 尝试 upsert
    const [existing] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.projectId, projectId), eq(documents.path, rel), isNull(documents.deletedAt)))
      .limit(1);

    if (existing) {
      await db
        .update(documents)
        .set({
          title,
          content,
          contentHash: hash,
          wordCount,
          kind: 'text',
          ext: 'md',
          mime: 'text/markdown',
          size: Buffer.byteLength(content, 'utf8'),
          status: 'synced',
          updatedAt: new Date(),
          deletedAt: null,
        })
        .where(eq(documents.id, existing.id));
    } else {
      await db.insert(documents).values({
        projectId,
        path: rel,
        title,
        content,
        kind: 'text',
        ext: 'md',
        mime: 'text/markdown',
        size: Buffer.byteLength(content, 'utf8'),
        contentHash: hash,
        wordCount,
        status: 'synced',
      });
    }
    upserted++;
    console.log(`[seed] ${existing ? 'upsert' : 'insert'} doc: ${rel}`);
  }
  console.log(`[seed] total docs upserted: ${upserted}`);
}

async function main(): Promise<void> {
  loadConfig();
  const adminEmail = 'admin@ewiki.local';
  const adminId = await ensureAdmin(adminEmail);
  const projectId = await ensureProject(adminId);

  const fsRoot = process.env.FS_ROOT ?? './data';
  const localDir = await ensureLocalStorage(projectId, fsRoot);
  await fs.mkdir(localDir, { recursive: true });

  await writeSampleMarkdown(fsRoot, projectId);
  await harvestDocsFromDir(projectId, localDir);

  // 为每个文档插入一份初始版本快照（version_no = 1）
  const allDocs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)));

  for (const d of allDocs) {
    const [maxVer] = await db
      .select({ max: sqlOp<number>`coalesce(max(${documentVersions.versionNo}), 0)` })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, d.id));
    if ((maxVer?.max ?? 0) < 1) {
      await db.insert(documentVersions).values({
        documentId: d.id,
        versionNo: 1,
        authorId: adminId,
        message: '种子数据初始化',
        content: d.content ?? '',
      });
    }
  }
  console.log(`[seed] created ${allDocs.length} initial versions`);

  // 重建 document_links（知识图谱边；broken 表示断链）
  const links = extractDocLinks(
    allDocs.map((d) => ({ id: d.id, path: d.path, content: d.content })),
  );
  if (links.length > 0) {
    const docIds = allDocs.map((d) => d.id);
    await db.delete(documentLinks).where(inArray(documentLinks.fromDocumentId, docIds));
    await db.insert(documentLinks).values(links);
  }
  console.log(`[seed] rebuilt ${links.length} document links`);

  await sql.end();
  console.log('[seed] ✅ complete. Login at http://localhost:5173 with admin@ewiki.local / ewiki-admin');
}

main().catch((err) => {
  console.error('[seed] FATAL:', err);
  process.exit(1);
});
