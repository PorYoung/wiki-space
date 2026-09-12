import { describe, expect, it } from 'vitest';
import { extractDocLinks } from './links.js';

const doc = (id: string, path: string, content: string | null) => ({ id, path, content });

describe('extractDocLinks', () => {
  const docs = [
    doc('a', 'README.md', null),
    doc('b', 'guides/start.md', null),
    doc('c', 'architecture/overview.md', null),
  ];

  it('解析相对 .md 链接为内部边', () => {
    const out = extractDocLinks([...docs, doc('x', 'home.md', '见 [指南](guides/start.md)')]);
    expect(out).toContainEqual({ fromDocumentId: 'x', toDocumentId: 'b', externalUrl: null, broken: false });
  });

  it('相对路径按 from 文档目录 resolve（含 ../）', () => {
    const out = extractDocLinks([
      ...docs,
      doc('x', 'guides/next.md', '回 [首页](../README.md)，看 [架构](../architecture/overview.md)'),
    ]);
    expect(out.filter((l) => l.fromDocumentId === 'x').map((l) => l.toDocumentId).sort()).toEqual(['a', 'c']);
    expect(out.filter((l) => l.fromDocumentId === 'x').every((l) => !l.broken)).toBe(true);
  });

  it('无 .md 后缀与带锚点链接可匹配', () => {
    const out = extractDocLinks([...docs, doc('x', 'home.md', '[指南](guides/start#步骤) [架](architecture/overview)')]);
    expect(out.filter((l) => l.fromDocumentId === 'x').map((l) => l.toDocumentId).sort()).toEqual(['b', 'c']);
  });

  it('http 链接归为外链，不产生 broken', () => {
    const out = extractDocLinks([doc('x', 'README.md', '[官网](https://example.com) [邮件](mailto:a@b.c)')]);
    expect(out.every((l) => l.externalUrl && !l.broken && l.toDocumentId === null)).toBe(true);
  });

  it('页内锚点与空目标被忽略', () => {
    const out = extractDocLinks([doc('x', 'README.md', '[跳转](#section) [空]()')]);
    expect(out).toEqual([]);
  });

  it('目标不存在标记 broken', () => {
    const out = extractDocLinks([doc('x', 'README.md', '[幽灵](ghost.md)')]);
    expect(out).toEqual([{ fromDocumentId: 'x', toDocumentId: null, externalUrl: null, broken: true }]);
  });

  it('图片语法 ![alt](t) 不算链接', () => {
    const out = extractDocLinks([doc('x', 'README.md', '![封面](cover.png)')]);
    expect(out).toEqual([]);
  });

  it('同一目标去重', () => {
    const out = extractDocLinks([doc('x', 'README.md', '[a](guides/start.md) [b](guides/start.md)')]);
    expect(out).toHaveLength(1);
  });

  it('空内容/空集安全', () => {
    expect(extractDocLinks([])).toEqual([]);
    expect(extractDocLinks([doc('x', 'a.md', null)])).toEqual([]);
  });

  it('默认不抽图片边（向后兼容）', () => {
    const out = extractDocLinks([
      doc('x', 'README.md', '![封面](assets/cover.png)'),
      doc('i', 'assets/cover.png', null),
    ]);
    expect(out).toEqual([]);
  });

  it('includeImages 时图片解析为内部图片边（精确路径优先）', () => {
    const out = extractDocLinks(
      [
        doc('x', 'guides/start.md', '![封面](../assets/cover.png)'),
        doc('i', 'assets/cover.png', null),
      ],
      { includeImages: true },
    );
    expect(out).toEqual([
      { fromDocumentId: 'x', toDocumentId: 'i', externalUrl: null, broken: false, image: true },
    ]);
  });

  it('includeImages 时缺失图片标记 broken 图片边', () => {
    const out = extractDocLinks([doc('x', 'README.md', '![幽灵](assets/missing.png)')], {
      includeImages: true,
    });
    expect(out).toEqual([
      { fromDocumentId: 'x', toDocumentId: null, externalUrl: null, broken: true, image: true },
    ]);
  });

  it('图片与普通链接指向同一目标时各自成边', () => {
    const out = extractDocLinks(
      [
        doc('x', 'README.md', '[链接](assets/cover.png) ![图片](assets/cover.png)'),
        doc('i', 'assets/cover.png', null),
      ],
      { includeImages: true },
    );
    expect(out).toHaveLength(2);
    expect(out.filter((l) => l.image)).toHaveLength(1);
  });
});
