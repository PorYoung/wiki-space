// ---------------------------------------------------------------------------
// P5 补单测：shared/filter —— 前端筛选纯函数
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  computeFacetCounts,
  docMatchesFacet,
  docMatchesKeyword,
  docPassesFilter,
  fileNameOfPath,
  folderHasMatch,
  isKeepPlaceholder,
  type FilterTreeNode,
} from './filter.js';

describe('fileNameOfPath / isKeepPlaceholder', () => {
  it('从路径取 basename', () => {
    expect(fileNameOfPath('a/b/c.md')).toBe('c.md');
    expect(fileNameOfPath('README.md')).toBe('README.md');
  });
  it('.keep 占位识别', () => {
    expect(isKeepPlaceholder('.keep')).toBe(true);
    expect(isKeepPlaceholder('dir/.keep')).toBe(true);
    expect(isKeepPlaceholder('real.md')).toBe(false);
  });
});

describe('docMatchesFacet', () => {
  it("facet='all' 恒命中", () => {
    expect(docMatchesFacet('any.txt', null, 'all')).toBe(true);
    expect(docMatchesFacet('no-such-ext.xyz', null, 'all')).toBe(true);
  });
  it('按扩展名精确匹配', () => {
    expect(docMatchesFacet('a.md', null, 'markdown')).toBe(true);
    expect(docMatchesFacet('a.md', null, 'code')).toBe(false);
    expect(docMatchesFacet('a.ts', null, 'code')).toBe(true);
    expect(docMatchesFacet('a.png', null, 'image')).toBe(true);
    expect(docMatchesFacet('a.pdf', null, 'pdf')).toBe(true);
  });
  it('未知扩展名 → binary', () => {
    expect(docMatchesFacet('a.xyz', null, 'binary')).toBe(true);
    expect(docMatchesFacet('a.xyz', null, 'code')).toBe(false);
  });
});

describe('docMatchesKeyword', () => {
  it('空 kw 恒 true', () => {
    expect(docMatchesKeyword('x.md', 'T', '')).toBe(true);
  });
  it('.keep 占位不参与搜索', () => {
    expect(docMatchesKeyword('.keep', '', 'k')).toBe(false);
  });
  it('path / title / basename 任一包含即命中（大小写不敏感）', () => {
    expect(docMatchesKeyword('guides/start.md', null, 'start')).toBe(true);
    expect(docMatchesKeyword('guides/start.md', null, 'START')).toBe(true);
    expect(docMatchesKeyword('a.md', '设计文档', '设计')).toBe(true);
    expect(docMatchesKeyword('deep/nested/readme.md', null, 'README')).toBe(true);
  });
});

describe('docPassesFilter', () => {
  it('无筛选条件：任何文档通过', () => {
    expect(docPassesFilter('a.md', null, 'T', '', 'all')).toBe(true);
    expect(docPassesFilter('.keep', null, '', '', 'all')).toBe(true); // .keep 在空筛选下可见
  });

  it('.keep 在 facet 或 kw 存在时一律隐藏', () => {
    expect(docPassesFilter('.keep', null, '', '', 'markdown')).toBe(false);
    expect(docPassesFilter('.keep', null, '', 'k', 'all')).toBe(false);
    expect(docPassesFilter('.keep', null, '', 'k', 'markdown')).toBe(false);
  });

  it('facet × keyword AND 组合', () => {
    expect(docPassesFilter('readme.md', null, 'Readme', 'readme', 'markdown')).toBe(true);
    expect(docPassesFilter('readme.md', null, 'Readme', 'readme', 'code')).toBe(false); // facet 不命中
    expect(docPassesFilter('readme.md', null, 'Readme', 'xxxx', 'markdown')).toBe(false); // kw 不命中
  });
});

describe('folderHasMatch', () => {
  function makeNode(name: string, docs: FilterTreeNode['docs'] = [], children: Record<string, FilterTreeNode> = {}): FilterTreeNode {
    return { name, docs, children: new Map(Object.entries(children)) };
  }

  it('空筛选（无 kw + all）返回 true', () => {
    const root = makeNode('root', [{ path: 'a.md' }]);
    expect(folderHasMatch(root, '', 'all')).toBe(true);
  });

  it('文件夹名包含关键字即命中', () => {
    const root = makeNode('guides', [], { sub: makeNode('intro', [{ path: 'a.md' }]) });
    expect(folderHasMatch(root, 'intro', 'all')).toBe(true);
  });

  it('子树递归命中', () => {
    const root = makeNode('root', [], {
      a: makeNode('a', [{ path: 'a.md' }], { b: makeNode('b', [{ path: 'deep/code.ts' }]) }),
    });
    expect(folderHasMatch(root, 'code', 'code')).toBe(true);
    expect(folderHasMatch(root, 'code', 'markdown')).toBe(false);
  });

  it('全部未命中返回 false', () => {
    const root = makeNode('root', [{ path: 'a.md' }], { b: makeNode('b', [{ path: 'c.txt' }]) });
    expect(folderHasMatch(root, 'zzz', 'all')).toBe(false);
    expect(folderHasMatch(root, '', 'image')).toBe(false); // 无 image 文件
  });
});

describe('computeFacetCounts', () => {
  it('空列表全 0', () => {
    expect(computeFacetCounts([])).toEqual({
      all: 0, markdown: 0, code: 0, image: 0, pdf: 0, binary: 0,
    });
  });

  it('按扩展名统计，.keep 不计入', () => {
    const docs = [
      { path: 'a.md' },
      { path: 'b.md' },
      { path: 'c.ts' },
      { path: 'd.png' },
      { path: '.keep' },
      { path: 'x.pdf' },
      { path: 'unknown.xyz' },
    ];
    const c = computeFacetCounts(docs);
    expect(c.all).toBe(6); // 排除 .keep
    expect(c.markdown).toBe(2);
    expect(c.code).toBe(1);
    expect(c.image).toBe(1);
    expect(c.pdf).toBe(1);
    expect(c.binary).toBe(1); // .xyz
  });

  it('mime 兜底：未知扩展名 + text/* mime → code', () => {
    const c = computeFacetCounts([
      { path: 'weird.ext', mime: 'text/plain' },
    ]);
    expect(c.code).toBe(1);
    expect(c.binary).toBe(0);
  });
});
