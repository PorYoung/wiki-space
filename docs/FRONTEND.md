# ewiki 前端开发规范

| 项 | 说明 |
| --- | --- |
| 文档目的 | 定义 ewiki Web 前端（apps/web）的工程结构、设计令牌、组件契约、状态管理、数据获取与实时集成规范，作为前端开发与 AI 编码代理的直接实施依据 |
| 创建日期 | 2026-09-06 |
| 上游基线 | [PRD](./PRD.md)（R4）；[SDD](./DESIGN.md)（R3）；高保真原型 `prototype-docvault`（视觉与交互事实源） |
| 阅读对象 | 前端工程师、AI 编码代理、UI 评审 |
| 修订记录 | R1（2026-09-06）：初版 |

**证据标注约定**：`[Data-backed]`（取自原型代码/PRD/SDD 的可验证事实）、`[Research-backed]`（注明来源的公开实践）、`[Expert judgment]`（工程推断）、`[Hypothesis]`（待确认假设）；无法核实的细节标 `[To be confirmed]`。

---

## 1 概述

### 1.1 文档定位

| 维度 | 分类 |
| --- | --- |
| 文档类型 | 前端工程开发规范（设计令牌 + 工程约定 + 集成契约） |
| 目标平台 | Web SPA（桌面浏览器为主；桌面端为远期预留，见 SDD ADR-7） |
| 技术栈 | React 19 + Vite + TypeScript + Tailwind CSS（SDD 2.4 决议） |
| 复杂度 | Standard（单前端子系统） |

### 1.2 范围与原则

本规范覆盖 apps/web 的全部实现约定；不覆盖后端契约定义（见 SDD 第 4 章）与部署（层 4）。

三条核心原则：

1. **令牌优先**：任何视觉决策必须追溯到命名令牌（CSS 自定义属性），禁止组件内硬编码色值/间距。语义层引用视觉层，主题切换只改映射不改组件 `[Research-backed：design-token 分层实践]`。
2. **原型即视觉事实源**：原型的布局、交互、文案与主题系统已完成并评审，本规范将其"翻译"为可执行约定而非重新设计；凡本文未覆盖的视觉细节，以原型为准 `[Data-backed]`。
3. **服务器状态与 UI 状态分离**：一切来自 API 的数据归 TanStack Query，一切纯客户端状态归 Zustand，禁止用 useState 复制服务器数据 `[Expert judgment]`。

---

## 2 工程结构与基础约定

### 2.1 目录结构

```
apps/web/src/
├─ main.tsx               # 入口：挂载 Provider 链
├─ App.tsx                # 路由表与布局壳
├─ routes/                # 页面组件（按路由域分目录）
│  ├─ dashboard/  library/  sources/  themes/  settings/
│  └─ project/            # 项目聚焦视图六个页签
├─ components/
│  ├─ ui/                 # 基础组件（Button/Modal/Toast/Empty…，见第 4 章）
│  ├─ layout/             # Layout / ProjectLayout / Sidebar / TopBar / RightPanel
│  └─ business/           # 业务复合组件（DocumentTree/PublishWizard/GraphCanvas…）
├─ features/              # 领域逻辑钩子：useDocuments/useSync/usePublish/useCollab…
├─ lib/
│  ├─ api/                # API 客户端（见第 6 章）
│  ├─ ws/                 # WS 客户端与订阅（见 8.2）
│  └─ editor/             # TipTap 封装（packages/editor 的消费侧）
├─ stores/                # Zustand slices
├─ theme/                 # ThemeProvider + 8 套主题定义 + 令牌 CSS
└─ types/                 # 仅前端局部类型；领域类型一律来自 packages/shared
```

规则：

- 领域类型（Project/Document/Source…与 API DTO）**只从 `@ewiki/shared` 导入**，apps/web 内禁止重复声明同名类型 `[Data-backed：SDD 2.5]`。
- 页面组件文件 `PascalCase.tsx`，钩子 `useXxx.ts`，其余 `camelCase.ts`；目录名 `kebab-case`。
- 跨域引用只允许 `components/ui` 与 `lib/*` 被任意引用；`features/*` 之间禁止互相导入，共享逻辑上移到 `lib` 或 `packages/shared` `[Expert judgment]`。

### 2.2 TypeScript 与工具链

| 项 | 约定 |
| --- | --- |
| 语言 | TypeScript strict 模式（`strict: true`，禁用 `any`，必要时 `unknown` + 收窄） |
| 组件 | 函数组件；文件内类型就近声明，跨文件导出类型放 `packages/shared` |
| Lint | eslint（typescript-eslint + react-hooks + react-refresh）；提交前必须 0 error |
| 格式化 | Prettier（单引号、无尾逗号默认、printWidth 100） |
| 命名 | 组件 PascalCase、钩子/变量 camelCase、常量 UPPER_SNAKE、令牌 kebab-case（与 CSS 变量一致） |
| 导入顺序 | 内置 → 第三方 → `@ewiki/*` → `@/` 别名 → 相对路径 |

---

## 3 设计令牌系统

### 3.1 令牌分层与命名约定

三层结构，命名沿用原型 ThemeContext 的既有变量名（更名前缀 docvault → ewiki）`[Data-backed：prototype-docvault/src/context/ThemeContext.jsx]`：

| 层 | 内容 | 载体 |
| --- | --- | --- |
| L1 主题色板（视觉层） | 8 套主题各自的 `--color-primary-{50..900}` | JS 对象（theme 定义）→ 运行时写入 CSS 变量 |
| L2 中性色与语义层 | `--color-neutral-{50..900}`、`--bg-*`、`--text-*`、`--border-*` | CSS 变量，随外观模式（亮/暗）整体切换 |
| L3 组件层 | `btn-primary`、`tag-success` 等组件类 | globals.css，仅引用 L1/L2 变量 |

命名规则：全 kebab-case；色板 `{role}-{shade}`；语义 `{semantic-role}`；组件类 `{component}-{variant}`。令牌名必须可直接用作 CSS 自定义属性与 JS 对象键 `[Research-backed：design-token 命名实践]`。

### 3.2 主题色板（L1）

8 套主题即 8 组 primary 色板，随主题切换整体替换 `--color-primary-{50..900}`：

| 主题 ID | 名称 | accent | 类别 | 正文风格 |
| --- | --- | --- | --- | --- |
| fresh-emerald（默认） | 清新翠绿 | #10b981 | modern | sans |
| deep-indigo | 深邃靛蓝 | #4f46e5 | modern | sans |
| warm-amber | 暖阳琥珀 | #f59e0b | modern | serif |
| minimal-rose | 极简玫瑰 | #f43f5e | modern | sans |
| bi-luo | 碧落 | #4E7D9A | cn-traditional | sans |
| mu-shan-zi | 暮山紫 | #6F5E8F | cn-traditional | serif |
| qiu-xiang | 秋香 | #B57D2C | cn-traditional | serif |
| yan-zhi | 燕支 | #B83A4C | cn-traditional | sans |

`[Data-backed：原型 ThemeContext THEMES 定义]`。每套主题的 50–900 完整色值**直接从原型 `ThemeContext.jsx` 迁移到 `theme/themes.ts`，逐值拷贝、禁止重调**。示例（fresh-emerald）：

```ts
export const freshEmerald: ThemeDef = {
  id: 'fresh-emerald', name: '清新翠绿', styleCategory: 'modern',
  accent: '#10b981', bodyFont: 'font-sans',
  palette: {
    50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399',
    500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b',
  },
}
```

### 3.3 语义层（L2）与亮/暗映射

语义变量沿用原型命名；中性色阶在亮/暗模式下整体切换（暗色取自原型 DARK_NEUTRAL_OVERRIDES，基于 Slate 暗色方案）`[Data-backed]`：

| 语义变量 | 亮色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| --color-neutral-{50..900} | Slate 亮阶 | Slate 暗阶（50=#0b1220 … 900=#f1f5f9） | 中性背景/边框/文本基色 |
| --bg-page | #f8fafc | #0b1220 | 页面背景 |
| --bg-surface | #ffffff | #111827 | 卡片/弹层表面 |
| --bg-subtle / --bg-hover | #f1f5f9 | #1e293b | 次级面板 / 悬停 |
| --border-soft / --border-strong | #e2e8f0 / #cbd5e1 | #1e293b / #334155 | 边框 |
| --text-primary / --text-secondary / --text-muted | #0f172a / #475569 / #94a3b8 | #f1f5f9 / #94a3b8 / #64748b | 文本三级 |
| --text-on-accent | #ffffff | #0b1220 | 主色上的文本 |
| data-appearance | 'light' | 'dark' | 根元素属性，供正文渲染主题等消费 |

### 3.4 输出格式

**CSS 变量（运行时唯一事实源）**——由 ThemeProvider 统一写入 `document.documentElement.style`：

```css
:root {
  --color-primary-500: var(--ewiki-primary-500, #10b981); /* 由主题运行时覆写 */
  --bg-surface: #ffffff;
  --text-primary: #0f172a;
}
[data-appearance='dark'] { /* 暗色整体切换 */ }
```

**Tailwind 消费**（tailwind.config.ts）——组件一律用 Tailwind 原子类引用变量，禁止直接写 hex：

```ts
export default {
  theme: { extend: {
    colors: {
      primary: { 50: 'var(--color-primary-50)', /* … */ 900: 'var(--color-primary-900)' },
      neutral: { 50: 'var(--color-neutral-50)', /* … */ 900: 'var(--color-neutral-900)' },
    },
  } },
}
```

**主题切换契约**（ThemeProvider，迁移自原型）：

- 切换主题 = 遍历 palette 写入 `--color-primary-{shade}`；切换外观 = 写入中性色与语义变量并设置 `data-appearance`；切换过渡 320ms（`.theme-transitioning` 类，结束后移除）`[Data-backed]`。
- 持久化：localStorage key 更名为 `ewiki-ui-theme` / `ewiki-appearance`（随产品更名）；默认主题 fresh-emerald、默认外观 system。
- appearance=system 时监听 `prefers-color-scheme` 变化实时跟随 `[Data-backed]`。
- 禁止：组件内直读 localStorage 主题、硬编码 #hex、绕过 ThemeProvider 手写 CSS 变量。

### 3.5 组件层（L3）工具类

原型 globals.css 中的组件类正式化为唯一组件样式入口（globals.css 以 CSS 变量实现，禁止 @apply 硬编码色值）：

| 类 | 用途 |
| --- | --- |
| `btn-primary` / `btn-secondary` / `btn-ghost` | 按钮三变体（对应 primary/secondary/ghost；danger 语义用 `btn-primary` + `--color-feedback-error` 场景类，见 4.2） |
| `tag-primary` / `tag-success` / `tag-neutral` / `tag-warning` / `tag-danger` | 状态标签 |
| `skeleton` | 骨架屏 |
| `scrollbar-thin` | 统一细滚动条 |
| `animate-fade-up` / `animate-slide-in` / `theme-transitioning` | 动效 |

---

## 4 组件规范

### 4.1 基础组件清单（components/ui）

Phase 1 必须落地的最小集（覆盖原型全部用到的 UI 原语）：

| 组件 | 职责 | 关键 Props（类型 / 默认 / 必填） |
| --- | --- | --- |
| Button | 按钮 | `variant: 'primary'\|'secondary'\|'ghost'\|'danger' = 'primary'`；`size: 'sm'\|'md' = 'md'`；`loading?: boolean`；`icon?: ReactNode` |
| Modal | 模态框 | `open: boolean`（必填）；`onClose: () => void`；`size: 'sm'\|'md'\|'lg' = 'md'`；`danger?: boolean` |
| ConfirmModal | 二次确认（删除项目/回滚/注销） | `title`、`confirmText`、`onConfirm: () => Promise<void>`（内置 loading） |
| Toast | 轻提示（原型 HeaderToast 模式：底部居中、2s 自消失） | `message: string`；`tone: 'success'\|'error' = 'success'` |
| Input / Textarea | 表单输入 | 标准 props + `error?: string`（红框+错误文案） |
| Select | 下拉 | `options: {label,value}[]` |
| Tag | 状态标签 | `tone: TagTone`（3.5 表） |
| EmptyState | 空态 | `title`、`description?`、`action?: ReactNode` |
| Skeleton | 骨架屏 | `rows?: number` |
| Tooltip | 悬浮提示 | `content: string`（原型 TopBar 模式：纯 CSS hover） |
| Tabs | 页签 | `items: {key,label,icon?}[]`、`active`、`onChange` |
| Pagination | 分页 | `page/pageSize/total/onChange` |

组件契约六要素（描述/Props/状态/变体/示例/Do-Don't）按 design-system 惯例执行；所有可交互组件必须覆盖：default / hover / active / focus（2px outline，--border-focus 语义）/ disabled / loading 六态 `[Research-backed：WCAG 2.1 焦点可见性]`。

**Do / Don't（全局）**：

- Do：图标按钮必须 `aria-label`（原型 AppearanceToggle 已示范）`[Data-backed]`；异步按钮必须 `loading`；列表必须同时实现空态与加载骨架。
- Don't：同一视图并排两个 primary 按钮；danger 用于非破坏性操作；在组件内直写 hex/px 间距（用令牌）。

### 4.2 业务复合组件（components/business）

| 组件 | 对应功能 | 说明 |
| --- | --- | --- |
| DocumentTree | F12 | 文档树；状态图标用 Tag tone 映射：synced=success、modified=warning、conflict=danger、untracked=neutral |
| EditorShell | F13–F15 | TipTap 容器 + 渲染主题切换 + TOC（见 8.1） |
| GraphCanvas | F29–F32 | 力导向画布（懒加载，见 9.3） |
| PublishWizard | F33–F36 | 三步向导（步骤状态机在组件内，配置提交走 API） |
| SourceForm | F19–F21 | 按 source type 动态字段（分支逻辑配置化：`{type: FieldSpec[]}`） |
| StarterPackWizard | F10 | 三步向导 + 内嵌 SourceForm |
| ActivityFeed / VersionTimeline | F03/F46–F49 | 时间线渲染，动词配色映射见 PRD F49 |
| MemberTable / InviteModal | F50–F52 | 角色 Tag + 行内菜单 |

---

## 5 状态管理与数据获取

### 5.1 职责边界

| 类别 | 归属 | 例 |
| --- | --- | --- |
| 服务器数据 | TanStack Query | 项目/文档/版本/源/动态/图谱/模板 |
| 跨组件 UI 状态 | Zustand | 侧边栏折叠、右侧面板开关、编辑器会话、实时连接状态 |
| 组件局部状态 | useState | 表单草稿、弹窗开关 |
| 主题/外观 | ThemeProvider Context（沿用原型） | theme、appearance |

禁止：用 Query 缓存放 UI 状态；用 Zustand 存 API 响应副本；props 逐层透传超过 3 层（应上 store）。

### 5.2 queryKey 规范与 WS→失效映射

queryKey 采用数组元组，层级与 API 路径一致；筛选条件作为 key 成员（保证缓存隔离）：

```ts
['projects'], ['project', id], ['documents', projectId, filters],
['document', id], ['versions', docId], ['graph', projectId, view],
['activities', projectId], ['sources'], ['team'], ['me']
```

WS 事件（SDD 4.4）到达后按映射失效缓存，禁止手动 setQueryData 直接改服务器数据（除乐观更新）：

| WS 事件 | 失效/动作 |
| --- | --- |
| activity.created | invalidate `['activities', projectId]` |
| document.updated | invalidate `['documents', projectId]` + `['document', docId]` |
| sync.status_changed | invalidate `['sources']`；若 sync 失败 → Toast(error) |
| publish.finished | invalidate `['publish-jobs', projectId]`；成功 → Toast |
| notification.new | invalidate `['notifications']` |
| presence.updated | 不进缓存，直接驱动编辑器 presence UI |

乐观更新：文档保存（D4）、角色变更（M1）采用 onMutate 乐观写 + 失败回滚 `[Expert judgment]`。

### 5.3 Zustand slice 划分

`uiStore`（sidebarCollapsed/rightPanel/navLayout/theme-panel 等布局态）、`editorStore`（当前 docId、会话状态、保存中标记）、`realtimeStore`（connected/rooms）。每个 slice 独立文件，selector 细粒度订阅（`useUiStore(s => s.rightPanel)`），禁止整 store 订阅。

---

## 6 API 客户端与错误处理

### 6.1 封装契约

`lib/api/client.ts`：基于 fetch 的单例，职责固定：

1. 自动附加 `Authorization: Bearer`（token 由 authStore 持有）；
2. 响应非 2xx 时抛 `EwikiApiError`（字段与 SDD 错误信封一致：`code/message/details/requestId`）；
3. 401 且非登录请求 → 自动调用 `POST /auth/refresh` 一次并重放原请求；刷新失败 → 清会话跳登录；
4. 任务型接口（S3/PU2/AI1/I1/X1）提供 `withIdempotencyKey()` 助手（随机 UUID，同语义重试复用）；
5. 分页响应解包 `{items, page, pageSize, total}`。

```ts
export class EwikiApiError extends Error {
  constructor(public code: string, message: string,
    public details?: unknown, public requestId?: string,
    public status: number) { super(message) }
}
```

### 6.2 错误处理约定

| 层 | 行为 |
| --- | --- |
| Query 层 | 业务化错误（SOURCE_UNREACHABLE、EDIT_CONFLICT…）由调用方消费并展示；统一走 Toast + 界面内错误态 |
| 403 FORBIDDEN | 页面级 → 空态提示无权限；操作级 → Toast |
| 409 EDIT_CONFLICT | 打开对比面板（PRD F43"每次询问"策略的客户端入口） |
| 网络错误/5xx | Toast + Query 自动重试（指数退避，最多 2 次） |
| 全局兜底 | ErrorBoundary 捕获渲染异常，展示错误页 + "重试" |

禁止：吞错（catch 后不展示）、用 alert/confirm 原生弹窗（一律 Modal/Toast）、把 requestId 打给用户（仅日志上报）。

---

## 7 路由、页面与布局

### 7.1 路由表（迁移自原型，全部懒加载）

| 路径 | 页面组件 | 布局壳 |
| --- | --- | --- |
| /dashboard | DashboardPage | Layout |
| /library | LibraryPage | Layout |
| /sources | SourcesPage | Layout |
| /themes | ThemesPage | Layout |
| /settings | SettingsPage | Layout |
| /project/:id/browse | ProjectBrowsePage | ProjectLayout |
| /project/:id/graph | ProjectGraphPage | ProjectLayout |
| /project/:id/activity | ProjectActivityPage | ProjectLayout |
| /project/:id/publish | ProjectPublishPage | ProjectLayout |
| /project/:id/members | ProjectMembersPage | ProjectLayout |
| /project/:id/settings | ProjectSettingsPage | ProjectLayout |

规则：`React.lazy` + Suspense（页面级代码分割）；进入 `/project/*` 时全局 Sidebar 隐藏、ProjectLayout 接管（原型行为 `[Data-backed]`）；未知路由 → 404 页；`/project/:id` id 无效 → 项目未找到空态页（原型 ProjectNotFound 模式）。

### 7.2 页面状态模板

每个数据页面必须实现四态，结构与 design-system 模板对齐：

| 状态 | 实现 |
| --- | --- |
| Loading | Skeleton（原型骨架屏类），禁止白屏 |
| Empty | EmptyState，文案沿用原型（如"尝试调整筛选条件或稍后再来看看新发布的内容"）`[Data-backed]` |
| Error | ErrorState + 重试（Query refetch） |
| Data | 正常渲染 |

---

## 8 编辑器与实时集成

### 8.1 编辑器（F13–F15）

- 内核：TipTap（packages/editor 封装），扩展集：StarterKit、Link、Image、TaskList、CodeBlock（lowlight）、Table `[To be confirmed：按 PRD 编辑器形态评审增删]`。
- Markdown 序列化：编辑态为 ProseMirror 文档，保存/版本快照序列化为 Markdown（库选型 `[To be confirmed：tiptap-markdown 或自研序列化]`）；渲染态复用同一文档模型。
- 渲染主题（7 种，F14）：CSS 类作用域切换（`.prose-doc[data-render-theme='book']` 等），从原型迁移；TOC：由文档标题派生 + scroll-spy（IntersectionObserver）。
- 快捷键：遵循 PRD F44 十组映射（Windows = Ctrl 系，SDD 8-9 决议）。

### 8.2 实时集成（F17 / F53）

- 连接：`lib/ws` 封装两条通道——事件通道 `/ws?accessToken=`（房间订阅 + 事件信封）与协同通道 `/collab`（Yjs 同步协议，y-websocket 兼容）。
- 事件 → 缓存失效映射固定为 5.2 表，新增事件必须先补表再消费。
- 协同：y-prosemirror 绑定 TipTap；`y-indexeddb` 本地持久化（断线降级编辑）；重连由 provider 自动同步；显式保存经 /collab 协议消息触发服务端生成版本（SDD 5.3），协同会话内禁调 D4。
- 连接状态进 `realtimeStore`，UI 在顶部以细条展示"已断开/重连中"（PRD 断线降级语义）。

---

## 9 质量门槛

| 门槛 | 要求 |
| --- | --- |
| 类型 | `tsc --noEmit` 0 error 才可合入 |
| Lint | eslint 0 error；react-hooks/exhaustive-deps 必须处理 |
| 单元测试 | Vitest：lib/api、stores、features 纯逻辑必测；组件测试按需 `[To be confirmed：是否引入 Testing Library]` |
| a11y 基线 | 图标按钮 aria-label；Modal 焦点陷阱 + `role="dialog"`；对比度遵循 WCAG 2.1 AA `[Research-backed]` |
| 性能预算 | 首屏 JS（gzip）≤ 300KB；路由级分割；GraphCanvas/Editor 懒加载；长列表（>200 行）虚拟滚动 |
| 主题回归 | 每个新组件必须在 8 主题 × 亮/暗 下目检（主题系统回归清单） |

---

## 10 需求追踪与开放项

| 本文档章节 | 上游 |
| --- | --- |
| 3 设计令牌 | PRD F37–F41、SDD 主题决策、原型 ThemeContext |
| 4 组件 | PRD F01–F36 各页面 UI 原语、原型 globals.css |
| 5 状态/6 API | SDD 4.2–4.4（契约）、PRD F44 |
| 7 路由 | PRD 路由地图（SDD 5.1）、原型 App.jsx |
| 8 编辑器与实时 | PRD F13–F17、SDD 5.2/5.3 |
| 9 质量门槛 | PRD 8.1 非功能、原型 a11y 示范 |

开放项（沿用 SDD）：Markdown 序列化库、Testing Library、AI 服务商。本文档随层 4 工程初始化反馈迭代。
