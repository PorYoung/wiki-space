# 原型 ↔ 实际项目 还原度审计报告（PROTOTYPE-PARITY-AUDIT）

> 审计对象：`prototype-docvault/`（12 页原型，视觉事实源）↔ `ewiki/apps/web/`（实际实现）
> 审计方式：基础层/壳层逐行人工比对 + 12 组页面逐一深比，全部 P0 结论经二次复核（证据行号均实际读取确认）。
> 配套文档：修复方案见 [PROTOTYPE-PARITY-PLAN.md](./PROTOTYPE-PARITY-PLAN.md)。
> 证据格式：`仓库内相对路径:行号`。

---

## 0. 总体结论

| 维度 | 还原度评估 | 说明 |
|---|---|---|
| 信息架构（路由/Tab/页面清单） | 约 90% | 路由结构、六个项目 Tab、全局五页全部对齐；新增 /login、/team、404 为合理演进 |
| 视觉契约（字体/圆角/阴影/组件规格） | **系统性漂移** | 字体未加载、圆角/阴影体系缺失、`.btn/.tag/.card/.input` 规格全面缩水 |
| 功能入口 | **10 处 P0 缺失/错位** | 快速创建菜单错跳、/team 孤儿路由、prose-doc 主题失效、ThemesPage key 冲突等 |
| 暗色模式 | 机制正确但 4 个缺口 | 变量化方案正确；`bg-white`、彩色 50 级、遮罩、tooltip 四处暗色破相 |
| 交互反馈 | 明显回退 | 原型的骨架屏/级联入场动画/Toast 反馈大部分未迁移 |

**一句话**：实际项目的信息架构和真实数据化方向正确，但设计契约在迁移中被"静默重写"，且多处功能入口"点了没反应"。最大的风险不是"长得不像"，而是**入口失效与暗色破相**。

---

## 1. 全局契约层差异（影响所有页面）

### F1.【P0】字体完全未加载，全站回退系统字体
- 原型 `prototype-docvault/index.html:8-11` 加载 Plus Jakarta Sans（display）/ Inter（body）/ JetBrains Mono（mono）；CSS 声明见 `prototype-docvault/tailwind.config.js:44-48`、`prototype-docvault/src/index.css:339-344`。
- 实际 `ewiki/apps/web/index.html:1-12` **未引入任何字体**；`ewiki/apps/web/tailwind.config.ts:24-26` 把 display 字体改成 **Poppins**（无出处、无字体文件）；body 未声明 font-family；无 mono 定义（`font-mono` 落浏览器默认，prose 代码块/路径面包屑观感受影响）。
- **修复约束（硬性）**：禁止把原型的 Google Fonts 外链原样搬入生产——用户环境可能无法访问 fonts.googleapis.com，会导致页面加载缓慢。必须离线化：`@fontsource` npm 自托管（woff2 随构建进 dist）+ 系统字体栈兜底，详见 [PLAN 1.1](./PROTOTYPE-PARITY-PLAN.md)。

### F2.【P0】圆角与阴影体系缺失
- 原型 `prototype-docvault/tailwind.config.js:49-58`：`borderRadius sm=6px / md=10px / lg=16px`；`boxShadow sm: 0 1px 2px rgba(16,24,40,0.06) / md: 0 4px 12px rgba(16,24,40,0.08) / lg: 0 12px 32px rgba(16,24,40,0.12)`。
- 实际 `ewiki/apps/web/tailwind.config.ts` 无对应覆写 → Tailwind 默认值（rounded=4/md=6/lg=8/xl=12）。**同名类全站小 2~4px**（卡片 xl 16→12、下拉 lg 16→8），悬浮感明显弱于原型。

### F3.【P1】组件类规格漂移
对照 `prototype-docvault/src/index.css:347-414` vs `ewiki/apps/web/src/index.css:21-93`：

| 类 | 原型规格 | 实际现状 |
|---|---|---|
| `.btn-primary` | `px-3.5 py-2`（高≈36px）+ `shadow-sm` + bg-primary-**500** | `px-3 py-1.5`（高≈30px）无阴影 bg-primary-**600** |
| `.tag` | `px-2 py-0.5 rounded-md text-xs`；warning=amber-50/amber-700 | `px-1.5 py-0.5 rounded text-[11px]`；warning 硬编码 `#fef3c7/#92400e`（暗色刺眼） |
| `.card` | 8px 圆角 + `shadow-sm` | `rounded-xl`（12px）**无阴影** |
| `.card-hover` | hover:shadow-md + `cursor-pointer` | 无 cursor-pointer |
| `.input` | `py-2` + focus `ring-2 ring-primary-200 border-primary-400` | `h-9` 定高 + focus ring primary-100 / border primary-500 |
| `.btn-ghost` | 中性色文字 + hover bg | 主色文字 |
| `.btn-danger` / `.nav-item` | 存在 | **缺失**（danger 被各页 `!important` 覆写替代） |

### F4.【P0】暗色模式四处破相
实际方案（`ewiki/packages/theme/src/index.ts:128-153` 变量化翻转 + `data-appearance` 属性）方向正确，`text-neutral-* / bg-neutral-* / border-neutral-*` 类可自适应；但原型用约 280 行覆盖层（`prototype-docvault/src/index.css:91-332`）处理的内容实际无替代：

1. **`bg-white` 不翻转**：TopBar 搜索聚焦、下拉面板、`ewiki/apps/web/src/pages/MembersPage.tsx:248`（角色菜单）等处暗色下仍是纯白。
2. **模态遮罩变亮**：`bg-neutral-900/40` 在暗色下因 neutral-900 翻转为 `#f1f5f9` 变成白色遮罩（Dashboard/Library 弹窗均中招）。原型 `prototype-docvault/src/index.css:200-211` 已处理为 `rgba(0,0,0,.65)` 系。
3. **Tailwind 默认彩色 50/100 级不自适应**：`bg-emerald-50/amber-50/red-50/rose-50/indigo-50/sky-50/violet-100` 用作图标底与徽章（Dashboard 统计卡、Members 角色徽章 `MembersPage.tsx:38-40`、PublishPage 概览卡 `PublishPage.tsx:545`、ProjectSettings danger 区硬编码 `rgb(254 242 242 / 0.5)` `ProjectSettingsPage.tsx:385-386`、AI 渐变 `ProjectSettingsPage.tsx:315`）。原型 `prototype-docvault/src/index.css:244-266` 有半透明降饱和映射。
4. **tooltip 反色消失**：TopBar tooltip `bg-neutral-800 text-white` 暗色下底变浅灰、字仍白 → 不可读（`TopBar.tsx:52`）。另缺 `color-scheme: dark` 与暗色阴影加深（原型 `index.css:172-175`）。

### F5.【P1】其他基础层
- **neutral 兜底缺失**：实际 `ewiki/apps/web/src/index.css:6-13` 只定义 `--color-neutral-500`，ThemeProvider 挂载写变量前首帧所有 neutral 工具类无值 → 首屏闪糊。原型 `:root` 有 50~900 全量兜底（`prototype-docvault/src/index.css:24-33`）。
- **动画参数漂移**：原型 `fadeUp 0.4s / translateY(8px)`、`slideInRight 0.25s / translateX(100%)` 且带 `both` 填充（级联 delay 期间不闪现）；实际 `0.24s/6px`、`0.22s/24px` 且无 `both`（`ewiki/apps/web/src/index.css:58-68`）。
- **主题色值漂移**：`@ewiki/theme` 注释自称"禁止重调色值"，但 warm-amber 700 写成 `#b45f09`（原型 `#b45309`，`ewiki/packages/theme/src/index.ts:51`）。
- 主题切换缺 `theme-transitioning` 300ms 平滑过渡（原型 `prototype-docvault/src/context/ThemeContext.jsx:242-268`），切换硬跳。
- neutral 色系系统性差异：原型静态 gray 系（#6b7280），实际经变量映射为 slate 系（#64748b）——与原型 CSS 变量层一致，属可接受的有意统一，但需知晓。

---

## 2. 壳层与功能入口

### S1.【P0】快速创建菜单：2 处跳转错 + 2 处图标错
实际 `ewiki/apps/web/src/components/layout/TopBar.tsx:113-118` vs 原型 `prototype-docvault/src/components/TopBar.jsx:210-215`：

| 菜单项 | 原型（正确） | 实际现状 |
|---|---|---|
| 新建文档 | FileText → `/library` | ✓ |
| 新建文档库 | FolderOpen → `/library` | ✗ 跳 `/dashboard` |
| 添加数据源 | **Database** 图标 → `/sources` | ✗ 图标 FolderOpen（路径对） |
| 邀请成员 | **Users** 图标 → `/team` | ✗ 图标 FolderOpen、跳 `/library` |

### S2.【P0】`/team` 成孤儿路由
原型自身缺陷：`Team.jsx` 已写好、入口已埋（面包屑 `'/team': '团队'`、快速创建跳 `/team`），但 `prototype-docvault/src/App.jsx:24-31` 未注册路由。实际补上了路由（`ewiki/apps/web/src/App.tsx:48`）**却把唯一入口改去了 /library** → 现在只能手敲 URL 进入。`TeamPage.tsx` 对 `Team.jsx` 的还原度其实很高（页头/StatPill/分段控件/表格/角色菜单逐块对齐）。

### S3.【P0】ProjectLayout 是"骨架"却自注"完整实现"
实际 `ewiki/apps/web/src/components/layout/ProjectLayout.tsx:12-45` 仅 45 行（注释称"完整实现迁移自原型"，与事实相反）：项目名直接渲染路由 id（`项目 {id}`，:22），六个 Tab 无图标、无 hover 态。原型 `prototype-docvault/src/components/ProjectLayout.jsx`（约 770 行）缺失的能力：
- 项目身份区：w-9 h-9 字母色块 + sourceType 标签（:585-593, 639）
- 项目切换下拉 + 返回全局文档库（:595-637）
- 分享按钮 + 更多菜单（访问发布网站/重命名/删除 + toast）（:643-668, 722-728）
- **外观切换按钮** → 项目内目前无法切暗色（实际壳内无 TopBar，项目路由不经全局 Layout）
- 导航布局切换（顶部↔侧边）+ 侧边折叠模式（:516-517, 704-754）
- 右侧信息面板 ProjectRightSidebar（概览/动态/成员 + browse 页 AI/评论/历史 + 折叠竖条）（:53-429, 762-768）
- toast 通道（Outlet context 下发 `showToast`，:758）——子页面保存等操作因此无反馈通路
- 加载骨架 HeaderSkeleton、项目不存在页（:472-497）
- main 路由切换 `key={pathname+search}` 重放 `animate-fade-up`（:757）

### S4.【P1】Sidebar / TopBar 细节
- NavItem（`Sidebar.tsx:27-31`）：gap 12→10px、圆角 10→8px、非激活字重 500→400、颜色 text-secondary→text-primary、**hover 效果整体丢失**、激活图标未染 primary-600（原型 `.nav-item` 定义见 `prototype-docvault/src/index.css:397-408`）。
- 头像：`from-primary-400 to-primary-600` 渐变 → 纯色 primary-500；UserMenu 头部渐变条丢失；菜单图标容器（w-8 h-8 圆角块）丢失；商业化菜单项按 PRD 4.1 移除（有意，保留）。
- 通知下拉：缺底部「查看全部通知」footer；缺逐条 50ms stagger。
- 面包屑：原型对 `/project/:id/:tab` 有专门映射（文档库 > 项目id(mono) > 子页中文名，`TopBar.jsx:60-85`）；实际原样输出 `project / p-001 / browse`；`/team` 无标签直出 `team`（`TopBar.tsx:14-16`）。

---

## 3. 页面级明细

### 3.1 Dashboard（`Dashboard.jsx` → `DashboardPage.tsx`）
- **P1**：三套加载骨架全删（SkeletonStat/ProjectRowSkeleton/ActivityItemSkeleton，原型 :69-107）→ 首屏闪空白；弹窗 8 色项目颜色选择器整组缺失（原型 :546-549, 692-709）；源类型 3 选 → 2 选（"使用已有数据源"被删，原型 :540-544）；创建成功 Toast 缺失（实际 onSuccess 仅 invalidate+onClose，`DashboardPage.tsx:103-106`）；`bg-neutral-900/40` 遮罩暗色变白。
- **P1**：Hero 渐变 `from-primary-50 to-white` → 纯色；提醒卡彩色 icon 底（bg-danger/10 等）→ 统一 bg-white；数量徽章 `bg-neutral-800` 圆形角标缺失（原型 :446-450）；「最近动态」图标 GitBranch → BookOpen（与相邻图标重复）。
- **P2**：文案（"已同步→已纳管"、"👋"丢失）；源类型标签语义（Git/本地 tag 区分 → 一律 tag-primary）；活动条目 60ms stagger 缺失。

### 3.2 Library（`Library.jsx` 2274 行 → `LibraryPage.tsx` 500 行，**全库偏离最大页**）
- **P0**：①「平铺文档」浏览模式整体缺失（browseMode flat/project 双模式 + DocumentCard 网格 + 表格视图 + 文档级搜索，原型 :950, 1157-1180, 1366-1427）；②「公开」探索维度蒸发（scope mine/explore、Explore 渐变横幅、已发布网站 chip、网站预览 Modal，原型 :951, 1206-1237, 1441-1492——实际数据模型仍保留 `visibility:'public'` 字段 `LibraryPage.tsx:19` 却无 UI）；③「导入源」按钮缺失（原型 :1187-1190）。
- **P1**：筛选抽屉 5 维砍到 3 维（模板/可见性/标签全删，`LibraryPage.tsx:137-139`）；ProjectSelector 缺失（≤6 chips、>6 搜索下拉，原型 :511-699）；快捷 FilterChip（冲突/本地修改）缺失；页头结构重构（单行 pill 组 → 两行 + 新增统计 tag 行）；项目卡内部重构（48px→40px 图标、同步时间/可见性胶囊 → 冲突计数/源类型 icon 串）；建库向导 Step2 大缩水（目录树预览/描述/可见性三选/存储后端三选全删）且恒可下一步（`LibraryPage.tsx:188`）、Step3 从"创建成功庆祝页"改为确认表单直跳；骨架与 60ms stagger 全删；`bg-neutral-900/30` 遮罩暗色失效。
- **P2**：搜索框 300px→256px；视图切换分段样式重构；筛选激活"黑底白字+角标"→ tag 计数；空态 48px→36px；untracked/modified 文案（"未跟踪→未纳管"、"本地修改→有修改"）。

### 3.3 Sources（`Sources.jsx` → `SourcesPage.tsx`）
- **P0**：源 URL 列消失——原型 6 列表格含「URL / 路径」（:249-330），实际无表头卡片行且 `configPublic.url` 不在任何位置展示，用户无法核对仓库地址。
- **P1**：「支持的数据源类型」4 张分类卡入口整体缺失（原型 :210-240）；源设置弹窗编辑能力从 10+ 字段缩至 3 个（名称/URL/分支/鉴权/Token/SSH/子目录/DB 参数全部只读化，原型 :1197-1447 vs `SourcesPage.tsx:387-404`）；connected 状态 `tag-success` 绿色 → `tag-neutral` 灰色（`SourcesPage.tsx:70`）；DB 类型选择从分组卡片按钮 → select 下拉；容器 1440→1100px。
- **P2**：添加弹窗缺 SSH 私钥/Token 眼睛切换/子目录/自动同步开关；删除用原生 `confirm()`；同步按钮 icon-only → 带文字（可保留）；intervalSeconds 档位 4→5；「个月前」时间档丢失。

### 3.4 Themes（`Themes.jsx` → `ThemesPage.tsx`，**整页重写**）
- **P0**（已复核）：① **`ewiki-ui-theme` key 冲突**：`ThemesPage.tsx:159` 用 `'ewiki-ui-theme'` 存自创主题 id（`indigo-sky` 等，:41-114），而 `ThemeProvider.tsx:11,26-29` 用同一 key 读并在已迁移的 8 套真主题中查找、查不到回退第一套 → **选主题不生效且污染主题引擎持久化**；② 已逐值迁移好的 8 套真主题（`ewiki/packages/theme/src/index.ts:17-114`）在 UI 里**没有任何入口**，页面展示的是另一套自创主题集。
- **P1**：PreviewModal 整个删除（浏览器 chrome 假窗 + `renderPreview` 真实 HTML 渲染 + 主色调 6 preset/取色器/hex 输入 + 应用到项目下拉，原型 :605-807）；「管理视图主题 / 发布网站主题」Tab 切换 → 上下平铺；发布模板分类筛选/收藏/悬停发布按钮全删；UI 主题分组（现代风格/中国传统色 + 组头+◆+数量）→ 无分组平铺；「应用」与「在发布中使用」按钮 disabled。
- **P2**：`darkMode` state 是死 UI（`ThemesPage.tsx:378,410-428` 只改 state 无消费）；Toast「主题已应用 ✨」删除；卡片规格缩水（accent 色块+渐变 palette 条+hex 标注 → mini 线框 mock，h-180→h-28）；暗色失效面大（`bg-white`、`border-neutral-200 hover:border-neutral-300`、`ring-offset-2` 白底等）。

### 3.5 Settings（`Settings.jsx` → `SettingsPage.tsx`）
- **P0**：外观偏好与 ThemeProvider **双轨不联动**——设置页外观 RadioCard 只写 `prefs.theme`（`SettingsPage.tsx:232`），不调 `applyAppearance`，与 TopBar 外观切换（独立 `ewiki-appearance` key）互不相通 → **切了等于没切**（纯前端可修）。
- **P1**：左侧 240px 分区导航（6 tab 单屏）删除 → 单列 7 section 堆叠（原型 :641-689）；通知细分（邮件/站内各 4 开关+摘要频率）→ 3 个总开关；数据源默认三分区（分支/间隔/冲突策略/已连接预览）→ 仅 git/local 单选；快捷键 10 行表格 → 2 行 input；关于区（版本卡/帮助链接/导出数据/危险操作红区）大幅缩水。
- **P2**：Toggle `h-6 w-11`→`h-5 w-9`；RadioCard ring-2→ring-1；kbd 胶囊 → input 框；强调色 5 圆（接主题 id）→ 6 圆（仅存 prefs，不生效）；保存 Toast 缺失（dirty 才可保存是增强，保留）。

### 3.6 ProjectLayout（壳层，见 S3）
- **P0**：壳层身份/操作区全缺；右侧面板整层缺失（图谱/动态页因此无右栏）。
- **P1**：toast 通道未建；项目不存在/加载骨架态缺失。
- **P2**：tab 无图标；main 无路由切换 fade-up 重放。

### 3.7 Browse（`ProjectBrowse.jsx` → `BrowsePage.tsx`）
- **P0**：① **prose-doc 七种渲染主题双重失效**（已复核）：实际全仓库无任何 `.prose-doc` CSS 定义，且 `BrowsePage.tsx:686` 只写固定 `prose-doc` 未拼 `` prose-${renderTheme} `` → 主题下拉（:607-643）点击后 state 变了但正文纹丝不动，正文还丢了基础排版（标题字体/代码块配色/引用样式）；原型定义见 `prototype-docvault/src/index.css:446-588`，原型拼接处 `ProjectBrowse.jsx:1063`。② **三栏拖拽调宽丢失**：原型 `react-resizable-panels`（`prototype-docvault/package.json:18`）PanelGroup 左 22%/中 56% 可拖（`ProjectBrowse.jsx:1657-1693`）+ `.resize-handle` 手柄样式（`prototype-docvault/src/index.css:591-632`）；实际无此依赖，左右栏硬编码 260/240px（`BrowsePage.tsx:401, 974`），无任何替代。
- **P1**：目录树搜索是假入口（state 存在 `:347-348` 但树渲染完全不消费，无过滤/高亮/自动展开）；状态 tag 全灰化（原型四色 tag-success/warning/danger/primary `ProjectBrowse.jsx:70-75` → 统一 `tag-neutral` `BrowsePage.tsx:768,600`，同步/修改/冲突不可辨）；untracked 状态点 primary→indigo（`:112`）；卡片"作者行"错显文档标题（接口有 `updatedBy` 却不用，`:776-779`）；保存成功无 toast（`:849-859` 仅失效缓存）；双击预览进编辑丢失（原型 :871-873, 1100-1107）；格式工具栏图标错配（PenTool=加粗、History=链接）且撤销/重做/预览按钮缺失（`:497-503, 671-680`）；右侧协作面板三 tab 无 active 态无切换、无折叠、`hidden lg:flex` 小屏直接消失（`:974-1016`）；树 footer 恒显「main 待同步」，local 项目语义错误（`:479-488`）。
- **P2**：卡片摘要恒「(有内容)」（接口无 content，可接受但观感差）；tags 行缺；hover「打开」浮动按钮缺；TOC 由浮动 overlay 改占位栏（正文变窄）；协作光标/状态栏 presence 缺（mock 成分为主，可有意省略但无注释）；relativeTime 缺「个月前」档；grid 卡片进入不重置编辑态残留（`:868-870`）；树侧栏底色 `bg-neutral-50/50` → 整栏 surface。

### 3.8 Graph（`ProjectGraph.jsx` → `GraphPage.tsx`）
力导向参数逐值一致（kRepulse 6000 / kSpring 0.015 / idealLen 140 / damping 0.82 / 140 次迭代），整体还原度高。
- **P1**：zoom 只缩节点不缩边（实际仅节点 translate+scale，边不缩放 → 放大后边端点与节点错位，`GraphPage.tsx:503-526,543` vs 原型 :413-433 整组缩放）；节点形状语义丢失（doc 圆角矩形/external 24px 小方块/broken 红色虚线圆 → 全部同款 `rect rx=4`，`:558-568` vs 原型 :90-141）；external 节点无法打开外链（「外部」新窗口按钮删除，`:648-657` vs 原型 :546-555）。
- **P2**：边标签丢失（后端无字段，有据）；工具栏缺「· {project.name}」；底栏无毛玻璃（`bg-white/60 backdrop-blur` → 纯色）；节点标签色 `#374151` → `#ffffff`、截断 14→18 字符；hubs 光环条件扩展（explore 视图也出环）；工具栏缺项目名。

### 3.9 Activity（`ProjectActivity.jsx` → `ActivityPage.tsx`）
骨架还原度高（双 sub-tab/搜索/导出/文档筛选/时间线/feed chips/空态均在）。
- **P1**：diff 预览块整体缺失（原型视觉核心，绿红 +/- 行，:42-54, 188-212；接口字段 `changedSummary` 存在却未消费 `ActivityPage.tsx:35`）；CommitCard hover 三操作（查看 diff/回滚/星标）缺失（`:170-174` 仅阴影 vs 原型 :171-183）。
- **P2**：sub-tab 选中文字 primary-700 → neutral-900、胶囊底 neutral-100 → surface（亮色下灰底变白底）；Clock/FileText 图标缺失；非 main 分支 violet chip → 恒中性 versionNo chip（接口无 branch，有据）；feed「编辑」chip 从动态注入改常驻；「删除→红字」动词配色分支丢失；头像色板 10→8 色。

### 3.10 Publish（`ProjectPublish.jsx` → `PublishPage.tsx`，**整页重构为站点管理列表**）
- **P0**：三步发布向导核心入口全缺失——版本范围（草稿/已发布）切换、发布文档下拉、内容范围（单文档/整库）、主题模板网格+实时预览（`templateId` 字段在 `PublishPage.tsx:35-36` 存在但只读展示）、**自动同步开关（`autoSync` 字段存在 `:39` 但无开关 UI）**、访问地址组（前缀+slug 校验+复制，原型 :500-536）；发布成功无正反馈条（原型 emerald 成功卡 :576-606）；**已有站点时无「新建站点」入口**（创建表单仅在空态出现 `:408-515`，页头只有刷新 :532-536）。
- **P1**：调度默认 `manual` ≠ 原型 `git-push`（`:349`）；底部固定操作栏缺失；概览卡仅 active 显示；骨架 3+1 → 2 卡。
- **P2**：「立即发布」`!h-7` 28px 高小于契约（原型 `!h-11`）；状态徽章自绘 rounded-full 未用 `.tag`；容器 880→860px；阶梯入场编舞 80→320ms → 固定 60ms；`bg-emerald-50` 概览图标底暗色不自适应。
- 架构性偏离（有据，保留）：域名模型 `{slug}.docvault.dev` → 后端下发 `site.url` + subpath/subdomain 双模式；真实 `POST /publish-sites/:id/jobs`。

### 3.11 Members（`ProjectMembers.jsx` → `MembersPage.tsx`）
- **P0**：邀请成员/角色变更/移除全部 disabled（后端 TODO，有据）但**保留大段不可达死代码**（角色下拉菜单 `MembersPage.tsx:245-256`、无 Modal 实现的邀请）；且死代码缺原型「设为所有者」、含原型没有的「移除成员」——产品决策未闭合。
- **P1**：成员搜索框缺失（原型 :266-278）；3 个 StatPill 统计删除；Editor 角色色 amber → sky（`:37-42` 违反 tag-warning 契约）；角色徽章自绘 rounded-full 药丸未用 `.tag`；角色体系词汇 Owner/Maintainer/Editor/Guest → owner/admin/editor/viewer（后端 globalRole 决定，需产品对齐词汇）。
- **P2**：表格 6→5 列（在线状态列取消，有据）；头像 36→32px；行级 40ms stagger 丢失；`bg-white` 下拉与 rose/indigo/sky-50 徽章暗色不自适应；max-w 1440→1024px；移动端卡片视图为新增增强（保留）。

### 3.12 ProjectSettings（`ProjectSettings.jsx` → `ProjectSettingsPage.tsx`）
- **P0**：「同步设置」整节缺失（自动同步开关/间隔四档/立即同步，原型 :319-373）——**`autoSync`/`intervalSeconds` 字段已在 `ProjectSettingsPage.tsx:50-51` 而 UI 不用**；保存/删除 disabled（后端缺 PATCH/DELETE，有据但属最高优先功能缺口）；AI 整理与外部导入完整交互缺失（开关/范围/执行/历史/Modal → 禁用空态卡）；导入器集合无出处变更（web-crawler/notion/obsidian/folder → notion/confluence/google `:349-353`）。
- **P1**：模板选择下拉缺失（overview `template` 字段未用 `:35`）；sourceUrl 不展示（`SourceItem` 无 url 字段 `:44-55`）；可见性描述文案全部改写需产品确认；保存按钮从卡头移至卡底。
- **P2**：侧栏 200→192px；区块头重构（8×8 图标块）；`.btn-danger` 被 4 个 `!important` 覆写替代；danger 区 `rgb(254 242 242/.5)` 与 violet/indigo 渐变暗色不自适应；全页无入场动画；toast 机制缺失；`borderColor` class+style 双重声明冗余（`:378`）。

### 3.13 新增页（原型无对应物）
- **LoginPage**：契约遵循良好（颜色全走 token，暗色最安全）。P2：标题未用 `font-display`；label text-sm vs 原型惯例 text-xs；继承 F1 字体修复即可。
- **NotFoundPage**：使用 btn 契约类 ✓。P2：渐变 fallback `var(--color-primary-600, #4f46e5)` 的兜底值是 indigo，与品牌绿不符（`:13`）；标题未用 `font-display`。
- **placeholders.tsx**：现仅 `export {}`，全仓库无 import（仅 NotFoundPage 注释提及）——**不存在"真实页面内部渲染 placeholder"的功能缺失**。

---

## 4. 有意偏离白名单（保留，勿"修复"）

以下改动有代码注释 / PRD / 后端架构依据，属合理演进：

1. mock stubs（200-1200ms 人工延迟）→ react-query + REST + 401 刷新重放（`ewiki/apps/web/src/lib/api/client.ts:52-82`）。
2. 登录鉴权 + 路由懒加载 + 404 页（原型 `*` 为静默重定向）。
3. Sidebar 商业化入口（升级 Pro/账单与订阅/帮助中心）按 PRD 4.1 移除（`Sidebar.tsx:11` 注释）。
4. 角色体系 Owner/Maintainer/Editor/Guest → admin/user（后端 `globalRole` 二元模型）；Team/Members/Settings/Themes 各处 disabled + "TODO: 后端补充" 注释。
5. Graph 三视图改前端派生（真实端点仅 nodes/edges）；重新布局按钮从假动作变真实重排（layoutSeed）。
6. Activity 导出跟随当前过滤 + 空结果 disabled；useQueries 全量预取。
7. Browse 无效 `?doc=` 显示引导空态（原型是自动回退第一篇，实际更合理）；新增刷新按钮、StarterPack 空态指引。
8. Sources 行内新增 `projectName` / `lastError` 展示；所属项目必填（真实 API 约束）。
9. Settings 云端 prefs `GET/PUT /api/v1/me/prefs` 双写 + 离线缓存；保存按钮 dirty 才可用。
10. `@ewiki/theme` 对原型 8 套主题色板逐值迁移（含暗色变量层），注释明确"[Data-backed：原型为视觉事实源，禁止重调色值]"。
11. 品牌更名 DocVault → ewiki（产品决策）。
12. neutral 色系统一为 slate（与原型 CSS 变量层一致）。

---

## 5. 优先级汇总（修复清单详见 PLAN 文档）

**P0（10 项）**
1. F1 字体未加载（全站）
2. F2 圆角/阴影体系缺失（全站）
3. F4 暗色四处破相（bg-white / 遮罩 / 彩色 50 级 / tooltip）
4. S1 快速创建菜单跳转与图标错误
5. S2 /team 孤儿路由
6. S3 ProjectLayout 骨架化（项目名/操作区/右栏/toast 全缺）
7. Library 平铺文档模式、公开探索、导入源入口缺失
8. Browse prose-doc 主题双重失效 + 三栏拖拽丢失
9. Themes key 冲突 + 真主题无入口
10. Settings 外观偏好与 ThemeProvider 双轨不联动；Publish 向导入口缺失 + autoSync 有字段无 UI；ProjectSettings 同步设置节缺失

**P1**：各页骨架屏/Toast/级联动画回退、Sources URL 列与设置弹窗缩水、状态 tag 灰化、Graph zoom/节点形状、Activity diff 块、Members 死代码、Sidebar NavItem hover 等（详见各节）。

**P2**：图标/文案/尺寸微调、死 UI（darkMode toggle）、时间档、色板数量等。
