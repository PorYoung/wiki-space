import { useMemo, useState } from "react";
import {
  CodeMirrorMarkdownEditor,
  tableExtension,
  mathExtension,
  mermaidExtension,
  footnoteExtension,
  wikilinkExtension,
} from "@latentic/live-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { history, historyKeymap } from "@codemirror/commands";
import { githubLight } from "@uiw/codemirror-theme-github";
import CodeMirror from "@uiw/react-codemirror";

// 完整演示文档 —— 覆盖 GFM 全特性
const FULL_DEMO = `# ewiki Markdown 全功能演示

> 这份文档展示 live-markdown 覆盖的所有 GFM 特性。
> 对比右侧"当前方案"看看差异有多大。

## ✅ 任务列表（GFM TaskList）

- [x] 重构协同层为 y-websocket
- [x] 修复路由匹配 /collab/<docId>
- [ ] 替换手写 decorations → live-markdown
- [ ] 接入 Hocuspocus 协同后端
- [ ] Diff 改用 diff 包

## 📊 GFM 表格（列对齐 + 边框）

| 方案 | 编辑器 | 协同 | 体积 | 推荐 |
| :--- | :---: | :---: | ---: | :---: |
| live-markdown | CM6 | y-codemirror | 57KB | ⭐⭐⭐⭐⭐ |
| 手写 decorations | CM6 | y-codemirror | 小 | ⭐⭐ |
| Tiptap | ProseMirror | y-prosemirror | ~120KB | ⭐⭐⭐⭐ |
| Milkdown | ProseMirror | 插件 | ~150KB | ⭐⭐⭐⭐ |

## 🔢 数学公式（KaTeX）

行内：质能方程 $E = mc^2$，二次公式 $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$

块级：

$$
\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$

## 🧩 Mermaid 流程图

\`\`\`mermaid
graph TD
    A[用户打开文档] --> B{是否已有协同连接?}
    B -->|是| C[复用 CollabYDoc 实例]
    B -->|否| D[新建 Y.Doc + WebsocketProvider]
    C --> E[ytext.transact 初始化]
    D --> E
    E --> F[y-codemirror.next 自动同步]
    F --> G[实时协同编辑 ✨]
\`\`\`

## 📖 代码高亮

\`\`\`typescript
import { Y } from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const doc = new Y.Doc();
const provider = new WebsocketProvider(
  'ws://localhost:3001/collab',
  'doc-123',
  doc
);

provider.on('sync', (synced) => {
  if (synced) console.log('协同已同步');
});
\`\`\`

## 🔗 链接 & 引用

访问 [live-markdown npm](https://www.npmjs.com/package/@latentic/live-markdown) 或 [GitHub](https://github.com/getlatentic/live-markdown)。

脚注测试[^live-markdown] 以及 wiki-link [[协同编辑器]]。

[^live-markdown]: live-markdown 是 CM6 上的 WYSIWYG 方案，以 Markdown 字符串为 source of truth。

## 🖼️ 图片 & 引用块

> "Typora 把体验做完整了，可它是桌面软件，嵌不进 React / Vue。"
> — Markweave README

嵌套引用：

> 外层引用
>
> > 内层引用 **加粗** 和 *斜体*

## 📝 标题层级

### 三级标题
#### 四级标题
##### 五级标题

**加粗** · *斜体* · ~~删除线~~ · \`行内代码\` · [链接](https://example.com)

---

结束线以上是完整的 live-markdown 渲染能力。手写 decorations 能覆盖的不到一半。
`;

// 简化演示（用于旧编辑器）
const SIMPLE_DEMO = `# ewiki Markdown 演示

## 任务列表（GFM TaskList）

- [x] 重构协同层
- [ ] 替换手写 decorations → live-markdown
- [ ] 接入 Hocuspocus

## 表格

| 方案 | 协同 | 推荐 |
| :--- | :---: | :---: |
| live-markdown | y-codemirror | ⭐⭐⭐⭐⭐ |
| 手写 decorations | y-codemirror | ⭐⭐ |

## 代码

\`\`\`typescript
const doc = new Y.Doc();
const provider = new WebsocketProvider(
  'ws://localhost:3001/collab',
  'doc-123',
  doc
);
\`\`\`

**加粗** · *斜体* · ~~删除线~~ · \`行内代码\`

> 引用块
`;

function LiveMarkdownPanel() {
  const [value, setValue] = useState(FULL_DEMO);
  const [mode, setMode] = useState<"wysiwyg" | "source">("wysiwyg");

  const extensions = useMemo(
    () => [
      tableExtension(),
      mathExtension,
      mermaidExtension,
      footnoteExtension,
      wikilinkExtension,
    ],
    []
  );

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-lg">✨</span>
          <span className="font-semibold text-gray-800">live-markdown（推荐方案）</span>
          <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">v0.4.2</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setMode("wysiwyg")}
            className={`px-3 py-1 text-xs rounded-md transition ${
              mode === "wysiwyg" ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            WYSIWYG
          </button>
          <button
            onClick={() => setMode("source")}
            className={`px-3 py-1 text-xs rounded-md transition ${
              mode === "source" ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            源码
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-auto">
        <CodeMirrorMarkdownEditor
          mode={mode}
          value={value}
          onChange={(v) => setValue(v)}
          extensions={extensions}
        />
      </div>

      {/* Footer stats */}
      <div className="px-4 py-1.5 bg-gray-50 border-t text-xs text-gray-500 flex justify-between">
        <span>{value.length} 字符 · {value.split("\n").length} 行</span>
        <span>Markdown 字符串 byte-for-byte 往返</span>
      </div>
    </div>
  );
}

function OldEditorPanel() {
  const [value, setValue] = useState(SIMPLE_DEMO);

  const extensions = useMemo(() => {
    return [
      markdown(),
      history(),
      keymap.of([...historyKeymap]),
      EditorView.theme({
        "&": { fontSize: "14px" },
        ".cm-gutters": { background: "transparent", border: "none" },
      }),
    ];
  }, []);

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
      <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-gray-50 to-slate-100 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-lg">📝</span>
          <span className="font-semibold text-gray-700">当前手写 decorations</span>
          <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">350 行手写</span>
        </div>
        <div className="text-xs text-gray-500">仅基础语法高亮</div>
      </div>

      <div className="flex-1 old-editor overflow-hidden">
        <CodeMirror
          value={value}
          theme={githubLight}
          extensions={extensions}
          onChange={setValue}
          basicSetup={{ lineNumbers: false, highlightActiveLine: false }}
        />
      </div>

      <div className="px-4 py-1.5 bg-gray-50 border-t text-xs text-gray-500 flex justify-between">
        <span>{value.length} 字符 · {value.split("\n").length} 行</span>
        <span>缺失：表格 / 数学 / Mermaid / TaskList / 脚注</span>
      </div>
    </div>
  );
}

function FeatureGrid() {
  const features = [
    { icon: "✅", name: "任务列表", old: "❌", new: "✅", desc: "GFM `- [x]` checkbox widget" },
    { icon: "📊", name: "GFM 表格", old: "❌", new: "✅", desc: "对齐列边框，Tab 单元格导航" },
    { icon: "🔢", name: "KaTeX 数学", old: "❌", new: "✅", desc: "$行内$ 和 $$块级$$" },
    { icon: "🧩", name: "Mermaid 图", old: "❌", new: "✅", desc: "流程图渲染为 SVG" },
    { icon: "📖", name: "脚注", old: "❌", new: "✅", desc: "[^id] 引用和定义" },
    { icon: "🔗", name: "WikiLinks", old: "❌", new: "✅", desc: "[[标题]] 内部链接" },
    { icon: "🖼️", name: "行内图片预览", old: "❌", new: "✅", desc: "WYSIWYG 直接看图" },
    { icon: "📝", name: "Code 高亮", old: "✅", new: "✅", desc: "highlight.js 集成" },
    { icon: "🧭", name: "撤销/重做", old: "✅", new: "✅", desc: "history() 插件" },
    { icon: "🤝", name: "协同兼容", old: "✅", new: "✅", desc: "y-codemirror.next 可叠加" },
    { icon: "💾", name: "Markdown 往返", old: "⚠️ 部分", new: "✅ Byte-for-byte", desc: "Source of truth 始终是 Markdown 字符串" },
    { icon: "📦", name: "Bundle", old: "手写 350行", new: "57KB gz", desc: "仅编辑器自身" },
  ];

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-gray-800 mb-4">📈 功能对比矩阵</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {features.map((f) => (
          <div key={f.name} className="border border-gray-200 rounded-lg p-3 hover:border-emerald-300 hover:bg-emerald-50/30 transition">
            <div className="flex items-center gap-2 mb-1">
              <span>{f.icon}</span>
              <span className="font-medium text-gray-800 text-sm">{f.name}</span>
            </div>
            <div className="flex gap-2 text-xs">
              <span className={`px-1.5 rounded ${f.old === "✅" ? "bg-gray-100 text-gray-600" : "bg-red-100 text-red-600"}`}>当前 {f.old}</span>
              <span className={`px-1.5 rounded ${f.new === "✅" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>live {f.new}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SolutionCard({
  title,
  tag,
  problem,
  solution,
  impact,
  effort,
}: {
  title: string;
  tag: string;
  problem: string;
  solution: string;
  impact: string;
  effort: "低" | "中" | "高";
}) {
  const effortColor = {
    低: "bg-green-100 text-green-700",
    中: "bg-yellow-100 text-yellow-700",
    高: "bg-red-100 text-red-700",
  }[effort];

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-5 hover:shadow-xl transition">
      <div className="flex items-start justify-between mb-3">
        <h4 className="font-bold text-gray-800">{title}</h4>
        <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">{tag}</span>
      </div>
      <div className="space-y-2 text-sm">
        <div>
          <span className="text-gray-500 font-medium">现状：</span>
          <span className="text-red-600">{problem}</span>
        </div>
        <div>
          <span className="text-gray-500 font-medium">方案：</span>
          <span className="text-emerald-700">{solution}</span>
        </div>
        <div>
          <span className="text-gray-500 font-medium">收益：</span>
          <span className="text-gray-700">{impact}</span>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t flex items-center justify-between">
        <span className="text-xs text-gray-400">实现难度</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${effortColor}`}>{effort}</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <span className="text-3xl">🔬</span>
              ewiki · 编辑器升级方案调研
            </h1>
            <p className="text-sm text-gray-500 mt-1">live-markdown vs 手写 decorations — 实时对比演示</p>
          </div>
          <div className="flex gap-2">
            <a
              href="https://www.npmjs.com/package/@latentic/live-markdown"
              target="_blank"
              className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-md transition text-gray-700"
              rel="noreferrer"
            >
              📦 live-markdown npm
            </a>
            <a
              href="https://github.com/getlatentic/live-markdown"
              target="_blank"
              className="px-3 py-1.5 text-xs bg-gray-900 text-white hover:bg-gray-800 rounded-md transition"
              rel="noreferrer"
            >
              ⭐ GitHub
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* 方案卡片 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">🎯 三大升级方案</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <SolutionCard
              title="P0 · 编辑器：live-markdown 替换手写 decorations"
              tag="编辑器"
              problem="手写 decorations 覆盖不到表格/数学/Mermaid/TaskList/脚注/图片预览（6+ 特性缺失）"
              solution="@latentic/live-markdown — CM6 原生 WYSIWYG，Markdown 字符串 byte-for-byte 往返"
              impact="完整 GFM 覆盖 + 编辑/预览统一管线 + 可视化 TOC"
              effort="低"
            />
            <SolutionCard
              title="P1 · Diff：用已有 diff 包替换手写"
              tag="后端"
              problem="diff-summary.ts 手写前缀/后缀截断，版本历史对比极粗糙"
              solution="import { diffLines } from 'diff'（已在 devDependencies）"
              impact="Git 级精确 diff — 加行/删行/修改行各一行级判定"
              effort="低"
            />
            <SolutionCard
              title="P1 · 协同后端：Hocuspocus v4 替换手写 relay"
              tag="协同"
              problem="手写后端无房间权限校验/无 rate limit/无 metrics/无 Redis 扩展"
              solution="@hocuspocus/server + onAuthenticate + onStoreDocument 钩子"
              impact="生产级协同基础设施 — 鉴权/持久化/可观测性/横向扩展"
              effort="中"
            />
          </div>
        </section>

        {/* 对比演示 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">⚡ 实时对比演示</h2>
          <div className="grid md:grid-cols-2 gap-6 h-[700px]">
            <LiveMarkdownPanel />
            <OldEditorPanel />
          </div>
          <p className="text-sm text-gray-500 mt-3 text-center">
            左边 live-markdown 渲染完整 GFM 表格/数学/Mermaid/脚注；右边当前手写方案只有基础语法高亮
          </p>
        </section>

        {/* 功能矩阵 */}
        <section>
          <FeatureGrid />
        </section>

        {/* 迁移路径 */}
        <section className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">🗺️ 低风险迁移路径</h2>
          <div className="space-y-4">
            {[
              { step: "Step 1", title: "并行引入 live-markdown", desc: "MarkdownViewer.tsx 加 prop：wysiwygMode（live-markdown） vs 现有 sourceMode（CM6 + 手写 decorations），用户可切换。两个组件同源，无破坏性。" },
              { step: "Step 2", title: "协同通道自动复用", desc: "y-codemirror.next + live-markdown 都绑定同一个 Y.Text —— 直接替换 CM6 的 decorations 层，协同链路无需任何改动。" },
              { step: "Step 3", title: "formatting.ts 废弃", desc: "6 个手写函数（wrapSelection/toggleLinePrefix/toggleHeading…）由 live-markdown 的 formatCommands 替代 —— 基于文档节点模型，不是字符串操作。" },
              { step: "Step 4", title: "diff-summary.ts 替换为 diff 包", desc: "后端 36 行手写截断 → 5 行 diffLines 调用。立即提升版本历史可读性。" },
              { step: "Step 5", title: "协同后端评估 Hocuspocus v4", desc: "3-5 天：搭 Hocuspocus Server 替代手写 index.ts（277 行 → 约 80 行 + 完整鉴权/持久化/metrics）。" },
            ].map((s) => (
              <div key={s.step} className="flex gap-4">
                <div className="shrink-0 w-16 h-8 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-bold flex items-center justify-center">
                  {s.step}
                </div>
                <div>
                  <h4 className="font-semibold text-gray-800">{s.title}</h4>
                  <p className="text-sm text-gray-600 mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* footer */}
        <footer className="text-center text-sm text-gray-400 py-6">
          原型 · React + Vite + live-markdown · 2026-09-13
        </footer>
      </main>
    </div>
  );
}
