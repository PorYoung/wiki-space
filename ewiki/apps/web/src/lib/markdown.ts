// ---------------------------------------------------------------------------
// 应用内 Markdown 渲染入口（BrowsePage 文档预览）
// 管线单一事实源已抽至 @ewiki/render/markdown（发布侧与应用内预览同源）：
//   markdown-it（CommonMark + GFM 表格/删除线）+ highlight.js 代码高亮
//   + KaTeX 公式（$..$ 行内 / $$..$$ 块级）+ mermaid 围栏占位容器。
// 本文件仅保留浏览器侧差异：KaTeX 样式表（发布站点由平台 vendor 路由按需注入）；
// mermaid 客户端渲染仍在 use-mermaid-render.ts（动态 import，独立 chunk 懒加载）。
// ---------------------------------------------------------------------------

import 'katex/dist/katex.min.css';

export { markdownToHtml, slugify, mdEscapeHtml, hasKatexOutput, hasMermaidBlock } from '@ewiki/render/markdown';
