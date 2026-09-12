import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useTheme } from '../theme/ThemeProvider';
import { EwikiRealtime } from '../lib/ws/client';
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock,
  FileCode2,
  FileCog,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Filter,
  GitBranch,
  History,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { basenameOf, extOf, resolveFileType, type FileKind } from '@ewiki/shared';
import { apiFetch } from '../lib/api/client';
import FileHost, { type FileMeta } from '../fileview/FileHost';
import { FileInfoDrawer } from '../fileview/FileInfoDrawer';
import { useProjectRole } from '../lib/api/use-project-role';
import { useShowToast } from '../components/Toast';
import {
  ConfirmDialog,
  MoveToDialog,
  NewFileDialog,
  NewFolderDialog,
  RenameDialog,
  TreeContextMenu,
  type TreeMenuItem,
} from '../components/TreeContextMenu';
import { UploadManager } from '../tree/UploadManager';
import { fileIconOf, docMatchesFacet, FILE_FACETS, type FileFacetId, type FileTypeId } from '../tree/fileIcons';
import { useUiStore } from '../stores/uiStore';
import { ListView, type ListRow } from './components/ListView';

// ---------------------------------------------------------------------------
// Types — 直接从后端返回 shape 推导
// ---------------------------------------------------------------------------

interface DocumentListItem {
  id: string;
  projectId: string;
  path: string;
  title: string | null;
  status: 'untracked' | 'synced' | 'modified' | 'conflict';
  wordCount: number;
  contentHash: string | null;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
  // 文件管理重构：类型元数据（后端 documents.kind/ext/mime/size，§3.1）
  kind?: FileKind;
  ext?: string | null;
  mime?: string | null;
  size?: number;
  // PLAN 3.4 残留：列表接口派生下发（routes.ts documentSummary）
  tags?: string[] | null;
  summary?: string | null;
}

interface DocumentDetail extends DocumentListItem {
  content: string | null;
  // P2 二进制链路：详情对二进制下发 storageRef 与短期签名 rawUrl（§5.2/§5.4）
  storageRef?: string | null;
  rawUrl?: string | null;
}

interface DocumentVersion {
  id: string;
  documentId: string;
  versionNo: number;
  commitHash: string | null;
  authorId: string | null;
  message: string | null;
  changedSummary: unknown;
  createdAt: string;
  authorName: string | null;
  // 二进制版本元数据（P3a 契约：后端在版本列表对二进制下发；暂缺时前端按 — 兜底）
  size?: number | null;
  storageRef?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// untracked=灰降调（对齐 LibraryPage STATUS_MAP 四态标尺）：品牌绿留给 Git 仓库/主操作，
// 与「已同步」的 success 绿区分，避免双绿混淆
const STATUS_MAP: Record<DocumentListItem['status'], { label: string; dot: string; tagClass: string }> = {
  synced: { label: '已同步', dot: 'bg-emerald-500', tagClass: 'tag-success' },
  modified: { label: '本地修改', dot: 'bg-amber-500', tagClass: 'tag-warning' },
  conflict: { label: '冲突', dot: 'bg-red-500', tagClass: 'tag-danger' },
  untracked: { label: '未跟踪', dot: 'bg-neutral-400', tagClass: 'tag-neutral' },
};

/** 真实文件名（path 最后一段，含扩展名；§3.4 树/面包屑一律显示真实文件名） */
function fileNameOfPath(p: string): string {
  return basenameOf(p);
}

/** 文件夹占位文件（.keep，§4.2）：新建文件夹时生成，树中弱化显示、不进默认搜索、不在网格视图展示 */
function isKeepPlaceholder(d: DocumentListItem): boolean {
  return fileNameOfPath(d.path) === '.keep';
}

// 搜索关键词高亮（照抄原型 ProjectBrowse.jsx:365-377）
function highlight(text: string, keyword: string): React.ReactNode {
  if (!keyword) return text;
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200/70 text-amber-900 rounded px-0.5">
        {text.slice(idx, idx + keyword.length)}
      </mark>
      {text.slice(idx + keyword.length)}
    </>
  );
}

function docMatchesKeyword(d: DocumentListItem, kw: string): boolean {
  if (!kw) return true;
  // .keep 占位不参与搜索（§4.2：默认搜索结果中不出现）
  if (isKeepPlaceholder(d)) return false;
  return (
    d.path.toLowerCase().includes(kw) ||
    (d.title ?? '').toLowerCase().includes(kw) ||
    (d.path.split('/').pop() ?? '').toLowerCase().includes(kw)
  );
}

/** 文档是否通过当前筛选（类型 facet 与关键字 AND 组合；.keep 占位在非「全部」时同样隐藏） */
function docPassesFilter(d: DocumentListItem, kw: string, facet: FileFacetId): boolean {
  if (isKeepPlaceholder(d) && (!!kw || facet !== 'all')) return false;
  if (!docMatchesFacet(d.path, d.mime, facet)) return false;
  return docMatchesKeyword(d, kw);
}

function folderHasMatch(node: TreeNode, kw: string, facet: FileFacetId): boolean {
  if (!kw && facet === 'all') return true;
  if (kw && node.name.toLowerCase().includes(kw)) return true;
  if (node.docs.some((d) => docPassesFilter(d, kw, facet))) return true;
  return Array.from(node.children.values()).some((ch) => folderHasMatch(ch, kw, facet));
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
  // 对齐原型 Sources.jsx:28-40 / LibraryPage relativeTime：超过 30 天进入「个月前」档
  return `${Math.floor(diffDays / 30)} 个月前`;
}

function avatarColor(name: string | null | undefined): string {
  const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];
  let h = 0;
  for (let i = 0; i < (name ?? '').length; i++) h = (h * 31 + name!.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length]!;
}

/** 文档/文件夹命名 → 路径 slug（与新建流程同规则：保留字母数字、中文，其余折叠为连字符） */
function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
}

/** 目录树操作错误文案收敛（后端语义码 → 用户可读提示） */
function prettyTreeError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('DOCUMENT_EXISTS')) return '目标位置已存在同名文档，请换一个名称或目录';
  if (msg.includes('FOLDER_NOT_FOUND')) return '文件夹不存在或已被清空';
  if (msg.includes('FORBIDDEN')) return '没有编辑权限';
  if (msg.includes('VALIDATION_FAILED')) return msg.replace('VALIDATION_FAILED: ', '');
  return msg || fallback;
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  docs: DocumentListItem[];
}

function buildTree(docs: DocumentListItem[]): TreeNode {
  const root: TreeNode = { name: '', children: new Map(), docs: [] };
  for (const doc of docs) {
    const parts = doc.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, children: new Map(), docs: [] });
      }
      node = node.children.get(part)!;
    }
    node.docs.push(doc);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Tree sidebar — 左侧目录树
// ---------------------------------------------------------------------------

/** 目录树行交互 API（右键菜单 / 拖拽移动的接线束，避免逐项 prop 爆炸） */
interface TreeApi {
  canWrite: boolean;
  draggingDocId: string | null;
  dragOverPath: string | null;
  activeDocId: string | null;
  keyword: string;
  facet: FileFacetId;
  onSelect: (d: DocumentListItem) => void;
  onMenu: (e: React.MouseEvent, target: { kind: 'doc'; doc: DocumentListItem } | { kind: 'folder'; path: string }) => void;
  onDocDragStart: (doc: DocumentListItem, e: React.DragEvent) => void;
  onDocDragEnd: () => void;
  onFolderDragOver: (path: string, e: React.DragEvent) => void;
  onFolderDragLeave: (path: string) => void;
  onFolderDrop: (path: string, e: React.DragEvent) => void;
}

type TreeMenuTarget = { kind: 'doc'; doc: DocumentListItem } | { kind: 'folder'; path: string } | { kind: 'root' };
interface TreeMenuState { x: number; y: number; target: TreeMenuTarget }
/** 新建入口类型（F2：Markdown 文档 / 文本代码文件 / 文件夹占位） */
type CreateKind = 'markdown' | 'text' | 'folder';
/** 「+」下拉菜单的定位状态（侧栏顶栏 / grid 头部共用） */
interface CreateMenuState { x: number; y: number; folder: string }
type RenameTarget = { kind: 'doc'; doc: DocumentListItem } | { kind: 'folder'; path: string };
type ConfirmTarget = { kind: 'doc'; doc: DocumentListItem } | { kind: 'folder'; path: string; count: number };

function TreeNodeRow({
  node,
  path,
  level,
  expanded,
  onToggle,
  api,
}: {
  node: TreeNode;
  path: string;
  level: number;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  api: TreeApi;
}): React.ReactElement {
  const nodePath = path ? `${path}/${node.name}` : node.name;
  const isExpanded = expanded.has(nodePath);
  const kw = api.keyword.trim().toLowerCase();
  const filtering = !!kw || api.facet !== 'all';

  const visibleDocs = filtering
    ? node.docs.filter((d) => docPassesFilter(d, kw, api.facet))
    : node.docs;
  const visibleChildren = filtering
    ? Array.from(node.children.entries()).filter(([, ch]) => folderHasMatch(ch, kw, api.facet))
    : Array.from(node.children.entries());

  if (filtering && !folderHasMatch(node, kw, api.facet)) return <></>;

  const folderActive = !!kw && node.name.toLowerCase().includes(kw);
  const isDropTarget = !!api.draggingDocId && api.dragOverPath === nodePath;
  // 拖拽进行中：所有文件夹行给出可放置暗示（淡环），命中目标高亮实环
  const dragHint = !!api.draggingDocId && !isDropTarget ? ' ring-1 ring-inset ring-primary-200' : '';

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(nodePath)}
        onContextMenu={(e) => api.onMenu(e, { kind: 'folder', path: nodePath })}
        onDragOver={(e) => api.onFolderDragOver(nodePath, e)}
        onDragLeave={() => api.onFolderDragLeave(nodePath)}
        onDrop={(e) => api.onFolderDrop(nodePath, e)}
        className={`group w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm transition ${
          isDropTarget
            ? 'bg-primary-100 ring-2 ring-inset ring-primary-400'
            : folderActive
              ? 'bg-amber-50 text-amber-800'
              : `text-neutral-700 hover:bg-neutral-100${dragHint}`
        } ${level === 0 ? 'font-medium' : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {node.children.size > 0 || node.docs.length > 0 ? (
          isExpanded ? <ChevronDown size={14} className="text-neutral-400 shrink-0" /> : <ChevronRight size={14} className="text-neutral-400 shrink-0" />
        ) : <span className="w-3.5 shrink-0" />}
        {isExpanded ? <FolderOpen size={13} className="text-primary-500 shrink-0" /> : <Folder size={13} className="text-primary-500 shrink-0" />}
        <span className="truncate">{api.keyword ? highlight(node.name, api.keyword) : node.name}</span>
        <span className="ml-auto font-mono text-[10px] text-neutral-400">{visibleDocs.length}</span>
        {api.canWrite && (
          <span
            role="button"
            tabIndex={-1}
            title="更多操作"
            onClick={(e) => { e.stopPropagation(); api.onMenu(e, { kind: 'folder', path: nodePath }); }}
            className="ml-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 group-hover:inline-flex hover:bg-neutral-200/70 hover:text-neutral-600"
          >
            <MoreHorizontal size={12} />
          </span>
        )}
      </button>

      {isExpanded && (
        <>
          {visibleChildren.map(([name, child]) => (
            <TreeNodeRow key={name} node={child} path={nodePath} level={level + 1} expanded={expanded} onToggle={onToggle} api={api} />
          ))}
          {visibleDocs.map((doc) => {
            const isActive = api.activeDocId === doc.id;
            const status = STATUS_MAP[doc.status] ?? STATUS_MAP.synced;
            const docName = fileNameOfPath(doc.path);
            const { Icon: DocIcon, className: iconClass } = fileIconOf(doc.path, doc.mime);
            const keep = isKeepPlaceholder(doc);
            const docActive = !!kw && (
              docName.toLowerCase().includes(kw) ||
              (doc.title ?? '').toLowerCase().includes(kw)
            );
            const beingDragged = api.draggingDocId === doc.id;
            return (
              <button
                key={doc.id}
                type="button"
                draggable={api.canWrite}
                onClick={() => api.onSelect(doc)}
                onContextMenu={(e) => api.onMenu(e, { kind: 'doc', doc })}
                onDragStart={(e) => api.onDocDragStart(doc, e)}
                onDragEnd={() => api.onDocDragEnd()}
                className={`group w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm transition ${beingDragged ? 'opacity-40' : ''} ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : docActive
                      ? 'bg-amber-50 text-neutral-800'
                      : keep
                        ? 'text-neutral-300 hover:bg-neutral-100'
                        : 'text-neutral-600 hover:bg-neutral-100'
                }`}
                style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }}
              >
                <span className="w-3.5 shrink-0" />
                <DocIcon size={13} className={`${iconClass} shrink-0${keep ? ' opacity-40' : ''}`} />
                <span className="truncate" title={keep ? '文件夹占位文件：文件夹内有其他文件后可手动删除' : doc.title ? `${doc.title}（${docName}）` : docName}>{api.keyword ? highlight(docName, api.keyword) : docName}</span>
                <span className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}${keep ? ' opacity-30' : ''}`} title={status.label} />
                {api.canWrite && (
                  <span
                    role="button"
                    tabIndex={-1}
                    title="更多操作"
                    onClick={(e) => { e.stopPropagation(); api.onMenu(e, { kind: 'doc', doc }); }}
                    className="ml-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 group-hover:inline-flex hover:bg-neutral-200/70 hover:text-neutral-600"
                  >
                    <MoreHorizontal size={12} />
                  </span>
                )}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}

function TreeSidebar({
  docs,
  activeDocId,
  onSelect,
  onBack,
  project,
  collapsed,
  onToggleCollapse,
  onCreate,
  onUploadFiles,
  onUploadFolder,
  canWrite,
  draggingDocId,
  dragOverPath,
  onMenu,
  onDocDragStart,
  onDocDragEnd,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  facet,
  facetCounts,
  onFacetChange,
}: {
  docs: DocumentListItem[];
  activeDocId: string | null;
  onSelect: (d: DocumentListItem) => void;
  onBack: () => void;
  project: { backendKind?: 'git' | 'local' | null } | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** 「+」下拉：新建 Markdown / 文本代码文件 / 文件夹（目标固定为根目录；文件夹内新建走右键菜单） */
  onCreate: (kind: CreateKind, folder: string) => void;
  /** 「+」下拉：上传文件（隐藏 input 多选）到根目录 */
  onUploadFiles: () => void;
  /** 「+」下拉：上传整个文件夹（webkitdirectory）到根目录 */
  onUploadFolder: () => void;
  /** 当前用户是否可编辑文档（false = 只读：隐藏新建入口，后端 POST 403 兜底） */
  canWrite: boolean;
  draggingDocId: string | null;
  dragOverPath: string | null;
  onMenu: (e: React.MouseEvent, target: TreeMenuTarget) => void;
  onDocDragStart: (doc: DocumentListItem, e: React.DragEvent) => void;
  onDocDragEnd: () => void;
  onFolderDragOver: (path: string, e: React.DragEvent) => void;
  onFolderDragLeave: (path: string) => void;
  onFolderDrop: (path: string, e: React.DragEvent) => void;
  /** 顶层统一的类型筛选 state（BrowsePage 持有） */
  facet: FileFacetId;
  facetCounts: Record<FileFacetId, number>;
  onFacetChange: (f: FileFacetId) => void;
}): React.ReactElement {
  const tree = useMemo(() => buildTree(docs), [docs]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [keyword, setKeyword] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [createMenu, setCreateMenu] = useState<{ x: number; y: number } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const openCreateMenu = (e: React.MouseEvent): void => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCreateMenu({ x: rect.right - 208, y: rect.bottom + 4 });
  };

  // Filter popover: outside click 关闭
  const filterWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filterOpen) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      if (filterWrapRef.current && !filterWrapRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [filterOpen]);

  const createMenuItems: TreeMenuItem[] = [
    { key: 'new-md', label: '新建 Markdown 文档', icon: FileText, onSelect: () => onCreate('markdown', '') },
    { key: 'new-text', label: '新建文本 / 代码文件', icon: FileCode2, onSelect: () => onCreate('text', '') },
    { key: 'new-folder', label: '新建文件夹', icon: FolderPlus, onSelect: () => onCreate('folder', '') },
    { key: 'upload-files', label: '上传文件…', icon: Upload, dividerAbove: true, onSelect: onUploadFiles },
    { key: 'upload-folder', label: '上传文件夹…', icon: UploadCloud, onSelect: onUploadFolder },
  ];

  // 目录树行交互束（右键菜单 + 拖拽移动），透传给每个 TreeNodeRow
  const treeApi: TreeApi = useMemo(() => ({
    canWrite,
    draggingDocId,
    dragOverPath,
    activeDocId,
    keyword,
    facet,
    onSelect,
    onMenu,
    onDocDragStart,
    onDocDragEnd,
    onFolderDragOver,
    onFolderDragLeave,
    onFolderDrop,
  }), [canWrite, draggingDocId, dragOverPath, activeDocId, keyword, facet, onSelect, onMenu, onDocDragStart, onDocDragEnd, onFolderDragOver, onFolderDragLeave, onFolderDrop]);

  // 自动展开 active doc 的父路径
  useEffect(() => {
    if (!activeDocId) return;
    const activeDoc = docs.find((d) => d.id === activeDocId);
    if (!activeDoc) return;
    const parts = activeDoc.path.split('/').filter((_, i, arr) => i < arr.length - 1);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < parts.length; i++) {
        next.add(parts.slice(0, i + 1).join('/'));
      }
      next.add('');
      return next;
    });
  }, [activeDocId, docs]);

  // 搜索 / 类型筛选时自动展开所有命中目录（照抄原型 ProjectBrowse.jsx:550-573）
  useEffect(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw && facet === 'all') return;
    const toExpand = new Set<string>(['']);
    const walk = (n: TreeNode, nodePath: string) => {
      if (folderHasMatch(n, kw, facet)) toExpand.add(nodePath);
      n.children.forEach((child, name) => {
        walk(child, nodePath ? `${nodePath}/${name}` : name);
      });
    };
    walk(tree, '');
    setExpanded(toExpand);
  }, [keyword, facet, tree]);

  const toggleExpand = (p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const modifiedCount = docs.filter((d) => d.status === 'modified' || d.status === 'conflict').length;
  const isGitBackend = project?.backendKind === 'git';
  const searchKw = keyword.trim().toLowerCase();
  const filtering = !!searchKw || facet !== 'all';
  const rootVisibleDocs = filtering
    ? tree.docs.filter((d) => docPassesFilter(d, searchKw, facet))
    : tree.docs;
  const rootVisibleChildren = filtering
    ? Array.from(tree.children.entries()).filter(([, ch]) => folderHasMatch(ch, searchKw, facet))
    : Array.from(tree.children.entries());
  const noMatch = filtering && rootVisibleDocs.length === 0 && rootVisibleChildren.length === 0;

  if (collapsed) {
    return (
      <aside className="h-full flex flex-col items-center py-3 border-r" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
        <button type="button" onClick={onToggleCollapse}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
          title="展开目录树">
          <ChevronRight size={14} />
        </button>
        <div className="mt-3 flex-1 flex flex-col items-center gap-1.5 w-full overflow-hidden">
          {docs.filter((d) => docPassesFilter(d, searchKw, facet)).slice(0, 5).map((d) => {
            const { Icon: CollapsedIcon } = fileIconOf(d.path, d.mime);
            return (
            <button key={d.id} type="button" onClick={() => onSelect(d)} title={fileNameOfPath(d.path)}
              className={`w-6 h-6 rounded-md inline-flex items-center justify-center transition ${
                activeDocId === d.id ? 'bg-primary-50 text-primary-600' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60'
              }`}>
              <CollapsedIcon size={12} />
            </button>
            );
          })}
        </div>
      </aside>
    );
  }

  // Filter 当前选中的 label（按钮上展示）
  const activeFacetLabel = FILE_FACETS.find((f) => f.id === facet)?.label ?? '全部';
  const activeFacetCount = facet === 'all' ? facetCounts.all : facetCounts[facet];

  return (
    <aside className="h-full w-full border-r flex flex-col min-w-0 overflow-hidden" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
      {/* Top bar */}
      <div className="shrink-0 px-3 pt-3 pb-2 border-b" style={{ borderColor: 'var(--border-soft)' }}>
        {!searchActive ? (
          <div className="flex items-center justify-between">
            <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-primary-600 transition-colors">
              <ArrowLeft size={12} /> 返回文档库
            </button>
            <div className="flex items-center gap-0.5">
              {/* Filter 下拉按钮（替代原来的 chip 行） */}
              <div ref={filterWrapRef} className="relative">
                <button type="button"
                  onClick={() => setFilterOpen((v) => !v)}
                  className={`w-7 h-7 inline-flex items-center justify-center rounded-md transition relative ${
                    facet !== 'all'
                      ? 'bg-primary-50 text-primary-600 hover:bg-primary-100'
                      : 'text-neutral-500 hover:text-primary-600 hover:bg-primary-50'
                  }`}
                  title={`按类型筛选：${activeFacetLabel}`}>
                  <Filter size={14} />
                  {facet !== 'all' && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-primary-600 text-white text-[9px] leading-[14px] text-center font-medium px-0.5">
                      {activeFacetCount}
                    </span>
                  )}
                </button>
                {filterOpen && (
                  <div className="absolute right-0 top-8 z-50 w-40 rounded-lg border bg-white shadow-lg dark:bg-neutral-900"
                    style={{ borderColor: 'var(--border-soft)' }}>
                    {FILE_FACETS.map((f) => {
                      const isActive = facet === f.id;
                      const count = facetCounts[f.id];
                      return (
                        <button key={f.id} type="button"
                          onClick={() => { onFacetChange(f.id); setFilterOpen(false); }}
                          className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition ${
                            isActive
                              ? 'bg-primary-50 text-primary-700'
                              : 'text-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                          } ${f === FILE_FACETS[0] ? 'rounded-t-lg' : ''} ${f === FILE_FACETS[FILE_FACETS.length - 1] ? 'rounded-b-lg' : ''}`}>
                          <span className="font-medium">{f.label}</span>
                          <span className={`rounded-full px-1.5 text-[10px] leading-4 ${
                            isActive ? 'bg-primary-100 text-primary-700' : 'bg-neutral-100 text-neutral-400'
                          }`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {canWrite && (
                <button type="button" onClick={openCreateMenu}
                  className="w-7 h-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                  title="新建文档或文件夹">
                  <Plus size={15} />
                </button>
              )}
              <button type="button" onClick={() => setSearchActive(true)}
                className="w-7 h-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                title="搜索">
                <Search size={14} />
              </button>
              <button type="button" onClick={onToggleCollapse}
                className="w-7 h-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                title="收起">
                <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
            </div>
          </div>
        ) : (
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              className="w-full h-8 pl-7 pr-8 rounded-md text-xs bg-neutral-100 border border-primary-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100 transition placeholder:text-neutral-400"
              placeholder="搜索文档 / 文件夹…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onBlur={(e) => { if (!e.target.value) setSearchActive(false); }}
            />
            {keyword ? (
              <button type="button" onClick={() => { setKeyword(''); searchRef.current?.focus(); }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-neutral-200 text-neutral-400 hover:text-neutral-600">
                <X size={12} />
              </button>
            ) : (
              <button type="button" onClick={() => setSearchActive(false)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-neutral-200 text-neutral-400 hover:text-neutral-600">
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tree（空白处右键 = 根目录菜单：在根新建文档/文件夹） */}
      <div
        className="flex-1 overflow-y-auto py-2 min-h-0"
        onContextMenu={canWrite ? (e) => onMenu(e, { kind: 'root' }) : undefined}
      >
        {tree.children.size === 0 && tree.docs.length === 0 ? (
          <div className="text-xs text-neutral-400 text-center py-6">暂无文档</div>
        ) : (
          <>
            {noMatch ? (
              <div className="text-xs text-neutral-400 text-center py-6">没有匹配的文档</div>
            ) : (
              <>
            {rootVisibleDocs.map((doc) => {
              const isActive = activeDocId === doc.id;
              const status = STATUS_MAP[doc.status] ?? STATUS_MAP.synced;
              const docName = fileNameOfPath(doc.path);
              const { Icon: RootDocIcon, className: rootIconClass } = fileIconOf(doc.path, doc.mime);
              const beingDragged = draggingDocId === doc.id;
              const keep = isKeepPlaceholder(doc);
              return (
                <button key={doc.id} type="button"
                  draggable={canWrite}
                  onClick={() => onSelect(doc)}
                  onContextMenu={(e) => onMenu(e, { kind: 'doc', doc })}
                  onDragStart={(e) => onDocDragStart(doc, e)}
                  onDragEnd={() => onDocDragEnd()}
                  className={`group w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm transition ${beingDragged ? 'opacity-40' : ''} ${
                    isActive ? 'bg-primary-50 text-primary-700' : keep ? 'text-neutral-300 hover:bg-neutral-100' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                  style={{ paddingLeft: '8px' }}>
                  <RootDocIcon size={13} className={`${rootIconClass} shrink-0${keep ? ' opacity-40' : ''}`} />
                  <span className="truncate" title={keep ? '文件夹占位文件：文件夹内有其他文件后可手动删除' : doc.title ? `${doc.title}（${docName}）` : docName}>{keyword ? highlight(docName, keyword) : docName}</span>
                  <span className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}${keep ? ' opacity-30' : ''}`} title={status.label} />
                  {canWrite && (
                    <span
                      role="button"
                      tabIndex={-1}
                      title="更多操作"
                      onClick={(e) => { e.stopPropagation(); onMenu(e, { kind: 'doc', doc }); }}
                      className="ml-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 group-hover:inline-flex hover:bg-neutral-200/70 hover:text-neutral-600"
                    >
                      <MoreHorizontal size={12} />
                    </span>
                  )}
                </button>
              );
            })}
            {rootVisibleChildren.map(([name, child]) => (
              <TreeNodeRow key={name} node={child} path="" level={0} expanded={expanded}
                onToggle={toggleExpand} api={treeApi} />
            ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t px-3 py-2" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          {isGitBackend ? (
            <>
              <GitBranch size={12} className="text-neutral-400" />
              <span className="font-mono">main</span>
              <span className="w-1 h-1 rounded-full bg-neutral-300" />
              <span className="text-amber-600">{modifiedCount} 待同步</span>
              <span className="flex-1" />
              <span className="text-neutral-400">{docs.length} 个文件</span>
            </>
          ) : (
            <>
              <Activity size={12} className="text-emerald-500" />
              <span>已同步</span>
              <span className="w-1 h-1 rounded-full bg-neutral-300" />
              <span className="text-neutral-400">{docs.length} 个文件</span>
            </>
          )}
        </div>
      </div>

      {/* 「+」新建下拉（Markdown / 文本代码 / 文件夹） */}
      {createMenu && canWrite && (
        <TreeContextMenu
          x={createMenu.x}
          y={createMenu.y}
          items={createMenuItems}
          onClose={() => setCreateMenu(null)}
        />
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Document card — grid 模式
// ---------------------------------------------------------------------------

function DocumentCard({ doc, onOpen, onOpenInfo, onOpenHistory, index }: {
  doc: DocumentListItem;
  onOpen: (d: DocumentListItem) => void;
  onOpenInfo: (d: DocumentListItem) => void;
  onOpenHistory: (d: DocumentListItem) => void;
  index: number;
}): React.ReactElement {
  const status = STATUS_MAP[doc.status] ?? STATUS_MAP.synced;
  const parentFolder = doc.path.includes('/')
    ? doc.path.split('/').slice(0, -1).join('/')
    : '根目录';
  const fileName = doc.path.split('/').pop() ?? doc.path;
  // 作者行（对齐原型 :767-779）：头像底色与首字母均取修改人
  const authorName = doc.updatedBy ?? '未知';

  return (
    <div role="button" tabIndex={0}
      onClick={() => onOpen(doc)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(doc); }}
      className="card-hover block relative group cursor-pointer"
      style={{ animationDelay: `${index * 50}ms` }}>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[11px] text-neutral-400 truncate flex items-center gap-1">
            <span>{parentFolder}</span>
            <ChevronRight size={12} className="text-neutral-300 shrink-0" />
            <span className="text-neutral-500">{fileName}</span>
          </div>
          <span className={`shrink-0 tag ${status.tagClass}`}>{status.label}</span>
        </div>
        <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <button
            type="button"
            title="文件信息"
            onClick={(e) => { e.stopPropagation(); onOpenInfo(doc); }}
            onKeyDown={(e) => e.stopPropagation()}
            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-500/10 hover:text-neutral-600"
          >
            <FileCog size={14} />
          </button>
          <button
            type="button"
            title="历史记录"
            onClick={(e) => { e.stopPropagation(); onOpenHistory(doc); }}
            onKeyDown={(e) => e.stopPropagation()}
            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-500/10 hover:text-neutral-600"
          >
            <History size={14} />
          </button>
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold text-neutral-900 leading-tight truncate">{doc.title ?? fileName}</h3>
          {/* 内容摘要（PLAN 3.4 残留：后端列表接口派生 summary 下发） */}
          <p className="text-xs text-neutral-500 leading-relaxed line-clamp-2">{doc.summary ?? ''}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500 pt-1 border-t" style={{ borderColor: 'var(--border-soft)' }}>
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
            style={{ background: avatarColor(authorName) }}>
            {authorName.slice(0, 1).toUpperCase()}
          </div>
          <span className="text-neutral-600 truncate">{authorName}</span>
          <span className="text-neutral-300">·</span>
          <span className="flex items-center gap-1 shrink-0"><Clock size={11} />{relativeTime(doc.updatedAt)}</span>
        </div>
        {/* 标签行（对齐原型 ProjectBrowse.jsx:339-348） */}
        {(doc.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {doc.tags!.slice(0, 3).map((t) => (
              <span key={t} className="tag tag-neutral !text-[10px]">
                <Tag size={10} />
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* hover「打开」按钮（对齐原型 :350-355） */}
      <div className="pointer-events-none absolute bottom-3 right-3 translate-y-1 opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
        <span className="btn-ghost inline-flex items-center gap-1 !px-2 !py-1 text-xs">
          打开
          <ChevronRight size={12} />
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function BrowsePage(): React.ReactElement {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canWrite } = useProjectRole(projectId);
  const { isDark } = useTheme();

  const docParam = searchParams.get('doc');
  const isFocused = !!docParam;

  // Local UI state
  const [keyword, setKeyword] = useState('');
  // 唯一的类型筛选 state（TreeSidebar + grid 视图共享；Facet popover 在 TreeSidebar 工具栏上）
  const [facet, setFacet] = useState<FileFacetId>('all');
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // 列表视图模式（非 focused 分支）：tree（目录树）| list（表格）| grid（卡片网格）
  const [viewMode, setViewMode] = useState<'tree' | 'list' | 'grid'>(() => {
    const v = searchParams.get('view');
    return v === 'list' || v === 'grid' || v === 'tree' ? v : 'grid';
  });
  // 前端分页（非 focused 分支）：当前页
  const [page, setPage] = useState<number>(() => {
    const p = Number(searchParams.get('page'));
    return Number.isFinite(p) && p > 0 ? p : 1;
  });
  const pageSize = 50;

  // URL 同步：view / page 参数变更 → 同步到 state（双向绑定）
  useEffect(() => {
    const params: Record<string, string> = {};
    const curDoc = searchParams.get('doc');
    if (curDoc) params.doc = curDoc;
    if (viewMode !== 'grid') params.view = viewMode;
    if (page > 1) params.page = String(page);
    const newStr = new URLSearchParams(params).toString();
    const curStr = new URLSearchParams(searchParams).toString();
    if (newStr !== curStr) setSearchParams(params, { replace: true });
  }, [viewMode, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // filter/search 条件变化 → 自动 reset page=1（避免新筛选下 page 越界）
  useEffect(() => {
    if (page !== 1) setPage(1);
  }, [keyword, facet]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Queries ----
  const { data: docData, isLoading: docsLoading } = useQuery<{ items: DocumentListItem[] }>({
    queryKey: ['project-documents', projectId],
    queryFn: () => apiFetch<{ items: DocumentListItem[] }>(`/api/v1/projects/${projectId}/documents`),
    enabled: !!projectId,
  });

  // 类型筛选计数：.keep 占位不计入任何类型桶，口径与 TreeSidebar 内部旧实现一致
  const facetCounts = useMemo(() => {
    const counts: Record<FileTypeId, number> = { markdown: 0, code: 0, image: 0, pdf: 0, binary: 0 };
    let total = 0;
    for (const d of docData?.items ?? []) {
      if (basenameOf(d.path) === '.keep') continue;
      total += 1;
      counts[resolveFileType(d.path, d.mime).typeId] += 1;
    }
    return { all: total, ...counts } as Record<FileFacetId, number>;
  }, [docData]);

  // 项目概览（与 ProjectLayout 共享 queryKey 缓存）
  const { data: projectOverview } = useQuery<{ id: string; name: string; backendKind?: 'git' | 'local' | null }>({
    queryKey: ['project-overview', projectId],
    queryFn: () => apiFetch<{ id: string; name: string; backendKind?: 'git' | 'local' | null }>(`/api/v1/projects/${projectId}/overview`),
    enabled: !!projectId,
  });

  // 活跃文档详情
  const { data: activeDoc } = useQuery<DocumentDetail>({
    queryKey: ['document', docParam],
    queryFn: () => apiFetch<DocumentDetail>(`/api/v1/documents/${docParam}`),
    enabled: !!docParam,
  });

  const { data: versionsData } = useQuery<{ items: DocumentVersion[] }>({
    queryKey: ['document-versions', docParam],
    queryFn: () => apiFetch<{ items: DocumentVersion[] }>(`/api/v1/documents/${docParam}/versions`),
    enabled: !!docParam,
  });

  // =========================================================================
  // §6.2 Unified onSave: 文本类（Markdown + Code）统一走这一个 PUT 乐观并发通道
  //   - 合并原 saveMutation（§4.4 旧 Markdown 保存）和 saveTextFile（§4.4 F5 代码保存）
  //   - MarkdownViewer / CodeViewer 各自内部持有 dirty buffer，宿主只管 PUT + 409 提示
  // =========================================================================
  const latestVersionRef = useRef(0);
  useEffect(() => {
    const v = versionsData?.items?.[0]?.versionNo ?? 0;
    if (v > 0) latestVersionRef.current = v;
  }, [versionsData]);

  const saveDocContent = async (nextContent: string): Promise<void> => {
    if (!activeDoc) throw new Error('文件不存在');
    // §4.4: Markdown 也走同通道，PUT body 结构与旧 saveMutation 完全一致
    const result = await apiFetch<{
      ok: boolean;
      document: DocumentDetail;
      version: number;
      effects?: { git: { attempted: boolean; ok: boolean; pushed: boolean; noop?: boolean; commitHash?: string; error?: string } };
    }>(
      `/api/v1/documents/${activeDoc.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          content: nextContent,
          title: activeDoc.title ?? undefined,
          baseVersionNo: latestVersionRef.current || undefined,
        }),
      },
    );
    latestVersionRef.current = result.version;
    if (result.document) {
      queryClient.setQueryData<DocumentDetail | undefined>(['document', docParam], result.document);
    }
    void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['document-versions', docParam] });
    void queryClient.invalidateQueries({ queryKey: ['activities'] });

    // Git 效果 toast（对齐原 saveMutation.onSuccess，§4.4）
    const git = result.effects?.git;
    if (git?.attempted && git.ok && git.pushed) {
      showToast(`已保存，Git 自动提交 ${git.commitHash?.slice(0, 8) ?? ''} 并推送`);
    } else if (git?.attempted && git.ok && git.noop) {
      showToast('已保存（与仓库内容一致，无需提交）');
    } else if (git?.attempted && !git.ok) {
      showToast(`已保存，但 Git 自动提交失败：${git.error ?? '未知错误'}`);
    } else {
      showToast('已保存');
    }
  };

  // §6.2: 409 冲突处理（§4.4）—— 宿主统一处理，MarkdownViewer 和 CodeViewer 都调 saveDocContent
  // 409 时 catch 后 window.confirm 并让 viewer 自己决定是否加载最新
  const wrapSaveWithConflict = (saveFn: (content: string) => Promise<void>) => {
    return async (content: string): Promise<void> => {
      try {
        await saveFn(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('DOCUMENT_VERSION_CONFLICT')) {
          // §6.2: 冲突不静默覆盖——统一由宿主弹出 409 确认框（原 saveMutation 与 saveTextFile 各有一份，现合并）
          if (window.confirm('版本冲突：其他成员刚更新了此文件。\n\n点「确定」加载最新内容（当前未保存的修改将被丢弃，建议先复制到剪贴板）；点「取消」留在当前编辑状态。')) {
            void queryClient.invalidateQueries({ queryKey: ['document', docParam] });
            void queryClient.invalidateQueries({ queryKey: ['document-versions', docParam] });
          }
          throw err; // 仍然 throw，让 viewer 知道保存失败并设置 saveError
        }
        throw err; // 其他错误同样 throw 给 viewer
      }
    };
  };

  // §6.2: 统一的 onSave 回调，宿主把 409 冲突和 PUT 封装好，viewer 只管传 content
  const unifiedOnSave = wrapSaveWithConflict(saveDocContent);

  // ---- 二进制替换上传（图片/PDF/兜底查看器，§5.2 POST /documents/:id/versions/upload） ----
  const replaceUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!activeDoc) throw new Error('文件不存在');
      const form = new FormData();
      form.append('file', file);
      form.append('idempotencyKey', crypto.randomUUID());
      return apiFetch<{ document: DocumentDetail; version: { versionNo: number } }>(
        `/api/v1/documents/${activeDoc.id}/versions/upload`,
        { method: 'POST', body: form, headers: { 'Content-Type': '' } },
      );
    },
    onSuccess: (result) => {
      showToast('已替换上传并生成新版本');
      latestVersionRef.current = result.version.versionNo;
      if (result.document) {
        queryClient.setQueryData<DocumentDetail | undefined>(['document', docParam], {
          ...(activeDoc ?? result.document),
          ...result.document,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['document', docParam] });
      void queryClient.invalidateQueries({ queryKey: ['document-versions', docParam] });
      void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
    onError: (err) => {
      showToast(err instanceof Error ? err.message : '替换上传失败');
    },
  });

  // 活跃文档 → FileMeta（查看器插件契约；§6.2）
  const activeFileMeta: FileMeta | null = useMemo(() => {
    if (!activeDoc) return null;
    const resolved = resolveFileType(activeDoc.path, activeDoc.mime);
    return {
      id: activeDoc.id,
      path: activeDoc.path,
      title: activeDoc.title ?? basenameOf(activeDoc.path),
      kind: (activeDoc.kind ?? resolved.kind) as FileKind,
      ext: activeDoc.ext ?? resolved.ext,
      mime: activeDoc.mime ?? resolved.mime,
      size: activeDoc.size ?? 0,
      storageRef: activeDoc.storageRef,
      content: activeDoc.content,
      versionNo: versionsData?.items?.[0]?.versionNo ?? null,
      rawUrl: activeDoc.rawUrl,
      updatedAt: activeDoc.updatedAt,
      ownerName: activeDoc.updatedBy,
    };
  }, [activeDoc, versionsData]);

  // ---- 实时互见（需求 9）：订阅项目房间，他人保存时自动刷新/提示 ----
  const activeDocRef = useRef(activeDoc);
  useEffect(() => {
    activeDocRef.current = activeDoc;
  }, [activeDoc]);
  useEffect(() => {
    if (!projectId) return undefined;
    const rt = new EwikiRealtime();
    rt.connect();
    rt.subscribe(`project:${projectId}`);
    rt.on('document.updated', (payload) => {
      const p = payload as {
        documentId?: string;
        by?: string;
        created?: boolean;
        deleted?: boolean;
        moved?: boolean;
        folder?: boolean;
        documentIds?: string[];
      };
      // 他人新建/删除/移动/文件夹级联：当前查看的文件未必在事件中，目录树必须实时响应（§4.3/§4.5）
      if (!docParam || p.documentId !== docParam) {
        const treeAffected =
          p.created || p.deleted || p.moved || p.folder || Array.isArray(p.documentIds);
        if (treeAffected) {
          void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
        }
        return;
      }
      // 二进制文件无编辑态：替换上传/删除后直接刷新详情与版本（由查看器展示新内容或 404 空态）
      const cur = activeDocRef.current;
      if (cur && (cur.kind === 'binary' || p.deleted)) {
        if (p.deleted) {
          setSearchParams({});
        } else {
          void queryClient.invalidateQueries({ queryKey: ['document', docParam] });
          void queryClient.invalidateQueries({ queryKey: ['document-versions', docParam] });
          showToast(`${p.by ?? '其他成员'} 更新了此文件，已刷新为最新版本`);
        }
        return;
      }
      // §6.2: 文本类不再在 BrowsePage 判断 dirty —— MarkdownViewer/CodeViewer 内部各自管理 buffer
      // 直接 invalidate，viewer 的 useEffect 会感知 file.content 变化；viewer 内部会区分
      // clean（buffer === saved）时自动更新、dirty 时保留 buffer 等待用户保存（保存时触发 409）
      void queryClient.invalidateQueries({ queryKey: ['document', docParam] });
      void queryClient.invalidateQueries({ queryKey: ['document-versions', docParam] });
      showToast(`${p.by ?? '其他成员'} 更新了此文件，已刷新为最新内容`);
    });
    return () => rt.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, docParam, queryClient]);

  // ---- 新建文档 mutation ----
  const createDocMutation = useMutation({
    mutationFn: (input: { path: string; title?: string; content?: string }) =>
      apiFetch<DocumentListItem>(`/api/v1/projects/${projectId}/documents`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
    },
  });

  // ---- 目录树管理状态（D8：右键菜单 / 拖拽移动 / 重命名 / 删除） ----
  const [treeMenu, setTreeMenu] = useState<TreeMenuState | null>(null);
  // 文件信息抽屉（树菜单 / 卡片 / FileHost host.openOpenInfo 共用一个宿主）
  const [infoDocId, setInfoDocId] = useState<string | null>(null);
  const requestHistoryTab = useUiStore((s) => s.requestHistoryTab);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [moveDoc, setMoveDoc] = useState<DocumentListItem | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [draggingDoc, setDraggingDoc] = useState<DocumentListItem | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  // F2 新建流程：「+」下拉/文件夹右键 → 类型与目标文件夹 → 新建对话框
  const [createMenu, setCreateMenu] = useState<CreateMenuState | null>(null);
  const [createTarget, setCreateTarget] = useState<{ kind: CreateKind; folder: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  // F3 上传：隐藏文件选择器 + 受控 UploadManager（targetFolder=null = 项目根）
  const uploadFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadDialog, setUploadDialog] = useState<{
    open: boolean;
    targetFolder: string | null;
    files: File[] | { path: string; file: File }[] | null;
  }>(
    { open: false, targetFolder: null, files: null },
  );
  // 操作系统拖拽（文件/文件夹从 OS 拖入主区域）：与库内文档拖拽互斥
  const [osDragActive, setOsDragActive] = useState(false);
  const osDragDepth = useRef(0);

  // webkitdirectory 是非标准 DOM 属性，React JSX 类型不覆盖，用 callback ref 在挂载时设置
  const folderInputRefCb = (el: HTMLInputElement | null): void => {
    uploadFolderInputRef.current = el;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
    }
  };

  // 文档 meta 变更（PATCH：title 与 path 相互独立——标题编辑只发 title，重命名/移动只发 path；§4.5）
  const patchDocMutation = useMutation({
    mutationFn: (input: { id: string; title?: string; path?: string }) =>
      apiFetch<{ ok: boolean; document: DocumentListItem }>(`/api/v1/documents/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: input.title, path: input.path }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['document'] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });

  const deleteDocMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/v1/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });

  const renameFolderMutation = useMutation({
    mutationFn: (input: { from: string; to: string }) =>
      apiFetch<{ ok: boolean; moved: number }>(`/api/v1/projects/${projectId}/folders/rename`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['document'] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (folder: string) =>
      apiFetch<{ ok: boolean; deleted: number }>(`/api/v1/projects/${projectId}/folders/delete`, {
        method: 'POST',
        body: JSON.stringify({ folder }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['document'] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });

  // ---- Handlers ----
  const openDoc = (doc: DocumentListItem) => {
    navigate(`/projects/${projectId}/browse?doc=${doc.id}`);
  };
  const selectDocInSidebar = (doc: DocumentListItem) => {
    setSearchParams({ doc: doc.id });
  };
  const backToGrid = () => setSearchParams({});

  // ---- F2 新建：「+」下拉 → 选择类型与目标文件夹 → 新建对话框 ----
  const openCreateMenuAt = (e: React.MouseEvent, folder: string): void => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCreateMenu({ x: rect.right - 208, y: rect.bottom + 4, folder });
  };

  const startCreate = (kind: CreateKind, folder: string): void => {
    setCreateError(null);
    setCreateTarget({ kind, folder });
  };

  const createMenuItemsFor = (folder: string): TreeMenuItem[] => [
    { key: 'new-md', label: '新建 Markdown 文档', icon: FileText, onSelect: () => startCreate('markdown', folder) },
    { key: 'new-text', label: '新建文本 / 代码文件', icon: FileCode2, onSelect: () => startCreate('text', folder) },
    { key: 'new-folder', label: folder ? '新建子文件夹' : '新建文件夹', icon: FolderPlus, onSelect: () => startCreate('folder', folder) },
    { key: 'upload-files', label: '上传文件…', icon: Upload, dividerAbove: true, onSelect: () => openUploadPicker('files', folder) },
    { key: 'upload-folder', label: '上传文件夹…', icon: UploadCloud, onSelect: () => openUploadPicker('folder', folder) },
  ];

  // ---- F3 上传：隐藏 input 选择器 → UploadManager ----
  const openUploadPicker = (kind: 'files' | 'folder', folder: string): void => {
    const input = kind === 'files' ? uploadFileInputRef.current : uploadFolderInputRef.current;
    if (!input) return;
    input.value = '';
    input.dataset.target = folder || '';
    input.click();
  };

  const handleUploadPickerChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const target = e.target.dataset.target || '';
    setUploadDialog({ open: true, targetFolder: target || null, files: Array.from(list) });
  };

  const handleUploaded = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['activities'] });
  };

  // ---- 操作系统拖拽上传：仅响应来自 OS 的 Files，库内文档拖拽（draggingDoc）不拦截 ----
  const isOsFileDrag = (e: React.DragEvent): boolean =>
    canWrite && !draggingDoc && Array.from(e.dataTransfer.types).includes('Files');

  const handleOsDragEnter = (e: React.DragEvent): void => {
    if (!isOsFileDrag(e)) return;
    e.preventDefault();
    osDragDepth.current += 1;
    setOsDragActive(true);
  };
  const handleOsDragOver = (e: React.DragEvent): void => {
    if (!isOsFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleOsDragLeave = (e: React.DragEvent): void => {
    if (!isOsFileDrag(e)) return;
    osDragDepth.current = Math.max(0, osDragDepth.current - 1);
    if (osDragDepth.current === 0 || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
      osDragDepth.current = 0;
      setOsDragActive(false);
    }
  };
  const handleOsDrop = async (e: React.DragEvent): Promise<void> => {
    if (!isOsFileDrag(e)) return;
    e.preventDefault();
    osDragDepth.current = 0;
    setOsDragActive(false);
    const target = searchParams.get('folder') ?? null;
    const picked = await walkDataTransferEntries(e.dataTransfer);
    if (picked.length === 0) return;
    setUploadDialog({ open: true, targetFolder: target, files: picked });
  };

  // 新建 Markdown / 文本代码文件（对话框返回完整文件名，拼目标文件夹后 POST；§4.5/§5.2）
  const handleCreateFile = async (fileName: string): Promise<void> => {
    if (!createTarget || createTarget.kind === 'folder') return;
    setCreateError(null);
    const { folder, kind } = createTarget;
    const fullPath = folder ? `${folder}/${fileName}` : fileName;
    try {
      const doc = await createDocMutation.mutateAsync(
        kind === 'markdown'
          ? { path: fullPath, content: `# ${fileName.replace(/\.md$/i, '')}\n\n开始编写…\n` }
          : { path: fullPath, content: '' },
      );
      setCreateTarget(null);
      openDoc(doc);
    } catch (err) {
      setCreateError(prettyTreeError(err, '创建失败，请重试'));
    }
  };

  // 新建文件夹：一期无文件夹实体，以固定命名的空 .keep 占位使目录在树中出现（§4.2），不打开文档
  const handleCreateFolder = async (rawName: string): Promise<void> => {
    if (!createTarget) return;
    setCreateError(null);
    const slug = slugifyName(rawName) || 'new-folder';
    const folderPath = createTarget.folder ? `${createTarget.folder}/${slug}` : slug;
    try {
      await createDocMutation.mutateAsync({ path: `${folderPath}/.keep`, content: '' });
      setCreateTarget(null);
      showToast(`文件夹「${slug}」已创建`);
    } catch (err) {
      setCreateError(prettyTreeError(err, '文件夹创建失败，请重试'));
    }
  };

  const docs = docData?.items ?? [];

  // 文档所在文件夹（'' = 根目录）
  const folderOf = (p: string): string => {
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  };
  const fileNameOf = (p: string): string => p.split('/').pop() ?? p;

  // 项目内全部文件夹路径（供移动目标选择器），按路径排序
  const allFolders = useMemo(() => {
    const set = new Set<string>();
    for (const d of docs) {
      let folder = folderOf(d.path);
      while (folder) {
        set.add(folder);
        folder = folderOf(folder);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [docs]);

  // 文件夹内文档数量（删除确认用）
  const countDocsInFolder = (folder: string): number =>
    docs.filter((d) => d.path.startsWith(`${folder}/`)).length;

  // ---- 右键菜单 ----
  const openTreeMenu = (e: React.MouseEvent, target: TreeMenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setTreeMenu({ x: e.clientX, y: e.clientY, target });
  };

  // 文件信息抽屉（网格/聚焦两分支共用；FileHost host.openOpenInfo 也走这里）
  const openInfo = (doc: DocumentListItem) => setInfoDocId(doc.id);

  // 历史记录统一走 ProjectLayout 右栏 history tab（避免第二个历史入口）：
  // 目标文档不是当前聚焦文档时先切换，再发信号；ProjectRightSidebar 监听信号切 tab。
  const openHistory = (doc: DocumentListItem) => {
    if (docParam !== doc.id) {
      setSearchParams({ doc: doc.id });
    }
    requestHistoryTab();
  };

  const handleRenameConfirm = (value: string) => {
    if (!renameTarget) return;
    setRenameError(null);
    if (renameTarget.kind === 'doc') {
      const doc = renameTarget.doc;
      // 重命名 = 只改 path 的完整 basename（含扩展名），标题 title 保持独立（§4.5）
      const fileName = fileNameOfPath(doc.path).trim();
      const nextName = value.trim();
      if (!nextName || nextName === fileName) {
        setRenameTarget(null);
        return;
      }
      if (nextName.includes('/') || nextName.includes('\\')) {
        setRenameError('文件名不能包含 / 或 \\ ，如需移动请使用拖拽/移动菜单');
        return;
      }
      // F9：扩展名变更会改变文件类型与查看器，需二次确认（服务端以新扩展名重算 kind/mime）
      if (extOf(nextName).toLowerCase() !== extOf(doc.path).toLowerCase()) {
        const ok = window.confirm(
          `扩展名将由「${extOf(doc.path) || '无'}」改为「${extOf(nextName) || '无'}」，`
            + '文件类型与打开方式会随之变化（如 Markdown 预览/评论等能力可能消失）。确定继续？',
        );
        if (!ok) return;
      }
      const base = folderOf(doc.path);
      const newPath = base ? `${base}/${nextName}` : nextName;
      patchDocMutation.mutate(
        { id: doc.id, path: newPath },
        {
          onSuccess: () => {
            setRenameTarget(null);
            showToast('文件已重命名');
          },
          onError: (err) => setRenameError(prettyTreeError(err, '重命名失败')),
        },
      );
    } else {
      const from = renameTarget.path;
      const base = folderOf(from);
      const toSlug = slugifyName(value);
      const to = base ? `${base}/${toSlug}` : toSlug;
      if (!toSlug) {
        setRenameError('名称不合法');
        return;
      }
      if (to === from) {
        setRenameTarget(null);
        return;
      }
      renameFolderMutation.mutate(
        { from, to },
        {
          onSuccess: (r) => {
            setRenameTarget(null);
            showToast(`文件夹已重命名（${r.moved} 篇文档）`);
          },
          onError: (err) => setRenameError(prettyTreeError(err, '重命名失败')),
        },
      );
    }
  };

  const handleDeleteConfirm = () => {
    if (!confirmTarget) return;
    if (confirmTarget.kind === 'doc') {
      const doc = confirmTarget.doc;
      deleteDocMutation.mutate(doc.id, {
        onSuccess: () => {
          setConfirmTarget(null);
          showToast('文档已删除');
          if (docParam === doc.id) setSearchParams({});
        },
        onError: (err) => showToast(prettyTreeError(err, '删除失败')),
      });
    } else {
      deleteFolderMutation.mutate(confirmTarget.path, {
        onSuccess: (r) => {
          setConfirmTarget(null);
          showToast(`文件夹已删除（${r.deleted} 篇文档）`);
          if (activeDoc && activeDoc.path.startsWith(`${confirmTarget.path}/`)) setSearchParams({});
        },
        onError: (err) => showToast(prettyTreeError(err, '删除失败')),
      });
    }
  };

  const handleMoveDoc = (targetFolder: string) => {
    if (!moveDoc) return;
    setMoveError(null);
    const fileName = fileNameOf(moveDoc.path);
    const targetPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
    if (targetPath === moveDoc.path) {
      setMoveDoc(null);
      return;
    }
    patchDocMutation.mutate(
      { id: moveDoc.id, path: targetPath },
      {
        onSuccess: () => {
          setMoveDoc(null);
          showToast('文档已移动');
        },
        onError: (err) => setMoveError(prettyTreeError(err, '移动失败')),
      },
    );
  };

  // ---- 拖拽移动文档到文件夹 ----
  const handleDocDragStart = (doc: DocumentListItem, e: React.DragEvent) => {
    setDraggingDoc(doc);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/ewiki-doc-id', doc.id);
    } catch {
      // 部分浏览器对自定义 MIME 受限，dataTransfer 内仅作辅助，真实载荷走 state
    }
  };
  const handleDocDragEnd = () => {
    setDraggingDoc(null);
    setDragOverPath(null);
  };
  const handleFolderDragOver = (path: string, e: React.DragEvent) => {
    if (!draggingDoc) return;
    // 禁止拖入自身所在文件夹或其子路径（文档不能移动到自己的路径前缀）
    const currentFolder = folderOf(draggingDoc.path);
    if (path === currentFolder || path.startsWith(`${currentFolder}/`)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverPath !== path) setDragOverPath(path);
  };
  const handleFolderDragLeave = (path: string) => {
    setDragOverPath((cur) => (cur === path ? null : cur));
  };
  const handleFolderDrop = (path: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const doc = draggingDoc;
    setDraggingDoc(null);
    setDragOverPath(null);
    if (!doc) return;
    const currentFolder = folderOf(doc.path);
    if (path === currentFolder) return;
    const targetPath = `${path}/${fileNameOf(doc.path)}`;
    patchDocMutation.mutate(
      { id: doc.id, path: targetPath },
      {
        onSuccess: () => showToast(`已移动到「${path}」`),
        onError: (err) => showToast(prettyTreeError(err, '移动失败')),
      },
    );
  };

  // ---- Visible docs (grid 模式)：.keep 占位文件不在卡片网格展示（§4.2）；
  //      类型 facet 与关键字 AND 组合，类型一律由 shared resolveFileType 前端派生 ----
  const visibleDocs = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return docs
      .filter((d) => docPassesFilter(d, kw, facet))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [docs, keyword, facet]);

  // 真实文档数（不含 .keep 占位）：grid 空态以此为准
  const realDocCount = useMemo(() => docs.filter((d) => !isKeepPlaceholder(d)).length, [docs]);

  // 左栏折叠联动（PLAN 5.4.2）：按钮走 Panel 命令式 collapse/expand，
  // 折叠态由 Panel 的 onCollapse/onExpand 回调写回 state，拖拽与按钮双向同步（对齐原型 ProjectBrowse.jsx:1430-1440）
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const toggleLeftPanel = () => {
    const panel = leftPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
  };

  // =========================================================================
  // GRID MODE
  // =========================================================================
  if (!isFocused) {
    return (
      <div
        className="relative h-full"
        onDragEnter={handleOsDragEnter}
        onDragOver={handleOsDragOver}
        onDragLeave={handleOsDragLeave}
        onDrop={(e) => void handleOsDrop(e)}
      >
        <div className="h-full overflow-y-auto scrollbar-thin">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="relative w-80">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              <input type="text" className="input !pl-9" placeholder="在本项目中搜索…"
                value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="flex-1" />
            {/* 视图模式切换：tree（目录树）| list（表格）| grid（卡片） */}
            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md border" style={{ borderColor: 'var(--border-soft)' }}>
              {([
                { key: 'tree' as const, Icon: FolderTree, label: '目录树' },
                { key: 'list' as const, Icon: List, label: '列表' },
                { key: 'grid' as const, Icon: LayoutGrid, label: '网格' },
              ]).map(({ key, Icon, label }) => {
                const active = viewMode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setViewMode(key)}
                    title={label}
                    className={`h-8 px-2.5 inline-flex items-center gap-1 rounded text-xs transition ${
                      active
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                    }`}
                  >
                    <Icon size={14} />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="btn-secondary !h-9 !text-xs"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] })}>
              <RefreshCw size={15} /> 刷新
            </button>
            {canWrite && (
              <>
                <button type="button" className="btn-primary !h-9 !text-xs"
                  onClick={(e) => openCreateMenuAt(e, '')} disabled={createDocMutation.isPending}>
                  <Plus size={15} /> 新建
                </button>
                {createMenu && (
                  <TreeContextMenu
                    x={createMenu.x}
                    y={createMenu.y}
                    items={createMenuItemsFor(createMenu.folder)}
                    onClose={() => setCreateMenu(null)}
                  />
                )}
              </>
            )}
          </div>

          {/* =============== viewMode: tree — 左栏目录树 + 右栏占位 =============== */}
          {viewMode === 'tree' && (
            <div className="h-[calc(100vh-220px)] min-h-[360px]">
              <PanelGroup direction="horizontal" className="h-full rounded-lg border overflow-hidden"
                style={{ borderColor: 'var(--border-soft)' }}>
                <Panel defaultSize={30} minSize={20} collapsible>
                  <TreeSidebar
                    docs={docs}
                    activeDocId={null}
                    onSelect={openDoc}
                    onBack={backToGrid}
                    project={projectOverview ?? null}
                    collapsed={false}
                    onToggleCollapse={() => { /* 非 focused tree 视图不支持折叠 */ }}
                    onCreate={startCreate}
                    onUploadFiles={() => openUploadPicker('files', '')}
                    onUploadFolder={() => openUploadPicker('folder', '')}
                    canWrite={canWrite}
                    draggingDocId={null}
                    dragOverPath={null}
                    onMenu={openTreeMenu}
                    onDocDragStart={() => { /* 非 focused tree 视图禁用拖拽 */ }}
                    onDocDragEnd={() => {}}
                    onFolderDragOver={() => {}}
                    onFolderDragLeave={() => {}}
                    onFolderDrop={() => {}}
                    facet={facet}
                    facetCounts={facetCounts}
                    onFacetChange={setFacet}
                  />
                </Panel>
                <PanelResizeHandle className="resize-handle" />
                <Panel minSize={40}>
                  <div className="h-full flex flex-col items-center justify-center text-center px-6"
                    style={{ background: 'var(--bg-surface)' }}>
                    <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                      style={{ background: 'var(--bg-hover)' }}>
                      <FolderTree size={24} className="text-primary-500" />
                    </div>
                    <p className="text-sm font-medium text-neutral-700">从左侧目录树选择文件</p>
                    <p className="text-xs text-neutral-400 mt-1">点击文件以打开，双击文件夹展开</p>
                  </div>
                </Panel>
              </PanelGroup>
            </div>
          )}

          {/* =============== viewMode: list — 表格视图 =============== */}
          {viewMode === 'list' && (
            <div className="h-[calc(100vh-220px)] min-h-[360px] rounded-lg border overflow-hidden"
              style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface)' }}>
              {docsLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 h-10">
                      <div className="skeleton h-4 w-48" />
                      <div className="skeleton h-4 w-20" />
                      <div className="skeleton h-4 w-16" />
                      <div className="skeleton h-4 w-24" />
                      <div className="skeleton h-4 w-24" />
                    </div>
                  ))}
                </div>
              ) : realDocCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <FileText size={40} className="mx-auto mb-3 text-neutral-300" />
                  <p className="text-sm text-neutral-500">该项目暂无文档</p>
                  <p className="text-xs text-neutral-400 mt-1">可新建文档，或在项目设置中对 Git 存储源触发同步</p>
                </div>
              ) : (
                <ListView
                  docs={visibleDocs as unknown as ListRow[]}
                  onSelect={openDoc as unknown as (d: ListRow) => void}
                  onMenu={openTreeMenu as unknown as (e: React.MouseEvent, d: ListRow) => void}
                  keyword={keyword}
                  page={page}
                  onPageChange={setPage}
                  pageSize={pageSize}
                  loading={docsLoading}
                />
              )}
            </div>
          )}

          {/* =============== viewMode: grid — 卡片网格（现状） =============== */}
          {viewMode === 'grid' && (
            <>
              {docsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="card p-4 space-y-3">
                      <div className="skeleton h-3 w-24" />
                      <div className="skeleton h-5 w-32" />
                      <div className="skeleton h-3 w-full" />
                    </div>
                  ))}
                </div>
              ) : realDocCount === 0 ? (
                <div className="card p-10 text-center text-neutral-400">
                  <FileText size={40} className="mx-auto mb-3 text-neutral-300" />
                  <p className="text-sm">该项目暂无文档</p>
                  <p className="text-xs mt-1">可新建文档，或在项目设置中对 Git 存储源触发同步</p>
                </div>
              ) : visibleDocs.length === 0 ? (
                <div className="card p-10 text-center text-neutral-400 max-w-md mx-auto mt-10">
                  <Search size={32} className="mx-auto mb-3 text-neutral-300" />
                  <p className="text-sm">没有找到匹配的文档</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {visibleDocs.map((d, i) => (
                    <DocumentCard
                      key={d.id}
                      doc={d}
                      onOpen={openDoc}
                      onOpenInfo={openInfo}
                      onOpenHistory={openHistory}
                      index={i}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        </div>

        {/* OS 拖拽上传遮罩 */}
        {osDragActive && (
          <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed bg-primary-50/70 backdrop-blur-sm"
            style={{ borderColor: 'var(--primary-400, #60a5fa)' }}>
            <div className="flex flex-col items-center gap-2 text-primary-600">
              <UploadCloud size={36} />
              <span className="text-sm font-medium">
                松开以上传到{searchParams.get('folder') ? `「${searchParams.get('folder')}」` : '当前文件夹（根目录）'}
              </span>
            </div>
          </div>
        )}

        {/* 隐藏的文件 / 文件夹选择器（webkitdirectory 非标准属性，通过 ref 设置） */}
        <input ref={uploadFileInputRef} type="file" multiple className="hidden"
          onChange={handleUploadPickerChange} />
        <input ref={folderInputRefCb} type="file" multiple className="hidden"
          onChange={handleUploadPickerChange} />
        <UploadManager
          open={uploadDialog.open}
          projectId={projectId ?? ''}
          targetFolder={uploadDialog.targetFolder}
          initialFiles={uploadDialog.files}
          onClose={() => setUploadDialog((s) => ({ ...s, open: false }))}
          onUploaded={handleUploaded}
        />
        <FileInfoDrawer
          documentId={infoDocId}
          open={!!infoDocId}
          canWrite={canWrite}
          onClose={() => setInfoDocId(null)}
          onOpenHistory={(id) => {
            const target = docs.find((d) => d.id === id);
            if (target) openHistory(target);
          }}
        />
      </div>
    );
  }

  // =========================================================================
  // FOCUSED MODE — 三栏 flex 布局（§6.2: 统一走 FileHost，不再区分 Markdown/Code）
  // =========================================================================
  return (
    <PanelGroup direction="horizontal" className="h-full flex overflow-hidden">
      <Panel
        ref={leftPanelRef}
        defaultSize={22}
        minSize={14}
        collapsible
        collapsedSize={4}
        onCollapse={() => setLeftCollapsed(true)}
        onExpand={() => setLeftCollapsed(false)}
        className="h-full min-w-0"
      >
      <TreeSidebar
        docs={docs}
        activeDocId={activeDoc?.id ?? null}
        onSelect={selectDocInSidebar}
        onBack={backToGrid}
        project={projectOverview ?? null}
        collapsed={leftCollapsed}
        onToggleCollapse={toggleLeftPanel}
        onCreate={startCreate}
        onUploadFiles={() => openUploadPicker('files', '')}
        onUploadFolder={() => openUploadPicker('folder', '')}
        canWrite={canWrite}
        draggingDocId={draggingDoc?.id ?? null}
        dragOverPath={dragOverPath}
        onMenu={openTreeMenu}
        onDocDragStart={handleDocDragStart}
        onDocDragEnd={handleDocDragEnd}
        onFolderDragOver={handleFolderDragOver}
        onFolderDragLeave={handleFolderDragLeave}
        onFolderDrop={handleFolderDrop}
        facet={facet}
        facetCounts={facetCounts}
        onFacetChange={setFacet}
      />
      </Panel>
      <PanelResizeHandle className="resize-handle" />
      <Panel minSize={30} className="h-full min-w-0">
      <div
        className="relative h-full"
        onDragEnter={handleOsDragEnter}
        onDragOver={handleOsDragOver}
        onDragLeave={handleOsDragLeave}
        onDrop={(e) => void handleOsDrop(e)}
      >
      {/* §6.2: 统一走 FileHost — resolveFileType 选 MarkdownViewer/CodeViewer/ImageViewer/PdfViewer/FallbackViewer */}
      {activeFileMeta ? (
        <FileHost
          file={activeFileMeta}
          canWrite={canWrite}
          isDark={isDark}
          onSave={unifiedOnSave}
          // §4.1-F16 Markdown 引用图片：透传 projectId 给 MarkdownViewer → ImagePickerModal，
          //   用于库内图片列表查询 GET /api/v1/projects/:id/documents?kind=binary
          projectId={projectId}
          onReplaced={() => {
            /* replaceUploadMutation 已完成缓存刷新；签名 rawUrl 由 invalidate document 后新详情下发 */
          }}
          onReplaceUpload={async (file) => {
            await replaceUploadMutation.mutateAsync(file);
          }}
          host={{
            openOpenInfo: () => {
              if (activeDoc) setInfoDocId(activeDoc.id);
            },
            openHistory: () => {
              if (activeDoc) openHistory(activeDoc);
            },
          }}
        />
      ) : (
        // 加载中（activeFileMeta 为 null = activeDoc 还没查回来）时显示 FileHost 自处理空态
        <FileHost
          file={
            {
              id: docParam ?? '',
              path: '',
              title: '',
              kind: 'text',
              ext: '',
              mime: '',
              size: 0,
              content: null,
            } as FileMeta
          }
          canWrite={canWrite}
          isDark={isDark}
          onSave={unifiedOnSave}
          // §4.1-F16 Markdown 引用图片：同样透传 projectId（空态时也可能短暂展示 MarkdownViewer）
          projectId={projectId}
          onReplaced={() => {}}
          host={{
            openOpenInfo: () => {
              if (activeDoc) setInfoDocId(activeDoc.id);
            },
            openHistory: () => {
              if (activeDoc) openHistory(activeDoc);
            },
          }}
        />
      )}
      {osDragActive && (
        <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed bg-primary-50/70 backdrop-blur-sm"
          style={{ borderColor: 'var(--primary-400, #60a5fa)' }}>
          <div className="flex flex-col items-center gap-2 text-primary-600">
            <UploadCloud size={36} />
            <span className="text-sm font-medium">
              松开以上传到{searchParams.get('folder') ? `「${searchParams.get('folder')}」` : '当前文件夹（根目录）'}
            </span>
          </div>
        </div>
      )}
      </div>
      </Panel>
      {/* 右侧协作面板（AI/评论/历史）由 ProjectLayout.ProjectRightSidebar 承载，避免双右栏 */}

      {/* 目录树右键菜单 */}
      {treeMenu && (
        <TreeContextMenu
          x={treeMenu.x}
          y={treeMenu.y}
          onClose={() => setTreeMenu(null)}
          items={buildTreeMenuItems(treeMenu.target, canWrite, {
            onOpenInfo: (d) => {
              setTreeMenu(null);
              openInfo(d);
            },
            onOpenHistory: (d) => {
              setTreeMenu(null);
              openHistory(d);
            },
            onRenameDoc: (d) => {
              setTreeMenu(null);
              setRenameError(null);
              setRenameTarget({ kind: 'doc', doc: d });
            },
            onMoveDoc: (d) => {
              setTreeMenu(null);
              setMoveError(null);
              setMoveDoc(d);
            },
            onDeleteDoc: (d) => {
              setTreeMenu(null);
              setConfirmTarget({ kind: 'doc', doc: d });
            },
            onRenameFolder: (path) => {
              setTreeMenu(null);
              setRenameError(null);
              setRenameTarget({ kind: 'folder', path });
            },
            onDeleteFolder: (path) => {
              setTreeMenu(null);
              setConfirmTarget({ kind: 'folder', path, count: countDocsInFolder(path) });
            },
            onCreateIn: (kind, folder) => {
              setTreeMenu(null);
              startCreate(kind, folder);
            },
          })}
        />
      )}

      {/* 重命名弹窗（文件完整文件名 / 文件夹名；标题编辑走 FileHost 宿主） */}
      {renameTarget && (
        <RenameDialog
          title={renameTarget.kind === 'doc' ? '重命名文件' : '重命名文件夹'}
          label={renameTarget.kind === 'doc'
            ? '输入完整文件名（须含扩展名，所在文件夹不变）；修改扩展名会改变文件类型与打开方式'
            : '文件夹改名后，其中文档路径会同步更新（Slug：小写字母/数字/中文，连字符分隔）'}
          initialValue={
            renameTarget.kind === 'doc'
              ? fileNameOfPath(renameTarget.doc.path)
              : renameTarget.path.split('/').pop() ?? ''
          }
          busy={patchDocMutation.isPending || renameFolderMutation.isPending}
          error={renameError}
          onCancel={() => setRenameTarget(null)}
          onConfirm={handleRenameConfirm}
        />
      )}

      {/* 删除确认 */}
      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.kind === 'doc' ? '删除文档' : '删除文件夹'}
          busy={deleteDocMutation.isPending || deleteFolderMutation.isPending}
          message={
            confirmTarget.kind === 'doc' ? (
              <>
                确定删除文档「{confirmTarget.doc.title ?? confirmTarget.doc.path}」？
                <br />
                删除后可由管理员在回收站恢复。
              </>
            ) : (
              <>
                确定删除文件夹「{confirmTarget.path}」？
                <br />
                其中的 <b>{confirmTarget.count}</b> 篇文档将一并被删除，可由管理员在回收站恢复。
              </>
            )
          }
          onCancel={() => setConfirmTarget(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}

      {/* 移动文档 */}
      {moveDoc && (
        <MoveToDialog
          folders={allFolders}
          currentFolder={folderOf(moveDoc.path)}
          busy={patchDocMutation.isPending}
          error={moveError}
          onCancel={() => setMoveDoc(null)}
          onConfirm={handleMoveDoc}
        />
      )}

      {/* F2 新建：Markdown / 文本代码文件对话框（成功后打开新文档） */}
      {createTarget && createTarget.kind !== 'folder' && (
        <NewFileDialog
          mode={createTarget.kind}
          targetFolder={createTarget.folder}
          busy={createDocMutation.isPending}
          error={createError}
          onCancel={() => setCreateTarget(null)}
          onConfirm={(fileName) => void handleCreateFile(fileName)}
        />
      )}

      {/* 新建文件夹对话框（以空 .keep 占位使目录在树中出现，成功后不打开文档） */}
      {createTarget?.kind === 'folder' && (
        <NewFolderDialog
          busy={createDocMutation.isPending}
          error={createError}
          onCancel={() => setCreateTarget(null)}
          onConfirm={(folderName) => void handleCreateFolder(folderName)}
        />
      )}

      {/* F3 上传：隐藏的文件 / 文件夹选择器（webkitdirectory 非标准属性，通过 ref 设置） */}
      <input ref={uploadFileInputRef} type="file" multiple className="hidden"
        onChange={handleUploadPickerChange} />
      <input ref={folderInputRefCb} type="file" multiple className="hidden"
        onChange={handleUploadPickerChange} />
      <UploadManager
        open={uploadDialog.open}
        projectId={projectId ?? ''}
        targetFolder={uploadDialog.targetFolder}
        initialFiles={uploadDialog.files}
        onClose={() => setUploadDialog((s) => ({ ...s, open: false }))}
        onUploaded={handleUploaded}
      />

      {/* 文件信息抽屉（树/卡片/查看器/md 编辑器共用宿主） */}
      <FileInfoDrawer
        documentId={infoDocId}
        open={!!infoDocId}
        canWrite={canWrite}
        onClose={() => setInfoDocId(null)}
        onOpenHistory={(id) => {
          const target = docs.find((d) => d.id === id);
          if (target) openHistory(target);
        }}
      />
    </PanelGroup>
  );
}

// ---- 右键菜单项构造（文档 / 文件夹 / 根；只读角色不返回任何可写项，
// 但「文件信息 / 历史记录」对只读角色也可见） ----
function buildTreeMenuItems(
  target: TreeMenuTarget,
  canWrite: boolean,
  handlers: {
    onOpenInfo: (d: DocumentListItem) => void;
    onOpenHistory: (d: DocumentListItem) => void;
    onRenameDoc: (d: DocumentListItem) => void;
    onMoveDoc: (d: DocumentListItem) => void;
    onDeleteDoc: (d: DocumentListItem) => void;
    onRenameFolder: (path: string) => void;
    onDeleteFolder: (path: string) => void;
    onCreateIn: (kind: CreateKind, folder: string) => void;
  },
): TreeMenuItem[] {
  if (target.kind === 'doc') {
    const d = target.doc;
    return [
      { key: 'info', label: '文件信息', icon: FileCog, onSelect: () => handlers.onOpenInfo(d) },
      { key: 'history', label: '历史记录', icon: History, onSelect: () => handlers.onOpenHistory(d) },
      ...(canWrite
        ? [
            { key: 'rename' as const, label: '重命名文件', icon: Pencil, dividerAbove: true, onSelect: () => handlers.onRenameDoc(d) },
            { key: 'move' as const, label: '移动到…', icon: FolderInput, onSelect: () => handlers.onMoveDoc(d) },
            { key: 'delete' as const, label: '删除', icon: Trash2, danger: true, onSelect: () => handlers.onDeleteDoc(d) },
          ]
        : []),
    ];
  }
  if (!canWrite) return [];
  const folder = target.kind === 'folder' ? target.path : '';
  return [
    { key: 'new-md', label: '新建 Markdown 文档', icon: FileText, onSelect: () => handlers.onCreateIn('markdown', folder) },
    { key: 'new-text', label: '新建文本 / 代码文件', icon: FileCode2, onSelect: () => handlers.onCreateIn('text', folder) },
    ...(target.kind === 'folder'
      ? [
          { key: 'new-folder' as const, label: '新建子文件夹', icon: FolderPlus, onSelect: () => handlers.onCreateIn('folder', folder) },
          { key: 'rename' as const, label: '重命名文件夹', icon: Pencil, onSelect: () => handlers.onRenameFolder(folder) },
          { key: 'delete' as const, label: '删除文件夹', icon: Trash2, danger: true, onSelect: () => handlers.onDeleteFolder(folder) },
        ]
      : [
          { key: 'new-folder' as const, label: '新建文件夹', icon: FolderPlus, onSelect: () => handlers.onCreateIn('folder', folder) },
        ]),
  ];
}

// ---- OS 拖拽：递归展开 DataTransfer 中的文件 / 文件夹（File System Entries API） ----
// 路径以拖入根项的名称起拼（posix，形如 my-folder/sub/a.txt），与 input[webkitdirectory]
// 的 file.webkitRelativePath 保持一致；entry API 不可用或任何一步失败时，回退
// dataTransfer.files（平铺文件；浏览器对拖拽文件夹一般不填充此处，仅作兜底）。
/* eslint-disable @typescript-eslint/no-explicit-any */
type PickedEntry = { path: string; file: File };

function walkDataTransferEntries(dt: DataTransfer): Promise<PickedEntry[]> {
  const fallback = (): PickedEntry[] =>
    Array.from(dt.files ?? []).map((f) => ({
      path: (f as any).webkitRelativePath || f.name,
      file: f,
    }));

  if (!dt.items || typeof dt.items.length !== 'number') {
    return Promise.resolve(fallback());
  }
  const roots: any[] = [];
  for (let i = 0; i < dt.items.length; i += 1) {
    const item = dt.items[i];
    if (item.kind !== 'file') continue;
    const entry = typeof (item as any).webkitGetAsEntry === 'function'
      ? (item as any).webkitGetAsEntry()
      : null;
    if (entry) roots.push(entry);
  }
  if (roots.length === 0) return Promise.resolve(fallback());

  const entryToFile = (entry: any): Promise<File> =>
    new Promise((resolve, reject) => entry.file(resolve, reject));

  const readAllEntries = (reader: any): Promise<any[]> =>
    new Promise((resolve, reject) => {
      const out: any[] = [];
      const readBatch = (): void => {
        reader.readEntries(
          (batch: any[]) => {
            if (!batch || batch.length === 0) {
              resolve(out);
              return;
            }
            out.push(...batch);
            readBatch();
          },
          reject,
        );
      };
      readBatch();
    });

  const walk = async (entry: any, prefix: string, out: PickedEntry[]): Promise<void> => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      const children = await readAllEntries(entry.createReader());
      for (const child of children) {
        await walk(child, rel, out);
      }
    } else if (entry.isFile) {
      const file = await entryToFile(entry);
      out.push({ path: rel, file });
    }
  };

  return (async () => {
    const out: PickedEntry[] = [];
    try {
      for (const root of roots) {
        await walk(root, '', out);
      }
    } catch {
      return fallback();
    }
    return out.length > 0 ? out : fallback();
  })();
}
