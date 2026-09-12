import { Hono } from 'hono';

// StarterPack（F10）：模板包清单。
// 建库统一入口为 POST /api/v1/projects（携带 storage 判别联合：本地或 Git 连接配置+仓库名称，
// 模板解析支持 starter-pack id），原 init-from-starter 端点（直填 Git 地址模型）已下线。

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

export function registerStarterRoutes(app: Hono): void {
  app.get('/api/v1/starter-packs', (c) => c.json({ items: STARTER_PACKS }));
}
