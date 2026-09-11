// ---------------------------------------------------------------------------
// @ewiki/render —— 发布渲染单一事实源（EXT-PLATFORM-PLAN ADR-P2）
//   worker（发布：异步全量、工件落盘）与 server（预览：同步按需、不落盘）
//   必须消费同一实现，保证「预览即所得」。纯函数包：入参即数据，不触 DB。
//   仅 server/worker 消费（Node 运行时，可用 node:crypto），前端不 import。
//   发布模板（t-docs 五套）是渲染参数而非五套渲染器；accent / sidebarSide
//   可被预览端点覆盖（PreviewModal 外观定制）。
//   边界：Markdown 常用子集（标题/段落/行内/代码块/引用/无序列表/链接），
//   表格等语法按纯文本透传——与 2026-09 前 worker 行为一致，不回退。
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Markdown → HTML（自 worker 迁移，逐行保持行为一致） */
export function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  const formatInline = (text: string): string =>
    text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过 closing ```
      out.push(
        `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(buf.join('\n'))}</code></pre>`,
      );
      continue;
    }

    // 空行 → 段落边界由 join 后的 <p> 自然处理
    if (!line.trim()) {
      i++;
      continue;
    }

    // 标题
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${formatInline(escapeHtml(h[2]))}</h${level}>`);
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(formatInline(escapeHtml(lines[i].replace(/^>\s?/, ''))));
        i++;
      }
      out.push(`<blockquote>${buf.join(' ')}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${formatInline(escapeHtml(lines[i].replace(/^[-*]\s+/, '')))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // 普通段落：收集连续非空非特殊行
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${formatInline(escapeHtml(buf.join(' ')))}</p>`);
  }

  return out.join('\n');
}

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

const BASE_CSS =
  'body{font-family:var(--tpl-font),system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#222}header{margin-bottom:2rem;border-bottom:1px solid #eee;padding-bottom:1rem}a{color:var(--tpl-accent)}pre{background:#f6f8fa;padding:1rem;border-radius:6px;overflow-x:auto}code{background:#f1f5f9;padding:.15em .35em;border-radius:4px;font-size:.92em}pre code{background:transparent;padding:0}blockquote{border-left:3px solid #d1d5db;padding-left:1rem;color:#6b7280;margin:1rem 0}h1,h2,h3{line-height:1.35}';

function pageShell(title: string, body: string, opts: { accent: string; font: string; relativeRoot: string; headerHtml?: string }): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>:root{--tpl-accent:${opts.accent};--tpl-font:${opts.font}}
  ${BASE_CSS}</style>
</head>
<body>
  ${opts.headerHtml ?? `<header><a href="${opts.relativeRoot}index.html">← 首页</a></header>`}
  <main>${body}</main>
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
}): { pages: SitePage[]; hash: string } {
  const tpl = resolveTemplate(input.templateId);
  const pages: SitePage[] = [];
  const links: string[] = [];

  for (const d of input.docs) {
    const safeName = d.path.replace(/\.(md|markdown)$/i, '').replace(/[\\/]/g, '__');
    const pageName = `page-${safeName}.html`;
    const title = d.title ?? d.path;
    const body = markdownToHtml(d.content ?? '');
    pages.push({ rel: pageName, html: pageShell(title, body, { accent: tpl.accent, font: tpl.bodyFont, relativeRoot: '' }) });
    links.push(`<li><a href="${pageName}">${escapeHtml(title)}</a></li>`);
  }

  const projectTitle = (input.docs[0]?.title ?? input.siteTitle) + ' — 全部页面';
  const indexHtml = pageShell(projectTitle, `<ul>${links.join('')}</ul>`, {
    accent: tpl.accent,
    font: tpl.bodyFont,
    relativeRoot: '',
    headerHtml: `<header><h1>${escapeHtml(input.siteTitle)}</h1></header>`,
  });
  pages.unshift({ rel: 'index.html', html: indexHtml });

  pages.push({ rel: 'style.css', html: `:root{--tpl-accent:${tpl.accent};--tpl-font:${tpl.bodyFont}}\n${BASE_CSS}` });

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
  opts?: { templateId?: string | null; accent?: string | null; sidebarSide?: 'left' | 'right' | null },
): string {
  const tpl = resolveTemplate(opts?.templateId);
  const accent = opts?.accent || tpl.accent;
  const side = opts?.sidebarSide || 'left';
  const contentHtml = markdownToHtml(input.content ?? '');
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
  <title>${escapeHtml(input.docTitle)}</title>
  <style>:root{--tpl-accent:${accent};--tpl-font:${tpl.bodyFont}}
  ${TPL_CHROME_CSS}</style>
</head>
<body data-layout="sidebar">${headerHtml}</body>
</html>`;
  } else {
    headerHtml = `<header class="tpl-topbar"><span class="tpl-site">${escapeHtml(input.siteTitle)}</span></header><main><article>${contentHtml}</article></main>`;
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(input.docTitle)}</title>
  <style>:root{--tpl-accent:${accent};--tpl-font:${tpl.bodyFont}}
  ${TPL_CHROME_CSS}</style>
</head>
<body data-layout="${escapeHtml(tpl.layout)}">${headerHtml}</body>
</html>`;
}

/** 预览页 chrome：基础排版 + 模板版式（侧栏/hero/顶栏），accent 驱动高亮 */
const TPL_CHROME_CSS = `${BASE_CSS}
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
