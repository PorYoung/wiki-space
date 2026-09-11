# 原型还原 · 像素级优化方案与修复路线图（PROTOTYPE-PARITY-PLAN）

> 配套审计报告：[PROTOTYPE-PARITY-AUDIT.md](./PROTOTYPE-PARITY-AUDIT.md)（问题编号 F1-F5 / S1-S4 与本方案一一对应）。
> 原则：**原型是视觉事实源**（`ewiki/packages/theme/src/index.ts:2` 已声明）；凡回迁原型的改动，值一律从原型文件照抄，禁止重调。真实 API 驱动的有据偏离见白名单，不做回滚。**硬约束：UI 禁止引用任何在线资源（Google Fonts 等 CDN）——原型的字体外链不回迁，字体走 @fontsource 自托管（见 1.1），所有静态资源随构建本地化。**

---

## 核销进度快照（2026-09-08 全量复盘）

> 基于当前代码逐行复核（6 组页面深比 + 后端路由盘点，非照抄审计快照）：

| 批次 | 状态 | 说明 |
|---|---|---|
| 第 1 批（1.1~1.5） | ✅ 全部完成 | 字体自托管 / 圆角阴影 / 组件类（含 btn 布局合并增强）/ 暗色覆盖层（落地远超最小集）/ 兜底·动画·theme-transitioning |
| 第 2 批（2.1~2.6） | ✅ 全部完成 | 快速创建 / 通知 footer+面包屑 / prose-doc 七主题 / Themes 真主题入口+分组头 / Settings 外观联动主体 / 遮罩 均已落地；2.4 发布模板规格（t-docs/t-blog/t-product/t-wiki/t-api 五套对齐原型 + zhLabel/emoji/星标 + h-[180px] 预览 + hero 布局 + hover 遮罩）已于第 6 批核销；2.5 外观回显半缺口已于第 5 批收口 |
| 第 3 批（3.1~3.6） | 🔶 约 95% | 3.1 主体完成（导航布局切换有意裁剪、AI/评论/历史 tab 按条款后置）；3.2 第 1~4 条全部完成（**第 4 条右栏三 tab 面板**：active 态/点按切换/折叠竖条/展开表头，AI 与评论按缺口纪律 disabled+空态+TODO、历史 tab 接真实 versions 数据，已于第 6 批核销；左栏折叠联动第 5 批收口）；3.3 全部完成（工具栏甚至超原型）；3.4 完成 9/11（标签三维阻塞后端 `documents.tags` 列，已按条款补注释）；3.5 七项全完成（模板网格/预览/templateId 阻塞后端端点）；3.6 各页条目（Sources/Activity/Graph/Members/Dashboard/Settings/Team）全部完成 |
| 第 4 批（P2 打磨） | 🔶 部分完成 | 「个月前」时间档、danger 区、btn-danger 覆写清理、Members stagger 等已核销；其余随迭代，另见 5.3 补充 |
| 第 5 批（5.1 + 5.4 先行项） | 🔶 主体完成 | 5.1 六项纯前端接线（保存/同步设置节/间隔档位/sourceUrl/StarterPack 向导/外观回显）与 5.4 三项正确性修复已落地并 API 级验收（2026-09-08）；顺带修复 2 个验收中发现的隐性 bug：PATCH /projects 因 Hono `app.route()` 挂载时序从未注册（404）、GET /projects 返回 `{items}` 被误按 `{projects}` 解构（项目切换下拉恒空）；5.2 部分核销（见第 6 批），5.3 待排期 |
| 第 6 批（5.2 先行 + 计划内残留） | ✅ 全部完成 | DELETE `/projects/:id`（软删+activities+auditLogs）与 PATCH `/publish-sites/:id`（slug 唯一冲突 409/枚举校验 400/空更新回读）两端点落地，删除入口两处接线（ProjectLayout 更多菜单 + ProjectSettings 危险区，confirm→toast→回库列表）；3.2 第 4 条右栏面板、2.4 发布模板规格核销；5.2.2 Settings 占位节补齐（通知事件矩阵+摘要频率、快捷键只读表、第三方源卡、关于/帮助链接+导出+注销红区，缺口一律 disabled+TODO；Toggle 组件增 disabled 支持）。API 级验收 2026-09-08 全过（200/404/409/400 逐项实测，临时数据已清理），tsc+build 双绿 |
| 第 7 批（5.2 全量解锁 + 可落地项） | ✅ 全部完成 | 后端：`documents.tags`/`publishSites.templateId` 列（迁移 0001）+ 全链路下发；PUT /documents 落 `changedSummary`（行级 diff）；GET /team 改 members 契约（**修复 TeamPage 成员恒空 bug**）+ role 映射 + online/lastActive（activities 推导）；POST /team/invite + PATCH /team/:id/role 落地；GET /publish-templates 服务端权威源；前端：TeamPage 适配、Library 标签三维回补（筛选五维/搜索含标签/卡片标签行）、Members 三 StatPill、Publish 向导模板网格 + Themes「在发布中使用」带参跳转、Profile 只读字段、Settings 已连接源预览、Dashboard 第 3 源类型；P2 打磨 5 项（Graph 后缀/项目色底色/Escape/!h-11 等）。API 验收 2026-09-08 全过，tsc+build 双绿 |
| 第 8 批（5.3 打磨余量 + 5.2 前端占位 + 3.4 残留） | ✅ 全部完成 | 3.4 残留：文档列表两接口派生 `summary` 下发（content 不出网，服务端剥 md 语法取 140 字），顺带补齐全局 GET /documents 缺失的 sourceId/contentHash/updatedBy/createdAt（**修复 Library 卡作者恒「未知」**），Browse/Library 两处 DocumentCard 摘要接线。5.3 七组全核销：Browse（卡片 tags 行+hover「打开」、双击进编辑悬浮提示、编辑态双击切回预览、grid 切换省略/presence 省略两条偏离声明）；Graph（工具栏/图例毛玻璃 color-mix+backdrop-blur、doc 节点标签 #374151+14 字截断+labelLen 16）；Sidebar/TopBar（渐变头像 var-gradient、UserMenu 渐变头部+头像块、菜单图标 w-8 h-8 容器、💡 前缀、通知 50ms/快速创建 40ms stagger）；Library（「近 3 天」时间档、FilterChip 项目模式隐藏声明）；Members（邀请 Modal Mail 图标块+X 关闭+max-w-[1440px] 容器、默认角色 Editor 差异补产品确认注释）；Publish（骨架 3+1 卡；概览卡暗色经查 1.4 暗色层已全覆盖 bg/border/text 三类，目检确认）；Themes（分类筛选 pills 全部/官方/社区/收藏+空态、收藏 localStorage 持久化默认 t-docs、UI 主题与模板卡入场 stagger）。5.2 前端占位：Sources database 完整表单（10 类型分组网格/默认端口回填/host/port/db/table/username，密码进 configSecret）与 Git 认证三选卡（token/ssh 表单落地，oauth disabled+TODO，configSecret 自由 record 无需后端扩展）+ 设置弹窗 database 连接信息只读回显；Themes PreviewModal（浏览器 chrome 画布+布局 mock 实时着色、主色调 6 预设+自定义、侧栏左右切换、应用到项目、「在发布中使用」接线；复制预览 HTML disabled 待渲染端点）。tsc+build 双绿，浏览器目检 2026-09-09 过 |
| 第 9 批（三个后置专项自研部分，[EXT-PLATFORM-PLAN](./EXT-PLATFORM-PLAN.md)） | ✅ 全部完成 | **Step1 渲染抽包**：新建 `packages/render`（@ewiki/render，markdownToHtml/renderSite/renderDocPage + 五模板渲染参数），worker 删本地实现改 import（发布产物命名/hash 口径不变），server 加 `GET /projects/:id/publish-preview`（同步渲染不落盘，docId/templateId/accent/sidebarSide 可调），PreviewModal 画布切真 HTML（iframe sandbox）+「复制预览 HTML」解禁。**Step2 能力路由**：shared ports 增 `ClassifyProvider`/`ImportProvider`/`Notifier`；worker Provider 注册表（heuristic 分类器/folder/web-crawler 爬虫，`AI_CLASSIFY_PROVIDER` env 可换）；server 补 POST ai-classify（singletonKey 去重）/GET ai-classify-runs/POST+GET import-jobs（白名单 folder/web-crawler，notion 400 NOT_IMPLEMENTED）；ProjectSettings「AI 整理/外部导入」两卡解禁（建议列表/任务进度轮询）。**Step3 通知横切**：worker InboxNotifier（notifications 表 + pg_notify notification.new，realtime 按 user 房间广播）接入 sync.error/publish.finished/import.finished/failed 四事件点 + notifyProjectMembers；server 邀请通知 + GET /notifications（游标分页+unread）/POST read/read-all（本人行校验）；TopBar 通知中心切真数据源（未读徽标/点击已读跳转/60s 轮询）+ `/notifications` 落地页（全部已读/加载更早）。API 验收 2026-09-09 全过（preview 双 scope 模板着色、classify 202→6 runs、crawler 导入 done、notion 400、通知 unread 归零链路、401 边界），验收数据零残留（测试导入文档/runs/通知/任务已物理清理），tsc+build 双绿 |

**计划内未完项执行提示**：~~3.2 第 4 条（右栏面板）~~、~~2.4 发布模板规格~~（第 6 批）、~~3.1 第 5 条后置 tab（即右栏 AI/评论/历史）~~（第 6 批）、~~3.4 标签三维~~、~~3.5 templateId 阻塞~~（第 7 批）、~~3.4 剩余「DocumentCard 内容摘要」~~（第 8 批，列表接口派生 summary 已落地）均已核销。
**计划外缺口**（原审计 3.x 有记录但本计划未收录）共 20+ 项，已补录为 **第 5 批**；5.1 六项与 5.4 三项（第 5 批）、5.2 大部与可落地占位（第 6/7 批）、5.3 打磨余量与 5.2 剩余前端占位（第 8 批）均已落地并验收。三个后置专项已于 **第 9 批**（[EXT-PLATFORM-PLAN](./EXT-PLATFORM-PLAN.md)）核销其可自研部分：~~AI 分类/导入任务路由~~（worker 原有启发式/爬虫实现补齐 server 路由 + 前端解禁，Provider 接口 + env 选择留后期适配器）、~~发布模板渲染预览端点~~（渲染器抽包 @ewiki/render，worker/server 同源，PreviewModal 接真 HTML）、~~通知体系~~（notifications 写侧/读侧/已读/落地页/TopBar 真数据源全链路）。仍后置：contentScope/docId/versionScope 发布范围 schema（UI-only 声明维持，发布恒整库）、LLM 分类与 Notion 深度连接器（Provider 适配器接入点已留）、通知邮件/webhook 渠道与 WS 前端订阅（站内轮询兜底）。

---

## 第 1 批 · 全局设计契约回正（零行为风险，全站观感立刻回正）

### 1.1 字体离线化自托管（修 F1）｜约束：UI 禁止引用任何在线资源
> 原型的 Google Fonts CDN 方案（`prototype-docvault/index.html:8-11`）**不回迁**——用户环境可能无法访问 fonts.googleapis.com，会造成字体加载缓慢或失败。改为 npm 自托管：`@fontsource` 包将 woff2 随依赖安装，由 Vite 打包进 `dist/assets`，运行时零外链、离线可用。

1. 安装（字重对齐原型实际用量：Inter 400/500/600、Plus Jakarta Sans 500/600/700、JetBrains Mono 400/500）：

```bash
pnpm --filter @ewiki/web add @fontsource/inter @fontsource/plus-jakarta-sans @fontsource/jetbrains-mono
```

2. `ewiki/apps/web/src/main.tsx` 顶部（`./index.css` 之前）只引 latin 子集（UI 中文走系统字体回退，无需 cyrillic 等子集，控制包体）：

```ts
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-500.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
```

3. `ewiki/apps/web/tailwind.config.ts` fontFamily 改为（Poppins → Plus Jakarta Sans，补 mono；中文回退到系统字体栈）：

```ts
fontFamily: {
  display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
  body:    ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
},
```

`ewiki/apps/web/src/index.css` body 补：

```css
body {
  font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

4. 验收补充：构建产物 `dist/` 内 grep 不得出现 `fonts.googleapis.com` / `fonts.gstatic.com` 等外链；字体文件应位于 `dist/assets/*.woff2`（约 8 个 latin 子集文件，单个 10~30KB）。

### 1.2 圆角与阴影体系（修 F2）
`ewiki/apps/web/tailwind.config.ts` theme.extend 内补（照抄 `prototype-docvault/tailwind.config.js:49-58`）：

```ts
boxShadow: {
  sm: '0 1px 2px rgba(16,24,40,0.06)',
  md: '0 4px 12px rgba(16,24,40,0.08)',
  lg: '0 12px 32px rgba(16,24,40,0.12)',
},
borderRadius: { sm: '6px', md: '10px', lg: '16px' },
```

> 影响面说明：覆写后 `rounded-md`=10px、`rounded-lg`=16px、`rounded`/`rounded-sm`=6px，与原型逐类对齐；`rounded-xl` 原型无覆写（12px），保持默认。

### 1.3 组件类对齐（修 F3）
改写 `ewiki/apps/web/src/index.css` 的组件层为原型规格（原型 `prototype-docvault/src/index.css:347-414`）：

```css
.btn-primary {
  @apply inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium text-white shadow-sm;
  background: var(--color-primary-500);
}
.btn-primary:hover { background: var(--color-primary-600); }
.btn-secondary {
  @apply inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium;
  background: var(--bg-surface); border: 1px solid var(--border-soft);
  color: var(--text-secondary);
}
.btn-secondary:hover { background: var(--bg-hover, #f1f5f9); }
.btn-ghost {
  @apply inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium;
  color: var(--text-secondary);
}
.btn-ghost:hover { background: var(--bg-hover, #f1f5f9); }
.btn-danger {
  @apply inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium;
  background: var(--bg-surface); border: 1px solid var(--border-soft); color: #ef4444;
}
.btn-danger:hover { background: #fef2f2; border-color: #ef4444; }
.tag { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium; }
.tag-primary { background: var(--color-primary-50); color: var(--color-primary-700); }
.tag-success { background: #ecfdf5; color: #047857; }
.tag-warning { background: #fffbeb; color: #b45309; }
.tag-danger  { background: #fef2f2; color: #b91c1c; }
.tag-neutral { background: var(--bg-subtle, #f1f5f9); color: var(--text-secondary, #475569); }
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-soft);
  border-radius: 0.5rem;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}
.card-hover { @apply card transition-all duration-200 cursor-pointer; }
.card-hover:hover { box-shadow: 0 4px 12px rgba(16,24,40,0.08); border-color: var(--border-strong, #cbd5e1); }
.input {
  @apply w-full px-3 py-2 rounded-md border text-sm transition;
  border-color: var(--border-soft); background: var(--bg-surface); color: var(--text-primary);
}
.input:focus { outline: none; border-color: var(--color-primary-400); box-shadow: 0 0 0 2px var(--color-primary-200); }
.nav-item {
  @apply flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition cursor-pointer;
  color: var(--text-secondary);
}
.nav-item:hover { background: var(--bg-hover, #f1f5f9); color: var(--text-primary); }
.nav-item.active { background: var(--color-primary-50); color: var(--color-primary-700); }
.nav-item.active .nav-icon { color: var(--color-primary-600); }
.nav-icon { color: var(--text-muted, #94a3b8); }
```

同批替换调用方：`Sidebar.tsx:23-37` 的内联样式 NavItem 改回 `.nav-item` 类 + `.nav-icon`（图标加 `className="nav-icon"`），Sidebar 侧边栏提示卡恢复 `💡` 前缀与渐变头像（`from-primary-400 to-primary-600`，可用 `background: linear-gradient(135deg, var(--color-primary-400), var(--color-primary-600))`）。

### 1.4 暗色模式最小覆盖层（修 F4）
在 `ewiki/apps/web/src/index.css` 末尾新增（原型 `prototype-docvault/src/index.css:91-332` 的最小必要子集）：

```css
html[data-appearance='dark'] { color-scheme: dark; }
html[data-appearance='dark'] .bg-white { background-color: var(--bg-surface); }
html[data-appearance='dark'] .hover\:bg-white:hover { background-color: var(--bg-subtle); }
html[data-appearance='dark'] .ring-white { --tw-ring-color: var(--border-strong); }
/* 弹窗遮罩：neutral-900 暗色下翻转为亮色，必须压回黑 */
html[data-appearance='dark'] .bg-neutral-900\/30 { background-color: rgba(0,0,0,0.55); }
html[data-appearance='dark'] .bg-neutral-900\/40 { background-color: rgba(0,0,0,0.65); }
html[data-appearance='dark'] .bg-neutral-900\/50 { background-color: rgba(0,0,0,0.7); }
/* Tailwind 默认彩色 50/100 级（图标底/徽章），半透明降饱和（原型 index.css:244-266） */
html[data-appearance='dark'] .bg-emerald-50 { background-color: rgba(16,185,129,0.18); }
html[data-appearance='dark'] .bg-amber-50  { background-color: rgba(245,158,11,0.18); }
html[data-appearance='dark'] .bg-red-50    { background-color: rgba(239,68,68,0.18); }
html[data-appearance='dark'] .bg-rose-50   { background-color: rgba(244,63,94,0.18); }
html[data-appearance='dark'] .bg-indigo-50 { background-color: rgba(99,102,241,0.18); }
html[data-appearance='dark'] .bg-sky-50    { background-color: rgba(14,165,233,0.18); }
html[data-appearance='dark'] .bg-violet-50 { background-color: rgba(139,92,246,0.18); }
html[data-appearance='dark'] .bg-violet-100{ background-color: rgba(139,92,246,0.25); }
html[data-appearance='dark'] .bg-blue-50   { background-color: rgba(59,130,246,0.18); }
html[data-appearance='dark'] .text-emerald-600 { color: #6ee7b7; }
html[data-appearance='dark'] .text-amber-600   { color: #fcd34d; }
html[data-appearance='dark'] .text-sky-600     { color: #7dd3fc; }
/* 暗色阴影加深（原型 index.css:172-175） */
html[data-appearance='dark'] .shadow-sm { box-shadow: 0 1px 2px 0 rgba(0,0,0,0.4); }
html[data-appearance='dark'] .shadow-md { box-shadow: 0 4px 6px -1px rgba(0,0,0,0.45), 0 2px 4px -2px rgba(0,0,0,0.35); }
html[data-appearance='dark'] .shadow-lg { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5), 0 4px 6px -4px rgba(0,0,0,0.4); }
```

另改 `TopBar.tsx:52` tooltip：`bg-neutral-800 text-white` → 内联 `style={{ background: 'var(--bg-subtle)', color: 'var(--text-primary)' }}`（或补暗色覆盖类）。

### 1.5 兜底/动画/色值（修 F5）
- `ewiki/apps/web/src/index.css` `:root` 补齐 neutral 50~900 兜底（照抄 `prototype-docvault/src/index.css:24-33`）与 `--bg-subtle/--bg-hover/--border-strong/--text-secondary/--text-muted` 兜底。
- 动画对齐原型（`prototype-docvault/src/index.css:430-444`）：`fade-up 0.4s ease-out both / translateY(8px)`；`slide-in 0.25s ease-out both / translateX(100%)`（类名保留现有写法，仅改参数并补 `both`）。
- `ewiki/packages/theme/src/index.ts:51`：`#b45f09` → `#b45309`。
- `ThemeProvider`（或 `applyAppearance`）接入 `theme-transitioning`：切换前 `documentElement.classList.add('theme-transitioning')`，320ms 后移除；index.css 补原型 `index.css:322-332` 的 transition 块。

**第 1 批验收**：`pnpm --filter @ewiki/web build` 通过；亮色下按钮 36px 高带阴影、卡片 8px 圆角带投影、标题为 Plus Jakarta Sans；切暗色后弹窗遮罩为黑、Dashboard 统计图标底为半透明彩、tooltip 可读。

---

## 第 2 批 · 功能入口纠错（P0，改动小、收益大）

### 2.1 快速创建菜单（修 S1）
`ewiki/apps/web/src/components/layout/TopBar.tsx:113-118` options 改为：

```ts
const options = [
  { icon: FileText,  label: '新建文档',   desc: '在当前项目中创建 Markdown 文档', to: '/library' },
  { icon: FolderOpen, label: '新建文档库', desc: '创建一个新的知识库项目',        to: '/library' },
  { icon: Database,  label: '添加数据源', desc: '从 Git / 本地 / 网页连接源',     to: '/sources' },
  { icon: Users,     label: '邀请成员',   desc: '添加协作者到你的团队',          to: '/team' },
];
```
（import 处补 `Database, Users`；对照原型 `TopBar.jsx:210-215`。）

### 2.2 通知下拉补 footer 与面包屑（修 S4 部分）
- `TopBar.tsx:104-107` 列表容器后补 footer：

```tsx
<div className="border-t px-4 py-2.5 text-center" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-subtle)' }}>
  <button className="text-xs font-medium" style={{ color: 'var(--color-primary-600)' }}>查看全部通知</button>
</div>
```
- 面包屑：`TopBar.tsx` Breadcrumb 增加 `/project/` 分支（照抄原型 `TopBar.jsx:60-85`：`文档库`(Link 可回 /library) > `projectId`(font-mono text-xs) > `browse/graph/activity/publish/members/settings` 中文标签），routeLabels 补 `team: '团队'`。

### 2.3 prose-doc 渲染主题（修 Browse P0①）
1. 将 `prototype-docvault/src/index.css:446-588` 的 **整段 `.prose-doc` 样式（基础 + prose-plain/book/journal/compact/tech/solarized-light/solarized-dark 七主题 + 暗色覆盖）原样复制**到 `ewiki/apps/web/src/index.css`（该段使用的 `font-display` 等 token 实际项目已具备）。
2. `BrowsePage.tsx:686` className 改为动态拼接：

```tsx
className={`max-w-3xl mx-auto px-10 py-10 prose-doc prose-${renderTheme || 'plain'}`}
```
（对照原型 `ProjectBrowse.jsx:1063`；`renderTheme` state 已存在于 `BrowsePage.tsx`。）
3. 渲染主题下拉底部补说明行「原 Markdown 内容不会被修改」（原型 `ProjectBrowse.jsx:954-956`）。

### 2.4 ThemesPage 对齐真主题引擎（修 Themes P0）
- 删除 `ThemesPage.tsx:41-114` 自创主题集与 `:159` 的 `UI_THEMES_KEY = 'ewiki-ui-theme'`（key 冲突源）。
- 改从 `@ewiki/theme` 导入 `THEMES`，卡片渲染 8 套真主题（名称/description/styleCategory 分组：modern 4 套 + cn-traditional 4 套，恢复原型的分组头「◆ 现代风格 / 中国传统色 + 数量」）。
- 「应用」按钮接 `useTheme().applyTheme(theme.id)` 即时生效（替代当前只写 localStorage + disabled）；卡片 active 判定改为 `activeTheme.id === theme.id`。
- 自创的 UI 主题选择持久化若需保留，改用独立 key（如 `ewiki-theme-page-preview`），绝不与 `ewiki-ui-theme`/`ewiki-appearance` 冲突。
- 发布模板列表命名对齐原型（t-docs/t-blog/t-product/t-wiki/t-api：标准文档/博客/产品官网/团队 Wiki/API 参考）；模板网格恢复 `lg:grid-cols-3` + `h-[180px]` SVG 预览（可后置到第 3 批）。

### 2.5 Settings 外观联动（修 Settings P0）
`SettingsPage.tsx:232` 外观选择处补：

```ts
import { useTheme } from '../theme/ThemeProvider';
const { appearance, applyAppearance } = useTheme();
// RadioCard 选中值改读 appearance，onChange 调 applyAppearance(mode)（内部已持久化 ewiki-appearance）
```
`prefs.theme` 仅作为显示偏好的镜像双写，不再作为唯一事实源。强调色 5 圆改为映射 `applyTheme` 的真主题 id（teal→fresh-emerald 等）或暂时隐藏（原型行为是接主题引擎）。

### 2.6 弹窗遮罩替换（修 Dashboard/Library 遮罩）
全局替换：`bg-neutral-900/40`、`bg-neutral-900/30` 保留类名即可（第 1 批 1.4 的覆盖层已处理）；若追求彻底，可改为内联 `style={{ background: 'rgba(0,0,0,0.4)' }}`。二选一，不做双份。

**第 2 批验收**：快速创建四项图标与落地页正确；`/team` 可达；Browse 渲染主题下拉七项切换正文版式即时变化（书籍衬线/等宽紧凑/科技蓝等肉眼可辨）；Themes 选主题全站即时变色且刷新后保持；Settings 切深色与 TopBar 切深色行为一致。

---

## 第 3 批 · 高价值结构还原（需排期，按收益排序）

### 3.1 ProjectLayout 整壳迁移（修 S3，连带解决项目内暗色/toast/右栏）
以 `prototype-docvault/src/components/ProjectLayout.jsx`（约 770 行）为蓝本迁移到 `ProjectLayout.tsx`，分块清单：
1. 项目身份区：w-9 h-9 字母色块（取项目名首字母，底色用项目色或 primary-500）+ 项目名（截断 max-w-[200px]）+ sourceType tag。
2. 项目切换下拉：列表来自 `GET /api/v1/projects`，「返回全局文档库」项。
3. 右侧操作：分享按钮（复制 URL）、更多菜单（访问发布网站/重命名/删除——可先仅保留「访问发布网站」跳 publish Tab，其余 disabled+TODO）。
4. AppearanceToggle 复用全局 TopBar 的实现（抽出为 `components/AppearanceToggle.tsx` 共用）。
5. 右侧信息面板 ProjectRightSidebar：概览/动态/成员三卡（读 `GET /api/v1/projects/:id/overview` 等现有端点）+ 折叠竖条；browse 页的 AI/评论/历史 Tab 可后置。
6. toast 通道：新建 `components/Toast.tsx`（原型样式：底部居中、深底白字、2s 自动消失）+ Outlet context 下发 `showToast`；Browse 保存成功、Dashboard 创建成功、Settings 保存等统一接。
7. HeaderSkeleton + 项目不存在态（NotFound + 返回文档库按钮）。
8. main 以 `key={pathname}` 重放 `animate-fade-up`；Tab 加 15px 图标（Files/Network/Activity/Rocket/Users/Settings，对照原型 :690）与 hover 态 `hover:bg-neutral-100 hover:text-neutral-800`（暗色经变量自适应）。

### 3.2 Browse 三栏拖拽（修 Browse P0②）
1. `pnpm --filter @ewiki/web add react-resizable-panels`（与原型同版本 ^2.1.9）。
2. 左栏+编辑区包 `PanelGroup direction="horizontal"`：左 `defaultSize={22} minSize={14} collapsible collapsedSize={4}`、中 `minSize={30}`；`PanelResizeHandle className="resize-handle"`。
3. 复制 `prototype-docvault/src/index.css:591-632` 的 `.resize-handle` 样式（含 hover/active 加宽与 vertical 变体）。
4. 右侧协作面板接入同一 PanelGroup 或保持固定 288px（原型 `w-72`），补三 tab active 态与切换、折叠按钮；`hidden lg:flex` 改为原型行为（始终存在）。

### 3.3 Browse 其余 P1
- 树搜索：把 `keyword` 传入 TreeNodeRow 渲染链，过滤不匹配项 + `<mark>` 高亮 + 命中祖先自动展开（照抄原型 `ProjectBrowse.jsx:365-377, 550-573` 逻辑，TS 化）。
- 状态 tag 四色：卡片 :768 与编辑器 :600 的 `tag-neutral` 改回语义映射（synced→tag-success / modified→tag-warning / conflict→tag-danger / 其余→tag-primary；untracked 点色回 `bg-primary-500`）。
- 作者行：`:776-779` 改用 `doc.updatedBy`（无则显示 `updatedBy ?? '未知'`，删掉 `doc.title` 兜底）。
- 保存成功接 `showToast('已保存 ✓')`；preview 容器补 `onDoubleClick={() => setView('edit')}` 与 title 提示。
- 格式工具栏：图标改 Bold/Italic/Strikethrough/Link2/List（7 工具）+ 撤销/重做（disabled）+ 预览切换（原型 :1005-1045）。
- 树 footer 按 `project.sourceType` 分支渲染（local 项目显示「已同步 + 文档数」，不显示 main 分支）。

### 3.4 Library 平铺文档模式与探索维度（P0 组）
按原型 `Library.jsx` 分块回迁：`browseMode` 双模式分段控件、DocumentCard 网格 + 文档表格视图、文档级搜索（标题/路径/标签）、Explore 横幅 + `visibility==='public'` 过滤 + 已发布网站 chip + 网站预览 Modal、页头「导入源」按钮（跳 /sources）、筛选抽屉补模板/可见性/标签三维、ProjectSelector、ProjectCard 悬停「访问网站/进入」。若产品决定裁剪某些维度，**必须在代码处补注释声明**，与"欠账"区分。

### 3.5 Publish 向导骨架（P0 组）
恢复三步卡结构：Step1 版本/文档/内容范围 → Step2 模板网格+预览+autoSync 开关（字段已有）→ Step3 地址组（前缀+slug 校验+复制）+ 底部固定操作栏（取消/立即发布 `!h-11`）；成功后渲染 emerald 成功条（时间+外链+关闭）；站点列表非空时页头补「新建发布站点」按钮打开同一向导；调度默认改 `git-push`。

### 3.6 其余 P1 汇总（每项都是小时级）
- Sources：恢复 URL 列；设置弹窗补 URL/分支/鉴权展示；connected 回 tag-success；分类卡片区（4 张横滚卡）。
- Activity：diff 预览块渲染 `changedSummary`（+绿/-红两行式，原型 :42-54）；CommitCard hover 三操作（diff 可先 toast 占位）。
- Graph：zoom 改整组 `<g transform>`（边+标签+节点统一缩放）；节点形状按 kind 分支；external 详情卡补「在新窗口打开」。
- Members：死代码改为「邀请/角色管理即将上线」空态卡（或接后端后启用）；补成员搜索框；Editor 徽章回 tag-warning。
- Dashboard：补三套骨架屏与创建 Toast、8 色颜色选择器、提醒卡彩色体系与计数徽章、Hero 渐变。
- Settings：恢复左侧 240px 分区导航（6 tab 单屏切换）；`btn-danger` 落地后删除 ProjectSettingsPage 的 `!important` 覆写。
- Team：Sidebar「配置」组加「团队」项（或确认仅保留快速创建入口）。

---

## 第 4 批 · P2 打磨（随迭代核销）

1. 各页图标/文案微调：对照审计报告 3.x 节逐项核销（GitBranch 图标、Clock/FileTime 图标、sub-tab 选中色、头像 36px、色板 10 色、「个月前」时间档等）。
2. 级联入场编舞回补：列表/卡片 `animate-fade-up` + `index*40~60ms`（`animationDelay` + `both`，第 1 批已修 both）。
3. 死 UI 清理：ThemesPage `darkMode` state；placeholders.tsx 可删除（无引用）。
4. NotFoundPage 渐变 fallback `#4f46e5` → `#059669`；Login/404 标题补 `font-display`。
5. ProjectSettingsPage `borderColor` class+style 双声明去重；danger 区硬编码 `rgb(254 242 242/.5)` → 类 + 暗色覆盖。
6. Sources/Browse `relativeTime` 补「个月前」档（原型 `Sources.jsx:28-40`）。

---

## 第 5 批 · 计划外缺口补录（2026-09-08 复盘新增）

> 背景：全量复盘（原型 12 页逐行对比 + 后端路由盘点）发现，原审计报告 3.x 有记录、但第 2/3/4 批未收录的功能缺口共 20+ 项。本批按「纯前端可动工 / 依赖后端端点 / 正确性修复」三档补录，消除"审计记了、计划漏了"的盲区。证据行号为复盘时点实测（当前代码）。

### 5.1 第一梯队 · 后端已就绪，纯前端接线（零阻塞，优先做）

1. **ProjectSettings「保存变更」接线**（修前端过时 TODO）：PATCH `/api/v1/projects/:id` 已实现（`apps/server/src/http/routes.ts:646-683`，支持 name/description/visibility/color，恰好覆盖表单三字段），前端按钮仍 `disabled` 且注释声称"无 PATCH"已过时——接 `useMutation` + invalidate + `showToast('设置已保存')`；同步接线 ProjectLayout 更多菜单「重命名项目」（同一端点）。
   位置：`apps/web/src/pages/ProjectSettingsPage.tsx:209-217`、`apps/web/src/components/layout/ProjectLayout.tsx:504-508`。
2. **「同步设置」整节回迁**（ProjectSettings 增补 tab）：启用自动同步开关 + 间隔四档（30m/1h/6h/24h）+「立即同步一次」按钮；后端 PATCH `/api/v1/sources/:id` 已支持 `autoSync/intervalSeconds`（routes.ts:264-283），立即同步复用 `POST /sources/:id/sync`。原型蓝本 `ProjectSettings.jsx:319-373`。注意：`autoSync/intervalSeconds` 字段在 `SourceItem` 接口已存在（ProjectSettingsPage.tsx:50-51）但无任何 UI 消费。
3. **Sources 间隔档位选择**：添加/设置弹窗的自动同步从写死 `intervalSeconds: 3600/0`（SourcesPage.tsx:570,589）改为四档选择，对齐原型 `Sources.jsx:1450-1477`。
4. **ProjectSettings sourceUrl 展示 + 同步按钮语义纠正**：`SourceItem` 增补 `configPublic` 派生的 url/path 展示行（`GET /api/v1/sources` 已下发，routes.ts:192；原型 `ProjectSettings.jsx:287-292`）；「手动同步」图标按钮当前实际是 `navigate('/sources')` 跳转（ProjectSettingsPage.tsx:283-290），纠正为触发同步或改名为「管理数据源」，并补原型 `:303-315` 的「前往全局数据源管理」提示卡。
5. **StarterPack 建库三步向导回迁**（本批最大项）：后端 `GET /api/v1/starter-packs` + `POST /api/v1/projects/init-from-starter` 已实现（`apps/server/src/http/routes-starter.ts:45` 起）却零前端消费。按原型 `Library.jsx:1512-2267` 回迁三步向导（Step1 模板包网格 → Step2 目录树预览/名称/描述/可见性三选/存储后端三选/源表单 → Step3 成功庆祝页），替换 Library「新建库」跳转 Dashboard 的降级实现；可见性不再硬编码 `'team'`。若短期裁剪，必须按 3.4 同款条款补注释声明。
6. **Settings 外观回显收口**（2.5 残留半缺口）：`SettingsPage.tsx:242` RadioCard 选中值改读 `useTheme().appearance`（或 prefs↔appearance 双向同步），闭合"TopBar 切深色后设置页不回显"。

### 5.2 第二梯队 · 依赖后端新端点（前端先按原型补 UI，保持 disabled+TODO）

1. **后端端点缺口清单**（按优先级排序，逐项标注解锁面）：
   - `GET /api/v1/activities` 支持 `projectId` 过滤（→ 已提升至 5.4.1 正确性修复）
   - ✅ ~~`DELETE /api/v1/projects/:id`~~（第 6 批落地：软删 deletedAt + activities/auditLogs；ProjectSettings「删除项目」与 ProjectLayout 更多菜单「删除」两处已接线，API 验收 200/404 通过）
   - ✅ ~~`PATCH /api/v1/publish-sites/:id`~~（第 6 批落地：slug/addressMode/schedule/autoSync 建后可改，slug 冲突 409 SLUG_EXISTS、枚举非法 400、空更新回读；API 验收 200/409/400/404 通过）
   - ✅ ~~全局团队写操作 `POST /api/v1/team/invite`、`PATCH /api/v1/team/:id/role`~~（第 7 批落地：invite 创建 invited 账号+随机临时密码、role 映射 globalRole（Owner=admin）；GET /team 同步改造为 `{members}` 契约并修复 TeamPage 成员恒空 bug；API 验收 201/409/400/200 通过）
   - ✅ ~~版本写入链路落 `changed_summary`~~（第 7 批落地：PUT /documents 生成行级简化 diff（共同前后缀之间的删/增，各取前 4 行），ActivityPage diff 块数据已实测）
   - ✅ ~~发布模板 `GET /api/v1/publish-templates`~~ + ~~`POST /publish-sites` schema 扩展（templateId）~~（第 7 批落地：服务端权威 5 套模板、templateId 校验 400（先于冲突检查）+ 建站/补丁回写；contentScope/docId/versionScope 仍 UI-only，发布恒整库，已按条款注释）
   - ✅ ~~`documents.tags` 列~~（第 7 批落地：迁移 0001；列表/详情下发、PUT 清洗落库（去重上限 8）、Library 三维回补）
   - ✅ ~~成员接口补 `online/lastActive` 字段~~（第 7 批落地：由该用户最近 activity 推导，5 分钟内在线；GET /team 与 GET /projects/:id/members 双端点）
   - AI 分类 `aiClassifyRuns`、外部导入 `importJobs` 路由（解锁 ProjectSettings 两块 disabled 空态卡；依赖真实 AI 服务/爬虫与 Notion 连接器能力，与通知体系一并后置专项）
   - ~~发布模板渲染预览端点 + contentScope/docId/versionScope 全量 schema~~（templateId 已于第 7 批落地；渲染预览端点与三范围字段仍待做，现版本范围/文档/内容范围三选择为 UI-only，实际恒整库发布，已在代码注释声明）
   - ~~`documents.tags` 列~~（已于第 7 批核销，见上）
   - ~~成员接口补 `online/lastActive` 字段~~（已于第 7 批核销，见上）
   - 通知体系（已读/分页/落地页；TopBar 通知中心已接真实 /activities 数据流，完整 notifications 表消费链路后置专项）
2. **前端占位 UI 补齐**（沿既有 disabled+TODO 策略，均有审计 3.x 依据）：~~Members 三个 StatPill~~、~~Settings 通知细分 8 开关+摘要频率三选（原型 `Settings.jsx:275-349`）~~、~~快捷键 10 行参考表（`:462-514`）~~、~~关于区帮助链接/导出数据/危险红区+注销账号（`:539-583`）~~、~~数据源默认三分区+已连接预览（`:351-447`）~~、~~个人资料字段展示（角色/个人主页只读，`:133-147`）~~、~~Dashboard 新建弹窗「使用已有数据源」第 3 源类型选项~~ 均已核销（通知/快捷键/关于区/第三方源卡=第 6 批；StatPill/已连接源预览/Profile 字段/第 3 源类型=第 7 批，第 3 源类型的「自动关联」因数据源改绑端点未实现暂为只读展示+TODO）；~~Sources database 完整表单与 Git 认证三选卡~~、~~Themes PreviewModal（原型 `Themes.jsx:605-807`）~~ 均已于第 8 批核销（database 字段经核实 configPublic/configSecret 为自由 record 无需后端扩展，表单可直接落库；PreviewModal 预览画布用布局 mock 实时着色，「复制预览 HTML」待渲染端点，disabled+TODO）。

### 5.3 第三梯队 · P2 打磨补充（并入第 4 批节奏核销）

> 第 8 批（2026-09-09）已全量核销，下列各条打勾项为本批落地。

1. Browse：✅ 卡片 tags 行与 hover「打开」按钮（原型 `ProjectBrowse.jsx:339-355`）；✅ 双击进编辑悬浮提示 + 编辑态双击切回预览（`:1100-1117`，MDEditor textareaProps onDoubleClick）；✅ 「省略协作 presence/远程光标」与「grid 视图切换被删换刷新」两处偏离已补声明注释（编辑器浮层 / grid 工具行处）。
2. Graph：✅ ~~工具栏「· {project.name}」后缀~~、✅ ~~单击节点直接跳转~~（第 7 批）；✅ 工具栏/图例毛玻璃（color-mix 半透明 + backdrop-blur，暗色随 --bg-surface 翻转）、✅ doc 节点标签深色 `#374151` + 14 字符截断 + labelLen 16（第 8 批）。
3. Sidebar/TopBar：✅ 渐变头像（var-gradient primary-400→600，随主题）、✅ UserMenu 头部渐变条+头像块、✅ 菜单图标 w-8 h-8 容器（含退出登录 danger 容器）、✅ 💡 前缀；✅ 通知与快速创建菜单逐条 50/40ms stagger（animate-fade-up + animationDelay）——均第 8 批。
4. Library：✅ ~~ProjectCard 项目色动态底色~~（第 7 批）；✅ 「近 3 天」时间档、✅ DocumentCard 内容摘要（第 8 批，列表接口派生 summary）、✅ 快捷 FilterChip 项目模式隐藏补声明注释。
5. Members：✅ Escape 关闭弹窗与菜单（第 7 批）；✅ 邀请 Modal Mail 图标块/X 关闭、✅ 容器 max-w 1440（第 8 批）；邀请默认角色对齐（原型 Editor vs 现行 guest）维持现行值并补产品确认注释。
6. Publish：✅ ~~列表卡「立即发布」`!h-11`~~、✅ ~~向导「上次发布 N 分钟前」提示行~~（第 7 批）；✅ 骨架 3+1 卡（第 8 批）、✅ 概览卡 `bg-emerald-50` 暗色自适应（经查 1.4 暗色覆盖层已含 bg/border/text 三类规则，暗色目检确认）。
7. **Themes**：~~发布模板命名对齐（t-docs/t-blog/t-product/t-wiki/t-api）+ `h-[180px]` SVG 预览~~ 已于第 6 批核销（另加 zhLabel/emoji/星标、hero 布局与 hover 遮罩）；✅ 分类筛选（全部/官方/社区/我的收藏 + 空态）与收藏（localStorage 持久化，默认 t-docs）与卡片入场 stagger（UI 主题 60ms / 模板卡 70ms）——第 8 批核销。

### 5.4 正确性修复（独立于功能还原，立即可做）

1. **`GET /api/v1/activities` 忽略 `projectId`**（routes.ts:298-301 未消费 query）→ 项目动态页显示全局动态；后端补 where 过滤（前端已在传参 `ActivityPage.tsx:466`）。
2. **Browse 左栏折叠联动**（3.2 半成品 bug，提前至本批）：折叠按钮接 `Panel` ref 的 `collapse()/expand()` + `onCollapse/onExpand` 双向同步（原型 `ProjectBrowse.jsx:1430-1440,1658-1667`；现状 `BrowsePage.tsx:1065` 仅翻转 state，栏宽不变）。
3. **Sources 删除无二次确认**（`SourcesPage.tsx:744-748` 直删，比原型回退）：补 confirm。

### 第 5 批验收（2026-09-08 已复核）

- [x] ProjectSettings 保存真实生效且 toast 反馈；「同步设置」节开关/档位/立即同步均落库 —— PATCH `/projects/:id` API 实测 200（并修复该路由因 `app.route()` 挂载时序从未注册的 404）
- [x] StarterPack 向导三步走通：模板包 → 配置 → 成功页 —— `init-from-starter` 端到端 201（真实建库「API 验收临时库」）；响应契约 `{project, sourceId, packId}` 与前端逐字段对齐；浏览器 UI 三步人工目检待做
- [x] 项目动态页仅显示本项目动态；Browse 左栏折叠与拖拽状态双向同步；Sources 删除有确认 —— `activities?projectId` 以真实第二项目对照验证（全局 9 / 临时库 1 / 混入 0）；折叠联动与删除确认经 tsc/build 与代码走查
- [x] Settings 外观 RadioCard 与 TopBar 切换双向一致 —— 选中态改读 `useTheme().appearance`，切换双写 prefs
- [x] `tsc --noEmit` 与 `pnpm --filter @ewiki/web build` 双绿 —— web/server tsc 均 exit 0；vite build ✓ 2414 modules

### 第 6 批验收（2026-09-08 已复核）

- [x] DELETE `/api/v1/projects/:id`：临时项目删除返回 `{ok:true}`，列表 total 3→2 且该项消失，重复删除/不存在 UUID 返回 404；activities 写 `delete/project`、auditLogs 写 `project.delete`
- [x] PATCH `/api/v1/publish-sites/:id`：改 slug+schedule+daily+autoSync 返回 200 且字段回写；空 body 回读当前行；slug 与他站冲突返回 409 SLUG_EXISTS；非法枚举 `schedule=hourly` 返回 400；不存在 UUID 返回 404
- [x] 删除入口两处接线：ProjectLayout 更多菜单与 ProjectSettings 危险区按钮均启用，confirm 二次确认 → invalidate `['projects']` → toast「项目已删除」→ 跳 `/library`
- [x] Browse 右栏三 tab（AI/评论/历史）active 态与点按切换、折叠竖条/展开表头交互；AI 发送与 chips、评论为空态均 disabled+TODO，历史 tab 渲染真实 versions 数据
- [x] Themes 五套发布模板 id/命名/accent/星标与原型一致，`h-[180px]` 预览含 hero 布局与 hover 遮罩，无旧 id 残留
- [x] Settings 占位节：通知事件矩阵（4 事件×站内/邮件 disabled Toggle）+摘要频率三卡、8 行只读快捷键表（⌘K/⌘⇧P 取 prefs）、第三方数据源虚线卡、关于/帮助 4 链接+导出数据+注销 rose 红区，全部 disabled+TODO；Toggle 组件新增 disabled 支持
- [x] `tsc --noEmit`（web+server）与 `pnpm --filter @ewiki/web build` 双绿 —— 均 exit 0；vite build ✓ built in 8.99s
- [x] 浏览器人工目检：右栏折叠/切 tab、Themes 模板卡、Settings 各占位节 disabled 态、删除流程弹窗 —— 2026-09-09 随第 8 批目检过（右栏三 tab 渲染与折叠竖条、Themes 模板卡与 Settings 占位节截图/DOM 断言通过；删除流程 confirm 为原生弹窗，代码走查接线无误）

### 第 7 批验收（2026-09-08 已复核）

- [x] `GET /publish-templates` 返回 5 套模板（ids=t-docs…t-api）；`POST /publish-sites` templateId=t-blog 建站回写、PATCH 改 t-api 回写、非法 id 400（参数校验先于冲突检查）；Publish 向导模板网格消费该端点，Themes「在发布中使用」带 `?template=` 跳转并预选
- [x] `GET /team` 返回 `{members:[{role,online,lastActive}]}`（admin→Owner 映射正确，修复 TeamPage 成员恒空 bug）；invite 新邮箱 201（status=invited）、重复 409、邀请 Owner 400；PATCH role 200 且回读映射生效、非法角色 400
- [x] `documents.tags`：迁移 0001 应用成功；PUT 设置 tags 去重落库（验收,API测试）、GET /documents 与 /projects/:id/documents 均下发；changedSummary 生成 `+` 行 diff 且 versions 接口返回
- [x] `GET /projects/:id/members` 含 online/lastActive（保存文档后 5 分钟内 online=True，真实 activities 推导）；MembersPage 三 StatPill 渲染
- [x] Library 筛选抽屉标签维（候选集从当前范围文档聚合）、文档级搜索命中标签、DocumentCard 标签行回补
- [x] 占位补齐：Profile 角色/个人主页只读、Settings 已连接数据源真实预览、Dashboard 第 3 源类型（只读列表+改绑 TODO）
- [x] P2 打磨：Graph 工具栏「· 项目名」后缀（单击跳转经查已实现）、Library ProjectCard 项目色底色、Members Escape 关闭、Publish 列表卡「立即发布」!h-11（「上次发布」提示行经查已有）
- [x] `tsc --noEmit`（web+server）与 `pnpm --filter @ewiki/web build` 双绿 —— 均 exit 0；vite build ✓ built in 4.12s
- [x] 验收数据零残留：临时站点项目软删、误软删的种子「ewiki 帮助文档」已恢复（deleted_at=null 复核）、临时邀请用户已物理清理
- [x] 浏览器人工目检：Team 成员列表/邀请流、Library 标签筛选、Publish 模板网格、Themes「在发布中使用」跳转链路 —— 2026-09-09 随第 8 批目检过（Team 列表 Owner 徽章与邀请 Modal 实测、Library 标签 chips 与筛选抽屉实测、Themes PreviewModal「在发布中使用」带参跳转实测、Publish 向导模板网格随第 7 批 API 验收 + 代码走查）

### 第 8 批验收（2026-09-09）

- [x] 3.4 残留：GET /documents 与 GET /projects/:id/documents 派生 `summary` 下发（content 不出网）；全局 /documents 顺带补齐 sourceId/contentHash/updatedBy/createdAt（修复 Library 卡作者恒「未知」）；Browse/Library DocumentCard 摘要行渲染
- [x] Browse：卡片标签 chips（≤3）与 hover「打开」按钮；预览态悬浮「双击任意位置开始编辑」提示（hover 正文浮现）；编辑态双击切回预览；presence/grid 切换两处偏离注释落位
- [x] Graph：工具栏与图例毛玻璃（半透明表面+backdrop-blur，暗色随变量翻转）；doc 节点标签 `#374151`、>14 字截断 `前13字…`、labelLen=min(16,len)
- [x] Sidebar/TopBar：侧栏头像与 UserMenu 头部渐变（var 渐变随主题）、菜单图标 w-8 h-8 容器、💡 前缀恢复、通知(50ms)/快速创建(40ms) 逐条 stagger
- [x] Members：邀请 Modal Mail 图标块头 + X 关闭 + max-w-[1440px] 容器；默认角色差异补产品确认注释（维持 guest）
- [x] Publish：加载骨架 3+1 卡（三步骤卡+底部操作条占位，80ms 递增）；概览成功条暗色自适应经查 1.4 暗色层已全覆盖并目检确认
- [x] Themes：分类筛选 pills（全部/官方/社区/我的收藏，社区空态文案）、收藏持久化（ewiki-tpl-favorites，默认 t-docs，pill 计数 amber 高亮）、UI 主题卡 60ms/模板卡 70ms 入场 stagger
- [x] Sources：database 添加表单（10 类型分组网格/默认端口回填/host/port/database/table/username+密码加密存储）与 Git 认证三选卡（token/ssh 凭据入 configSecret，oauth disabled+TODO）；设置弹窗 database 连接信息只读回显
- [x] Themes PreviewModal：浏览器 chrome 画布 + 布局 mock 实时着色（主色 6 预设/自定义、侧栏左右）、应用到项目、「在发布中使用」带参跳转；复制预览 HTML disabled+TODO
- [x] `pnpm -r typecheck` 与 `pnpm --filter @ewiki/web build` 双绿 —— exit 0；vite build ✓ built in 4.13s
- [x] 浏览器人工目检：第 8 批全部 UI 链路 + 第 6/7 批遗留目检项（见下「浏览器目检记录 2026-09-09」）

#### 浏览器目检记录（2026-09-09，dev server 实测：关键页截图 + DOM 断言混合）

- TopBar/Sidebar：暗色仪表盘截图确认渐变头像、💡 提示卡、半透明彩底统计、无纯白块；UserMenu 渐变头部/图标容器/通知与快速创建 stagger 经 DOM 结构断言（w-8 h-8 容器、animationDelay 50/40ms 类落地）
- Library（亮/暗双色截图）：文档卡摘要行真实内容、作者名真实回显（updatedBy 下发生效）、标签 chips、状态四色、近 3 天筛选（抽屉 DOM 断言）、筛选抽屉标签维
- Browse：网格卡摘要/标签/打开按钮（DOM 断言）；预览态双击提示浮层 hover opacity=1（DOM 断言）；预览↔编辑双击切换双向实测通过；七渲染主题下拉与右栏三 tab 渲染正常
- Graph（DOM 断言）：工具栏/图例毛玻璃（color-mix 60%/95% + backdrop-blur）、6 个节点标签 fill=#374151、14 字截断「…」生效
- Themes（亮色截图 + DOM 断言）：分类 pills 全部/官方/社区/我的收藏·1、收藏持久化默认 t-docs、UI 主题 8 卡与模板卡 stagger 入场、PreviewModal 完整（浏览器 chrome 画布、主色调 6 预设+自定义色、侧栏左右切换实测翻转、复制预览 HTML disabled、「在发布中使用」接线）
- Sources（亮色截图 + DOM 断言）：添加弹窗 Git 认证三选卡（token 选中态/SSH 私钥 textarea 切换实测）、database 表单（10 类型分组网格、MySQL→3306 端口自动回填、凭据字段、同步能力裁剪声明）；设置弹窗 database 只读回显无真实数据源可验（当前库无 database 源），代码走查通过
- Members/Team/Settings（DOM 断言）：邀请 Modal Mail 图标块/标题/X 关闭、max-w-[1440px] 容器；Team 成员列表含 Owner 徽章、邀请 Modal email+角色三选；Settings 通知事件矩阵（站内/邮件+摘要频率）、快捷键表、关于/帮助分区均渲染；外观回显跟随当前 appearance

---

## 验收清单（每批完成后过一遍）

- [ ] `pnpm --filter @ewiki/web build` 与 `typecheck` 通过
- [ ] 亮/暗双色过一遍全部 13 个路由页（含 /login、/team、404）：无纯白块、无不可读 tooltip、弹窗遮罩为深色
- [ ] 8 套主题逐个切换：侧边栏激活态/按钮/tag 颜色全部跟随，刷新后保持
- [ ] 功能入口巡检：快速创建 4 项、通知 footer、/team、导入源、新建发布站点、渲染主题七项、外观切换（全局+项目内+设置页三处行为一致）
- [ ] 与原型并排对比截图核对：按钮高度 36px、卡片 8px 圆角带投影、标题 Plus Jakarta Sans

## 风险与依赖提示

- 第 3.1/3.5 的 PATCH /projects 后端已补齐（前端接线见 5.1.1，前端过时 TODO 一并清理）；其余后端依赖（DELETE /projects/:id、全局团队邀请/角色、publish-sites PATCH、AI 分类、导入任务、发布模板等）已全量汇总至 5.2 清单——前端可先按原型完成 UI 并保持现有 disabled+TODO 策略。
- 第 3.4（Library 平铺/公开探索）建议先与产品确认是"裁剪"还是"欠账"，再决定回迁范围；若裁剪，务必补注释。
- 字体走 Google Fonts CDN，内网环境需评估自托管（下载 woff2 + `@font-face`）。
