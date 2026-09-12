// @ewiki/render 渲染管线冒烟测试（发布侧与应用内预览同源验证）
// 运行：node node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/cli.mjs scripts/render-smoke.mjs
import { markdownToHtml } from '../packages/render/src/markdown.ts';
import { renderDocPage, renderSite } from '../packages/render/src/index.ts';

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const md = [
  '# 标题一',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '行内公式 $E=mc^2$ 测试。',
  '',
  '$$',
  '\\int_0^1 x dx',
  '$$',
  '',
  '```mermaid',
  'graph TD; A-->B;',
  '```',
  '',
  '~~删除线~~ 与 [链接](https://example.com)',
].join('\n');

const html = markdownToHtml(md);
check('GFM 表格渲染为 <table>', html.includes('<table') && html.includes('<th'));
check('代码高亮 hljs 类', html.includes('hljs') && html.includes('hljs-keyword'));
check('行内公式 KaTeX', html.includes('class="katex"'));
check('块级公式 math-block', html.includes('math-block'));
check('mermaid 占位容器', html.includes('mermaid-block') && html.includes(encodeURIComponent('graph TD; A-->B;')));
check('标题带 slugify id', html.includes('<h1 id="标题一">'));
check('删除线 <s>', html.includes('<s>'));
check('外链 target=_blank', html.includes('target="_blank"'));
check('原始 HTML 被转义', !markdownToHtml('<img src=x onerror=alert(1)>').includes('<img'));

const page = renderDocPage(
  { siteTitle: '冒烟站', docPath: 'a.md', docTitle: '冒烟文档', content: md },
  { templateId: 't-docs' },
);
check('预览页按需注入 KaTeX 样式', page.includes('/assets/vendor/katex/katex.min.css'));
check('预览页按需注入 mermaid loader', page.includes('/assets/vendor/mermaid/mermaid.esm.min.mjs'));
const plainPage = renderDocPage({ siteTitle: 's', docPath: 'b.md', docTitle: '纯文本', content: '# hi' });
check('纯文本页不注入 vendor 资源', !plainPage.includes('/assets/vendor/'));

const site = renderSite({ docs: [{ path: 'README.md', title: 'R', content: md }], siteTitle: '站点', templateId: 't-docs' });
const indexPage = site.pages.find((p) => p.rel === 'index.html');
const docPage = site.pages.find((p) => p.rel === 'page-README.html');
check('发布装配含 index 与文档页', !!indexPage && !!docPage);
check('发布文档页注入 KaTeX/mermaid', !!docPage && docPage.html.includes('vendor/katex') && docPage.html.includes('mermaid.esm.min.mjs'));
check('发布含 style.css 且带 DOC_CSS', site.pages.some((p) => p.rel === 'style.css' && p.html.includes('.mermaid-block')));
check('hash 为 sha256 hex', /^[0-9a-f]{64}$/.test(site.hash));

console.log(`\n===== 渲染冒烟：${pass}/${pass + fail} 通过 =====`);
process.exit(fail === 0 ? 0 : 1);
