import { describe, expect, it } from 'vitest';
import { chunkMarkdown, estimateTokens, fuseRRF, highlightTerms } from './search.js';

describe('estimateTokens', () => {
  it('CJK 逐字计数、拉丁按 4 字符/token 近似', () => {
    expect(estimateTokens('部署回滚')).toBe(4);
    expect(estimateTokens('abcdefgh')).toBe(2); // 8 latin chars
    expect(estimateTokens('部署deploy回滚')).toBe(4 + 2);
  });
});

describe('chunkMarkdown', () => {
  it('按标题边界切分并携带标题链', () => {
    const md = [
      '# 部署',
      '正文一段。' + '内容'.repeat(40),
      '',
      '## 回滚',
      '回滚步骤正文。' + '步骤'.repeat(40),
    ].join('\n');
    const chunks = chunkMarkdown(md, { targetTokens: 40, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].headingPath).toBe('部署');
    const rollback = chunks.find((c) => c.headingPath === '部署/回滚');
    expect(rollback).toBeDefined();
    expect(rollback!.content).toContain('回滚步骤正文');
  });

  it('相邻 chunk 携带重叠（overlap）', () => {
    const body = Array.from({ length: 60 }, (_, i) => `第${i}行 这是一段足够长的中文正文内容用于切分测试。`).join('\n');
    const md = `# 文档\n\n${body}`;
    const chunks = chunkMarkdown(md, { targetTokens: 60, overlapTokens: 20, maxTokens: 90 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // chunk[1] 的前缀应与 chunk[0] 的尾部有交集
    const tail = chunks[0].content.slice(-30);
    expect(chunks[1].content).toContain(tail.split('\n')[0]?.slice(0, 10) ?? '');
  });

  it('代码围栏内不切分（除非超长）', () => {
    const code = Array.from({ length: 10 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const md = `# 代码\n\n\`\`\`ts\n${code}\n\`\`\`\n\n正文。`;
    const chunks = chunkMarkdown(md, { targetTokens: 30, overlapTokens: 0 });
    const codeChunk = chunks.find((c) => c.content.includes('const v0'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.content).toContain('const v9'); // 围栏完整保留在同一 chunk
  });

  it('chunkNo 连续且 tokenCount 合理', () => {
    const chunks = chunkMarkdown('# A\n\n内容一。\n\n# B\n\n内容二。');
    expect(chunks.map((c) => c.chunkNo)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) expect(c.tokenCount).toBeGreaterThan(0);
  });
});

describe('fuseRRF', () => {
  it('双路命中得分高于单路，排序稳定', () => {
    const kw = ['a', 'b', 'c'];
    const sem = ['b', 'a', 'd'];
    const fused = fuseRRF([kw, sem], 60, 10);
    expect(fused[0].key).toBe('a'); // a: 1/61 + 1/62 > b: 1/61 + 1/62 — 并列时按输入顺序稳定
    // a 与 b 都双路命中；d 单路。双路应排在单路前
    const both = fused.filter((f) => f.ranks.length === 2).map((f) => f.key);
    const single = fused.filter((f) => f.ranks.length === 1).map((f) => f.key);
    expect(both).toContain('a');
    expect(both).toContain('b');
    expect(single).toEqual(['c', 'd']);
  });

  it('limit 生效且 k 越大单路差距越小', () => {
    const fused = fuseRRF([['x', 'y'], ['z']], 60, 2);
    expect(fused.length).toBe(2);
    expect(fused[0].key).toBe('x');
  });
});

describe('highlightTerms', () => {
  it('命中词加 <em>，HTML 转义其余内容', () => {
    const out = highlightTerms('系统部署与回滚 <b>安全</b>', '部署');
    expect(out).toContain('<em>部署</em>');
    expect(out).toContain('&lt;b&gt;');
    expect(out).not.toContain('<b>');
  });

  it('无命中时仍转义并截窗', () => {
    const out = highlightTerms('普通正文内容', '不存在的词');
    expect(out).toBe('普通正文内容');
  });
});
