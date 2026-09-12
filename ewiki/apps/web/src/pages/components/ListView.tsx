import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  FileQuestion,
  Search,
} from 'lucide-react';
import { fileIconOf } from '../../tree/fileIcons';

// ---------------------------------------------------------------------------
// Row type — 与 BrowsePage.DocumentListItem 同构，就地定义避免跨页 import 耦合
// ---------------------------------------------------------------------------

export interface ListRow {
  id: string;
  path: string;
  title: string | null;
  kind?: string;
  ext?: string | null;
  mime?: string | null;
  size?: number;
  updatedBy: string | null;
  updatedAt: string;
  status: 'untracked' | 'synced' | 'modified' | 'conflict';
}

// ---------------------------------------------------------------------------
// Helpers — 与 BrowsePage 内联实现保持一致
// ---------------------------------------------------------------------------

function fileNameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

function folderOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '刚刚';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs} 小时前`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;
  return `${Math.floor(diffDays / 30)} 个月前`;
}

function avatarColor(name: string | null | undefined): string {
  const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];
  let h = 0;
  for (let i = 0; i < (name ?? '').length; i++) h = (h * 31 + name!.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length]!;
}

function formatSize(bytes?: number | null): string {
  if (bytes == null || bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ListViewProps {
  /** 当前筛选后的全量文档（.keep 占位应已在调用方过滤） */
  docs: ListRow[];
  onSelect: (d: ListRow) => void;
  /** 右键 / 更多操作；事件来自行或空区 */
  onMenu: (e: React.MouseEvent, d: ListRow) => void;
  /** 当前搜索关键词 — 用于空态文案区分「全部为空」vs「搜索无结果」 */
  keyword: string;
  page: number;
  onPageChange: (p: number) => void;
  pageSize?: number;
  loading?: boolean;
}

const DEFAULT_PAGE_SIZE = 50;

export function ListView({
  docs,
  onSelect,
  onMenu,
  keyword,
  page,
  onPageChange,
  pageSize = DEFAULT_PAGE_SIZE,
  loading = false,
}: ListViewProps): React.ReactElement {
  const total = docs.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // 保护：外部 page 可能超出 totalPages（如筛选后总数变小），裁剪到有效范围
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const rows = docs.slice(startIdx, startIdx + pageSize);

  // 页码按钮渲染 — 最多展示 7 个（首、省略、中间 range、省略、尾）
  const pageNumbers = ((): (number | 'ellipsis')[] => {
    const max = 7;
    if (totalPages <= max) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const out: (number | 'ellipsis')[] = [];
    const window = 1; // 当前页两侧保留的页码数
    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= safePage - window && i <= safePage + window)
      ) {
        out.push(i);
      } else if (out[out.length - 1] !== 'ellipsis') {
        out.push('ellipsis');
      }
    }
    return out;
  })();

  // -------------------------------------------------------------------------
  // 行渲染
  // -------------------------------------------------------------------------
  const renderRow = (d: ListRow, idx: number): React.ReactElement => {
    const { Icon: DocIcon, className: iconClass } = fileIconOf(d.path, d.mime);
    const authorName = d.updatedBy ?? '未知';
    // 斑马纹（奇数行）
    const zebraBg = idx % 2 === 0 ? '' : 'bg-neutral-50/60 dark:bg-neutral-900/40';

    return (
      <tr
        key={d.id}
        role="button"
        tabIndex={0}
        draggable={false}
        onClick={() => onSelect(d)}
        onContextMenu={(e) => onMenu(e, d)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(d);
          }
        }}
        className={`group h-10 cursor-pointer border-b transition-colors hover:bg-primary-50/70 dark:hover:bg-primary-900/20 ${zebraBg}`}
        style={{ borderColor: 'var(--border-soft)' }}
      >
        {/* 文件名 + 类型图标 */}
        <td className="px-3">
          <div className="flex items-center gap-2 min-w-0">
            <DocIcon size={14} className={`${iconClass} shrink-0`} />
            <div className="min-w-0">
              <div
                className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200"
                title={d.title ? `${d.title}（${fileNameOf(d.path)}）` : fileNameOf(d.path)}
              >
                {d.title ?? fileNameOf(d.path)}
              </div>
              {folderOf(d.path) && (
                <div className="truncate text-[11px] text-neutral-400 font-mono">
                  /{folderOf(d.path)}
                </div>
              )}
            </div>
          </div>
        </td>

        {/* 类型（图标 + 文字） */}
        <td className="px-3">
          <span className={`inline-flex items-center gap-1 text-xs ${iconClass}`}>
            <DocIcon size={12} />
            <span className="text-neutral-600 dark:text-neutral-400">
              {resolveTypeLabel(d)}
            </span>
          </span>
        </td>

        {/* 大小 */}
        <td className="px-3 text-xs text-neutral-500 font-mono w-20">
          {formatSize(d.size)}
        </td>

        {/* 最后修改时间 */}
        <td className="px-3 text-xs text-neutral-500 w-28 whitespace-nowrap">
          <span className="inline-flex items-center gap-1">
            <Clock size={11} />
            {relativeTime(d.updatedAt)}
          </span>
        </td>

        {/* 修改人 */}
        <td className="px-3">
          <div className="flex items-center gap-1.5 max-w-[140px]">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
              style={{ background: avatarColor(authorName) }}
            >
              {authorName.slice(0, 1).toUpperCase()}
            </div>
            <span className="truncate text-xs text-neutral-600 dark:text-neutral-400">
              {authorName}
            </span>
          </div>
        </td>
      </tr>
    );
  };

  // -------------------------------------------------------------------------
  // 空态
  // -------------------------------------------------------------------------
  const renderEmpty = (): React.ReactElement => (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      {loading ? (
        <>
          <div className="skeleton h-10 w-10 rounded-full mb-3" />
          <div className="skeleton h-4 w-24 mb-2" />
          <div className="skeleton h-3 w-40" />
        </>
      ) : keyword ? (
        <>
          <Search size={36} className="text-neutral-300 mb-3" />
          <p className="text-sm text-neutral-500">没有找到匹配的文档</p>
          <p className="text-xs text-neutral-400 mt-1">换个关键词试试，或清除筛选条件</p>
        </>
      ) : (
        <>
          <FileQuestion size={36} className="text-neutral-300 mb-3" />
          <p className="text-sm text-neutral-500">当前筛选无结果</p>
          <p className="text-xs text-neutral-400 mt-1">修改类型筛选或返回查看全部文档</p>
        </>
      )}
    </div>
  );

  // -------------------------------------------------------------------------
  // 分页控件
  // -------------------------------------------------------------------------
  const renderPagination = (): React.ReactElement | null => {
    if (total <= pageSize) return null;

    const goto = (p: number): void => {
      const clamped = Math.min(Math.max(1, p), totalPages);
      if (clamped !== safePage) onPageChange(clamped);
    };

    const pageBtnCls = (active: boolean): string =>
      `min-w-[28px] h-7 px-2 inline-flex items-center justify-center rounded-md text-xs transition ${
        active
          ? 'bg-primary-50 text-primary-700 font-medium'
          : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
      }`;

    return (
      <div
        className="shrink-0 flex items-center justify-between px-4 py-2 border-t text-xs"
        style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface)' }}
      >
        <span className="text-neutral-500">
          共 <span className="font-medium text-neutral-700">{total}</span> 条，
          第 <span className="font-medium text-neutral-700">{safePage}</span> /{' '}
          <span className="font-medium text-neutral-700">{totalPages}</span> 页
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goto(1)}
            disabled={safePage === 1}
            className={`${pageBtnCls(false)} disabled:opacity-40 disabled:cursor-not-allowed`}
            title="首页"
          >
            <ChevronsLeft size={12} />
          </button>
          <button
            type="button"
            onClick={() => goto(safePage - 1)}
            disabled={safePage === 1}
            className={`${pageBtnCls(false)} disabled:opacity-40 disabled:cursor-not-allowed`}
            title="上一页"
          >
            <ChevronLeft size={12} />
          </button>

          {pageNumbers.map((n, i) =>
            n === 'ellipsis' ? (
              <span key={`e-${i}`} className="px-1 text-neutral-400">…</span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => goto(n)}
                className={pageBtnCls(n === safePage)}
              >
                {n}
              </button>
            ),
          )}

          <button
            type="button"
            onClick={() => goto(safePage + 1)}
            disabled={safePage === totalPages}
            className={`${pageBtnCls(false)} disabled:opacity-40 disabled:cursor-not-allowed`}
            title="下一页"
          >
            <ChevronRight size={12} />
          </button>
          <button
            type="button"
            onClick={() => goto(totalPages)}
            disabled={safePage === totalPages}
            className={`${pageBtnCls(false)} disabled:opacity-40 disabled:cursor-not-allowed`}
            title="末页"
          >
            <ChevronsRight size={12} />
          </button>
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // 主渲染
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin">
        {total === 0 ? (
          renderEmpty()
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr
                className="h-9 text-xs text-neutral-500 font-medium border-b"
                style={{
                  background: 'var(--bg-surface)',
                  borderColor: 'var(--border-soft)',
                }}
              >
                <th className="px-3 text-left w-[36%]">文件名</th>
                <th className="px-3 text-left w-24">类型</th>
                <th className="px-3 text-left">大小</th>
                <th className="px-3 text-left">最后修改</th>
                <th className="px-3 text-left">修改人</th>
              </tr>
            </thead>
            <tbody>{rows.map((d, i) => renderRow(d, i))}</tbody>
          </table>
        )}
      </div>
      {renderPagination()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 类型标签 — 文件名推断（不依赖 shared 的 resolveFileType 也能给出可读性 label）
// ---------------------------------------------------------------------------
function resolveTypeLabel(d: ListRow): string {
  const ext = d.ext ?? (() => {
    const i = d.path.lastIndexOf('.');
    return i >= 0 ? d.path.slice(i + 1).toLowerCase() : null;
  })();
  if (!ext) return '文件';
  const m: Record<string, string> = {
    md: 'Markdown',
    mdx: 'Markdown',
    txt: '文本',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    ts: 'TypeScript',
    tsx: 'TSX',
    js: 'JavaScript',
    jsx: 'JSX',
    py: 'Python',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    css: 'CSS',
    scss: 'SCSS',
    html: 'HTML',
    xml: 'XML',
    svg: 'SVG',
    png: 'PNG',
    jpg: 'JPG',
    jpeg: 'JPG',
    gif: 'GIF',
    pdf: 'PDF',
    csv: 'CSV',
  };
  return m[ext] ?? ext.toUpperCase();
}
