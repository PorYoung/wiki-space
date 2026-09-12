// ---------------------------------------------------------------------------
// @ewiki/render/markdown —— Markdown 渲染单一事实源（与应用内预览同源）
//   markdown-it（CommonMark + GFM 表格/删除线）+ highlight.js 代码高亮
//   + KaTeX 公式（$..$ 行内 / $$..$$ 块级，适配自 markdown-it-katex MIT 实现）
//   + mermaid 流程图（```mermaid 围栏 → 占位容器，消费方异步渲染：
//     应用内 use-mermaid-render.ts；发布站点内嵌 loader，见 index.ts）。
// 安全基线：html:false 原始 HTML 一律转义；KaTeX throwOnError:false。
// 约束：本模块不得 import node 内置模块 / CSS（web 端经子路径消费，见 package.json exports）。
// ---------------------------------------------------------------------------

import MarkdownIt from 'markdown-it';
import type { StateBlock, StateInline } from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';

// ---------------------------------------------------------------------------
// slugify：标题 id 与 TOC 提取必须同源（h1/h2/h3[id] = slugify(标题原文)）
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

// ---------------------------------------------------------------------------

const md = new MarkdownIt({
  html: false,
  linkify: true,
  // 代码高亮：highlight.js common 集（~40 常用语言，控制体积）；未识别语言降级转义原文。
  // 返回以 <pre 开头时 markdown-it 原样使用，不再包一层 <pre><code>
  highlight: (str: string, lang: string): string => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {
        // 语法结构异常时降级为转义原文
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

// -- mermaid 围栏：输出占位容器（代码 encodeURIComponent 进 data 属性），
// 由消费方异步渲染为 SVG；lang 尾参（如 ```mermaid title=xx）忽略
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  if (token.info.trim().split(/\s+/)[0] === 'mermaid') {
    return `<div class="mermaid-block" data-mermaid-code="${encodeURIComponent(token.content)}"></div>`;
  }
  return defaultFence!(tokens, idx, options, env, self);
};

// -- 标题 id：与 slugify 同口径（TOC scroll-spy / 锚点定位依据）
md.renderer.rules.heading_open = (tokens, idx) => {
  const token = tokens[idx]!;
  const text = tokens[idx + 1]?.content ?? '';
  return `<${token.tag} id="${slugify(text)}">`;
};

// -- 外链新开页签
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet('target', '_blank');
  tokens[idx]!.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// -- 图片相对地址改写（发布站点：相对引用 → 站点 assets URL）。
// 仅相对路径经 env.rewriteAsset 改写；http(s)/mailto/data:/页内锚点/绝对路径原样保留。
// env 随每次 md.render(src, env) 传入，无 env 时默认渲染，行为与历史完全一致。
interface MarkdownRenderEnv {
  rewriteAsset?: (target: string) => string;
}

const ASSET_EXTERNAL_RE = /^(https?:|mailto:|data:)/i;

const defaultImage =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const rewriteAsset = (env as MarkdownRenderEnv | undefined)?.rewriteAsset;
  if (rewriteAsset) {
    const token = tokens[idx]!;
    const src = token.attrGet('src');
    if (typeof src === 'string' && src && !ASSET_EXTERNAL_RE.test(src) && !src.startsWith('#') && !src.startsWith('/')) {
      token.attrSet('src', rewriteAsset(src));
    }
  }
  return defaultImage(tokens, idx, options, env, self);
};

// ---------------------------------------------------------------------------
// KaTeX 数学公式（$..$ 行内 / $$..$$ 块级）
// 适配自 waylonflinn/markdown-it-katex（MIT）：分隔符合法性校验 + 反斜杠转义扫描
// 保持原逻辑；渲染层加固——异常时输出转义原文（原实现直接回填 LaTeX，存在注入面）。
// ---------------------------------------------------------------------------

/** $ 分隔符两侧合法性：开侧后不能是空白，闭侧前不能是空白、闭侧后不能紧跟数字（防 "$5" 误判） */
function isValidDelim(state: StateInline, pos: number): { can_open: boolean; can_close: boolean } {
  const max = state.posMax;
  const prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
  const nextChar = pos + 1 <= max ? state.src.charCodeAt(pos + 1) : -1;
  let can_open = true;
  let can_close = true;
  if (prevChar === 0x20 || prevChar === 0x09 || (nextChar >= 0x30 && nextChar <= 0x39)) {
    can_close = false;
  }
  if (nextChar === 0x20 || nextChar === 0x09) {
    can_open = false;
  }
  return { can_open, can_close };
}

function mathInline(state: StateInline, silent: boolean): boolean {
  if (state.src[state.pos] !== '$') return false;

  if (!isValidDelim(state, state.pos).can_open) {
    if (!silent) state.pending += '$';
    state.pos += 1;
    return true;
  }

  // 找闭合 $：跳过被反斜杠转义的（闭合 $ 前须有偶数个反斜杠）
  const start = state.pos + 1;
  let match = start;
  while ((match = state.src.indexOf('$', match)) !== -1) {
    let pos = match - 1;
    while (state.src[pos] === '\\') pos -= 1;
    if ((match - pos) % 2 === 1) break;
    match += 1;
  }
  if (match === -1) {
    if (!silent) state.pending += '$';
    state.pos = start;
    return true;
  }
  // "$$" 空内容不按行内公式解析（属块级 $$ 的开头）
  if (match - start === 0) {
    if (!silent) state.pending += '$$';
    state.pos = start + 1;
    return true;
  }
  if (!isValidDelim(state, match).can_close) {
    if (!silent) state.pending += '$';
    state.pos = start;
    return true;
  }

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = '$';
    token.content = state.src.slice(start, match);
  }
  state.pos = match + 1;
  return true;
}

function mathBlock(state: StateBlock, start: number, end: number, silent: boolean): boolean {
  let found = false;
  let pos = state.bMarks[start]! + state.tShift[start]!;
  let max = state.eMarks[start]!;

  if (pos + 2 > max) return false;
  if (state.src.slice(pos, pos + 2) !== '$$') return false;

  pos += 2;
  let firstLine = state.src.slice(pos, max);
  if (silent) return true;
  if (firstLine.trim().slice(-2) === '$$') {
    firstLine = firstLine.trim().slice(0, -2);
    found = true;
  }
  let lastLine: string | undefined;

  let next = start;
  while (!found) {
    next += 1;
    if (next >= end) break;
    pos = state.bMarks[next]! + state.tShift[next]!;
    max = state.eMarks[next]!;
    if (pos < max && state.tShift[next]! < state.blkIndent) break;
    if (state.src.slice(pos, max).trim().slice(-2) === '$$') {
      const lastPos = state.src.slice(0, max).lastIndexOf('$$');
      lastLine = state.src.slice(pos, lastPos);
      found = true;
    }
  }
  state.line = next + 1;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content =
    (firstLine && firstLine.trim() ? `${firstLine}\n` : '') +
    state.getLines(start + 1, next, state.tShift[start]!, true) +
    (lastLine && lastLine.trim() ? lastLine : '');
  token.markup = '$$';
  return true;
}

function katexRender(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode, strict: false });
  } catch {
    return md.utils.escapeHtml(tex);
  }
}

md.inline.ruler.after('escape', 'math_inline', mathInline);
md.block.ruler.after('blockquote', 'math_block', mathBlock, {
  alt: ['paragraph', 'reference', 'blockquote', 'list'],
});
md.renderer.rules.math_inline = (tokens, idx) => katexRender(tokens[idx]!.content, false);
md.renderer.rules.math_block = (tokens, idx) => `<div class="math-block">${katexRender(tokens[idx]!.content, true)}</div>`;

// ---------------------------------------------------------------------------

export interface MarkdownRenderOptions {
  /** 相对图片地址改写回调（发布站点相对资源 → 站点 assets URL）；不传时图片地址原样输出 */
  rewriteAsset?: (target: string) => string;
}

export const markdownToHtml = (
  src: string | null | undefined,
  opts?: MarkdownRenderOptions,
): string => (src ? md.render(src, { rewriteAsset: opts?.rewriteAsset }) : '');

/** 渲染层 HTML 转义（mermaid 错误提示等复用） */
export const mdEscapeHtml = md.utils.escapeHtml;

/** 发布页按需注入判据：正文含 KaTeX 输出 / mermaid 占位 */
export const hasKatexOutput = (html: string): boolean => html.includes('class="katex');
export const hasMermaidBlock = (html: string): boolean => html.includes('mermaid-block');
