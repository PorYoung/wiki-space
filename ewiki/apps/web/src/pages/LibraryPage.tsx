import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  ArrowRight, ChevronLeft, ChevronRight, Clock, ExternalLink, EyeOff,
  FileText, Filter, FolderKanban, FolderOpen, FolderPlus, GitBranch, Globe, Grid3X3, HardDrive,
  LayoutGrid, List, Lock, RotateCcw, Search, SlidersHorizontal, Tag, Users, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch, fetchAllDocuments } from '../lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Visibility = 'private' | 'team' | 'public';
type DocStatus = 'untracked' | 'synced' | 'modified' | 'conflict';
type ViewMode = 'grid' | 'list';
type BrowseMode = 'flat' | 'project';
type Scope = 'mine' | 'explore';
type BackendKind = 'git' | 'local';

interface Project {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  visibility: Visibility;
  template?: string | null;
  ownerId?: string;
  storageKind?: BackendKind;
  updatedAt?: string;
}

interface LibraryDoc {
  id: string;
  projectId: string;
  path: string;
  title: string | null;
  status: DocStatus;
  tags: string[];
  wordCount?: number;
  updatedBy?: string | null;
  updatedAt?: string;
  // PLAN 3.4 残留：列表接口派生下发（routes.ts documentSummary）
  summary?: string | null;
}

interface TeamUser {
  id: string;
  name: string;
}

interface PublishSite {
  id: string;
  projectId: string;
  slug: string;
  addressMode: 'subdomain' | 'subpath';
  customDomain?: string | null;
}

interface ItemsResp<T> { items: T[]; }

// ---------------------------------------------------------------------------
// 常量与映射（对照原型 Library.jsx）
// ---------------------------------------------------------------------------

// 文档状态徽章四态语义标尺：synced=绿(健康) / modified=琥珀(待处理) / conflict=红(错误) /
// untracked=灰(初始默认态，降调处理)。旧实现 untracked 用 tag-primary(品牌绿)：
// 与「已同步」的 success 绿构成双绿混淆，且导入默认态不应用品牌色高亮；dot 与 FilterDrawer 状态点同源。
const STATUS_MAP: Record<DocStatus, { label: string; cls: string; dot: string }> = {
  synced: { label: '已同步', cls: 'tag-success', dot: 'bg-emerald-500' },
  modified: { label: '本地修改', cls: 'tag-warning', dot: 'bg-amber-500' },
  conflict: { label: '冲突', cls: 'tag-danger', dot: 'bg-red-500' },
  untracked: { label: '未跟踪', cls: 'tag-neutral', dot: 'bg-neutral-400' },
};

const TEMPLATE_LABEL: Record<string, string> = {
  docs: '标准文档',
  blog: '博客',
  wiki: '团队 Wiki',
  'product-site': '产品官网',
  'api-ref': 'API 参考',
  docs_hub: '文档中心',
  api_ref: 'API 参考',
  custom: '自定义',
};

const VISIBILITY_META: Record<Visibility, { label: string; Icon: LucideIcon; cls: string }> = {
  private: { label: '私有', Icon: Lock, cls: 'bg-neutral-100 text-neutral-600' },
  team: { label: '团队', Icon: Users, cls: 'bg-primary-50 text-primary-600' },
  public: { label: '公开', Icon: Globe, cls: 'bg-emerald-50 text-emerald-600' },
};

const BACKEND_ICON: Record<BackendKind, LucideIcon> = {
  git: GitBranch,
  local: HardDrive,
};

const BACKEND_LABEL: Record<BackendKind, string> = {
  git: 'Git',
  local: '服务器存储',
};

// 状态筛选候选直接从 STATUS_MAP 派生（label/dot 单一来源，避免双表维护漂移）
const STATUS_OPTIONS: Array<{ key: DocStatus; label: string; dot: string }> =
  (Object.keys(STATUS_MAP) as DocStatus[]).map((key) => ({
    key, label: STATUS_MAP[key].label, dot: STATUS_MAP[key].dot,
  }));

const TIME_RANGES = [
  { key: 'any', label: '任意时间', ms: Infinity },
  { key: '1d', label: '今天', ms: 86_400_000 },
  { key: '3d', label: '近 3 天', ms: 3 * 86_400_000 },
  { key: '7d', label: '近一周', ms: 7 * 86_400_000 },
  { key: '30d', label: '近一个月', ms: 30 * 86_400_000 },
] as const;

type TimeRangeKey = (typeof TIME_RANGES)[number]['key'];

interface Filters {
  status: DocStatus[];
  template: string | null;
  visibility: Visibility | null;
  timeRange: TimeRangeKey;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(isoString?: string | null): string {
  if (!isoString) return '刚刚';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  return `${Math.floor(days / 30)} 个月前`;
}

// 站点访问地址：与 PublishPage siteUrlOf 保持同一推导规则
function siteUrlOf(site: PublishSite): string {
  if (site.customDomain) return site.customDomain;
  return site.addressMode === 'subpath'
    ? `ewiki.local/p/${site.slug}`
    : `${site.slug}.ewiki.local`;
}

// 状态徽章：统一走 .tag 基类（旧实现漏掉基类 → 无 padding/圆角的紧贴色块），
// 内嵌状态圆点提供色弱冗余编码（与 FilterDrawer 状态点同一套色）
function StatusBadge({ status }: { status: DocStatus }): React.ReactElement {
  const meta = STATUS_MAP[status] ?? STATUS_MAP.synced;
  return (
    <span className={`tag shrink-0 !text-[10px] ${meta.cls}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function LibrarySkeleton(): React.ReactElement {
  return (
    <>
      <div className="animate-fade-up mb-6 flex items-start justify-between">
        <div>
          <div className="skeleton mb-2 h-7 w-28" />
          <div className="skeleton h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <div className="skeleton h-9 w-24" />
          <div className="skeleton h-9 w-24" />
        </div>
      </div>
      <div className="skeleton mb-5 h-8 w-full" />
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card space-y-3 p-4" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="flex justify-between">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-5 w-14" />
            </div>
            <div className="skeleton h-5 w-32" />
            <div className="space-y-2">
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// FilterChip（工具行快捷筛选）
// ---------------------------------------------------------------------------

function FilterChip({ label, active, count, onClick }: {
  label: string; active: boolean; count?: number; onClick: () => void;
}): React.ReactElement {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
        active
          ? 'border-primary-200 bg-primary-50 text-primary-700 shadow-sm'
          : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-800'
      }`}>
      {label}
      {count != null && (
        <span className={`text-[10px] ${active ? 'text-primary-500' : 'text-neutral-400'}`}>{count}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PaginationBar（平铺 / 按项目两种模式共用）
// 全局库沿用「一次拉全量 → 前端过滤」模型（服务端 GET /api/v1/documents 硬上限 500 条，
// 且已预留 page/pageSize/total 字段），分页在前端切片完成；单页 24 张卡（2 列 ×12 / 3 列 ×8 整除）。
// 数据量逼近 500 上限时再升级服务端分页，避免过度设计。
// ---------------------------------------------------------------------------

const PAGE_SIZE = 24;

// 页码窗口：首末页恒显 + 当前页 ±1 + 超窗收进省略号（≤7 页全显）
function pageItems(current: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const items: Array<number | 'ellipsis'> = [1];
  const lo = Math.max(2, current - 1);
  const hi = Math.min(totalPages - 1, current + 1);
  if (lo > 2) items.push('ellipsis');
  for (let i = lo; i <= hi; i++) items.push(i);
  if (hi < totalPages - 1) items.push('ellipsis');
  items.push(totalPages);
  return items;
}

function PaginationBar({ page, pageSize, total, unit, onPageChange }: {
  page: number; pageSize: number; total: number; unit: string; onPageChange: (p: number) => void;
}): React.ReactElement | null {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= 0 || totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const numBtn = (active: boolean): string =>
    `inline-flex h-8 min-w-[2rem] items-center justify-center rounded-md border px-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
      active
        ? 'border-primary-200 bg-primary-50 text-primary-700'
        : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-800'
    }`;
  return (
    <nav className="animate-fade-up mb-8 flex flex-wrap items-center justify-between gap-3" aria-label="分页">
      <div className="text-xs text-neutral-500">
        共 <span className="font-semibold text-neutral-800">{total}</span> {unit}
        <span className="mx-1.5 text-neutral-300">·</span>
        第 {start}–{end} {unit}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className={numBtn(false)} disabled={page <= 1}
          onClick={() => onPageChange(page - 1)} aria-label="上一页">
          <ChevronLeft size={14} />
        </button>
        {pageItems(page, totalPages).map((item, i) =>
          item === 'ellipsis' ? (
            <span key={`ellipsis-${i}`} className="px-1 text-xs text-neutral-400">…</span>
          ) : (
            <button key={item} type="button" className={numBtn(item === page)}
              aria-current={item === page ? 'page' : undefined}
              onClick={() => onPageChange(item)}>
              {item}
            </button>
          ),
        )}
        <button type="button" className={numBtn(false)} disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)} aria-label="下一页">
          <ChevronRight size={14} />
        </button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// DocumentCard（平铺模式 · 卡片网格）
// 摘要预览已随列表接口派生 summary 字段回补（PLAN 3.4 残留），无内容时回退字数统计；
// 标签行已随 documents.tags 列落地回补（后端 5.2.1）。
// ---------------------------------------------------------------------------

function DocumentCard({ doc, projects, users, delayMs = 0 }: {
  doc: LibraryDoc; projects: Project[]; users: TeamUser[]; delayMs?: number;
}): React.ReactElement {
  const author = users.find((u) => u.id === doc.updatedBy);
  const authorName = author?.name ?? '未知';
  const project = projects.find((p) => p.id === doc.projectId);
  const parentFolder = doc.path.includes('/')
    ? doc.path.split('/').slice(0, -1).join('/')
    : '根目录';
  const fileName = doc.path.includes('/') ? doc.path.split('/').pop() ?? doc.path : doc.path;

  return (
    <Link to={`/projects/${doc.projectId}/browse?doc=${doc.id}`}
      className="card-hover animate-fade-up group block"
      style={{ animationDelay: `${delayMs}ms` }}>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-neutral-400">
            {project && (
              <>
                <span className="font-medium text-primary-600">{project.name}</span>
                <ChevronRight size={12} className="shrink-0 text-neutral-300" />
              </>
            )}
            <span className="truncate">{parentFolder}</span>
            <ChevronRight size={12} className="shrink-0 text-neutral-300" />
            <span className="truncate text-neutral-500">{fileName}</span>
          </div>
          <StatusBadge status={doc.status} />
        </div>

        <div className="space-y-1.5">
          <h3 className="line-clamp-1 text-base font-semibold leading-tight text-neutral-900">
            {doc.title ?? fileName}
          </h3>
          {/* 内容摘要（对齐原型 Library.jsx:283-286 extractPreview 预览行） */}
          <p className="line-clamp-2 text-xs leading-relaxed text-neutral-500">
            {doc.summary || (doc.wordCount ? `${doc.wordCount} 字` : '暂无内容')}
          </p>
        </div>

        {/* 标签行（原型 DocumentCard 标签 chips；documents.tags 已落地） */}
        {(doc.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1">
            {doc.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="tag tag-neutral !text-[10px] !px-1.5 !py-0">
                <Tag size={9} />
                {tag}
              </span>
            ))}
            {doc.tags.length > 3 && (
              <span className="text-[10px] text-neutral-400">+{doc.tags.length - 3}</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-neutral-100 pt-1 text-xs text-neutral-500">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-500 text-[10px] font-semibold text-white">
            {authorName.slice(0, 1).toUpperCase()}
          </div>
          <span className="truncate text-neutral-600">{authorName}</span>
          <span className="text-neutral-300">·</span>
          <span className="flex shrink-0 items-center gap-1">
            <Clock size={11} />
            {relativeTime(doc.updatedAt)}
          </span>
        </div>

        <div className="absolute bottom-3 right-3 translate-y-1 opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
          <span className="btn-ghost inline-flex items-center gap-1 !px-2 !py-1 text-xs">
            打开编辑器
            <ChevronRight size={12} />
          </span>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// DocumentListView（平铺模式 · 表格视图）
// ---------------------------------------------------------------------------

function DocumentListRow({ doc, projects, users, delayMs = 0 }: {
  doc: LibraryDoc; projects: Project[]; users: TeamUser[]; delayMs?: number;
}): React.ReactElement {
  const author = users.find((u) => u.id === doc.updatedBy);
  const authorName = author?.name ?? '未知';
  const project = projects.find((p) => p.id === doc.projectId);

  return (
    <Link to={`/projects/${doc.projectId}/browse?doc=${doc.id}`}
      className="animate-fade-up group block" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="flex items-center gap-4 border-b border-neutral-100 px-4 py-3 transition-colors last:border-0 hover:bg-neutral-50/80">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500">
          <FileText size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-medium text-neutral-900 transition-colors group-hover:text-primary-600">
              {doc.title ?? doc.path}
            </h4>
            <StatusBadge status={doc.status} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-neutral-500">
            {project && <span className="truncate text-primary-600">{project.name}</span>}
            <ChevronRight size={10} className="shrink-0 text-neutral-300" />
            <span className="truncate">{doc.path}</span>
          </div>
        </div>
        <div className="hidden w-[160px] shrink-0 items-center gap-2 text-[11px] text-neutral-500 sm:flex">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-500 text-[9px] font-semibold text-white">
            {authorName.slice(0, 1).toUpperCase()}
          </div>
          <span className="truncate">{authorName}</span>
        </div>
        <div className="hidden w-[90px] shrink-0 justify-end gap-1 text-[11px] text-neutral-400 lg:flex">
          <Clock size={10} />
          <span>{relativeTime(doc.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function DocumentListView({ docs, projects, users }: {
  docs: LibraryDoc[]; projects: Project[]; users: TeamUser[];
}): React.ReactElement {
  return (
    <div className="card divide-y divide-neutral-100 overflow-hidden p-0">
      <div className="flex items-center gap-4 border-b border-neutral-200 bg-neutral-50/60 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
        <div className="w-8 shrink-0" />
        <div className="flex-1">文档</div>
        <div className="hidden w-[160px] shrink-0 sm:block">作者</div>
        <div className="hidden w-[90px] shrink-0 text-right lg:block">更新时间</div>
      </div>
      {docs.map((doc, i) => (
        <DocumentListRow key={doc.id} doc={doc} projects={projects} users={users} delayMs={i * 30} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectCard（按项目模式）
// ---------------------------------------------------------------------------

function ProjectCard({ project, docCount, backendKind, siteUrl, delayMs = 0, onOpenWebsite }: {
  project: Project;
  docCount: number;
  backendKind: BackendKind;
  siteUrl: string | null;
  delayMs?: number;
  onOpenWebsite: (url: string) => void;
}): React.ReactElement {
  const Icon = BACKEND_ICON[backendKind] ?? HardDrive;
  const vis = VISIBILITY_META[project.visibility] ?? VISIBILITY_META.private;
  const VisIcon = vis.Icon;

  return (
    <div className="card-hover animate-fade-up group relative block overflow-hidden"
      style={{ animationDelay: `${delayMs}ms` }}>
      <Link to={`/projects/${project.id}/browse`} className="block space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          {/* 项目色动态底色（project.color 存 Tailwind 浅底类名，与 Dashboard :446 同约定；PLAN 5.3.4） */}
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-primary-600 ${project.color ?? 'bg-primary-50'}`}>
            <Icon size={22} />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="tag-neutral !px-1.5 !py-0 !text-[10px]">
              {BACKEND_LABEL[backendKind] ?? backendKind}
            </span>
            {project.updatedAt && (
              <span className="flex items-center gap-0.5 text-[11px] text-neutral-400">
                <Clock size={10} />
                {relativeTime(project.updatedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <h3 className="line-clamp-1 text-base font-semibold leading-tight text-neutral-900">
            {project.name}
          </h3>
          <p className="line-clamp-2 text-xs leading-relaxed text-neutral-500">
            {project.description ?? '暂无描述'}
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-neutral-100 pt-2">
          <div className="flex items-center gap-1.5 text-xs text-neutral-600">
            <FileText size={13} className="text-neutral-400" />
            <span className="font-semibold text-neutral-800">{docCount}</span>
            <span className="text-neutral-500">篇文档</span>
          </div>
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${vis.cls}`}>
            <VisIcon size={10} />
            {vis.label}
          </span>
        </div>
      </Link>

      {/* 悬停浮现：访问网站（已发布）/ 进入 */}
      <div className="absolute bottom-4 right-4 flex translate-y-1 items-center gap-2 opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
        {siteUrl && (
          <button type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenWebsite(siteUrl); }}
            className="btn-ghost inline-flex items-center gap-1 border border-emerald-100 !px-2.5 !py-1.5 text-xs text-emerald-600 hover:bg-emerald-50"
            title="打开已发布网站">
            <Globe size={13} />
            访问网站
          </button>
        )}
        <Link to={`/projects/${project.id}/browse`}
          className="btn-primary inline-flex items-center gap-1 !px-3 !py-1.5 text-xs">
          进入
          <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectSelector —— 项目少用 chips，多用带搜索的 Portal 下拉
// ---------------------------------------------------------------------------

function ProjectSelector({ projects, selected, onSelect, docCounts, threshold = 6 }: {
  projects: Project[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  docCounts: Record<string, number>;
  threshold?: number;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  const totalCount = projects.reduce((s, p) => s + (docCounts[p.id] ?? 0), 0);
  const selectedProject = selected ? projects.find((p) => p.id === selected) : null;

  useEffect(() => {
    if (!open) return;
    const close = (): void => setOpen(false);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 项目数较少：内联 chips
  if (projects.length <= threshold) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => onSelect(null)}
          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
            selected === null
              ? 'border-primary-200 bg-primary-50 !text-primary-700'
              : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-800'
          }`}>
          <FolderOpen size={11} />
          全部
          <span className={`text-[10px] ${selected === null ? 'text-primary-500' : 'text-neutral-400'}`}>
            {totalCount}
          </span>
        </button>
        {projects.map((p) => (
          <button key={p.id} type="button" onClick={() => onSelect(p.id)}
            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
              selected === p.id
                ? 'border-primary-200 bg-primary-50 !text-primary-700'
                : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-800'
            }`}>
            {p.name}
            <span className={`text-[10px] ${selected === p.id ? 'text-primary-500' : 'text-neutral-400'}`}>
              {docCounts[p.id] ?? 0}
            </span>
          </button>
        ))}
      </div>
    );
  }

  // 项目数较多：Portal 下拉 + 搜索
  const filtered = projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  const openDropdown = (): void => {
    setOpen(true);
    setQuery('');
    setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPanelPos({ top: rect.bottom + 4, left: rect.left });
    }, 0);
  };

  return (
    <div className="relative shrink-0">
      <button ref={triggerRef} type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium transition ${
          selected
            ? 'border-primary-200 bg-primary-50 !text-primary-700'
            : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-800'
        }`}>
        <FolderOpen size={11} />
        {selectedProject ? selectedProject.name : '全部项目'}
        <span className={`text-[10px] ${selected ? 'text-primary-500' : 'text-neutral-400'}`}>
          {selected ? (docCounts[selected] ?? 0) : totalCount}
        </span>
        <ChevronRight size={12} className={`text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && panelPos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 w-72 animate-fade-up overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl"
            style={{ top: panelPos.top, left: panelPos.left }}>
            <div className="border-b border-neutral-100 p-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索项目..." className="input !h-8 !pl-7 !text-xs" autoFocus />
              </div>
            </div>
            <div className="scrollbar-thin max-h-64 overflow-y-auto py-1">
              <button type="button"
                onClick={() => { onSelect(null); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition ${
                  selected === null ? 'bg-primary-50 text-primary-700' : 'text-neutral-700 hover:bg-neutral-50'
                }`}>
                <FolderOpen size={12} className="shrink-0" />
                <span className="flex-1 text-left">全部项目</span>
                <span className={`text-[10px] ${selected === null ? 'text-primary-500' : 'text-neutral-400'}`}>
                  {totalCount}
                </span>
              </button>
              {filtered.map((p) => (
                <button key={p.id} type="button"
                  onClick={() => { onSelect(p.id); setOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition ${
                    selected === p.id ? 'bg-primary-50 text-primary-700' : 'text-neutral-700 hover:bg-neutral-50'
                  }`}>
                  <FolderOpen size={12} className="shrink-0" />
                  <span className="flex-1 truncate text-left">{p.name}</span>
                  <span className={`text-[10px] ${selected === p.id ? 'text-primary-500' : 'text-neutral-400'}`}>
                    {docCounts[p.id] ?? 0}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-neutral-400">未找到匹配的项目</div>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterDrawer —— 状态 / 模板 / 可见性 / 标签 / 时间五维
// 标签维：documents.tags 列已落地（后端 5.2.1），候选集由主组件从当前范围文档聚合
// ---------------------------------------------------------------------------

function FilterDrawer({ open, onClose, filters, setFilters, availableTags }: {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  availableTags: string[];
}): React.ReactElement | null {
  if (!open) return null;

  const toggleStatus = (key: DocStatus): void => {
    setFilters((f) => ({
      ...f,
      status: f.status.includes(key) ? f.status.filter((s) => s !== key) : [...f.status, key],
    }));
  };

  const toggleTag = (tag: string): void => {
    setFilters((f) => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag],
    }));
  };

  const activeCount =
    filters.status.length +
    (filters.template ? 1 : 0) +
    (filters.visibility ? 1 : 0) +
    filters.tags.length +
    (filters.timeRange !== 'any' ? 1 : 0);

  const resetAll = (): void => {
    setFilters({ status: [], template: null, visibility: null, tags: [], timeRange: 'any' });
  };

  const pillCls = (active: boolean): string =>
    `inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
      active
        ? 'border-neutral-900 bg-neutral-900 text-white'
        : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
    }`;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-neutral-900/30 animate-fade-up" onClick={onClose} />
      <aside className="scrollbar-thin fixed bottom-0 right-0 top-0 z-50 w-[340px] animate-slide-in overflow-y-auto border-l border-neutral-200 bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-100 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-primary-600" />
            <span className="font-semibold text-neutral-900">筛选条件</span>
            {activeCount > 0 && (
              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-600">
                {activeCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {activeCount > 0 && (
              <button type="button" onClick={resetAll}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-700">
                <RotateCcw size={12} />
                重置
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-ghost !p-1.5">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="space-y-6 p-5">
          <div>
            <div className="mb-2 text-xs font-semibold text-neutral-700">文档状态</div>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => (
                <button key={opt.key} type="button" onClick={() => toggleStatus(opt.key)}
                  className={pillCls(filters.status.includes(opt.key))}>
                  <span className={`h-1.5 w-1.5 rounded-full ${opt.dot}`} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold text-neutral-700">文档库模板</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(TEMPLATE_LABEL).map(([key, label]) => (
                <button key={key} type="button"
                  onClick={() => setFilters((f) => ({ ...f, template: f.template === key ? null : key }))}
                  className={pillCls(filters.template === key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold text-neutral-700">可见性</div>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(VISIBILITY_META) as Array<[Visibility, typeof VISIBILITY_META[Visibility]]>).map(([key, meta]) => {
                const Icon = meta.Icon;
                return (
                  <button key={key} type="button"
                    onClick={() => setFilters((f) => ({ ...f, visibility: f.visibility === key ? null : key }))}
                    className={pillCls(filters.visibility === key)}>
                    <Icon size={12} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold text-neutral-700">更新时间</div>
            <div className="flex flex-wrap gap-2">
              {TIME_RANGES.map((opt) => (
                <button key={opt.key} type="button"
                  onClick={() => setFilters((f) => ({ ...f, timeRange: opt.key }))}
                  className={pillCls(filters.timeRange === opt.key)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-neutral-700">
              <Tag size={12} />
              标签
            </div>
            {availableTags.length === 0 ? (
              <p className="text-xs text-neutral-400">当前范围内暂无文档标签（在编辑器保存时可设置）。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => (
                  <button key={tag} type="button" onClick={() => toggleTag(tag)}
                    className={pillCls(filters.tags.includes(tag))}>
                    <Tag size={10} />
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// 网站预览 Modal（已发布站点占位跳转）
// ---------------------------------------------------------------------------

function WebsiteModal({ url, onClose }: { url: string; onClose: () => void }): React.ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4 backdrop-blur-sm animate-fade-up"
      onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Globe size={16} />
            </div>
            <div>
              <div className="text-sm font-semibold text-neutral-900">打开已发布网站</div>
              <div className="max-w-xs truncate font-mono text-[11px] text-neutral-500">{url}</div>
            </div>
          </div>
          <button type="button" className="btn-ghost !p-2" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="p-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <ExternalLink size={24} />
          </div>
          <p className="mb-4 text-sm text-neutral-700">
            此文档库已发布为公开网站，点击「立即访问」在新窗口打开。
          </p>
          <div className="flex items-center justify-center gap-3">
            <button type="button" onClick={onClose} className="btn-secondary">关闭</button>
            <a href={`https://${url}`} target="_blank" rel="noopener noreferrer"
              className="btn-primary inline-flex items-center gap-1.5">
              <ExternalLink size={14} />
              立即访问
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function LibraryPage(): React.ReactElement {
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [browseMode, setBrowseMode] = useState<BrowseMode>('flat');
  const [scope, setScope] = useState<Scope>('mine');
  const [keyword, setKeyword] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  // 分页页码（平铺/按项目共用一份：模式切换即重置，见下方 effect）
  const [page, setPage] = useState(1);
  // 内容区顶部锚点：切页后把新页顶部滚回视口
  const contentTopRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<Filters>({
    status: [],
    template: null,
    visibility: null,
    tags: [],
    timeRange: 'any',
  });

  const { data: projectsData, isLoading: projectsLoading } = useQuery<ItemsResp<Project>>({
    queryKey: ['projects'],
    queryFn: () => apiFetch<ItemsResp<Project>>('/api/v1/projects'),
  });
  const { data: docsData, isLoading: docsLoading } = useQuery<LibraryDoc[], Error>({
    queryKey: ['library-documents'],
    // 服务端真分页（pageSize 上限 500）后循环拉齐全量，前端过滤/分页架构不变
    queryFn: () => fetchAllDocuments<LibraryDoc>(),
  });
  const { data: teamData } = useQuery<ItemsResp<TeamUser>>({
    queryKey: ['team'],
    queryFn: () => apiFetch<ItemsResp<TeamUser>>('/api/v1/team'),
  });

  const projects = projectsData?.items ?? [];
  const documents = docsData ?? [];
  const users = teamData?.items ?? [];

  // 公开项目（explore 范围）
  const publicProjects = useMemo(
    () => projects.filter((p) => p.visibility === 'public'),
    [projects],
  );

  // 已发布站点：无全局 publish-sites 端点，按公开项目并行查询各自站点
  const siteQueries = useQueries({
    queries: publicProjects.map((p) => ({
      queryKey: ['project-publish-sites', p.id],
      queryFn: async (): Promise<PublishSite | null> => {
        try {
          const resp = await apiFetch<ItemsResp<PublishSite>>(`/api/v1/projects/${p.id}/publish-sites`);
          return resp.items[0] ?? null;
        } catch {
          return null;
        }
      },
    })),
  });

  const siteByProject = useMemo(() => {
    const map: Record<string, string> = {};
    publicProjects.forEach((p, i) => {
      const site = siteQueries[i]?.data;
      if (site) map[p.id] = siteUrlOf(site);
    });
    return map;
  }, [publicProjects, siteQueries]);

  const publishedPublicProjects = useMemo(
    () => publicProjects.filter((p) => siteByProject[p.id]),
    [publicProjects, siteByProject],
  );

  const docCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of documents) c[d.projectId] = (c[d.projectId] ?? 0) + 1;
    return c;
  }, [documents]);

  // ---- 范围过滤 ----
  const scopeProjects = useMemo(
    () => (scope === 'explore' ? publicProjects : projects),
    [projects, publicProjects, scope],
  );

  const inTimeRange = (iso?: string | null): boolean => {
    const range = TIME_RANGES.find((r) => r.key === filters.timeRange);
    if (!range || range.ms === Infinity) return true;
    if (!iso) return false;
    return Date.now() - new Date(iso).getTime() <= range.ms;
  };

  const filteredDocs = useMemo(() => {
    let list = documents.filter((d) => {
      if (scope === 'explore') {
        const proj = projects.find((p) => p.id === d.projectId);
        if (!proj || proj.visibility !== 'public') return false;
      }
      if (selectedProject && d.projectId !== selectedProject) return false;
      if (filters.status.length > 0 && !filters.status.includes(d.status)) return false;
      if (filters.tags.length > 0 && !filters.tags.some((t) => d.tags?.includes(t))) return false;
      if (!inTimeRange(d.updatedAt)) return false;
      return true;
    });
    // 文档级搜索：标题 / 路径 / 标签（标签维随 documents.tags 列落地回补）
    const needle = keyword.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (d) =>
          (d.title ?? '').toLowerCase().includes(needle) ||
          d.path.toLowerCase().includes(needle) ||
          (d.tags ?? []).some((t) => t.toLowerCase().includes(needle)),
      );
    }
    return [...list].sort(
      (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, projects, scope, selectedProject, filters.status, filters.tags, filters.timeRange, keyword]);

  // 标签候选集：当前范围内文档的并集（按字典序，供 FilterDrawer 渲染）
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of documents) {
      if (scope === 'explore') {
        const proj = projects.find((p) => p.id === d.projectId);
        if (!proj || proj.visibility !== 'public') continue;
      }
      if (selectedProject && d.projectId !== selectedProject) continue;
      for (const t of d.tags ?? []) set.add(t);
    }
    return [...set].sort();
  }, [documents, projects, scope, selectedProject]);

  const filteredProjects = useMemo(() => {
    return scopeProjects
      .filter((p) => {
        if (filters.template && p.template !== filters.template) return false;
        if (filters.visibility && p.visibility !== filters.visibility) return false;
        if (!inTimeRange(p.updatedAt)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeProjects, filters.template, filters.visibility, filters.timeRange]);

  const activeFilterCount =
    filters.status.length +
    (filters.template ? 1 : 0) +
    (filters.visibility ? 1 : 0) +
    filters.tags.length +
    (filters.timeRange !== 'any' ? 1 : 0);

  // ---- 分页派生 ----
  // 任一筛选/搜索/范围/模式变化即回到第 1 页（viewMode 切换除外：网格↔列表保留页位）；
  // filteredDocs 因删档等变短时收敛页码防越界
  const totalPages = Math.max(1, Math.ceil(
    (browseMode === 'flat' ? filteredDocs.length : filteredProjects.length) / PAGE_SIZE,
  ));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [keyword, filters, selectedProject, scope, browseMode]);

  const pagedDocs = useMemo(
    () => filteredDocs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredDocs, safePage],
  );
  const pagedProjects = useMemo(
    () => filteredProjects.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredProjects, safePage],
  );

  function handlePageChange(next: number): void {
    setPage(next);
    // Layout 的 main 是 overflow-auto 滚动容器，window.scrollTo 无效，用内容区锚点定位
    contentTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const loading = projectsLoading || docsLoading;

  const segBtn = (active: boolean): string =>
    `inline-flex items-center gap-1 rounded px-2.5 py-1 transition text-[12px] ${
      active ? 'bg-white text-neutral-900 shadow-sm font-medium' : 'text-neutral-500 hover:text-neutral-700'
    }`;

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      {loading ? (
        <LibrarySkeleton />
      ) : (
        <>
          {/* 1. 页头：标题 + 范围/浏览模式分段控件 + 操作按钮 */}
          <header className="animate-fade-up mb-5 flex items-center gap-3">
            <h1 className="flex shrink-0 items-center gap-2 text-lg font-bold text-neutral-900">
              <FolderOpen size={20} className="text-primary-600" />
              文档库
            </h1>

            <div className="inline-flex shrink-0 items-center rounded-md bg-neutral-100 p-0.5">
              <button type="button"
                onClick={() => { setScope('mine'); setSelectedProject(null); }}
                className={segBtn(scope === 'mine')}>
                <EyeOff size={12} />
                我的
                <span className="text-[10px] text-neutral-400">{projects.length}</span>
              </button>
              <button type="button"
                onClick={() => { setScope('explore'); setSelectedProject(null); }}
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1 transition text-[12px] ${
                  scope === 'explore'
                    ? 'bg-white font-medium text-emerald-700 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}>
                <Globe size={12} />
                公开
                <span className={`text-[10px] ${scope === 'explore' ? 'text-emerald-500' : 'text-neutral-400'}`}>
                  {publishedPublicProjects.length}
                </span>
              </button>
              <div className="mx-0.5 h-4 w-px bg-neutral-200" />
              <button type="button" onClick={() => setBrowseMode('flat')} className={segBtn(browseMode === 'flat')}>
                <LayoutGrid size={12} />
                平铺
              </button>
              <button type="button" onClick={() => setBrowseMode('project')} className={segBtn(browseMode === 'project')}>
                <FolderKanban size={12} />
                按项目
              </button>
            </div>

            <div className="flex-1" />

            {scope === 'mine' && (
              <>
                {/* 新建文档库统一入口（平台化需求 5/7）：跳转完整向导 —— 模板/空库 × 本地/Git 存储源（连接配置 + 仓库名称 + 自动初始化） */}
                <button type="button" className="btn-primary !h-8 !text-xs" onClick={() => navigate('/projects/new')}>
                  <FolderPlus size={14} />
                  新建文档库
                </button>
              </>
            )}
          </header>

          {/* Explore 横幅：已发布的公开网站 */}
          {scope === 'explore' && publishedPublicProjects.length > 0 && (
            <div className="animate-fade-up mb-5 flex items-center gap-4 rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-teal-50 to-sky-50 p-4"
              style={{ animationDelay: '60ms' }}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500">
                <Globe size={20} className="text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-neutral-900">已发布的网站</div>
                <div className="mt-0.5 text-xs text-neutral-600">
                  以下 {publishedPublicProjects.length} 个文档库已作为网站发布，点击「访问网站」可直接预览线上效果
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {publishedPublicProjects.slice(0, 3).map((p) => (
                  <button key={p.id} type="button"
                    onClick={() => setWebsiteUrl(siteByProject[p.id])}
                    className="btn-ghost inline-flex items-center gap-1 border border-emerald-200 !px-2 !py-1.5 text-[11px] text-emerald-700 hover:bg-emerald-100"
                    title={siteByProject[p.id]}>
                    <ExternalLink size={11} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 2. 搜索 + 工具行（同时作为切页滚动锚点） */}
          <div ref={contentTopRef} className="animate-fade-up mb-4 flex flex-wrap items-center gap-2.5" style={{ animationDelay: '40ms' }}>
            <div className="relative w-[300px] min-w-[220px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
                placeholder={scope === 'explore' ? '搜索公开文档库、博客、官网...' : '按标题或路径搜索...'}
                className="input !h-8 !pl-9 !text-xs" />
            </div>

            {/* 快捷 FilterChip 仅「我的文档 · 平铺」与 Explore 模式渲染（对齐原型工具行）；
                项目聚焦模式（ProjectSelector 选中单项目时）隐藏属有据裁剪——项目内筛选已由
                Browse 页搜索/目录树承担，PLAN 5.3.4 声明 */}
            {scope === 'mine' && browseMode === 'flat' && (
              <>
                <FilterChip label="冲突"
                  count={documents.filter((d) => d.status === 'conflict').length}
                  active={filters.status.includes('conflict')}
                  onClick={() => setFilters((f) => ({
                    ...f,
                    status: f.status.includes('conflict')
                      ? f.status.filter((s) => s !== 'conflict')
                      : [...f.status, 'conflict'],
                  }))} />
                <FilterChip label="本地修改"
                  count={documents.filter((d) => d.status === 'modified').length}
                  active={filters.status.includes('modified')}
                  onClick={() => setFilters((f) => ({
                    ...f,
                    status: f.status.includes('modified')
                      ? f.status.filter((s) => s !== 'modified')
                      : [...f.status, 'modified'],
                  }))} />
              </>
            )}
            {scope === 'explore' && (
              <FilterChip label="已发布网站"
                count={publishedPublicProjects.length}
                active={filters.visibility === 'public'}
                onClick={() => setFilters((f) => ({
                  ...f,
                  visibility: f.visibility === 'public' ? null : 'public',
                  template: null,
                }))} />
            )}

            <div className="ml-auto flex items-center gap-1.5">
              {browseMode === 'flat' && scope === 'mine' && (
                <ProjectSelector projects={scopeProjects} selected={selectedProject}
                  onSelect={setSelectedProject} docCounts={docCounts} />
              )}

              <div className="ml-1 inline-flex items-center rounded-md bg-neutral-100 p-0.5">
                <button type="button" onClick={() => setViewMode('grid')}
                  className={`rounded p-1.5 transition ${
                    viewMode === 'grid' ? 'bg-white text-primary-600 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                  aria-label="网格视图">
                  <Grid3X3 size={15} />
                </button>
                <button type="button" onClick={() => setViewMode('list')}
                  className={`rounded p-1.5 transition ${
                    viewMode === 'list' ? 'bg-white text-primary-600 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                  aria-label="列表视图">
                  <List size={15} />
                </button>
              </div>

              <button type="button" onClick={() => setFilterOpen(true)}
                className={`relative ml-1 rounded-md border p-1.5 transition ${
                  activeFilterCount > 0
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                }`}
                aria-label="筛选" title="筛选">
                <Filter size={15} />
                {activeFilterCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary-500 text-[9px] font-medium leading-none text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 3. 内容区：平铺（文档）/ 按项目（项目卡），均接客户端分页 */}
          {browseMode === 'flat' ? (
            filteredDocs.length === 0 ? (
              <div className="animate-fade-up card p-12 text-center" style={{ animationDelay: '120ms' }}>
                <FileText size={48} className="mx-auto mb-4 text-neutral-300" />
                <div className="mb-1 text-sm font-medium text-neutral-700">
                  {scope === 'explore' ? '没有匹配的公开文档' : '没有找到匹配的文档'}
                </div>
                <div className="text-xs text-neutral-400">
                  {scope === 'explore'
                    ? '尝试调整筛选条件或稍后再来看看新发布的内容'
                    : '尝试切换项目筛选条件或清空搜索关键词'}
                </div>
              </div>
            ) : (
              <>
                {viewMode === 'list' ? (
                  <div className="animate-fade-up mb-4" style={{ animationDelay: '60ms' }}>
                    <DocumentListView docs={pagedDocs} projects={projects} users={users} />
                  </div>
                ) : (
                  <div className="animate-fade-up mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" style={{ animationDelay: '60ms' }}>
                    {pagedDocs.map((doc, i) => (
                      <DocumentCard key={doc.id} doc={doc} projects={projects} users={users} delayMs={i * 50} />
                    ))}
                  </div>
                )}
                <PaginationBar page={safePage} pageSize={PAGE_SIZE} total={filteredDocs.length}
                  unit="篇文档" onPageChange={handlePageChange} />
              </>
            )
          ) : filteredProjects.length === 0 ? (
            <div className="animate-fade-up card p-12 text-center" style={{ animationDelay: '120ms' }}>
              <FolderKanban size={48} className="mx-auto mb-4 text-neutral-300" />
              <div className="mb-1 text-sm font-medium text-neutral-700">
                {scope === 'explore' ? '没有公开的文档库' : '没有匹配的项目'}
              </div>
              <div className="text-xs text-neutral-400">
                {scope === 'explore' ? '当前没有团队设置为公开的文档库' : '尝试清除筛选条件'}
              </div>
            </div>
          ) : (
            <>
              <div className="animate-fade-up mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" style={{ animationDelay: '60ms' }}>
                {pagedProjects.map((p, i) => (
                  <ProjectCard key={p.id} project={p}
                    docCount={docCounts[p.id] ?? 0}
                    backendKind={p.storageKind ?? 'local'}
                    siteUrl={siteByProject[p.id] ?? null}
                    onOpenWebsite={setWebsiteUrl}
                    delayMs={i * 50} />
                ))}
              </div>
              <PaginationBar page={safePage} pageSize={PAGE_SIZE} total={filteredProjects.length}
                unit="个文档库" onPageChange={handlePageChange} />
            </>
          )}
        </>
      )}

      <FilterDrawer open={filterOpen} onClose={() => setFilterOpen(false)}
        filters={filters} setFilters={setFilters} availableTags={availableTags} />

      {websiteUrl && <WebsiteModal url={websiteUrl} onClose={() => setWebsiteUrl(null)} />}
    </div>
  );
}
