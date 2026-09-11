// ---------------------------------------------------------------------------
// 文档库模板（需求 4/5/10）：注册示例库、新建文档库、发布站点的模板内容源。
// starter-packs（routes-starter.ts）仅含目录骨架；本文件提供带正文的富模板，
// id 与 starter-pack 体系互通（team-wiki 等既有 id 优先富内容，其余回退骨架占位文档）。
// ---------------------------------------------------------------------------

export interface TemplateDoc {
  path: string;
  content: string;
}

export interface LibraryTemplate {
  id: string;
  name: string;
  description: string;
  docs: TemplateDoc[];
}

const welcome = `# 欢迎使用你的知识库

这是一座属于你的**个人示例知识库**，由平台在注册时自动创建。你可以：

- 直接在左侧目录树中新建、编辑、删除文档；
- 用右上角「分享」把整个知识库共享给同事协作；
- 用「发布」把文档一键变成可访问的网站；
- 在「存储配置」中绑定 GitLab / Gitea，把知识库同步到 Git 仓库。

> 删除本示例库不会影响你的其他数据。`;

const quickstart = `# 快速上手

## 1. 新建文档
在文档库页点击「新建文档」，输入路径（如 \`guides/onboarding.md\`）即可。

## 2. 组织目录
用「新建文件夹」把文档按主题分层，例如 \`架构\`、\`会议纪要\`、\`运维手册\`。

## 3. 协作
分享给同事时可选择 **可阅读** 或 **可编辑** 权限，多人同时编辑时
平台会做版本保护：后保存的一方会收到冲突提示，不会覆盖彼此的修改。

## 4. 发布
选择一套站点模板，把当前文档库发布为平台子路径网站，例如
\`/sites/<站点标识>/\`，任何人无需登录即可访问。`;

const featureTour = `# 平台功能导览

| 功能 | 入口 | 说明 |
| --- | --- | --- |
| 文档库 | 全局侧栏「文档库」 | 浏览、搜索、新建知识库 |
| 存储配置 | 全局侧栏「存储配置」 | 管理 GitLab / Gitea 连接 |
| 系统管理 | 全局侧栏「系统管理」 | 仅管理员：用户、数据库、存储、审计 |
| 项目空间 | 文档库详情 | 文档增删查改、成员分享、发布站点 |

## 存储源说明
- **云文档**：文档保存在平台分配给你的服务器存储目录（模拟 NAS 盘）；
- **Git 仓库**：文档保存在 Git 仓库中，每次保存自动提交并推送，提交历史可在 Git 服务端查到。`;

const markdownGuide = `# Markdown 写作指南

## 常用语法

- **加粗** 与 *斜体*
- [链接](https://example.com)
- 行内代码 \`const x = 1\`
- 引用：> 引用内容
- 无序列表：- 项目
- 有序列表：1. 第一项

## 代码块

\`\`\`ts
export function greet(name: string): string {
  return \`你好，\${name}\`;
}
\`\`\`

## 表格

| 语法 | 用途 |
| --- | --- |
| \`#\` | 标题 |
| \`---\` | 分隔线 |`;

const onboarding = `# 新人指引

欢迎加入！第一天建议完成：

1. 用企业邮箱登录平台，确认个人示例知识库已就绪；
2. 阅读本库的《团队规范》与《决策记录》；
3. 加入对应项目空间（由项目管理员分享）；
4. 遇到问题先查《常见问题》，再在团队频道提问。`;

const teamRules = `# 团队规范

## 文档写作
- 标题用一句话说清主题，正文先结论后细节；
- 会议纪要按 \`会议纪要/YYYY-MM-DD 主题\` 命名；
- 重要决策必须落 ADR（见 \`决策记录/ADR-001\`）。

## 权限约定
- 团队知识库默认对全员可读；
- 项目空间按需分享，编辑权限只授予实际参与人。`;

const adr001 = `# ADR-001 知识库采用「平台托管 + Git 双轨」存储

## 状态
已采纳

## 背景
企业知识资产既需要低门槛的网页编辑，也需要可审计的版本历史。

## 决策
- 默认存储源为平台云文档（服务器配置的存储目录，模拟 NAS 盘）；
- 需要强版本管理/外部协作的项目选择 Git 仓库存储源；
- Git 仓库在项目创建时自动初始化，文档保存即自动提交推送。

## 后果
- 编辑体验一致，存储差异对用户透明；
- Git 服务端可独立审计每一次文档变更。`;

const faq = `# 常见问题

**Q: 忘记密码怎么办？**
联系管理员在「系统管理 → 用户管理」重置。

**Q: 文档保存后冲突了？**
点击提示中的「加载最新内容」，在最新版本上重放你的修改；平台保证不会静默覆盖他人编辑。

**Q: 如何把知识库发布成网站？**
文档库详情 → 发布 → 选择模板 → 发布，得到形如 \`/sites/<标识>/\` 的访问地址。`;

const projectReadme = `# 项目空间

本库用于沉淀项目的过程资产。建议目录结构：

- \`需求/\`：需求文档与评审记录
- \`设计/\`：架构与技术方案
- \`会议纪要/\`：例会与评审纪要
- \`发布/\`：上线记录与回滚预案`;

const meetingTemplate = `# 会议纪要 YYYY-MM-DD 主题

## 参会人
-

## 议题与结论
1.

## 待办
| 事项 | 负责人 | 截止 |
| --- | --- | --- |
|  |  |  |`;

const requirementDoc = `# 需求文档 <项目名>

## 背景与目标

## 用户故事
- 作为 <角色>，我希望 <能力>，以便 <价值>。

## 验收标准
1. `;

const milestone = `# 里程碑

| 阶段 | 目标 | 时间 | 状态 |
| --- | --- | --- | --- |
| M1 | 需求冻结 |  | 进行中 |
| M2 | 方案评审 |  | 未开始 |
| M3 | 上线发布 |  | 未开始 |`;

export const LIBRARY_TEMPLATES: LibraryTemplate[] = [
  {
    id: 'personal-sample',
    name: '个人示例知识库',
    description: '注册自动创建：平台导览、快速上手与写作指南',
    docs: [
      { path: '欢迎使用你的知识库.md', content: welcome },
      { path: '快速上手.md', content: quickstart },
      { path: '平台功能导览.md', content: featureTour },
      { path: 'Markdown 写作指南.md', content: markdownGuide },
    ],
  },
  {
    id: 'team-wiki',
    name: '团队知识库',
    description: '新人指引、团队规范、决策记录与常见问题',
    docs: [
      { path: '新人指引.md', content: onboarding },
      { path: '团队规范.md', content: teamRules },
      { path: '决策记录/ADR-001 双轨存储.md', content: adr001 },
      { path: '常见问题.md', content: faq },
    ],
  },
  {
    id: 'project-space',
    name: '项目空间',
    description: '需求、设计、会议纪要与里程碑的过程资产管理',
    docs: [
      { path: 'README.md', content: projectReadme },
      { path: '会议纪要/会议纪要模板.md', content: meetingTemplate },
      { path: '需求/需求文档模板.md', content: requirementDoc },
      { path: '里程碑.md', content: milestone },
    ],
  },
];

export function getLibraryTemplate(id: string): LibraryTemplate | null {
  return LIBRARY_TEMPLATES.find((t) => t.id === id) ?? null;
}
