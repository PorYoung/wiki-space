---
name: "prototype-migrate"
description: "Migrates a prototype JSX page to production TSX with real API. Invoke when: a prototype page exists (e.g. prototype-docvault/src/pages/*.jsx) and needs to be converted into the real app (apps/web/src/pages/) using apiFetch + react-query + Tailwind + CSS tokens, with zero-error build as the gate."
---

# Prototype → Production Page Migrator

把原型（通常是 `prototype-*/src/pages/*.jsx`）迁移到真实应用（`apps/web/src/pages/*.tsx`），对接后端真实 API，**零 error build 通过**作为门禁。

## 触发条件

用户说"继续推进"、"迁移页面"、"把原型 X 搬到真实代码里"、"对接真实 API"，或原型目录中存在 `.jsx` 而真实目录对应的 `.tsx` 仍是 `placeholders.tsx` 占位符时触发。

## 输入契约

迁移前必须确认 3 件事：

1. **原型文件路径** — `Glob pattern: prototype-*/src/pages/*.jsx`
2. **真实路由配置** — 看 `apps/web/src/App.tsx` 的路由表，确认目标文件名
3. **后端 API 可用性** — 扫 `apps/server/src/http/routes.ts`，列一张表：哪些 API 已实现、哪些是缺口

## 输出契约

- 新建 `apps/web/src/pages/<PageName>.tsx`
- 更新 `App.tsx` 的 import（从 placeholders 拆出去）
- 原型中所有 mock fetch/stubs 替换为真实 `apiFetch` + `useQuery`/`useMutation`
- `pnpm --filter @ewiki/web run build` **零错误通过**（硬性门槛）
- 后端 API 缺口处：**skeleton 空态 + 禁用按钮 + TODO 注释**，**绝不编造 mock 数据结构**

## 迁移规则（严格遵守）

### 1. 类型与框架

```typescript
// ✅ 正确（从项目共享包取类型）
import type { Document, Project, User } from '@ewiki/shared';
// ❌ 错误（从哪里随便 import 自己的 interface）
interface Foo { id: string }
```

| 项目 | 来源 |
|---|---|
| API 调用 | `import { apiFetch } from '../lib/api/client'` |
| 数据获取 | `import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'` |
| 路由参数 | `import { useParams, useSearchParams, Link, Navigate } from 'react-router-dom'` |
| 图标 | `import { Search, ChevronRight, Save } from 'lucide-react'` |
| 类型 | 优先从 `@ewiki/shared` import，本地只定义 endpoint response shape |

### 2. Tailwind + CSS 变量风格

所有颜色/背景/边框/间距必须走 CSS 变量令牌，**禁止硬编码 hex 颜色**：

```tsx
// ✅ 正确
<div style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }} />
<h1 style={{ color: 'var(--color-primary-600)' }} />

// ❌ 错误（硬编码）
<div style={{ background: '#ffffff' }} />
<h1 style={{ color: '#2563eb' }} />
```

常用令牌速查：`--bg-page` / `--bg-surface` / `--color-primary-600` / `--text-primary` / `--text-muted` / `--border-soft` / `tag-primary` / `tag-success` / `tag-warning` / `tag-danger` / `.card` / `.card-hover` / `.input` / `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.skeleton` / `.scrollbar-thin` / `.animate-fade-up`

### 3. 禁止引入新依赖

原型可能用了 `react-resizable-panels`、`d3`、`react-flow`、`react-markdown` 等，但 `@ewiki/web` 的 `package.json` 里没有。**用项目已有依赖 + flex/SVG/原生能力替代**：

| 原型能力 | 项目替代 |
|---|---|
| PanelGroup 拖拽面板 | flex + 手动折叠按钮（可留 TODO 后续引入） |
| d3 力导向图 | 纯 SVG + 自写力模拟 |
| react-markdown | 自写 `markdownToHtml` 子集 |
| react-router Outlet context | useQuery/useMutation 直接调用，不走 context |

### 4. API 对接模式

```typescript
// ===== 查询 =====
const { data, isLoading, error } = useQuery<SomeType>({
  queryKey: ['my-query', param],  // 必须带上动态参数做 key
  queryFn: () => apiFetch<SomeType>(`/api/v1/endpoint/${param}`),
  enabled: !!param,                 // 守卫条件（防止 undefined 触发）
});

// ===== 写操作 =====
const mutation = useMutation({
  mutationFn: (payload) => apiFetch<Result>('/api/v1/endpoint', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  onSuccess: (result) => {
    const qc = useQueryClient(); // hook 内部直接拿
    void qc.invalidateQueries({ queryKey: ['my-query', param] });
    // 乐观更新用 setQueryData，不存本地 state
  },
});
```

**queryKey 规范**：`['资源名', id或filter]`，必须唯一标识这份数据。不要用模糊的 `['data']`。

### 5. API 缺口处理

原型里可能有后端还没实现的端点。**三种处理方式按优先级选**：

1. **后端已有类似端点 → 前端过滤**（如 sourcesRoute 已返回全部 sources，前端 `sources.filter(s => s.projectId === pid)`）
2. **后端完全没有 → skeleton 空态 + 禁用按钮**（如 ProjectSettingsPage 的 AI 整理区域）
3. **后端有表但没路由 → 在 tasks 里记下，先在前端做注释占位**

```tsx
// ✅ 正确的缺口处理
<div className="card p-6 text-center text-neutral-400">
  <Wand2 size={32} className="mx-auto mb-3 text-neutral-300" />
  <p className="text-sm">AI 智能整理功能暂未开放</p>
  <p className="text-xs mt-1">后端路由 P23（aiClassifyRuns）待实现</p>
</div>
<button disabled className="btn-primary opacity-50 cursor-not-allowed">
  开始整理（TODO: /api/v1/projects/:id/ai-classify）
</button>

// ❌ 错误（编造 mock 数据）
const mockResult = { folders: 5, docs: 42 };
```

### 6. 路由 import 拆分

从 placeholders.tsx 迁走时，App.tsx 的 import 必须独立：

```typescript
// ✅ 正确
import { GraphPage } from './pages/GraphPage';  // 独立
import { MembersPage, SettingsPage } from './pages/placeholders';  // 仍占位的留一起

// ❌ 错误（从 placeholders 继续 import 已实现的）
import { GraphPage } from './pages/placeholders';
```

placeholders.tsx 中的对应 export 可以**保留或移除**——App.tsx 不再 import 它即可。

### 7. build 门禁（硬性）

迁移完必须跑：

```powershell
$env:PATH = "C:\nvm4w\node_global;" + $env:PATH
pnpm --filter @ewiki/web run build
```

**零 error 零 warning 才算完成**。如果报 TS 错误，按错误信息回改，不允许 `// @ts-ignore` 绕过。

### 8. 命名规范

| 原型命名 | 真实命名 | 示例 |
|---|---|---|
| `ProjectBrowse.jsx` | `BrowsePage.tsx` | 路由 `browse` |
| `ProjectMembers.jsx` | `MembersPage.tsx` | 路由 `members` |
| `Dashboard.jsx` | `DashboardPage.tsx` | 路由 `dashboard` |
| `Settings.jsx` (全局) | `SettingsPage.tsx` | 路由 `/settings` |

## 迁移 Checklist（按顺序执行）

1. **Glob 原型文件** → 确认目标文件数量和规模
2. **Read App.tsx** → 确认路由表和 import 结构
3. **Read routes.ts** → 列出 API 可用/缺口清单
4. **Read 最近迁好的参考页** → `BrowsePage.tsx` 是最佳样板
5. **写新 TSX 文件** → 遵循 7 条规则
6. **Edit App.tsx** → import 拆分
7. **pnpm build** → 零 error 门禁
8. **（可选）浏览器代理验证** → `browser_use` 走一遍路由

## 常见踩坑

| 坑 | 解法 |
|---|---|
| 原型用 `useOutletContext` 拿数据 → 真实项目没有 | 直接在子组件里 useQuery，别走 context 传递 |
| 原型 import `mock/data.js` → 真实项目无此文件 | 删掉，用真实 API 或前端过滤 |
| 原型硬编码颜色 `#3B82F6` | 替换为 CSS 变量令牌 |
| 原型用 `api.stubs.fetchX` → 真实用 `apiFetch` + queryKey | 改 queryKey 时必须包含动态参数 |
| pnpm 命令找不到 | `$env:PATH = "C:\nvm4w\node_global;" + $env:PATH` 前置 |
| 后端 routes.ts 无 import → 用 `eq/sql/and` 时忘记从 drizzle-orm 导入 | 先 Grep 现有 routes 的 import 结构再动手 |

## 与其他 Skill 的关系

- 如果需要**先补后端 API 再迁前端**，可以先用 `plan-maker` 或直接在 tasks 里加一条后端路由任务
- 这是 ewiki 工作区专属的 skill（路径在 `ewiki/.trae/skills/`），迁移完后内容和规则已固化在本文件中，下一个同类任务直接 invoke 即可
