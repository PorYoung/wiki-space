import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import MDEditor from '@uiw/react-md-editor';
import { useTheme } from '../theme/ThemeProvider';
import { markdownToHtml, slugify } from '../lib/markdown';
import { useMermaidRender } from '../lib/use-mermaid-render';
import { EwikiRealtime } from '../lib/ws/client';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  Eye,
  FileCode2,
  FileCog,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Filter,
  GitBranch,
  History,
  Image as ImageIcon,
  ImagePlus,
  Keyboard,
  Layers,
  MoreHorizontal,
  Palette,
  PenTool,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Search,
  Sun,
  Moon,
  Tag,
  Trash2,
  Undo2,
  Upload,
  UploadCloud,
  X,
  type LucideIcon,
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
import { fetchRawBlob, useAuthImageUrl } from '../fileview/api';
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
import { createUploadSession, uploadFileXhr, explainUploadError } from '../tree/upload-api';
import { fileIconOf, docMatchesFacet, FILE_FACETS, type FileFacetId, type FileTypeId } from '../tree/fileIcons';
import { useUiStore } from '../stores/uiStore';

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

/** 取库内 posix 路径的目录段（根文档返回 ''） */
function dirOfPosix(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = norm.lastIndexOf('/');
  return idx < 0 ? '' : norm.slice(0, idx);
}

/**
 * 计算从文档 docPath 指向目标资源 targetPath 的相对 posix 路径（§5.3 选图插入）：
 * 同目录直接 basename；子目录无前缀；上级目录用 ../ 归一；path.normalize 只吃 '/'
 * 输入，Windows 反斜杠会被当成普通字符，故先显式 replace 再手工压栈。
 */
function relativePosix(docPath: string, targetPath: string): string {
  const fromParts = dirOfPosix(docPath).split('/').filter(Boolean);
  const toParts = targetPath.replace(/\\/g, '/').split('/').filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) {
    common += 1;
  }
  const ups = fromParts.length - common;
  const down = toParts.slice(common);
  const upSegs = Array.from({ length: ups }, () => '..');
  return [...upSegs, ...down].join('/');
}

/** 生成插入到正文的图片 markdown（alt 取标题或无扩展名 basename） */
function buildImageMarkdown(label: string, relPath: string): string {
  const alt = (label || '').replace(/[\[\]]/g, '');
  return `![${alt}](${relPath.replace(/\)/g, '%29')})`;
}



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

/** 文档预览渲染：markdown-it（表格/高亮/KaTeX/mermaid）统一入口见 lib/markdown.ts；TOC 提取仍走源文正则 */
function extractToc(md: string | null): Array<{ level: number; text: string; id: string }> {
  if (!md) return [];
  const lines = md.split('\n');
  const toc: Array<{ level: number; text: string; id: string }> = [];
  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h1 = line.match(/^#\s+(.+)$/);
    if (h3) toc.push({ level: 3, text: h3[1]!.trim(), id: slugify(h3[1]!) });
    else if (h2) toc.push({ level: 2, text: h2[1]!.trim(), id: slugify(h2[1]!) });
    else if (h1) toc.push({ level: 1, text: h1[1]!.trim(), id: slugify(h1[1]!) });
  }
  return toc;
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
// Document editor — 中间内容区
// ---------------------------------------------------------------------------

const RENDER_THEMES: Array<{ key: string; label: string; desc: string; Icon: LucideIcon }> = [
  { key: 'plain', label: '经典', desc: '默认无衬线 · 紧凑', Icon: FileText },
  { key: 'book', label: '书籍', desc: '衬线体 · 宽松行距', Icon: BookOpen },
  { key: 'journal', label: '期刊', desc: '窄栏双端对齐', Icon: FileText },
  { key: 'compact', label: '工程风', desc: '等宽字体 · 大密度', Icon: Code },
  { key: 'tech', label: '科技蓝', desc: '冷色调高亮', Icon: Layers },
  { key: 'solarized-light', label: 'Solarized Light', desc: '经典米黄', Icon: Sun },
  { key: 'solarized-dark', label: 'Solarized Dark', desc: '经典深蓝', Icon: Moon },
];

// 编辑器快捷键速查（@uiw/react-md-editor 内置 Markdown 快捷键 + 页面级快捷键）
const SHORTCUT_GROUPS: Array<{ title: string; items: Array<{ keys: string; desc: string }> }> = [
  {
    title: '编辑',
    items: [
      { keys: 'Ctrl/⌘ + B', desc: '加粗' },
      { keys: 'Ctrl/⌘ + I', desc: '斜体' },
      { keys: 'Ctrl/⌘ + L', desc: '链接' },
      { keys: 'Ctrl/⌘ + K', desc: '图片' },
      { keys: 'Ctrl/⌘ + Q', desc: '引用' },
      { keys: 'Ctrl/⌘ + J', desc: '行内代码' },
      { keys: 'Ctrl/⌘ + Shift + J', desc: '代码块' },
      { keys: 'Ctrl/⌘ + H', desc: '分割线' },
      { keys: 'Ctrl/⌘ + /', desc: '注释' },
    ],
  },
  {
    title: '行操作',
    items: [
      { keys: 'Tab / Shift+Tab', desc: '缩进 / 减少缩进' },
      { keys: 'Ctrl/⌘ + D', desc: '复制当前行' },
      { keys: 'Alt + ↑ / ↓', desc: '上移 / 下移当前行' },
      { keys: 'Enter', desc: '列表中自动续行' },
    ],
  },
  {
    title: '文档',
    items: [
      { keys: 'Ctrl/⌘ + S', desc: '保存文档' },
      { keys: 'Ctrl/⌘ + E', desc: '编辑 / 预览切换' },
      { keys: 'Esc', desc: '编辑态切回预览' },
    ],
  },
];

/** 鉴权缩略图：/raw 需 Bearer，img 不能直接指，故走 objectURL（卸载自动 revoke） */
function AuthImageThumb({ id, className, alt = '' }: { id: string; className?: string; alt?: string }): React.ReactElement {
  const url = useAuthImageUrl(id);
  if (!url) {
    return (
      <span className={`flex items-center justify-center text-neutral-300 ${className ?? ''}`}>
        <ImageIcon size={22} />
      </span>
    );
  }
  return <img src={url} alt={alt} loading="lazy" className={className} />;
}

// ---------------------------------------------------------------------------
// 插入图片弹层（§5.3）：列出库内 typeId=image 图片 + 当场上传新图；无新增 .tsx 文件，
// 作为 BrowsePage 内部组件与 DocumentEditor 同文件；上传冲突用 window.confirm 三策略最低限度处理
// ---------------------------------------------------------------------------

function ImagePickerModal({
  projectId,
  docs,
  currentDocPath,
  canWrite,
  onClose,
  onPick,
  onUploaded,
}: {
  projectId: string;
  docs: DocumentListItem[];
  currentDocPath: string;
  canWrite: boolean;
  onClose: () => void;
  onPick: (image: DocumentListItem) => void;
  onUploaded: () => void;
}): React.ReactElement {
  const [kw, setKw] = useState('');
  const [targetFolder, setTargetFolder] = useState(dirOfPosix(currentDocPath));
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const d of docs) {
      const dir = dirOfPosix(d.path);
      if (dir) set.add(dir);
    }
    return ['', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [docs]);

  const images = useMemo(() => {
    const kwl = kw.trim().toLowerCase();
    return docs
      .filter((d) => !isKeepPlaceholder(d) && resolveFileType(d.path, d.mime).typeId === 'image')
      .filter((d) => !kwl || d.path.toLowerCase().includes(kwl) || (d.title ?? '').toLowerCase().includes(kwl))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [docs, kw]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return;
    const imageFiles = Array.from(files).filter((f) => resolveFileType(f.name, f.type || null).typeId === 'image');
    if (imageFiles.length === 0) {
      window.alert('仅支持上传图片文件（png / jpg / gif / webp / svg 等）');
      return;
    }
    setBusy(true);
    try {
      // 1) 批量预检（大小/路径/同名冲突）
      const candidates = imageFiles.map((f) => ({
        path: targetFolder ? `${targetFolder}/${f.name}` : f.name,
        size: f.size,
        mime: f.type || null,
      }));
      const session = await createUploadSession(projectId, candidates);
      let uploadedCount = 0;
      for (let i = 0; i < imageFiles.length; i += 1) {
        const file = imageFiles[i]!;
        const item = session.items[i]!;
        if (item.decision === 'reject') {
          window.alert(`「${file.name}」被拒绝：${item.reason || '不符合上传条件'}`);
          continue;
        }
        // 2) 冲突：最低限度 window.confirm 三策略（替换 / 自动共存 / 取消）
        let policy: 'error' | 'replace' | 'rename' = 'error';
        if (item.decision === 'conflict') {
          const choice = window.confirm(
            `「${file.name}」已存在。\n\n确定 = 替换原文件并生成新版本\n取消 = 自动改名共存（-1 / -2 后缀）\n\n（按浏览器对话框 Esc 后重试可放弃该文件）`,
          );
          policy = choice ? 'replace' : 'rename';
        }
        const idemKey = `md-image-${Date.now()}-${i}-${file.size}`;
        try {
          const result = await uploadFileXhr(projectId, item.path, file, policy, idemKey);
          uploadedCount += 1;
          // rename 策略下服务端返回真实落库路径：自动选中刚上传的图片
          const finalPath = result.path || item.path;
          const picked = docs.find((d) => d.path === finalPath);
          if (i === imageFiles.length - 1 || imageFiles.length === 1) {
            if (!picked) onUploaded();
          }
          void result;
        } catch (err) {
          window.alert(`「${file.name}」上传失败：${explainUploadError(err)}`);
        }
      }
      if (uploadedCount > 0) onUploaded();
    } catch (err) {
      window.alert(explainUploadError(err));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/40 p-4 backdrop-blur-sm"
      onMouseDown={onClose}>
      <div className="flex max-h-[82vh] w-[640px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl animate-fade-up"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--border-soft)' }}>
          <ImagePlus size={16} className="text-primary-600" />
          <h3 className="text-sm font-semibold text-neutral-800">插入图片</h3>
          <span className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            role="button" tabIndex={0} onClick={onClose}><X size={14} /></span>
        </div>

        {/* 上传区：默认当前 md 同目录，可改到其他库内目录 */}
        {canWrite && (
          <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border-soft)' }}>
            <div className="flex items-center gap-2">
              <select value={targetFolder} onChange={(e) => setTargetFolder(e.target.value)}
                className="h-8 max-w-[260px] truncate rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-700 focus:border-primary-400 focus:outline-none">
                {folders.map((f) => (
                  <option key={f || '/'} value={f}>{f || '根目录'}</option>
                ))}
              </select>
              <button type="button" className="btn-secondary !h-8 !text-xs" disabled={busy}
                onClick={() => fileInputRef.current?.click()}>
                <Upload size={13} /> {busy ? '上传中…' : '上传新图片到此目录'}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => void handleFiles(e.target.files)} />
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-400">新图上传后会插入相对路径，随文档一起移动目录仍可解析</p>
          </div>
        )}

        <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--border-soft)' }}>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input type="text" className="h-8 w-full rounded-md bg-neutral-100 pl-8 pr-3 text-xs placeholder:text-neutral-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
              placeholder="按路径 / 标题搜索库内图片…" value={kw} onChange={(e) => setKw(e.target.value)} autoFocus />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
          {images.length === 0 ? (
            <div className="py-10 text-center text-xs text-neutral-400">
              <ImageIcon size={28} className="mx-auto mb-2 text-neutral-300" />
              库内暂无图片{kw ? '匹配' : ''}，{canWrite ? '可在上方上传' : '请联系有编辑权限的成员上传'}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {images.map((img) => (
                <button key={img.id} type="button" onClick={() => onPick(img)}
                  className="group flex flex-col overflow-hidden rounded-lg border border-neutral-200 text-left transition hover:border-primary-400 hover:shadow-sm">
                  <div className="flex h-20 items-center justify-center overflow-hidden bg-neutral-50">
                    <AuthImageThumb id={img.id} className="max-h-full max-w-full object-contain" />
                  </div>
                  <div className="truncate px-2 py-1.5 text-[11px] text-neutral-600 group-hover:text-primary-700" title={img.path}>
                    {fileNameOfPath(img.path)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentEditor({
  doc,
  editContent,
  onEditChange,
  view,
  setView,
  onSave,
  saving,
  renderTheme,
  setRenderTheme,
  canWrite,
  onRenameTitle,
  renamingTitle,
  onOpenInfo,
  onOpenHistory,
  projectId,
  docs,
  onPickImage,
}: {
  doc: DocumentDetail | null;
  editContent: string;
  onEditChange: (v: string) => void;
  view: 'preview' | 'edit';
  setView: (v: 'preview' | 'edit') => void;
  onSave: () => void;
  saving: boolean;
  renderTheme: string;
  setRenderTheme: (t: string) => void;
  /** 当前用户是否可编辑文档（false = 只读：隐藏编辑/保存入口，禁用双击进入编辑） */
  canWrite: boolean;
  /** 标题元数据编辑（仅 PATCH title，不改文件名/path；§4.5） */
  onRenameTitle: (title: string) => Promise<void> | void;
  renamingTitle: boolean;
  /** 打开文件信息抽屉（md 也走统一宿主） */
  onOpenInfo: () => void;
  /** 打开右栏历史 tab */
  onOpenHistory: () => void;
  /** 当前项目 id（选图弹层上传目标目录所需） */
  projectId: string;
  /** 项目内全量文档列表（选图弹层过滤 typeId=image） */
  docs: DocumentListItem[];
  /** 选图完成回调：插入生成的 markdown 到正文末尾 */
  onPickImage: (item: { docPath: string; label: string }) => void;
}): React.ReactElement {
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const { isDark } = useTheme();
  const [fadeKey, setFadeKey] = useState(0);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  // 保存/视图切换的最新引用，供全局快捷键调用
  const onSaveRef = useRef(onSave);
  const setViewRef = useRef(setView);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { setViewRef.current = setView; }, [setView]);

  const tocItems = useMemo(() => extractToc(doc?.content ?? null), [doc?.content]);
  // 预览 HTML：markdown-it 渲染（GFM 表格/代码高亮/KaTeX/mermaid 占位容器）
  const previewHtml = useMemo(() => markdownToHtml(doc?.content ?? null), [doc?.content]);
  // mermaid 占位容器异步渲染为 SVG（懒加载 mermaid，跟随明暗主题）
  useMermaidRender(previewScrollRef, view === 'preview', isDark, previewHtml);

  // ---- P3a：markdown 预览相对路径图片 → 鉴权拉 raw → object URL ----
  // markdown 管线输出纯 HTML `<img src="相对路径">`，浏览器裸 fetch 会 401；
  // 这里在 DOM 渲染后扫描相对路径 img，按库内 posix 路径解析图片文档 → fetchRawBlob → object URL。
  useEffect(() => {
    if (view !== 'preview' || !doc?.content || !previewScrollRef.current) return undefined;
    const container = previewScrollRef.current;
    let cancelled = false;
    const objectUrls: string[] = [];

    const resolve = (src: string): DocumentListItem | undefined => {
      // 纯 posix：doc.path 的目录段 + src 相对路径 resolve → docs 里精确匹配（与 shared links.ts 同口径）
      const fromDir = dirOfPosix(doc.path);
      const combined = src.startsWith('/') ? src : `${fromDir}/${src}`;
      const segments: string[] = [];
      for (const seg of combined.replace(/\\/g, '/').split('/')) {
        if (!seg || seg === '.') continue;
        if (seg === '..') segments.pop();
        else segments.push(seg);
      }
      const posix = segments.join('/');
      return docs.find((d) => d.path === posix);
    };

    const kickoff = (): void => {
      const imgs = container.querySelectorAll('img[src]');
      for (const img of imgs) {
        const raw = img.getAttribute('src') ?? '';
        // 跳过 http / https / data: / mailto / # 锚点 / 绝对路径（/开头视为站外静态资源）
        if (/^(https?:|data:|mailto:)/i.test(raw) || raw.startsWith('#') || raw.startsWith('/')) continue;
        // 跳过已被替换过的 object URL（revoke 前保持）
        if (raw.startsWith('blob:')) continue;

        const target = resolve(raw);
        if (!target || target.kind !== 'binary') continue;

        fetchRawBlob({ id: target.id, rawUrl: undefined } as FileMeta)
          .then((blob) => {
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            img.setAttribute('src', url);
          })
          .catch(() => {
            // 拉取失败保留原 src（自然 404 占位），不阻断
          });
      }
    };

    // 等 React 完成 render（dangerouslySetInnerHTML → DOM）
    const t = window.setTimeout(kickoff, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      for (const u of objectUrls) URL.revokeObjectURL(u);
    };
  }, [view, previewHtml, doc?.content, doc?.path, docs]);

  useEffect(() => {
    setFadeKey((k) => k + 1);
    setActiveHeadingId(null);
  }, [doc?.id]);

  // scroll-spy
  useEffect(() => {
    if (view !== 'preview' || !previewScrollRef.current) return;
    const container = previewScrollRef.current;
    const handleScroll = () => {
      const headings = container.querySelectorAll('h1[id], h2[id], h3[id]');
      let current: string | null = null;
      for (const h of headings) {
        const rect = h.getBoundingClientRect();
        const containerTop = container.getBoundingClientRect().top;
        if (rect.top - containerTop <= 80) current = h.id;
      }
      setActiveHeadingId(current);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  }, [view, doc?.id]);

  const jumpToHeading = (id: string) => {
    if (!id || !previewScrollRef.current) return;
    const el = previewScrollRef.current.querySelector(`#${CSS.escape(id)}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // 撤销/重做：textarea 是受控组件，React 用原生 setter 同步 value 后浏览器历史栈仍可用，
  // execCommand 触发的 input 事件会让 React 的 onChange 正常回写 editContent
  const focusTextarea = (): HTMLTextAreaElement | null =>
    editorWrapRef.current?.querySelector('textarea') ?? null;
  const runNativeCommand = (cmd: 'undo' | 'redo') => {
    const ta = focusTextarea();
    if (!ta) return;
    ta.focus();
    document.execCommand(cmd);
  };

  // 页面级快捷键：Ctrl/⌘+S 保存、Ctrl/⌘+E 切换编辑/预览（焦点在输入控件时同样生效并阻止浏览器默认行为）
  useEffect(() => {
    if (!doc || !canWrite) return undefined;
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        if (!saving) onSaveRef.current();
      } else if (key === 'e') {
        e.preventDefault();
        setViewRef.current(view === 'edit' ? 'preview' : 'edit');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doc, canWrite, saving, view]);

  // 切换文档时退出标题编辑态
  useEffect(() => {
    setEditingTitle(false);
  }, [doc?.id]);
  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  const startEditTitle = () => {
    setTitleDraft(doc?.title ?? '');
    setEditingTitle(true);
  };
  const cancelEditTitle = () => setEditingTitle(false);
  const submitTitle = async () => {
    const next = titleDraft.trim();
    if (!next || !doc || next === (doc.title ?? '')) {
      setEditingTitle(false);
      return;
    }
    try {
      await onRenameTitle(next);
      setEditingTitle(false);
    } catch {
      // 错误提示由父级 mutation 统一 toast，输入态保留以便重试
    }
  };

  if (!doc) {
    return (
      <section className="h-full flex items-center justify-center text-sm text-neutral-400">
        <div className="text-center">
          <FileText size={40} className="mx-auto mb-3 text-neutral-300" />
          <p>从左侧目录树选择文档开始阅读</p>
        </div>
      </section>
    );
  }

  const pathParts = (doc.path || '').split('/').filter(Boolean);
  const status = STATUS_MAP[doc.status] ?? STATUS_MAP.synced;

  return (
    <>
    <section className="h-full min-h-0 flex flex-col min-w-0 overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
      {/* Context bar */}
      <div className="shrink-0 border-b px-6 pt-4 pb-3" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-xs text-neutral-400 flex items-center gap-1 min-w-0">
            {pathParts.map((part, i) => (
              <span key={`${part}-${i}`} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight size={11} className="text-neutral-300 shrink-0" />}
                <span className="truncate">{part}</span>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenInfo}
              title="文件信息"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
            >
              <FileCog size={14} />
            </button>
            <button
              type="button"
              onClick={onOpenHistory}
              title="历史记录"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
            >
              <History size={14} />
            </button>
            <span className={`tag ${status.tagClass}`}>{status.label}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-1">
          {editingTitle && canWrite ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <input
                ref={titleInputRef}
                value={titleDraft}
                maxLength={200}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitTitle();
                  if (e.key === 'Escape') cancelEditTitle();
                }}
                placeholder="文档标题"
                className="h-8 min-w-0 flex-1 rounded-md border border-primary-300 px-2 text-lg font-bold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
              <button type="button" className="btn-primary !h-8 !px-2.5 !text-xs disabled:opacity-60"
                disabled={!titleDraft.trim() || renamingTitle || titleDraft.trim() === (doc.title ?? '')}
                onClick={() => void submitTitle()}>
                <CheckCircle2 size={13} /> {renamingTitle ? '保存中…' : '确定'}
              </button>
              <button type="button" className="btn-secondary !h-8 !px-2.5 !text-xs"
                onClick={cancelEditTitle} disabled={renamingTitle}>
                取消
              </button>
            </div>
          ) : (
            <div className="group/title flex items-center gap-1.5 min-w-0">
              <h1 className="text-xl font-bold text-neutral-900 truncate">{doc.title || fileNameOfPath(doc.path)}</h1>
              {canWrite && (
                <button
                  type="button"
                  onClick={startEditTitle}
                  title="编辑标题（不影响文件名；文件名请在左侧目录树右键「重命名」修改）"
                  className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 opacity-0 transition group-hover/title:opacity-100 hover:bg-neutral-100 hover:text-primary-600 focus:opacity-100"
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {/* 渲染主题下拉 */}
            {view === 'preview' && (
              <div className="relative">
                <button type="button" onClick={() => setShowThemeMenu((s) => !s)}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded text-xs font-medium border border-neutral-200 hover:bg-neutral-50 transition">
                  <Palette size={12} />
                  <span>{RENDER_THEMES.find((t) => t.key === renderTheme)?.label ?? '经典'}</span>
                  <ChevronDown size={12} />
                </button>
                {showThemeMenu && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setShowThemeMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 w-64 rounded-lg bg-white border border-neutral-200 shadow-xl z-30">
                      <div className="px-3 py-2 border-b border-neutral-100 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">渲染主题</div>
                      <div className="py-1 max-h-72 overflow-y-auto">
                        {RENDER_THEMES.map((t) => {
                          const Icon = t.Icon;
                          const active = renderTheme === t.key;
                          return (
                            <button key={t.key} type="button"
                              onClick={() => { setRenderTheme(t.key); setShowThemeMenu(false); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition ${active ? 'bg-primary-50' : 'hover:bg-neutral-50'}`}>
                              <Icon size={14} className={active ? 'text-primary-600' : 'text-neutral-400'} />
                              <div className="min-w-0 flex-1">
                                <div className={`text-xs font-medium ${active ? 'text-primary-700' : 'text-neutral-700'}`}>{t.label}</div>
                                <div className="text-[10px] text-neutral-400 truncate">{t.desc}</div>
                              </div>
                              {active && <CheckCircle2 size={14} className="text-primary-600 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                      <div className="px-3 py-2 border-t border-neutral-100 text-[10px] text-neutral-400">
                        原 Markdown 内容不会被修改
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* View mode pill —— 编辑入口仅可写角色可见（guest/隐式读者只读，后端 PUT 403 兜底） */}
            <div className="bg-neutral-100 rounded-md p-0.5 inline-flex">
              <button type="button" onClick={() => setView('preview')}
                className={`inline-flex items-center gap-1 px-2.5 h-7 rounded text-xs font-medium transition ${
                  view === 'preview' ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                }`}>
                <Eye size={13} /> 预览
              </button>
              {canWrite && (
                <button type="button" onClick={() => setView('edit')}
                  title="双击内容可快速进入编辑"
                  className={`inline-flex items-center gap-1 px-2.5 h-7 rounded text-xs font-medium transition ${
                    view === 'edit' ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                  }`}>
                  <PenTool size={13} /> 编辑
                </button>
              )}
            </div>

            {/* Save —— 高度对齐相邻预览/编辑 pill（h-7），变体类已自带 inline-flex 布局 */}
            {canWrite && (
              <button type="button" className="btn-primary !h-7 !px-2.5 !text-xs disabled:opacity-60"
                onClick={onSave} disabled={saving}>
                <Save size={13} /> {saving ? '保存中…' : '保存'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 编辑辅助栏（仅编辑模式）：格式操作由编辑器自带工具栏承担，这里只补撤销/重做与快捷键速查 */}
      {view === 'edit' && (
        <div className="h-9 px-4 flex items-center gap-1 bg-neutral-50 border-b border-neutral-200 text-neutral-500 shrink-0 animate-fade-up">
          <button type="button" title="撤销 (Ctrl/⌘+Z)"
            onClick={() => runNativeCommand('undo')}
            className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-neutral-200 transition">
            <Undo2 size={14} />
          </button>
          <button type="button" title="重做 (Ctrl/⌘+Shift+Z)"
            onClick={() => runNativeCommand('redo')}
            className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-neutral-200 transition">
            <Redo2 size={14} />
          </button>
          <span className="w-px h-4 bg-neutral-200 mx-1.5" />
          <div className="relative">
            <button type="button" title="快捷键速查"
              onClick={() => setShowShortcuts((s) => !s)}
              className="inline-flex items-center gap-1 px-2 h-7 rounded text-xs hover:bg-neutral-200 transition">
              <Keyboard size={13} /> 快捷键
            </button>
            {showShortcuts && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowShortcuts(false)} />
                <div className="absolute left-0 top-full mt-1 w-[420px] max-w-[90vw] rounded-lg bg-white border border-neutral-200 shadow-xl z-30 p-3">
                  <div className="grid grid-cols-3 gap-3">
                    {SHORTCUT_GROUPS.map((group) => (
                      <div key={group.title}>
                        <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">{group.title}</div>
                        <ul className="space-y-1">
                          {group.items.map((item) => (
                            <li key={item.keys} className="flex flex-col gap-0.5">
                              <kbd className="self-start rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600">{item.keys}</kbd>
                              <span className="text-[11px] text-neutral-500">{item.desc}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <span className="flex-1" />
          <span className="text-[11px] text-neutral-400 hidden sm:inline">Ctrl/⌘+S 保存 · Ctrl/⌘+E 预览 · Esc 返回预览</span>
        </div>
      )}

      {/* Content */}
      <div key={fadeKey} className="flex-1 flex min-h-0 overflow-hidden">
        {view === 'preview' ? (
          <div className="group flex-1 relative min-h-0">
            <div ref={previewScrollRef} className="h-full overflow-y-auto scrollbar-thin"
              onDoubleClick={() => { if (canWrite) setView('edit'); }}
              title={canWrite ? '双击内容可快速进入编辑' : undefined}>
              <div className={`max-w-3xl mx-auto px-10 py-10 prose-doc prose-${renderTheme || 'plain'}`}
                dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
            {/* 「双击进入编辑」悬浮提示（对齐原型 ProjectBrowse.jsx:1100-1107）：hover 正文时浮现；只读用户不提示 */}
            {canWrite && (
              <div className="pointer-events-none fixed bottom-6 right-[340px] z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <div className="flex items-center gap-2 rounded-lg bg-neutral-900/80 px-3 py-1.5 text-xs text-white shadow-lg">
                  <PenTool size={12} />
                  双击任意位置开始编辑
                  <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px]">Enter</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div ref={editorWrapRef} className="flex-1 min-h-0 overflow-hidden">
            {/* 有据偏离（PLAN 5.3.1 声明）：原型的 mock 远程协作光标/Presence 浮层（MOCK_CURSORS，:1122-1140）
                依赖协同编辑会话，真实协同链路落地前省略；协作面板（右栏）已按 3.2 第 4 条承载 AI/评论/历史入口 */}
            {/* P3a 选图：独立插图按钮（不注入 MDEditor commands，避免版本差异） */}
            {canWrite && (
              <div className="flex items-center gap-1 border-b px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-soft)' }}>
                <Keyboard size={12} className="text-neutral-400" />
                <span className="text-neutral-500">快捷：</span>
                <span className="rounded bg-neutral-100 px-1 font-mono text-[11px] text-neutral-600">Ctrl+S</span>
                <span className="text-neutral-400">保存</span>
                <span className="mx-1 h-3 w-px bg-neutral-200" />
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-primary-600 hover:bg-primary-50"
                  title="插入图片（Ctrl+K）"
                  onClick={() => setShowImagePicker(true)}
                >
                  <ImagePlus size={12} /> 插入图片
                </button>
              </div>
            )}
            <MDEditor
              value={editContent}
              onChange={(v) => onEditChange(v ?? '')}
              preview="edit"
              hideToolbar={false}
              height="100%"
              className="h-full"
              style={{ height: '100%' }}
              // Tab 键插入缩进而非跳走焦点（defaultTabEnable），2 空格缩进
              defaultTabEnable
              tabSize={2}
              // 编辑器内置明暗配色必须显式跟随 app 外观：默认 colorMode="auto" 只认系统偏好，
              // 亮色 app + 系统暗色时会渲染成黑块；见验收走查"编辑器主题不适配"
              data-color-mode={isDark ? 'dark' : 'light'}
              textareaProps={{
                placeholder: '开始编写 Markdown 文档…',
                spellCheck: false,
                // 编辑态双击切回预览（对齐原型 textarea onDoubleClick，:1117）
                onDoubleClick: () => setView('preview'),
                onKeyDown: (e) => {
                  // Esc 回到预览；Ctrl/⌘+Z / Shift+Z 走浏览器原生撤销重做（保留历史栈）
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setView('preview');
                  }
                },
              }}
            />
          </div>
        )}

        {/* Floating TOC — 仅预览 + xl 屏幕 */}
        {view === 'preview' && tocItems.length > 0 && (
          <nav className="hidden xl:flex w-56 shrink-0 flex-col pt-2 pl-4 pr-3 overflow-y-auto scrollbar-thin border-l"
            style={{ borderColor: 'var(--border-soft)' }}>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold mb-2 px-2">目录</div>
            <ul className="space-y-0.5">
              {tocItems.map((item, idx) => (
                <li key={`${item.id}-${idx}`}
                  style={{ paddingLeft: item.level === 3 ? '12px' : item.level === 2 ? '4px' : '0' }}>
                  <button type="button" onClick={() => jumpToHeading(item.id)}
                    className={`block w-full text-left text-xs leading-5 px-2 py-0.5 rounded truncate transition-colors ${
                      activeHeadingId === item.id ? 'bg-primary-50 text-primary-700 font-medium' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100'
                    }`}
                    title={item.text}>
                    {item.text}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>

      {/* Edit status bar */}
      {view === 'edit' && (
        <div className="shrink-0 h-6 px-4 border-t flex items-center justify-between text-[11px] text-neutral-400"
          style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-page)' }}>
          <div className="flex items-center gap-3">
            <span>行 {editContent.split('\n').length}</span>
            <span>字 {editContent.length}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><GitBranch size={10} /> main</span>
          </div>
        </div>
      )}
    </section>
    {/* P3a 选图弹层：列出库内图片 + 当场上传；选中 → 相对路径 → 追加到正文 */}
    {showImagePicker && (
      <ImagePickerModal
        projectId={projectId}
        docs={docs}
        currentDocPath={doc.path}
        canWrite={canWrite}
        onClose={() => setShowImagePicker(false)}
        onPick={(image) => {
          const rel = relativePosix(doc.path, image.path);
          const md = buildImageMarkdown(image.title ?? basenameOf(image.path), rel);
          onEditChange((editContent ?? '') + '\n' + md + '\n');
          onPickImage({ docPath: image.path, label: image.title ?? basenameOf(image.path) });
          setShowImagePicker(false);
        }}
        onUploaded={() => {
          // 刷新 docs（上传后刚入库，选图弹层关闭重开可见）；一期先关弹层让用户重开
          setShowImagePicker(false);
        }}
      />
    )}
  </>
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
  // 项目内角色：false = 只读（非成员隐式读者 / guest），隐藏文档新建与编辑保存入口
  const { canWrite } = useProjectRole(projectId);
  const { isDark } = useTheme();

  const docParam = searchParams.get('doc');
  const isFocused = !!docParam;

  // Local UI state
  const [keyword, setKeyword] = useState('');
  // 唯一的类型筛选 state（TreeSidebar + grid 视图共享；Facet popover 在 TreeSidebar 工具栏上）
  const [facet, setFacet] = useState<FileFacetId>('all');
  const [renderTheme, setRenderTheme] = useState('plain');
  const [focusedView, setFocusedView] = useState<'preview' | 'edit'>('preview');
  const [editContent, setEditContent] = useState('');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // 右栏协作面板（AI 助手/评论/历史）已上收到 ProjectLayout.ProjectRightSidebar：
  // browse 路由时布局右栏固定显示三 tab，概览/动态/成员进入「更多」下拉（对齐原型 ProjectLayout.jsx）

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

  // 保存 mutation（乐观并发保护：baseVersionNo 与最新版本不符 → 409 冲突；Git 库自动提交推送）
  const latestVersionRef = useRef(0);
  const editContentRef = useRef('');
  useEffect(() => {
    editContentRef.current = editContent;
  }, [editContent]);
  useEffect(() => {
    const v = versionsData?.items?.[0]?.versionNo ?? 0;
    if (v > 0) latestVersionRef.current = v;
  }, [versionsData]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!activeDoc) return Promise.reject(new Error('no doc'));
      return apiFetch<{ ok: boolean; document: DocumentDetail; version: number; effects?: { git: { attempted: boolean; ok: boolean; pushed: boolean; noop?: boolean; commitHash?: string; error?: string } } }>(
        `/api/v1/documents/${activeDoc.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            content: editContent,
            title: activeDoc.title ?? undefined,
            baseVersionNo: latestVersionRef.current || undefined,
          }),
        },
      );
    },
    onSuccess: (result) => {
      latestVersionRef.current = result.version;
      // 失效相关缓存
      void queryClient.invalidateQueries({ queryKey: ['document', docParam] });
      void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
      void queryClient.invalidateQueries({ queryKey: ['document-versions', docParam] });
      // 更新本地状态
      if (result.document) {
        queryClient.setQueryData<DocumentDetail | undefined>(['document', docParam], result.document);
      }
      const git = result.effects?.git;
      if (git?.attempted && git.ok && git.pushed) {
        showToast(`文档已保存，Git 自动提交 ${git.commitHash?.slice(0, 8) ?? ''} 并推送`);
      } else if (git?.attempted && git.ok && git.noop) {
        showToast('文档已保存（与仓库内容一致，无需提交）');
      } else if (git?.attempted && !git.ok) {
        showToast(`文档已保存，但 Git 自动提交失败：${git.error ?? '未知错误'}`);
      } else {
        showToast('文档已保存');
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('DOCUMENT_VERSION_CONFLICT')) {
        // 多人协作不丢失：冲突时不静默覆盖，提示加载最新
        if (window.confirm('版本冲突：其他成员刚更新了此文档。\n\n点「确定」加载最新内容（当前未保存的修改将被丢弃，建议先复制到剪贴板）；点「取消」留在当前编辑状态。')) {
          void queryClient.invalidateQueries({ queryKey: ['document', docParam] });
          void queryClient.invalidateQueries({ queryKey: ['document-versions', docParam] });
        }
      } else {
        showToast(msg || '保存失败');
      }
    },
  });

  // ---- Sync editor buffer ----
  useEffect(() => {
    if (activeDoc) setEditContent(activeDoc.content ?? '');
  }, [activeDoc?.id, activeDoc?.contentHash]);

  // ---- 非 md 文本类（CodeViewer）保存：同一 PUT + baseVersionNo 乐观并发通道（§4.4 F5） ----
  const saveTextFile = async (nextContent: string): Promise<void> => {
    if (!activeDoc) throw new Error('文件不存在');
    try {
      const result = await apiFetch<{ ok: boolean; document: DocumentDetail; version: number }>(
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('DOCUMENT_VERSION_CONFLICT')) {
        // 冲突不静默覆盖：提示后重新拉取最新内容（CodeViewer 的 saved 缓冲随之刷新，本地脏修改仍在）
        if (window.confirm('版本冲突：其他成员刚更新了此文件。\n\n点「确定」加载最新内容（当前未保存的修改将被丢弃，建议先复制到剪贴板）；点「取消」留在当前编辑状态。')) {
          await queryClient.invalidateQueries({ queryKey: ['document', docParam] });
          await queryClient.invalidateQueries({ queryKey: ['document-versions', docParam] });
        }
      }
      throw err instanceof Error ? err : new Error('保存失败');
    }
  };

  // ---- 二进制替换上传（图片/PDF/兜底查看器，§5.2 POST /documents/:id/versions/upload） ----
  const replaceUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!activeDoc) throw new Error('文件不存在');
      const form = new FormData();
      form.append('file', file);
      form.append('idempotencyKey', crypto.randomUUID());
      // FormData 必须让浏览器自带 multipart boundary：空串占位阻止 apiFetch 补 application/json，
      // fetch 发送 FormData 时会忽略空串并自动生成 boundary
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
      // 重新拉详情以获取新的签名 rawUrl（旧签名 30 分钟过期且内容已变）
      void queryClient.invalidateQueries({ queryKey: ['document', docParam] });
      void queryClient.invalidateQueries({ queryKey: ['document-versions', docParam] });
      void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
    onError: (err) => {
      showToast(err instanceof Error ? err.message : '替换上传失败');
    },
  });

  // 活跃文档 → FileMeta（查看器插件契约）；md 仍走旧 DocumentEditor，不经过 FileHost
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

  const activeIsMarkdown = activeDoc
    ? resolveFileType(activeDoc.path, activeDoc.mime).typeId === 'markdown'
    : true;

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
      const clean = editContentRef.current === (activeDocRef.current?.content ?? '');
      if (clean) {
        void apiFetch<DocumentDetail>(`/api/v1/documents/${docParam}`)
          .then((d) => {
            queryClient.setQueryData(['document', docParam], d);
            setEditContent(d.content ?? '');
            latestVersionRef.current = 0; // 触发 versions 查询回填
            void queryClient.invalidateQueries({ queryKey: ['document-versions', docParam] });
            showToast(`${p.by ?? '其他成员'} 更新了此文档，已刷新为最新内容`);
          })
          .catch(() => undefined);
      } else {
        showToast(`${p.by ?? '其他成员'} 更新了此文档；你有未保存的修改，保存时将做冲突检测`);
      }
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
  // 文件信息抽屉（树菜单 / 卡片 / 查看器 host.openOpenInfo / md 编辑器共用一个宿主）
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
    setFocusedView('preview');
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

  // 文件信息抽屉（网格/聚焦两分支共用；host.openOpenInfo 也走这里）
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

  // ---- 标题栏就地编辑：只改 title 元数据，不触碰文件名/path（§4.5 解耦） ----
  const handleRenameTitle = async (title: string): Promise<void> => {
    if (!activeDoc) return;
    try {
      await patchDocMutation.mutateAsync({ id: activeDoc.id, title });
      showToast('标题已更新');
    } catch (err) {
      showToast(prettyTreeError(err, '标题更新失败'));
      throw err;
    }
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
            {/* 有据偏离（PLAN 5.3.1 声明）：原型的「网格/树状」grid 视图切换（ProjectBrowse.jsx:1587-1613）
                为视觉性 mock，此处以真实数据刷新按钮替代，树状结构由左栏目录树承担 */}
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
  // FOCUSED MODE — 三栏 flex 布局
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
      {activeIsMarkdown || !activeFileMeta ? (
        <DocumentEditor
          doc={activeDoc ?? null}
          editContent={editContent}
          onEditChange={setEditContent}
          view={focusedView}
          setView={setFocusedView}
          onSave={() => void saveMutation.mutateAsync()}
          saving={saveMutation.isPending}
          renderTheme={renderTheme}
          setRenderTheme={setRenderTheme}
          canWrite={canWrite}
          onRenameTitle={handleRenameTitle}
          renamingTitle={patchDocMutation.isPending}
          onOpenInfo={() => {
            if (activeDoc) setInfoDocId(activeDoc.id);
          }}
          onOpenHistory={() => {
            if (activeDoc) openHistory(activeDoc);
          }}
          projectId={projectId ?? ''}
          docs={docData?.items ?? []}
          onPickImage={() => { /* 选图弹层内部已 append editContent，此处留空供未来扩展 */ }}
        />
      ) : (
        <FileHost
          file={activeFileMeta}
          canWrite={canWrite}
          isDark={isDark}
          onSave={saveTextFile}
          onReplaced={() => {
            /* mutation 已完成缓存刷新；签名 rawUrl 由 invalidate document 后新详情下发 */
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

      {/* 重命名弹窗（文件完整文件名 / 文件夹名；标题编辑走编辑区内联入口） */}
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
