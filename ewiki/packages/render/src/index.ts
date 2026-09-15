// ---------------------------------------------------------------------------
// @ewiki/render —— 发布渲染单一事实源（EXT-PLATFORM-PLAN ADR-P2）
//   worker（发布：异步全量、工件落盘）与 server（预览：同步按需、不落盘）
//   必须消费同一实现，保证「预览即所得」。纯函数包：入参即数据，不触 DB。
//   仅 server/worker 消费（Node 运行时，可用 node:crypto），前端不 import 本入口
//   （前端经子路径 @ewiki/render/markdown 复用同一 Markdown 管线，避免 node:crypto 入图）。
//   发布模板（t-docs 五套）是渲染参数而非五套渲染器；accent / sidebarSide
//   可被预览端点覆盖（PreviewModal 外观定制）。
//   Markdown 管线与应用内预览同源（markdown-it + hljs + KaTeX + mermaid 占位），
//   见 ./markdown.ts；发布页对 KaTeX/mermaid 按需注入平台同源 vendor 资源
//   （server 提供 /assets/vendor/katex/* 与 /assets/vendor/mermaid/*）。
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { hasKatexOutput, hasMermaidBlock, markdownToHtml, mdEscapeHtml } from './markdown.js';
import type { MarkdownRenderOptions } from './markdown.js';

export { markdownToHtml, slugify, mdEscapeHtml } from './markdown.js';
export type { MarkdownRenderOptions } from './markdown.js';

const escapeHtml = mdEscapeHtml;

// ---------------------------------------------------------------------------
// 发布模板元数据（GET /publish-templates 的渲染侧镜像；服务端权威源在 server routes.ts）
// ---------------------------------------------------------------------------

export interface RenderTemplateMeta {
  id: string;
  zhLabel: string;
  accent: string;
  bodyFont: string;
  layout: 'sidebar' | 'sidebar-wide' | 'hero' | 'grid' | 'split';
}

export const RENDER_TEMPLATES: Record<string, RenderTemplateMeta> = {
  't-docs': { id: 't-docs', zhLabel: '文档站', accent: '#0ea5e9', bodyFont: "system-ui, 'Inter', sans-serif", layout: 'sidebar-wide' },
  't-blog': { id: 't-blog', zhLabel: '博客', accent: '#f43f5e', bodyFont: "Georgia, 'Songti SC', serif", layout: 'sidebar' },
  't-product': { id: 't-product', zhLabel: '产品首页', accent: '#14b8a6', bodyFont: "system-ui, 'Inter', sans-serif", layout: 'hero' },
  't-wiki': { id: 't-wiki', zhLabel: '知识库', accent: '#8b5cf6', bodyFont: "system-ui, 'Inter', sans-serif", layout: 'grid' },
  't-api': { id: 't-api', zhLabel: 'API 参考', accent: '#f59e0b', bodyFont: "ui-monospace, 'JetBrains Mono', monospace", layout: 'split' },
};

/** 未知/未选模板回退 generic（ewiki 主色） */
export function resolveTemplate(templateId?: string | null): RenderTemplateMeta {
  return (templateId && RENDER_TEMPLATES[templateId]) || {
    id: 'generic',
    zhLabel: '默认',
    accent: '#2ca894',
    bodyFont: "system-ui, 'Inter', sans-serif",
    layout: 'sidebar',
  };
}

// ---------------------------------------------------------------------------
// 站点装配（发布全站：自 worker 迁移；页面命名/Hash 口径保持不变）
// ---------------------------------------------------------------------------

export interface SiteDocInput {
  path: string;
  title: string | null;
  content: string | null;
}

export interface SitePage {
  rel: string;
  html: string;
}

/**
 * 发布站点二进制资源映射（P3b）：path = 二进制文档在文档库中的 posix 路径
 * （extractDocLinks 解析相对图片目标的命中口径），url = 站点内相对 URL
 * （worker 实际落盘路径，如 assets/img/logo.png）。
 */
export interface SiteAsset {
  path: string;
  url: string;
}

/** POSIX 语义相对路径 resolve（与 @ewiki/shared links.resolvePosix 同口径：./ ../ 处理） */
function resolveAssetPosix(fromDir: string, rel: string): string {
  const combined = rel.startsWith('/') ? rel : `${fromDir}/${rel}`;
  const segments: string[] = [];
  for (const seg of combined.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return segments.join('/');
}

/**
 * 构造单页图片地址改写器：以当前文档目录为基准 resolve 相对图片目标，
 * 三级候选（精确 / 补 .md / 去 .md 与 links 抽取匹配口径对齐）命中 assets 映射则改写，
 * 未命中（含 broken 图片）原样保留。
 */
function makeAssetRewriter(
  docPath: string,
  assetByPath: Map<string, string>,
): ((target: string) => string) | undefined {
  if (assetByPath.size === 0) return undefined;
  const posixPath = docPath.replace(/\\/g, '/');
  const dirParts = posixPath.split('/');
  dirParts.pop();
  const fromDir = dirParts.join('/');
  return (target: string): string => {
    const hashIdx = target.indexOf('#');
    const pure = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
    if (!pure) return target;
    const resolved = resolveAssetPosix(fromDir, pure.replace(/\\/g, '/'));
    const candidates = [resolved, `${resolved}.md`, resolved.replace(/\.md$/i, '')];
    for (const c of candidates) {
      const url = assetByPath.get(c);
      if (url !== undefined) return url;
    }
    return target;
  };
}

const BASE_CSS =
  'body{font-family:var(--tpl-font),system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#222}header{margin-bottom:2rem;border-bottom:1px solid #eee;padding-bottom:1rem}a{color:var(--tpl-accent)}pre{background:#f6f8fa;padding:1rem;border-radius:6px;overflow-x:auto}code{background:#f1f5f9;padding:.15em .35em;border-radius:4px;font-size:.92em}pre code{background:transparent;padding:0}blockquote{border-left:3px solid #d1d5db;padding-left:1rem;color:#6b7280;margin:1rem 0}h1,h2,h3{line-height:1.35}' +
  // 站点搜索框（OPEN-API-MCP-DESIGN D1：发布模板检索入口）
  '.site-search{position:relative;margin:0 0 1rem}.site-search input{width:100%;box-sizing:border-box;padding:.5rem .75rem;border:1px solid #e2e8f0;border-radius:8px;font-size:.95rem;font-family:inherit}.site-search input:focus{outline:2px solid var(--tpl-accent);outline-offset:-1px}.ss-results{position:absolute;z-index:9;left:0;right:0;top:calc(100% + 4px);background:#fff;border:1px solid #e2e8f0;border-radius:8px;max-height:60vh;overflow:auto;box-shadow:0 8px 24px rgba(15,23,42,.08)}.ss-item{display:block;padding:.55rem .75rem;border-bottom:1px solid #f1f5f9;text-decoration:none;color:#222}.ss-item:last-child{border-bottom:none}.ss-item:hover{background:#f8fafc}.ss-item strong{display:block;font-size:.9rem;color:var(--tpl-accent)}.ss-item span{display:block;font-size:.8rem;color:#64748b;margin-top:.15rem}.ss-empty{padding:.6rem .75rem;font-size:.85rem;color:#94a3b8}';

// 文档级排版补充（与应用内预览 prose-doc 同能力的发布侧版本）：
// GFM 表格（块级 + 横向滚动）、highlight.js github-light 令牌色、KaTeX/公式块、mermaid 容器
const DOC_CSS =
  'table{border-collapse:collapse;width:100%;display:block;overflow-x:auto;margin:1rem 0;font-size:.95em}th,td{border:1px solid #e2e8f0;padding:.45em .7em;text-align:left;vertical-align:top}th{background:#f8fafc;font-weight:600}tbody tr:nth-child(2n){background:#fafafa}del,s{color:#94a3b8}img{max-width:100%}.hljs{color:#24292e;background:transparent}.hljs-comment,.hljs-quote{color:#6a737d;font-style:italic}.hljs-keyword,.hljs-selector-tag,.hljs-meta{color:#d73a49}.hljs-literal,.hljs-number,.hljs-built_in{color:#005cc5}.hljs-string,.hljs-doctag,.hljs-addition,.hljs-regexp{color:#032f62}.hljs-title,.hljs-section,.hljs-name,.hljs-selector-id,.hljs-selector-class{color:#6f42c1;font-weight:600}.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable{color:#e36209}.hljs-type,.hljs-class .hljs-title{color:#6f42c1}.hljs-deletion{color:#b31d28;background:#ffeef0}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:600}.katex{font-size:1.08em}.math-block{overflow-x:auto;margin:1rem 0}.mermaid-block{margin:1rem 0;text-align:center;overflow-x:auto}.mermaid-block svg{max-width:100%;height:auto}';

/** 发布页 head 按需注入：KaTeX 官方样式（含字体，经平台同源 vendor 路由） */
function headExtras(body: string): string {
  return hasKatexOutput(body) ? '\n  <link rel="stylesheet" href="/assets/vendor/katex/katex.min.css" />' : '';
}

/** 发布页尾按需注入：mermaid 占位渲染 loader（同源 ESM，内网/气隙可用） */
const MERMAID_LOADER = `
<script type="module">
try {
  const m = await import('/assets/vendor/mermaid/mermaid.esm.min.mjs');
  m.default.initialize({ startOnLoad: false, securityLevel: 'strict' });
  document.querySelectorAll('.mermaid-block').forEach((el) => {
    el.textContent = decodeURIComponent(el.dataset.mermaidCode ?? '');
  });
  await m.default.run({ querySelector: '.mermaid-block' });
} catch (e) {
  document.querySelectorAll('.mermaid-block').forEach((el) => {
    el.textContent = '流程图渲染失败：mermaid 资源加载不可用';
  });
}
</script>`;

function tailExtras(body: string): string {
  return hasMermaidBlock(body) ? MERMAID_LOADER : '';
}

/**
 * 站点搜索框（OPEN-API-MCP-DESIGN D1）：注入发布站每页 header 下方，检索开放面
 * /api/open/v1/sites/{slug}/search。结果链接按发布页命名规则（page-<path 压平 __>.html）
 * 由文档 path 前端换算；snippet/title 以 textContent 写入（防内容注入）。
 */
function searchBoxHtml(endpoint: string): string {
  const ep = escapeHtml(endpoint);
  return `<div class="site-search">
  <input id="ss-input" type="search" placeholder="搜索本站…" autocomplete="off" />
  <div id="ss-results" class="ss-results" hidden></div>
</div>
<script>
(function () {
  var input = document.getElementById('ss-input');
  var box = document.getElementById('ss-results');
  if (!input || !box) return;
  var timer = null;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    var q = input.value.trim();
    if (!q) { box.hidden = true; box.textContent = ''; return; }
    timer = setTimeout(function () {
      fetch('${ep}?q=' + encodeURIComponent(q))
        .then(function (r) { if (!r.ok) throw r.status; return r.json(); })
        .then(function (d) {
          box.textContent = '';
          var items = d.items || [];
          if (!items.length) {
            var empty = document.createElement('div');
            empty.className = 'ss-empty';
            empty.textContent = '未找到匹配内容';
            box.appendChild(empty);
          }
          items.forEach(function (it) {
            var a = document.createElement('a');
            a.className = 'ss-item';
            a.href = 'page-' + String(it.path || '').replace(/\\.(md|markdown)$/i, '').replace(/\\//g, '__') + '.html';
            var t = document.createElement('strong');
            t.textContent = it.title || it.path;
            a.appendChild(t);
            var sp = document.createElement('span');
            sp.textContent = String(it.snippet || '').replace(/<\\/?em>/g, '');
            a.appendChild(sp);
            box.appendChild(a);
          });
          box.hidden = false;
        })
        .catch(function (s) {
          box.textContent = '';
          var empty = document.createElement('div');
          empty.className = 'ss-empty';
          empty.textContent = '搜索暂不可用（' + s + '）';
          box.appendChild(empty);
          box.hidden = false;
        });
    }, 250);
  });
  document.addEventListener('click', function (e) {
    if (e.target !== input && !box.contains(e.target)) box.hidden = true;
  });
})();
</script>`;
}

function pageShell(title: string, body: string, opts: { accent: string; font: string; relativeRoot: string; headerHtml?: string; searchHtml?: string }): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>${headExtras(body)}
  <style>:root{--tpl-accent:${opts.accent};--tpl-font:${opts.font}}
  ${BASE_CSS}
  ${DOC_CSS}</style>
</head>
<body>
  ${opts.headerHtml ?? `<header><a href="${opts.relativeRoot}index.html">← 首页</a></header>`}
  ${opts.searchHtml ?? ''}
  <main>${body}</main>${tailExtras(body)}
</body>
</html>`;
}

/**
 * 发布全站装配：docs → [{index, page-*, style.css}] + 内容 hash。
 * 页面命名（page-<path 压平>.html）与 worker 历史产物一致，发布地址不因抽包改变。
 */
export function renderSite(input: {
  docs: SiteDocInput[];
  siteTitle: string;
  templateId?: string | null;
  /** 二进制资源映射（被 md 图片相对引用、需复制到站点 assets/ 的文档）；缺省 = 不改写图片地址 */
  assets?: SiteAsset[];
  /** 站点检索入口（开放面 D1）；缺省 = 不注入搜索框 */
  search?: { endpoint: string };
}): { pages: SitePage[]; hash: string } {
  const tpl = resolveTemplate(input.templateId);
  const pages: SitePage[] = [];
  const links: string[] = [];
  const searchHtml = input.search ? searchBoxHtml(input.search.endpoint) : '';

  const assetByPath = new Map<string, string>();
  for (const a of input.assets ?? []) assetByPath.set(a.path.replace(/\\/g, '/'), a.url);

  for (const d of input.docs) {
    const safeName = d.path.replace(/\.(md|markdown)$/i, '').replace(/[\\/]/g, '__');
    const pageName = `page-${safeName}.html`;
    const title = d.title ?? d.path;
    const body = markdownToHtml(d.content ?? '', { rewriteAsset: makeAssetRewriter(d.path, assetByPath) });
    pages.push({ rel: pageName, html: pageShell(title, body, { accent: tpl.accent, font: tpl.bodyFont, relativeRoot: '', searchHtml }) });
    links.push(`<li><a href="${pageName}">${escapeHtml(title)}</a></li>`);
  }

  const projectTitle = (input.docs[0]?.title ?? input.siteTitle) + ' — 全部页面';
  const indexHtml = pageShell(projectTitle, `<ul>${links.join('')}</ul>`, {
    accent: tpl.accent,
    font: tpl.bodyFont,
    relativeRoot: '',
    headerHtml: `<header><h1>${escapeHtml(input.siteTitle)}</h1></header>`,
    searchHtml,
  });
  pages.unshift({ rel: 'index.html', html: indexHtml });

  pages.push({ rel: 'style.css', html: `:root{--tpl-accent:${tpl.accent};--tpl-font:${tpl.bodyFont}}\n${BASE_CSS}\n${DOC_CSS}` });

  const concat = pages.map((p) => p.html).join('\n');
  // 与 worker 历史产物同口径：sha256 hex（publish_jobs.contentHash 消费方依赖该格式）
  const hash = createHash('sha256').update(concat).digest('hex');
  return { pages, hash };
}

// ---------------------------------------------------------------------------
// 预览单页（server publish-preview 专用；模板 chrome + accent/sidebar 可覆盖）
// ---------------------------------------------------------------------------

export interface DocPreviewInput {
  siteTitle: string;
  docPath: string;
  docTitle: string;
  content: string | null;
  navItems?: Array<{ title: string; active?: boolean }>;
}

export function renderDocPage(
  input: DocPreviewInput,
  opts?: {
    templateId?: string | null;
    accent?: string | null;
    sidebarSide?: 'left' | 'right' | null;
    /** 图片相对地址改写（预览侧目前不传，保持历史行为；预留与发布同源能力） */
    rewriteAsset?: MarkdownRenderOptions['rewriteAsset'];
  },
): string {
  const tpl = resolveTemplate(opts?.templateId);
  const accent = opts?.accent || tpl.accent;
  const side = opts?.sidebarSide || 'left';
  const contentHtml = markdownToHtml(input.content ?? '', { rewriteAsset: opts?.rewriteAsset });
  const nav = input.navItems ?? [{ title: input.docTitle, active: true }];

  const railItems = nav
    .map((n) => `<li${n.active ? ' class="active"' : ''}>${escapeHtml(n.title)}</li>`)
    .join('');
  const rail = `<aside class="tpl-rail"><div class="tpl-site">${escapeHtml(input.siteTitle)}</div><ul>${railItems}</ul></aside>`;

  let headerHtml: string;
  if (tpl.layout === 'hero') {
    headerHtml = `<div class="tpl-hero"><div class="tpl-site">${escapeHtml(input.siteTitle)}</div><h1>${escapeHtml(input.docTitle)}</h1></div>`;
  } else if (tpl.layout === 'sidebar' || tpl.layout === 'sidebar-wide') {
    headerHtml = `<div class="tpl-layout ${side === 'right' ? 'tpl-reverse' : ''}">${rail}<main class="tpl-main"><article>${contentHtml}</article></main></div>`;
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(input.docTitle)}</title>${headExtras(contentHtml)}
  <style>:root{--tpl-accent:${accent};--tpl-font:${tpl.bodyFont}}
  ${TPL_CHROME_CSS}</style>
</head>
<body data-layout="sidebar">${headerHtml}${tailExtras(contentHtml)}</body>
</html>`;
  } else {
    headerHtml = `<header class="tpl-topbar"><span class="tpl-site">${escapeHtml(input.siteTitle)}</span></header><main><article>${contentHtml}</article></main>`;
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(input.docTitle)}</title>${headExtras(contentHtml)}
  <style>:root{--tpl-accent:${accent};--tpl-font:${tpl.bodyFont}}
  ${TPL_CHROME_CSS}</style>
</head>
<body data-layout="${escapeHtml(tpl.layout)}">${headerHtml}${tailExtras(contentHtml)}</body>
</html>`;
}

/** 预览页 chrome：基础排版 + 文档排版 + 模板版式（侧栏/hero/顶栏），accent 驱动高亮 */
const TPL_CHROME_CSS = `${BASE_CSS}
${DOC_CSS}
body{max-width:none;margin:0;padding:0}
.tpl-site{font-weight:700;color:var(--tpl-accent);letter-spacing:.01em}
.tpl-topbar{display:flex;align-items:center;gap:1rem;padding:.8rem 1.5rem;border-bottom:2px solid var(--tpl-accent)}
.tpl-topbar main,.tpl-layout{max-width:980px;margin:0 auto}
article{max-width:780px;margin:1.5rem auto;padding:0 1rem}
.tpl-hero{background:linear-gradient(135deg,var(--tpl-accent),color-mix(in srgb,var(--tpl-accent) 60%,#0f172a));color:#fff;padding:2.5rem 1.5rem;margin-bottom:1rem}
.tpl-hero .tpl-site{color:#fff;opacity:.85;font-size:.85rem;text-transform:uppercase;letter-spacing:.08em}
.tpl-hero h1{color:#fff;margin:.5rem 0 0}
.tpl-layout{display:flex;gap:0;min-height:100vh;align-items:stretch}
.tpl-layout.tpl-reverse{flex-direction:row-reverse}
.tpl-rail{flex:0 0 240px;border-right:1px solid #e5e7eb;padding:1.25rem 1rem;background:#fafafa}
.tpl-reverse .tpl-rail{border-right:none;border-left:1px solid #e5e7eb}
.tpl-rail ul{list-style:none;margin:1rem 0 0;padding:0}
.tpl-rail li{padding:.4rem .6rem;border-radius:6px;font-size:.9rem;color:#374151}
.tpl-rail li.active{background:color-mix(in srgb,var(--tpl-accent) 14%,transparent);color:var(--tpl-accent);font-weight:600}
.tpl-main{flex:1;min-width:0}`;
