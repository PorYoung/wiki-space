// DocVault Mock Data — 文档与知识资产管理平台
// 自包含 JS，无外部依赖

const now = new Date('2026-09-05T10:30:00+08:00');
const daysAgo = (d, h = 0) => new Date(now.getTime() - d * 86400000 - h * 3600000).toISOString();

// ---------- 项目 / 文档库 ----------
const projects = [
  {
    id: 'p-001',
    name: '个人知识库',
    description: '日常学习笔记、读书笔记与灵感收集，属于我自己的第二大脑。',
    icon: 'brain',
    sourceType: 'local',
    sourceUrl: 'C:/Users/poryo/Documents/DocVault/Personal',
    lastSynced: daysAgo(0, 2),
    docCount: 47,
    template: 'wiki',
    visibility: 'private',
    color: 'bg-violet-100',
    members: [1],
  },
  {
    id: 'p-002',
    name: 'EdgeAgent Platform',
    description: '团队边缘计算智能体平台官方文档，含架构、部署与 API 参考。',
    icon: 'server',
    sourceType: 'git',
    sourceUrl: 'git@git.deepwiki.cn:platform/edgeagent-docs.git',
    lastSynced: daysAgo(0, 1),
    docCount: 86,
    template: 'docs',
    visibility: 'team',
    color: 'bg-sky-100',
    members: [1, 2, 3, 4, 6],
  },
  {
    id: 'p-003',
    name: 'DeepWiki Blog',
    description: 'DeepWiki 官方博客，发布产品更新、技术洞察与团队故事。',
    icon: 'pen-square',
    sourceType: 'git',
    sourceUrl: 'https://github.com/deepwiki/blog.git',
    lastSynced: daysAgo(1),
    docCount: 32,
    template: 'blog',
    visibility: 'public',
    isPublished: true,
    websiteUrl: 'https://blog.deepwiki.cn',
    color: 'bg-rose-100',
    members: [4, 5],
  },
  {
    id: 'p-004',
    name: 'Harness Specs',
    description: '测试工具 Harness 的需求与规格说明仓库，从代码库 /docs 目录自动索引。',
    icon: 'clipboard-list',
    sourceType: 'git',
    sourceUrl: 'https://github.com/harness/harness-core.git',
    lastSynced: daysAgo(0, 4),
    docCount: 54,
    template: 'docs',
    visibility: 'team',
    color: 'bg-amber-100',
    members: [6, 7, 8, 9],
  },
  {
    id: 'p-005',
    name: 'Nova 前端仓库 /docs',
    description: 'Nova 前端 monorepo 中的设计与开发文档，源自 packages/nova/docs。',
    icon: 'layout-template',
    sourceType: 'git',
    sourceUrl: 'git@git.deepwiki.cn:web/nova.git',
    lastSynced: daysAgo(2),
    docCount: 28,
    template: 'docs',
    visibility: 'team',
    color: 'bg-emerald-100',
    members: [7, 8],
  },
  {
    id: 'p-006',
    name: 'DataHub Wiki',
    description: 'DataHub 数据治理平台内部 Wiki，涵盖数据资产目录与血缘。',
    icon: 'database',
    sourceType: 'git',
    sourceUrl: 'git@git.deepwiki.cn:data/datahub-wiki.git',
    lastSynced: daysAgo(1, 3),
    docCount: 121,
    template: 'wiki',
    visibility: 'team',
    color: 'bg-indigo-100',
    members: [9, 10],
  },
  {
    id: 'p-007',
    name: 'OpenCloud 官网',
    description: 'OpenCloud 云计算产品官网，使用自定义产品站模板构建。',
    icon: 'globe',
    sourceType: 'git',
    sourceUrl: 'https://github.com/opencloud-site/marketing.git',
    lastSynced: daysAgo(3),
    docCount: 18,
    template: 'product-site',
    visibility: 'public',
    isPublished: true,
    websiteUrl: 'https://opencloud.io',
    color: 'bg-teal-100',
    members: [11, 12],
  },
  {
    id: 'p-008',
    name: 'Weekly Engineering Notes',
    description: '工程团队周报与复盘集合，纯本地 Markdown 归档。',
    icon: 'file-text',
    sourceType: 'local',
    sourceUrl: 'D:/engineering/weekly',
    lastSynced: daysAgo(0, 6),
    docCount: 96,
    template: 'custom',
    visibility: 'team',
    color: 'bg-orange-100',
    members: [1, 2, 6, 9],
  },
];

// ---------- 文档 ----------
const documents = [
  {
    id: 'd-101',
    projectId: 'p-002',
    title: 'EdgeAgent 架构概览',
    path: 'architecture/overview.md',
    content: `# EdgeAgent 架构概览

EdgeAgent 采用 **控制面 / 数据面** 分离的分布式架构，支持从边缘设备到区域中心的多层部署。

- 控制面（Control Plane）：负责策略分发、设备注册与状态同步
- 数据面（Data Plane）：运行在边缘节点上，执行推理与数据采集
- 消息总线：基于 MQTT，QoS 1 至少一次投递

核心组件：

\`\`\`yaml
edgeagent:
  control-plane: controller
  data-plane: agent
  transport: mqtt://broker:1883
\`\`\`

> 部署前请阅读 [部署指南](./deployment.md)。`,
    lastModified: daysAgo(0, 1),
    modifiedBy: 'u-1',
    status: 'synced',
    version: 7,
    tags: ['architecture', 'overview'],
    collaborators: [1, 2, 3],
    wordCount: 186,
  },
  {
    id: 'd-102',
    projectId: 'p-002',
    title: '快速开始：5 分钟跑通 EdgeAgent',
    path: 'getting-started/quickstart.md',
    content: `# 快速开始

通过三步在本地启动一个 EdgeAgent 集群：

1. 克隆仓库：\`git clone git@git.deepwiki.cn:platform/edgeagent-docs.git\`
2. 启动依赖：\`docker-compose up -d mqtt zookeeper\`
3. 启动 Agent：\`edgeagent run --config ./examples/dev.yaml\`

首次启动后，访问 \`http://localhost:9090\` 查看控制面板。

## 常见问题

- **端口被占用**：修改 \`--config\` 中的 \`listen.port\`
- **证书错误**：开发环境可加 \`--insecure\` 跳过 TLS 校验`,
    lastModified: daysAgo(1),
    modifiedBy: 'u-2',
    status: 'synced',
    version: 5,
    tags: ['quickstart', 'tutorial'],
    collaborators: [1, 2],
    wordCount: 152,
  },
  {
    id: 'd-103',
    projectId: 'p-002',
    title: 'REST API 参考',
    path: 'api/rest-api.md',
    content: `# REST API

EdgeAgent 提供 OpenAPI 3.0 风格的 REST 接口，根路径为 \`/v1\`。

## 设备列表

\`GET /v1/devices\`

查询参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| page | int | 页码，默认 1 |
| size | int | 每页大小，最大 100 |
| status | enum | \`online\` / \`offline\` / \`unknown\` |

响应示例：

\`\`\`json
{ "items": [ { "id": "dev-001", "status": "online" } ], "total": 128 }
\`\`\``,
    lastModified: daysAgo(0, 3),
    modifiedBy: 'u-3',
    status: 'modified',
    version: 12,
    tags: ['api', 'reference'],
    collaborators: [1, 3],
    wordCount: 178,
  },
  {
    id: 'd-104',
    projectId: 'p-001',
    title: '第二大脑构建方法论',
    path: '方法论/第二大脑.md',
    content: `# 第二大脑构建方法论

## 核心理念

> 你的大脑负责**思考**，而不是**记忆**。把记忆外包给结构化的笔记系统。

## 执行步骤

1. **采集**：任何有启发的内容都进入收件箱
2. **精炼**：用自己的话重述，写为什么重要
3. **关联**：通过双向链接连接到已有笔记
4. **表达**：定期输出文章或分享

## 工具选择

- 笔记：Obsidian / DocVault
- 闪卡：Anki
- 画布：Excalidraw`,
    lastModified: daysAgo(2),
    modifiedBy: 'u-1',
    status: 'synced',
    version: 3,
    tags: ['方法论', 'PIM'],
    collaborators: [1],
    wordCount: 120,
  },
  {
    id: 'd-105',
    projectId: 'p-001',
    title: '读书笔记：《思考，快与慢》',
    path: '读书笔记/思考快与慢.md',
    content: `# 《思考，快与慢》读书笔记

作者：丹尼尔·卡尼曼 | 2011

## 系统 1 与系统 2

- **系统 1**：快速、直觉、不费力；依赖经验与启发式
- **系统 2**：缓慢、分析、需要专注；用于复杂推理

## 关键启发

在产品决策中，我们常常高估直觉（系统 1）。重要决策必须强制走系统 2：
- 写下来而不是口头判断
- 引入外部视角（"事前验尸"）
- 用数据校验直觉`,
    lastModified: daysAgo(5),
    modifiedBy: 'u-1',
    status: 'synced',
    version: 2,
    tags: ['读书笔记', '行为经济学'],
    collaborators: [1],
    wordCount: 115,
  },
  {
    id: 'd-106',
    projectId: 'p-003',
    title: 'DocVault 2.0 发布：让文档管理像代码一样优雅',
    path: 'posts/2026-09-01-docvault-2.0.md',
    content: `# DocVault 2.0 发布：让文档管理像代码一样优雅

**2026-09-01 · 5 分钟阅读**

今天我们正式发布 DocVault 2.0。这个版本的核心理念是：**文档即代码**。

## 有什么新东西？

- 🧩 **Git 原生同步**：直接绑定 GitHub / GitLab 仓库
- 🗂️ **多源聚合**：本地文件夹、代码仓库 /docs 目录、网页链接一网打尽
- 🤝 **团队协作**：评论、@提及、冲突可视化三方合并
- 🎨 **主题市场**：docs、blog、wiki、product-site 一键切换

## 技术亮点

新版索引器使用 Rust 重写，**增量索引速度提升 8 倍**，全文搜索延迟降到 20ms 以内。`,
    lastModified: daysAgo(4),
    modifiedBy: 'u-4',
    status: 'synced',
    version: 4,
    tags: ['release', 'product'],
    collaborators: [4, 5],
    wordCount: 198,
  },
  {
    id: 'd-107',
    projectId: 'p-003',
    title: '从零搭建一个技术博客：我的选型思考',
    path: 'posts/2026-08-20-blog-stack.md',
    content: `# 从零搭建一个技术博客：我的选型思考

## 目标

- 写作体验优先：Markdown + 实时预览
- 零运维：静态托管 + CDN
- 可扩展：未来想接评论、邮件订阅

## 最终选择

| 层 | 方案 | 理由 |
|---|------|------|
| 引擎 | Astro | 内容优先，MDX 支持好 |
| 样式 | Tailwind | 设计一致性 |
| 部署 | Cloudflare Pages | 免费 + 全球 CDN |
| 内容 | DocVault | 多端编辑 + 版本管理 |

## 踩坑

不要把博客的 Markdown 直接丢进 CMS，你会失去 Git 的全部威力。`,
    lastModified: daysAgo(16),
    modifiedBy: 'u-5',
    status: 'synced',
    version: 3,
    tags: ['blog', 'devops'],
    collaborators: [4, 5],
    wordCount: 142,
  },
  {
    id: 'd-108',
    projectId: 'p-004',
    title: 'Harness 项目总览',
    path: 'index.md',
    content: `# Harness 项目总览

Harness 是一个 **声明式测试编排框架**，核心思想是：测试也应该像基础设施一样即代码。

## 模块

- \`harness-core\`：执行引擎与 DSL 解析
- \`harness-cli\`：命令行入口
- \`harness-web\`：可视化工作台
- \`harness-plugins\`：插件体系（junit、pytest、playwright...）

## 快速链接

- [DSL 规范](./dsl/spec.md)
- [插件开发](./plugins/authoring.md)
- [CI 集成](./integrations/ci.md)`,
    lastModified: daysAgo(0, 4),
    modifiedBy: 'u-6',
    status: 'synced',
    version: 6,
    tags: ['overview'],
    collaborators: [6, 7],
    wordCount: 110,
  },
  {
    id: 'd-109',
    projectId: 'p-004',
    title: 'DSL 规范 v2',
    path: 'dsl/spec-v2.md',
    content: `# DSL 规范 v2

Harness DSL 使用 YAML 定义测试流水线。

## 示例

\`\`\`yaml
suite: api-regression
target:
  image: node:20
  script: npm test
steps:
  - uses: harness/plugins/junit@v1
    with:
      report: ./artifacts/junit.xml
  - uses: harness/plugins/notify@v2
    with:
      channel: '#qa-alerts'
\`\`\`

## 变更日志

- **v2.1**：新增 \`needs\` 显式依赖声明
- **v2.0**：\`target\` 块取代顶层 \`image\` 字段，破坏性变更`,
    lastModified: daysAgo(3),
    modifiedBy: 'u-6',
    status: 'conflict',
    version: 9,
    tags: ['dsl', 'spec'],
    collaborators: [6, 7, 2],
    wordCount: 135,
  },
  {
    id: 'd-110',
    projectId: 'p-005',
    title: 'Nova 组件库设计原则',
    path: 'design/principles.md',
    content: `# Nova 组件库设计原则

## 四条核心原则

1. **可组合**：组件是乐高，不是黑盒
2. **可主题化**：设计 token 驱动，不用写死颜色
3. **可访问**：默认满足 WCAG AA
4. **可扩展**：插槽 / render-prop 预留扩展点

## 反模式

- ❌ 在组件内部硬编码间距
- ❌ 暴露 20+ 个 props 却没有分组
- ❌ 用 CSS \`!important\` 覆盖用户样式`,
    lastModified: daysAgo(2),
    modifiedBy: 'u-7',
    status: 'synced',
    version: 4,
    tags: ['design', 'components'],
    collaborators: [7, 8],
    wordCount: 118,
  },
  {
    id: 'd-111',
    projectId: 'p-005',
    title: 'Nova Changelog',
    path: 'CHANGELOG.md',
    content: `# Changelog

## [3.4.0] - 2026-08-28

### 新增

- \`DataTable\` 虚拟滚动支持（\`virtualized\` prop）
- \`useMediaQuery\` 组合式 hook

### 修复

- \`Modal\` 在 iOS Safari 下的滚动穿透问题（#2847）
- \`Select\` 远程搜索防抖丢失输入（#2851）

## [3.3.2] - 2026-08-14

- Patch：修复构建产物中的 sourcemap 路径`,
    lastModified: daysAgo(8),
    modifiedBy: 'u-8',
    status: 'synced',
    version: 15,
    tags: ['changelog', 'release-notes'],
    collaborators: [7, 8],
    wordCount: 108,
  },
  {
    id: 'd-112',
    projectId: 'p-006',
    title: 'DataHub 数据资产目录使用指南',
    path: '使用指南/资产目录.md',
    content: `# 数据资产目录使用指南

数据资产目录是 DataHub 的核心入口，提供 **搜索、血缘、归属** 三大能力。

## 搜索

- 支持按名称、Owner、标签、层级路径过滤
- 最近搜索会被团队共享
- 结果可保存为个人或团队视图

## 血缘

- 点击任意字段可向上 / 向下追溯 5 层
- 生产链路高亮为红色，实验链路为灰色
- 支持导出为 PNG 或 Mermaid 源码`,
    lastModified: daysAgo(1, 3),
    modifiedBy: 'u-9',
    status: 'synced',
    version: 6,
    tags: ['guide', 'catalog'],
    collaborators: [9, 10],
    wordCount: 124,
  },
  {
    id: 'd-113',
    projectId: 'p-006',
    title: '数据治理 RACI 矩阵',
    path: '治理/RACI矩阵.md',
    content: `# 数据治理 RACI 矩阵

| 领域 | R | A | C | I |
|------|---|---|---|---|
| 数据标准 | 数据委员会 | 架构组 | 各业务 Owner | 全员 |
| 分类分级 | 安全团队 | 数据委员会 | 业务 Owner | 合规 |
| 生命周期 | 平台组 | 数据 Owner | 业务 Owner | 审计 |
| 元数据质量 | 数据 Owner | 平台组 | 业务 Owner | — |

> R=Responsible 执行者, A=Accountable 问责者, C=Consulted 被咨询, I=Informed 被告知`,
    lastModified: daysAgo(12),
    modifiedBy: 'u-10',
    status: 'synced',
    version: 3,
    tags: ['governance', 'raci'],
    collaborators: [9, 10],
    wordCount: 96,
  },
  {
    id: 'd-114',
    projectId: 'p-007',
    title: 'OpenCloud 产品页文案',
    path: 'pages/product.md',
    content: `# OpenCloud 产品页文案

## Hero 标题

**为开发者而生的云。**
弹性、可控、开箱即用。

## 核心卖点（三栏）

- **弹性伸缩**：秒级扩容，按秒计费
- **全球节点**：24 个区域，3 倍于传统云
- **开发者友好**：完整的 OpenAPI + Terraform Provider

## CTA

[免费注册 →](/signup) | [看定价 →](/pricing)`,
    lastModified: daysAgo(3),
    modifiedBy: 'u-11',
    status: 'untracked',
    version: 1,
    tags: ['copy', 'marketing'],
    collaborators: [11, 12],
    wordCount: 98,
  },
  {
    id: 'd-115',
    projectId: 'p-007',
    title: 'OpenCloud 定价策略',
    path: 'pages/pricing.md',
    content: `# OpenCloud 定价策略

## 基本原则

- **只按使用量付费**，不收预留费用
- **免费额度永久有效**，不是首月优惠
- **价格透明**，所有单价在 API 中可查询

## 计算示例

一台 2C4G 实例运行 720 小时：

\`\`\`
0.032 元 / 小时 × 720 = 23.04 元
\`\`\`

对比行业平均 42 元/月，节省约 45%。`,
    lastModified: daysAgo(9),
    modifiedBy: 'u-12',
    status: 'synced',
    version: 5,
    tags: ['pricing', 'marketing'],
    collaborators: [11, 12],
    wordCount: 102,
  },
  {
    id: 'd-116',
    projectId: 'p-008',
    title: '2026-W35 工程周报',
    path: '2026/W35.md',
    content: `# 2026-W35 工程周报（08/25 – 08/31）

## 亮点

- 🚀 DocVault 2.0 发布，Rust 索引器落地
- 🧯 Nova 3.4.0 修了三个 P0 级 bug
- 🤝 EdgeAgent 对接 DataHub，设备元数据自动同步

## 下周计划

| 负责人 | 事项 |
|--------|------|
| poryo | EdgeAgent mTLS 改造 |
| 阿杰 | Harness DSL v2 灰度 |
| 小七 | Nova 无障碍审计 |

## 风险

- Cloudflare Workers 本月配额快用完了，需要评估迁移成本`,
    lastModified: daysAgo(5),
    modifiedBy: 'u-1',
    status: 'synced',
    version: 2,
    tags: ['weekly', 'report'],
    collaborators: [1, 2, 6],
    wordCount: 130,
  },
  {
    id: 'd-117',
    projectId: 'p-008',
    title: '2026-W36 工程周报',
    path: '2026/W36.md',
    content: `# 2026-W36 工程周报（09/01 – 09/05）

## 亮点

- 📦 OpenCloud 官网重构上线，LCP 从 4.2s 降到 1.1s
- 🧪 Harness DSL v2 灰度 10%，零失败
- 🧠 个人知识库同步了 23 篇新笔记

## 阻塞

- 阿里云 RAM 权限工单还没批，EdgeAgent 的 VPC peering 卡住

## 下周计划

- Harness DSL v2 扩到 50%
- DataHub 接入 Hive Metastore
- 准备 Q3 总结汇报`,
    lastModified: daysAgo(0, 6),
    modifiedBy: 'u-1',
    status: 'synced',
    version: 2,
    tags: ['weekly', 'report'],
    collaborators: [1, 2, 9],
    wordCount: 118,
  },
  {
    id: 'd-118',
    projectId: 'p-001',
    title: '提示词工程笔记',
    path: 'AI/提示词工程.md',
    content: `# 提示词工程笔记

## 通用框架：CRISPE

- **C**apacity & Role：让模型扮演什么角色
- **R**ole Play：角色的具体职责
- **I**nformation：背景信息
- **S**tatement：要完成的任务
- **P**ersonality：语气风格
- **E**xperiment：多次迭代

## 技巧

- 给**负面示例**和给正面示例一样重要
- 对复杂任务要求模型**先思考再回答**（chain-of-thought）
- 用分隔符（\`\`\`）明确标注输入边界`,
    lastModified: daysAgo(7),
    modifiedBy: 'u-1',
    status: 'synced',
    version: 3,
    tags: ['AI', 'prompting'],
    collaborators: [1],
    wordCount: 112,
  },
  {
    id: 'd-119',
    projectId: 'p-002',
    title: 'EdgeAgent 故障排查手册',
    path: 'operations/troubleshooting.md',
    content: `# 故障排查手册

## 设备离线

按顺序检查：

1. 网络连通：\`ping <device-ip>\`
2. 证书有效期：\`openssl x509 -in cert.pem -dates\`
3. Agent 日志：\`journalctl -u edgeagent -f\`

## 消息积压

- 查看 Broker 的 \`mqtt_queued_messages\` 指标
- 检查消费者端是否有慢处理
- 紧急时可临时扩容 Broker 节点

## 常见错误码

| 码 | 含义 | 处理 |
|----|------|------|
| E1001 | 认证失败 | 重新签发设备证书 |
| E2003 | 消息格式不兼容 | 升级 Agent 固件 |`,
    lastModified: daysAgo(0, 5),
    modifiedBy: 'u-2',
    status: 'modified',
    version: 8,
    tags: ['ops', 'troubleshooting'],
    collaborators: [1, 2, 3],
    wordCount: 148,
  },
  {
    id: 'd-120',
    projectId: 'p-004',
    title: '插件开发 Authoring 指南',
    path: 'plugins/authoring.md',
    content: `# 插件开发 Authoring 指南

Harness 插件是一个符合特定接口的 Go 模块。

## 核心接口

\`\`\`go
type Plugin interface {
  Name() string
  Run(ctx context.Context, input Input) (Output, error)
}
\`\`\`

## 发布流程

1. 在 \`harness-plugins\` monorepo 开分支
2. 合并后自动发布到 \`registry.harness.dev\`
3. 用户在 DSL 中写 \`uses: org/plugin-name@v1\`

## 调试技巧

本地用 \`harness plugin dev --path ./my-plugin\` 热重载。`,
    lastModified: daysAgo(4),
    modifiedBy: 'u-6',
    status: 'synced',
    version: 5,
    tags: ['plugin', 'guide'],
    collaborators: [6, 7],
    wordCount: 132,
  },
  {
    id: 'd-121',
    projectId: 'p-006',
    title: '元数据质量评分规则',
    path: '治理/质量评分.md',
    content: `# 元数据质量评分规则

DataHub 为每张表计算 0–100 的质量分，由以下维度加权：

| 维度 | 权重 | 说明 |
|------|------|------|
| 描述完整度 | 30% | 表 + 字段是否有非空描述 |
| 标签覆盖率 | 20% | 是否打上领域 / 等级标签 |
| Owner 明确 | 20% | 是否指定数据 Owner |
| 血缘联通 | 15% | 是否能追溯上游 |
| 最近更新 | 15% | 元数据是否在 30 天内刷新 |

分数 < 60 的表会进入**治理看板**，自动推送给 Owner。`,
    lastModified: daysAgo(14),
    modifiedBy: 'u-10',
    status: 'synced',
    version: 4,
    tags: ['governance', 'quality'],
    collaborators: [9, 10],
    wordCount: 128,
  },
];

// ---------- 版本历史 ----------
const authors = [
  { id: 'u-1', name: 'poryo' },
  { id: 'u-2', name: '林川' },
  { id: 'u-3', name: '赵一鸣' },
  { id: 'u-4', name: '苏筱' },
  { id: 'u-5', name: '周远' },
  { id: 'u-6', name: '何佳' },
  { id: 'u-7', name: '小七' },
  { id: 'u-8', name: '阿杰' },
  { id: 'u-9', name: '郑凯' },
  { id: 'u-10', name: '李沐' },
  { id: 'u-11', name: 'Amy' },
  { id: 'u-12', name: 'Ken' },
];

const makeVersions = (docId, seed, count = 5) => {
  const messages = [
    '更新示例代码',
    '修正文案与排版',
    '补充故障排查章节',
    '重写开头导语',
    '新增常见问题 FAQ',
    '修复表格格式',
    '调整章节顺序',
    '添加参考链接',
    '根据评审意见修改',
    '同步最新接口变更',
  ];
  const branches = ['main', 'main', 'main', 'feat/api-v2', 'fix/docs-typo'];
  const list = [];
  for (let i = 0; i < count; i++) {
    const hash = Math.random().toString(16).slice(2, 9);
    list.push({
      id: `${docId}-v${count - i}`,
      docId,
      commitHash: hash,
      message: messages[(seed + i) % messages.length],
      author: authors[(seed + i) % authors.length].name,
      timestamp: daysAgo(i * 2 + (seed % 3)),
      additions: 5 + ((seed * 7 + i * 13) % 40),
      deletions: ((seed * 3 + i * 5) % 25),
      branch: branches[(seed + i) % branches.length],
    });
  }
  return list;
};

const versions = [
  ...makeVersions('d-101', 1, 5),
  ...makeVersions('d-102', 2, 4),
  ...makeVersions('d-103', 3, 6),
  ...makeVersions('d-104', 4, 3),
  ...makeVersions('d-105', 5, 3),
  ...makeVersions('d-106', 6, 4),
  ...makeVersions('d-107', 7, 4),
  ...makeVersions('d-108', 8, 5),
  ...makeVersions('d-109', 9, 6),
  ...makeVersions('d-110', 10, 4),
  ...makeVersions('d-111', 11, 5),
  ...makeVersions('d-112', 12, 5),
  ...makeVersions('d-113', 13, 3),
  ...makeVersions('d-114', 14, 2),
  ...makeVersions('d-115', 15, 5),
  ...makeVersions('d-116', 16, 2),
  ...makeVersions('d-117', 17, 2),
  ...makeVersions('d-118', 18, 3),
  ...makeVersions('d-119', 19, 6),
  ...makeVersions('d-120', 20, 5),
  ...makeVersions('d-121', 21, 4),
];

// ---------- 团队成员 ----------
const team = [
  { id: 1, name: 'poryo', email: 'poryo@deepwiki.cn', role: 'Owner', avatarColor: '#8b5cf6', online: true, lastActive: daysAgo(0) },
  { id: 2, name: '林川', email: 'linchuan@deepwiki.cn', role: 'Maintainer', avatarColor: '#0ea5e9', online: true, lastActive: daysAgo(0, 1) },
  { id: 3, name: '赵一鸣', email: 'zhaoyiming@deepwiki.cn', role: 'Maintainer', avatarColor: '#f59e0b', online: false, lastActive: daysAgo(1) },
  { id: 4, name: '苏筱', email: 'suxiao@deepwiki.cn', role: 'Editor', avatarColor: '#ec4899', online: true, lastActive: daysAgo(0, 3) },
  { id: 5, name: '周远', email: 'zhouyuan@deepwiki.cn', role: 'Editor', avatarColor: '#10b981', online: false, lastActive: daysAgo(2) },
  { id: 6, name: '何佳', email: 'hejia@deepwiki.cn', role: 'Maintainer', avatarColor: '#6366f1', online: true, lastActive: daysAgo(0, 4) },
  { id: 7, name: '小七', email: 'xiaoqi@deepwiki.cn', role: 'Editor', avatarColor: '#14b8a6', online: true, lastActive: daysAgo(0) },
  { id: 8, name: '阿杰', email: 'ajie@deepwiki.cn', role: 'Editor', avatarColor: '#f97316', online: false, lastActive: daysAgo(1, 6) },
  { id: 9, name: '郑凯', email: 'zhengkai@deepwiki.cn', role: 'Maintainer', avatarColor: '#3b82f6', online: false, lastActive: daysAgo(2) },
  { id: 10, name: '李沐', email: 'limu@deepwiki.cn', role: 'Editor', avatarColor: '#a855f7', online: true, lastActive: daysAgo(0, 2) },
  { id: 11, name: 'Amy', email: 'amy@opencloud.io', role: 'Guest', avatarColor: '#e11d48', online: false, lastActive: daysAgo(3) },
  { id: 12, name: 'Ken', email: 'ken@opencloud.io', role: 'Guest', avatarColor: '#059669', online: false, lastActive: daysAgo(4) },
];

// ---------- 模板 ----------
const templates = [
  {
    id: 't-docs',
    name: '标准文档 Docs',
    type: 'docs',
    previewEmoji: '📚',
    color: 'bg-sky-100',
    description: '技术文档的经典模板，左侧导航 + 右侧内容，支持多版本切换。',
    projectCount: 3,
  },
  {
    id: 't-blog',
    name: '博客 Blog',
    type: 'blog',
    previewEmoji: '✍️',
    color: 'bg-rose-100',
    description: '时间线驱动的文章列表，首页支持精选推荐与分类过滤。',
    projectCount: 1,
  },
  {
    id: 't-product',
    name: '产品官网 Product Site',
    type: 'product-site',
    previewEmoji: '🌐',
    color: 'bg-teal-100',
    description: '营销导向的单页模板，内置 Hero、特性三栏、定价与 CTA。',
    projectCount: 1,
  },
  {
    id: 't-wiki',
    name: '团队 Wiki',
    type: 'wiki',
    previewEmoji: '🧠',
    color: 'bg-violet-100',
    description: '支持树形目录与双向链接，适合沉淀组织知识。',
    projectCount: 2,
  },
  {
    id: 't-api',
    name: 'API 参考 API Ref',
    type: 'api-ref',
    previewEmoji: '🔗',
    color: 'bg-amber-100',
    description: 'OpenAPI 渲染专用模板，自动生成端点分组与试跑面板。',
    projectCount: 0,
  },
];

// ---------- 文档源 ----------
const sources = [
  {
    id: 's-1',
    name: 'Harness Core 仓库',
    type: 'git',
    url: 'https://github.com/harness/harness-core.git',
    status: 'connected',
    lastSync: daysAgo(0, 4),
    branch: 'main',
    authMethod: 'token',
    subdirectories: ['docs'],
  },
  {
    id: 's-2',
    name: 'EdgeAgent 官方文档',
    type: 'git',
    url: 'git@git.deepwiki.cn:platform/edgeagent-docs.git',
    status: 'connected',
    lastSync: daysAgo(0, 1),
    branch: 'main',
    authMethod: 'ssh',
    subdirectories: [],
  },
  {
    id: 's-3',
    name: '本地 · Personal Vault',
    type: 'local-folder',
    url: 'C:/Users/poryo/Documents/DocVault/Personal',
    status: 'connected',
    lastSync: daysAgo(0, 2),
    branch: null,
  },
  {
    id: 's-4',
    name: 'Nova 前端 Monorepo',
    type: 'git',
    url: 'git@git.deepwiki.cn:web/nova.git',
    status: 'syncing',
    lastSync: daysAgo(2),
    branch: 'develop',
    authMethod: 'token',
    subdirectories: ['packages/nova/docs', 'docs/guide'],
  },
  {
    id: 's-5',
    name: 'DataHub Wiki 仓库',
    type: 'git',
    url: 'git@git.deepwiki.cn:data/datahub-wiki.git',
    status: 'connected',
    lastSync: daysAgo(1, 3),
    branch: 'main',
    authMethod: 'ssh',
    subdirectories: [],
  },
  {
    id: 's-6',
    name: 'OpenCloud Marketing',
    type: 'git',
    url: 'https://github.com/opencloud-site/marketing.git',
    status: 'connected',
    lastSync: daysAgo(3),
    branch: 'main',
    authMethod: 'token',
    subdirectories: ['pages'],
  },
  {
    id: 's-7',
    name: 'Web · Rust Book',
    type: 'web-link',
    url: 'https://doc.rust-lang.org/book/',
    status: 'error',
    lastSync: daysAgo(7),
    branch: null,
  },
  {
    id: 's-8',
    name: '本地 · Engineering Weekly',
    type: 'local-folder',
    url: 'D:/engineering/weekly',
    status: 'connected',
    lastSync: daysAgo(0, 6),
    branch: null,
  },
  {
    id: 's-9',
    name: 'MySQL · 公司内部规范库',
    type: 'database',
    dbType: 'mysql',
    host: 'mysql.internal.deepwiki.cn',
    port: 3306,
    database: 'doc_vault',
    table: 'company_docs',
    username: 'doc_reader',
    status: 'connected',
    lastSync: daysAgo(0, 8),
  },
  {
    id: 's-10',
    name: 'PostgreSQL · API 变更日志',
    type: 'database',
    dbType: 'postgresql',
    host: 'pg-api.deepwiki.cn',
    port: 5432,
    database: 'api_audit',
    table: 'change_logs',
    username: 'api_ro',
    status: 'connected',
    lastSync: daysAgo(1, 2),
  },
  // ---- 对象数据库示例 ----
  {
    id: 's-11',
    name: 'CouchDB · 产品文档库',
    type: 'database',
    dbType: 'couchdb',
    host: 'couchdb.internal.deepwiki.cn',
    port: 5984,
    database: 'product_docs',
    table: null,
    username: 'couchdb_ro',
    status: 'connected',
    lastSync: daysAgo(0, 6),
  },
  {
    id: 's-12',
    name: 'Azure Cosmos DB · 团队 Wiki',
    type: 'database',
    dbType: 'cosmosdb',
    host: 'https://cosmos-docvault.documents.azure.com',
    port: null,
    database: 'TeamWiki',
    table: 'documents',
    username: null,
    status: 'connected',
    lastSync: daysAgo(1, 4),
  },
  {
    id: 's-13',
    name: 'RavenDB · 需求追踪',
    type: 'database',
    dbType: 'ravendb',
    host: 'ravendb.internal.deepwiki.cn',
    port: 8080,
    database: 'Requirements',
    table: null,
    username: 'raven_reader',
    status: 'error',
    lastSync: daysAgo(3),
  },
];

// ---------- 活动流 ----------
const activities = [
  { id: 'a-01', actor: 'poryo', action: '编辑了', target: 'EdgeAgent 故障排查手册', projectId: 'p-002', timestamp: daysAgo(0, 5) },
  { id: 'a-02', actor: '林川', action: '提交了 PR：', target: 'docs: 补充 mTLS 章节', projectId: 'p-002', timestamp: daysAgo(0, 2) },
  { id: 'a-03', actor: '苏筱', action: '发布了博客：', target: 'DocVault 2.0 发布', projectId: 'p-003', timestamp: daysAgo(1) },
  { id: 'a-04', actor: '何佳', action: '合并了 MR：', target: 'dsl: v2 规范定稿', projectId: 'p-004', timestamp: daysAgo(3) },
  { id: 'a-05', actor: '郑凯', action: '新增了文档：', target: '元数据质量评分规则', projectId: 'p-006', timestamp: daysAgo(14) },
  { id: 'a-06', actor: '小七', action: '更新了', target: 'Nova Changelog', projectId: 'p-005', timestamp: daysAgo(8) },
  { id: 'a-07', actor: 'Ken', action: '留下评论在', target: 'OpenCloud 定价策略', projectId: 'p-007', timestamp: daysAgo(9) },
  { id: 'a-08', actor: 'poryo', action: '同步了', target: '个人知识库（+23 篇）', projectId: 'p-001', timestamp: daysAgo(0, 2) },
  { id: 'a-09', actor: '周远', action: '删除了', target: 'draft: 未命名.md', projectId: 'p-003', timestamp: daysAgo(2) },
  { id: 'a-10', actor: 'Amy', action: '加入了', target: 'OpenCloud 官网 项目', projectId: 'p-007', timestamp: daysAgo(10) },
  { id: 'a-11', actor: '赵一鸣', action: '解决了冲突在', target: 'DSL 规范 v2', projectId: 'p-004', timestamp: daysAgo(4) },
  { id: 'a-12', actor: '李沐', action: '@提及 你 在', target: '数据治理 RACI 矩阵', projectId: 'p-006', timestamp: daysAgo(12) },
];

// ---------- 写操作 stub（原型占位，不修改真实数据） ----------
function pushVersion(docId, message) {
  const doc = documents.find((d) => d.id === docId);
  if (!doc) return null;
  const hash = Math.random().toString(16).slice(2, 9);
  const v = {
    id: `${docId}-v${doc.version + 1}`,
    docId,
    commitHash: hash,
    message,
    author: authors[0].name,
    timestamp: new Date().toISOString(),
    additions: 10,
    deletions: 0,
    branch: 'main',
  };
  versions.unshift(v);
  return v;
}

function pushActivity({ actor, action, target, at }) {
  activities.unshift({
    id: `a-${Date.now()}`,
    actor,
    action,
    target,
    projectId: 'p-001',
    timestamp: at || new Date().toISOString(),
  });
}

// ---------- 编辑器默认打开的文档 ----------
const editorOpenDocId = documents[0].id; // 'd-101'

// ---------- Starter Packs（参考 open-knowledge 的种子模板包）----------
// 每个模板包描述一个目录结构，用于从平台新建知识库时一键初始化。
// tree 字段：字符串数组，'  ' 前缀缩进表示层级，'.md' 后缀为文档文件，其余为目录。
const starterPacks = [
  {
    id: 'sp-default',
    name: '默认知识底座',
    type: 'default',
    previewEmoji: '🧠',
    color: 'bg-violet-100',
    description: '最通用的起步模板：收件箱 + 方法论 + 读书笔记 + 灵感收集，开箱即用。',
    docCount: 12,
    tree: [
      '收件箱/',
      '  待整理.md',
      '方法论/',
      '  第二大脑.md',
      '  费曼学习法.md',
      '读书笔记/',
      '  思考快与慢.md',
      '  原则.md',
      '灵感/',
      '  产品 idea.md',
      '  技术 idea.md',
      'AI/',
      '  提示词工程.md',
    ],
    sampleTags: ['方法论', 'PIM', 'AI', '读书笔记'],
  },
  {
    id: 'sp-software-lifecycle',
    name: '软件研发生命周期',
    type: 'software-lifecycle',
    previewEmoji: '🛠️',
    color: 'bg-sky-100',
    description: '从需求到运维的全流程文档骨架，适合研发团队沉淀内部 Wiki。',
    docCount: 14,
    tree: [
      '01-需求/',
      '  PRD-模板.md',
      '  需求池.md',
      '02-设计/',
      '  架构设计.md',
      '  数据库设计.md',
      '03-开发/',
      '  开发规范.md',
      '  代码审查清单.md',
      '04-测试/',
      '  测试计划.md',
      '  测试用例模板.md',
      '05-运维/',
      '  部署指南.md',
      '  故障排查手册.md',
      '06-发布/',
      '  变更日志.md',
      '  发布计划.md',
    ],
    sampleTags: ['研发', '架构', '测试', '运维'],
  },
  {
    id: 'sp-codebase-wiki',
    name: '代码库 Wiki',
    type: 'codebase-wiki',
    previewEmoji: '📦',
    color: 'bg-amber-100',
    description: '围绕一个代码仓库的文档化模板：快速上手、架构、模块、约定、FAQ。',
    docCount: 10,
    tree: [
      'README.md',
      '快速开始.md',
      '架构概览.md',
      '目录约定.md',
      '模块/',
      '  模块A.md',
      '  模块B.md',
      '开发指南/',
      '  本地开发.md',
      '  测试.md',
      '  发布.md',
      '常见问题-FAQ.md',
    ],
    sampleTags: ['代码库', '架构', '开发'],
  },
  {
    id: 'sp-plain-notes',
    name: '纯笔记起点',
    type: 'plain-notes',
    previewEmoji: '📝',
    color: 'bg-emerald-100',
    description: '极简起步：一个收件箱 + 若干空白笔记，不预设任何结构。',
    docCount: 4,
    tree: [
      '收件箱/',
      '  今天想到的.md',
      '笔记/',
      '  空白笔记1.md',
      '  空白笔记2.md',
      '索引.md',
    ],
    sampleTags: [],
  },
  {
    id: 'sp-worldbuilding',
    name: '世界观构建',
    type: 'worldbuilding',
    previewEmoji: '🌍',
    color: 'bg-rose-100',
    description: '小说 / 剧本世界观设定专用模板，含人物、地理、历史、魔法体系等。',
    docCount: 12,
    tree: [
      '世界观总览.md',
      '人物/',
      '  主角.md',
      '  配角.md',
      '  反派.md',
      '地理/',
      '  地图总览.md',
      '  主要城市.md',
      '历史/',
      '  编年史.md',
      '  关键事件.md',
      '力量体系/',
      '  魔法.md',
      '  科技.md',
      '语言-文化.md',
    ],
    sampleTags: ['世界观', '写作'],
  },
  {
    id: 'sp-writing-pipeline',
    name: '写作流水线',
    type: 'writing-pipeline',
    previewEmoji: '✍️',
    color: 'bg-teal-100',
    description: '从素材收集到发布的博客/专栏写作工作流模板。',
    docCount: 8,
    tree: [
      '素材/',
      '  灵感收集.md',
      '  参考资料.md',
      '草稿/',
      '  草稿-模板.md',
      '已发布/',
      '  第一篇.md',
      '提纲库.md',
      '读者反馈.md',
      '选题池.md',
    ],
    sampleTags: ['写作', '博客'],
  },
  {
    id: 'sp-entity-vault',
    name: '实体库（卡片盒）',
    type: 'entity-vault',
    previewEmoji: '🗂️',
    color: 'bg-indigo-100',
    description: 'Zettelkasten 风格：每个概念/人物/公司一张卡片，通过双向链接串联。',
    docCount: 6,
    tree: [
      '索引.md',
      '概念/',
      '  认知负荷.md',
      '  第一性原理.md',
      '人物/',
      '  查理芒格.md',
      '  纳西姆塔勒布.md',
    ],
    sampleTags: ['概念', '人物', '卡片盒'],
  },
  {
    id: 'sp-okf',
    name: 'OKR & 目标追踪',
    type: 'okf',
    previewEmoji: '🎯',
    color: 'bg-orange-100',
    description: '季度 OKR、目标拆解、复盘与周回顾的结构化模板。',
    docCount: 9,
    tree: [
      '季度-OKR/',
      '  Q3-OKR.md',
      '  Q4-OKR.md',
      '目标拆解/',
      '  年度目标.md',
      '  月度目标.md',
      '周回顾/',
      '  W35.md',
      '  W36.md',
      '复盘/',
      '  月度复盘.md',
      '索引.md',
    ],
    sampleTags: ['OKR', '目标管理'],
  },
];

// ---------- 知识图谱数据（按项目划分，节点 + 边）----------
// 节点类型：doc = 文档；external = 外部网页；orphan = 孤立节点（无入边也无出边）
const graphData = {
  // p-001 个人知识库（示例：AI / 方法论 / 读书笔记三篇互链）
  'p-001': {
    nodes: [
      { id: 'd-104', label: '第二大脑构建方法论', type: 'doc', cluster: '方法论', url: '/project/p-001/browse?doc=d-104' },
      { id: 'd-105', label: '读书笔记：思考快与慢', type: 'doc', cluster: '读书笔记', url: '/project/p-001/browse?doc=d-105' },
      { id: 'd-118', label: '提示词工程笔记', type: 'doc', cluster: 'AI', url: '/project/p-001/browse?doc=d-118' },
      { id: 'ext-1', label: 'Zettelkasten 方法论', type: 'external', cluster: 'external', url: 'https://zettelkasten.de' },
      { id: 'ext-2', label: 'CRISPE Prompt Framework', type: 'external', cluster: 'external', url: 'https://medium.com/@mousavi78/crispe' },
    ],
    edges: [
      { from: 'd-104', to: 'ext-1', label: '参考' },
      { from: 'd-118', to: 'ext-2', label: '来源' },
      { from: 'd-118', to: 'd-104', label: '关联' },
    ],
    clusters: [
      { key: '方法论', color: '#8b5cf6' },
      { key: '读书笔记', color: '#f59e0b' },
      { key: 'AI', color: '#10b981' },
      { key: 'external', color: '#f97316' },
    ],
    orphans: ['d-105'],
    hubs: ['d-118'],
  },
  // p-002 EdgeAgent 文档
  'p-002': {
    nodes: [
      { id: 'd-101', label: 'EdgeAgent 架构概览', type: 'doc', cluster: '架构', url: '/project/p-002/browse?doc=d-101' },
      { id: 'd-102', label: '快速开始', type: 'doc', cluster: '入门', url: '/project/p-002/browse?doc=d-102' },
      { id: 'd-103', label: 'REST API 参考', type: 'doc', cluster: 'API', url: '/project/p-002/browse?doc=d-103' },
      { id: 'd-119', label: '故障排查手册', type: 'doc', cluster: '运维', url: '/project/p-002/browse?doc=d-119' },
      { id: 'ext-mqtt', label: 'MQTT 协议规范', type: 'external', cluster: 'external', url: 'https://mqtt.org' },
      { id: 'broken-1', label: '已删除的部署文档', type: 'doc', cluster: '运维', broken: true },
    ],
    edges: [
      { from: 'd-101', to: 'd-102', label: '见' },
      { from: 'd-101', to: 'd-103', label: '相关' },
      { from: 'd-101', to: 'd-119', label: '延伸' },
      { from: 'd-101', to: 'ext-mqtt', label: '依赖' },
      { from: 'd-119', to: 'broken-1', label: '已替换', broken: true },
    ],
    clusters: [
      { key: '架构', color: '#0ea5e9' },
      { key: '入门', color: '#22c55e' },
      { key: 'API', color: '#eab308' },
      { key: '运维', color: '#ef4444' },
      { key: 'external', color: '#f97316' },
    ],
    orphans: [],
    hubs: ['d-101'],
  },
};

// ---------- 导入历史（import jobs）----------
const importJobs = [
  {
    id: 'ij-001',
    projectId: 'p-001',
    importer: 'web-crawler',
    sourceUrl: 'https://doc.rust-lang.org/book/',
    status: 'completed',
    startedAt: daysAgo(0, 3),
    finishedAt: daysAgo(0, 2),
    stats: { pagesFetched: 47, pagesImported: 42, skipped: 5, newDocs: 42 },
    title: 'Rust Book',
  },
  {
    id: 'ij-002',
    projectId: 'p-001',
    importer: 'notion',
    sourceUrl: 'https://notion.so/my-team-wiki',
    status: 'completed',
    startedAt: daysAgo(1, 2),
    finishedAt: daysAgo(1, 1),
    stats: { pagesFetched: 128, pagesImported: 120, skipped: 8, newDocs: 120 },
    title: 'Notion 团队 Wiki',
  },
  {
    id: 'ij-003',
    projectId: 'p-001',
    importer: 'web-crawler',
    sourceUrl: 'https://docs.python.org/3/tutorial/',
    status: 'running',
    startedAt: daysAgo(0, 0.5),
    finishedAt: null,
    stats: { pagesFetched: 18, pagesImported: 15, skipped: 0, newDocs: 15 },
    title: 'Python 官方教程',
  },
];

// ---------- AI 自动分类运行记录 ----------
const aiClassifyRuns = [
  {
    id: 'ac-001',
    projectId: 'p-001',
    scope: 'all',
    classifierVersion: 'v2.3',
    startedAt: daysAgo(2),
    finishedAt: daysAgo(2),
    durationSec: 47,
    stats: { scanned: 47, foldersCreated: 3, docsRelocated: 12, tagsAdded: 34 },
    status: 'completed',
    by: 'system',
  },
  {
    id: 'ac-002',
    projectId: 'p-001',
    scope: 'inbox',
    classifierVersion: 'v2.3',
    startedAt: daysAgo(0, 6),
    finishedAt: daysAgo(0, 6),
    durationSec: 8,
    stats: { scanned: 6, foldersCreated: 0, docsRelocated: 4, tagsAdded: 9 },
    status: 'completed',
    by: 'system',
  },
];

// ---------- 聚合导出 ----------
const DB = {
  projects,
  documents,
  versions,
  team,
  templates,
  sources,
  activities,
  editorOpenDocId,
  authors,
  starterPacks,
  graphData,
  importJobs,
  aiClassifyRuns,
};

export default DB;
export {
  DB,
  projects,
  documents,
  versions,
  team,
  templates,
  sources,
  activities,
  editorOpenDocId,
  authors,
  pushVersion,
  pushActivity,
  starterPacks,
  graphData,
  importJobs,
  aiClassifyRuns,
};
