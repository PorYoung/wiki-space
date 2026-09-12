import {
  File,
  FileCode2,
  FileText,
  FileType,
  Image as ImageIcon,
  type LucideIcon,
} from 'lucide-react';
import { resolveFileType, type ResolvedFileType } from '@ewiki/shared';

// 全仓唯一的类型图标映射（文件管理重构 §3.2/§6.2）：
// 类型判定权威在 shared 的 resolveFileType（按扩展名注册表 + mime 兜底），
// lucide 是前端依赖，图标只在 web 侧按 typeId 映射这一份。

export type FileTypeId = ResolvedFileType['typeId'];

/** 类型筛选 facet：'all' 为全部，其余值与 shared typeId 一一对应（§3.2） */
export type FileFacetId = 'all' | FileTypeId;

export const FILE_FACETS: ReadonlyArray<{ id: FileFacetId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'markdown', label: '文档' },
  { id: 'code', label: '代码' },
  { id: 'image', label: '图片' },
  { id: 'pdf', label: 'PDF' },
  { id: 'binary', label: '其他' },
];

export const FILE_ICON_MAP: Record<FileTypeId, { Icon: LucideIcon; className: string }> = {
  markdown: { Icon: FileText, className: 'text-sky-500' },
  code: { Icon: FileCode2, className: 'text-violet-500' },
  image: { Icon: ImageIcon, className: 'text-emerald-500' },
  pdf: { Icon: FileType, className: 'text-rose-500' },
  binary: { Icon: File, className: 'text-neutral-400' },
};

export function fileIconOf(path: string, mime?: string | null): { Icon: LucideIcon; className: string } {
  const typeId = resolveFileType(path, mime).typeId;
  return FILE_ICON_MAP[typeId] ?? FILE_ICON_MAP.binary;
}

/** 文档是否命中类型 facet（'all' 恒命中；判定一律走 shared resolveFileType，禁止自写扩展名表） */
export function docMatchesFacet(path: string, mime: string | null | undefined, facet: FileFacetId): boolean {
  if (facet === 'all') return true;
  return resolveFileType(path, mime).typeId === facet;
}
