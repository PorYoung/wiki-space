// ---------------------------------------------------------------------------
// 纯函数：前端筛选/分组（从 web/BrowsePage.tsx 提取，shared 包复用）
// P5 补单测（见同目录 filter.test.ts）
// ---------------------------------------------------------------------------

import { basenameOf, resolveFileType, type ResolvedFileType } from './filetypes.js';

/** 文件类型 id（从 ResolvedFileType.typeId 提取） */
export type FileTypeId = ResolvedFileType['typeId'];

/** 筛选 facet：'all' 为全部，其余与 shared typeId 一一对应 */
export type FileFacetId = 'all' | FileTypeId;

/** .keep 占位文件识别（前端弱化显示 / 默认搜索隐藏） */
export function fileNameOfPath(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** 是否为 .keep 占位 */
export function isKeepPlaceholder(path: string): boolean {
  return fileNameOfPath(path) === '.keep';
}

/** 文档是否命中类型 facet */
export function docMatchesFacet(path: string, mime: string | null | undefined, facet: FileFacetId): boolean {
  if (facet === 'all') return true;
  return resolveFileType(path, mime).typeId === facet;
}

/**
 * 文档是否命中关键字搜索。
 * - path / title / basename 任一包含（小写）
 * - .keep 占位不参与搜索
 */
export function docMatchesKeyword(
  path: string,
  title: string | null | undefined,
  kw: string,
): boolean {
  if (!kw) return true;
  if (isKeepPlaceholder(path)) return false;
  const lower = kw.toLowerCase();
  return (
    path.toLowerCase().includes(lower) ||
    (title ?? '').toLowerCase().includes(lower) ||
    (path.split('/').pop() ?? '').toLowerCase().includes(lower)
  );
}

/**
 * 文档是否通过「类型 facet × 关键字」AND 组合筛选。
 * .keep 在「无 facet 无关键字」时视为通过，其余情况一律隐藏。
 */
export function docPassesFilter(
  path: string,
  mime: string | null | undefined,
  title: string | null | undefined,
  kw: string,
  facet: FileFacetId,
): boolean {
  if (isKeepPlaceholder(path) && (!!kw || facet !== 'all')) return false;
  if (!docMatchesFacet(path, mime, facet)) return false;
  return docMatchesKeyword(path, title, kw);
}

/** 树节点（纯结构，不带 React） */
export interface FilterTreeNode {
  name: string;
  docs: Array<{ path: string; mime?: string | null; title?: string | null }>;
  children: Map<string, FilterTreeNode>;
}

/**
 * 文件夹（递归）是否命中筛选：
 * - 空筛选（无 kw + facet=all）一律命中
 * - 文件夹名包含关键字 → 命中
 * - 自身 docs 或子树命中 → 命中
 */
export function folderHasMatch(node: FilterTreeNode, kw: string, facet: FileFacetId): boolean {
  if (!kw && facet === 'all') return true;
  if (kw && node.name.toLowerCase().includes(kw.toLowerCase())) return true;
  if (
    node.docs.some((d) =>
      docPassesFilter(d.path, d.mime ?? null, d.title ?? null, kw, facet),
    )
  )
    return true;
  return Array.from(node.children.values()).some((ch) => folderHasMatch(ch, kw, facet));
}

/**
 * facetCounts：从文档列表统计各类型数量。
 * 口径与 BrowsePage 前端一致：.keep 占位不计入任何桶。
 */
export function computeFacetCounts(
  docs: Array<{ path: string; mime?: string | null }>,
): Record<FileFacetId, number> {
  const counts: Record<FileFacetId, number> = {
    all: 0,
    markdown: 0,
    code: 0,
    image: 0,
    pdf: 0,
    binary: 0,
  };
  for (const d of docs) {
    if (basenameOf(d.path) === '.keep') continue;
    counts.all += 1;
    counts[resolveFileType(d.path, d.mime).typeId] += 1;
  }
  return counts;
}
