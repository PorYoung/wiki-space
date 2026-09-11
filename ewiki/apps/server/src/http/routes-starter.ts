import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { SourceType } from '@ewiki/shared';
import type { AppDeps } from './app.js';
import { activities, projectMembers, projects, sources } from '../db/schema.js';

// StarterPack（F10）：初始化模板目录 + 从模板创建项目（内嵌数据源创建，复用 S1）

export const STARTER_PACKS = [
  {
    id: 'tech-docs', name: '技术文档库', description: '架构设计、开发指南与运维手册',
    docCount: 12, tree: ['README.md', 'architecture/overview.md', 'guides/getting-started.md', 'ops/runbook.md'],
    sampleTags: ['架构', '指南', '运维'],
  },
  {
    id: 'product-prd', name: '产品需求库', description: 'PRD、评审记录与路线图',
    docCount: 8, tree: ['prd/overview.md', 'prd/features.md', 'reviews/weekly.md', 'roadmap.md'],
    sampleTags: ['PRD', '评审'],
  },
  {
    id: 'api-docs', name: 'API 参考库', description: '接口规范、变更日志与示例',
    docCount: 10, tree: ['api/v1.md', 'api/webhooks.md', 'changelog.md'],
    sampleTags: ['API', '变更'],
  },
  {
    id: 'team-wiki', name: '团队知识库', description: '新人指引、流程规范与决策记录',
    docCount: 15, tree: ['onboarding.md', 'process/code-review.md', 'decisions/adr-template.md'],
    sampleTags: ['流程', 'ADR'],
  },
  {
    id: 'meeting-notes', name: '会议纪要库', description: '周会、评审与决议归档',
    docCount: 6, tree: ['weekly/index.md', 'reviews/index.md'], sampleTags: ['周会', '决议'],
  },
  {
    id: 'learning', name: '学习笔记库', description: '读书笔记、课程摘录与实践',
    docCount: 9, tree: ['books/index.md', 'courses/index.md', 'notes/index.md'],
    sampleTags: ['读书', '笔记'],
  },
];

export function registerStarterRoutes(app: Hono, deps: AppDeps): void {
  const { db, boss } = deps;

  app.get('/api/v1/starter-packs', (c) => c.json({ items: STARTER_PACKS }));

  app.post('/api/v1/projects/init-from-starter', async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json()) as {
      packId?: string;
      name?: string;
      visibility?: 'private' | 'team' | 'public';
      sourceType?: 'git' | 'local' | null;
      sourceUrl?: string;
      autoSync?: boolean;
    };
    if (!body.packId || !body.name) throw new HTTPException(400, { message: 'VALIDATION_FAILED' });
    const pack = STARTER_PACKS.find((p) => p.id === body.packId);
    if (!pack) throw new HTTPException(404, { message: 'NOT_FOUND' });

    const [project] = await db
      .insert(projects)
      .values({
        name: body.name,
        description: pack.description,
        visibility: body.visibility ?? 'private',
        template: pack.id,
        ownerId: userId,
      })
      .returning();
    await db.insert(projectMembers).values({ projectId: project.id, userId, role: 'owner' });

    // 内嵌数据源创建（F10 第三步），并立即触发一次同步以填充文档
    let sourceId: string | null = null;
    if ((body.sourceType === 'git' || body.sourceType === 'local') && body.sourceUrl) {
      const parsed = SourceType.safeParse(body.sourceType);
      if (parsed.success) {
        const [source] = await db
          .insert(sources)
          .values({
            projectId: project.id,
            type: parsed.data,
            name: `${body.name} 主源`,
            configPublic: body.sourceType === 'git' ? { url: body.sourceUrl } : { path: body.sourceUrl },
            defaultBranch: body.sourceType === 'git' ? 'main' : null,
            autoSync: body.autoSync ?? false,
            intervalSeconds: body.autoSync ? 3600 : 0,
          })
          .returning();
        sourceId = source.id;
        await boss.send(
          'sync',
          { sourceId: source.id, trigger: 'manual' },
          { id: `sync:${source.id}:init:${Math.floor(Date.now() / 60_000)}` },
        );
        await db.update(sources).set({ status: 'syncing' }).where(eq(sources.id, source.id));
      }
    }

    await db.insert(activities).values({
      projectId: project.id,
      actorId: userId,
      verb: 'create',
      targetType: 'project',
      targetId: project.id,
      targetTitle: project.name,
    });
    return c.json({ project, sourceId, packId: pack.id }, 201);
  });
}
