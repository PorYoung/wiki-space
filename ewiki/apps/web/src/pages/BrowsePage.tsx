import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import MDEditor from '@uiw/react-md-editor';
import { useTheme } from '../theme/ThemeProvider';
import { EwikiRealtime } from '../lib/ws/client';
import {
  Activity,
  ArrowLeft,
  Bold,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FilePlus,
  GitBranch,
  Heading1,
  Italic,
  Layers,
  Link2,
  List,
  Palette,
  PenTool,
  Plus,
  Quote,
  Redo2,
  RefreshCw,
  Save,
  Search,
  Sun,
  Moon,
  Tag,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { apiFetch } from '../lib/api/client';
import { useProjectRole } from '../lib/api/use-project-role';
import { useShowToast } from '../components/Toast';

// ---------------------------------------------------------------------------
// Types — 直接从后端返回 shape 推导
// ---------------------------------------------------------------------------

interface DocumentListItem {
  id: string;
  projectId: string;
  sourceId: string | null;
  path: string;
  title: string | null;
  status: 'untracked' | 'synced' | 'modified' | 'conflict';
  wordCount: number;
  contentHash: string | null;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
  // PLAN 3.4 残留：列表接口派生下发（routes.ts documentSummary）
  tags?: string[] | null;
  summary?: string | null;
}

interface DocumentDetail extends DocumentListItem {
  content: string | null;
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
  return (
    d.path.toLowerCase().includes(kw) ||
    (d.title ?? '').toLowerCase().includes(kw) ||
    (d.path.split('/').pop() ?? '').toLowerCase().includes(kw)
  );
}

function folderHasMatch(node: TreeNode, kw: string): boolean {
  if (node.name.toLowerCase().includes(kw)) return true;
  if (node.docs.some((d) => docMatchesKeyword(d, kw))) return true;
  return Array.from(node.children.values()).some((ch) => folderHasMatch(ch, kw));
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

/** Minimal markdown → HTML（prose-doc 子集） */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

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

function inlineMd(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function markdownToHtml(md: string | null): string {
  if (!md) return '';
  let src = md.replace(/\r\n/g, '\n');

  // code fence —— 先抽成占位符隔离处理：围栏内含多行，若直接替换成 <pre>，
  // 后续的标题/段落正则仍会命中围栏内部行（"# 注释"被转 <h1>、命令行被包 <p>），
  // 漏出 pre 的深色文字落在终端深底上几乎不可读；占位符占整行、不匹配任何行级语法，
  // 全部转换完成后再还原（与 worker 侧逐行状态机实现思路一致）
  const fences: string[] = [];
  src = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code: string) => {
    const escaped = code.trim().replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
    fences.push(`<pre><code>${escaped}</code></pre>`);
    return `\n@@FENCE_${fences.length - 1}@@\n`;
  });

  // blockquote
  src = src.replace(/^(>\s*.+)$/gm, (_m, line: string) => `<blockquote>${inlineMd(line.replace(/^>\s*/, ''))}</blockquote>`);

  // headings
  src = src.replace(/^###\s+(.+)$/gm, (_m, t: string) => `<h3 id="${slugify(t)}">${t}</h3>`);
  src = src.replace(/^##\s+(.+)$/gm, (_m, t: string) => `<h2 id="${slugify(t)}">${t}</h2>`);
  src = src.replace(/^#\s+(.+)$/gm, (_m, t: string) => `<h1 id="${slugify(t)}">${t}</h1>`);
  src = src.replace(/^---+$/gm, '<hr/>');

  // ul
  src = src.replace(/((?:^[-*+]\s+.+\n?)+)/gm, (block) => {
    const items = block
      .split('\n')
      .filter((l) => /^[-*+]\s+/.test(l))
      .map((l) => `<li>${inlineMd(l.replace(/^[-*+]\s+/, ''))}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });

  // ol
  src = src.replace(/((?:^\d+\.\s+.+\n?)+)/gm, (block) => {
    const items = block
      .split('\n')
      .filter((l) => /^\d+\.\s+/.test(l))
      .map((l) => `<li>${inlineMd(l.replace(/^\d+\.\s+/, ''))}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  });

  // paragraphs — skip lines already wrapped（含代码围栏占位行：不匹配任何行级语法，原样保留）
  src = src
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (/^<(h1|h2|h3|ul|ol|li|pre|blockquote|hr)/.test(trimmed)) return line;
      if (/^@@FENCE_\d+@@$/.test(trimmed)) return line;
      return `<p>${inlineMd(trimmed)}</p>`;
    })
    .join('');

  // 还原代码围栏
  return src.replace(/@@FENCE_(\d+)@@/g, (_m, i: string) => fences[Number(i)] ?? '');
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

function TreeNodeRow({
  node,
  path,
  level,
  expanded,
  onToggle,
  onSelect,
  activeDocId,
  keyword,
}: {
  node: TreeNode;
  path: string;
  level: number;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  onSelect: (d: DocumentListItem) => void;
  activeDocId: string | null;
  keyword: string;
}): React.ReactElement {
  const nodePath = path ? `${path}/${node.name}` : node.name;
  const isExpanded = expanded.has(nodePath);
  const kw = keyword.trim().toLowerCase();

  const visibleDocs = kw ? node.docs.filter((d) => docMatchesKeyword(d, kw)) : node.docs;
  const visibleChildren = kw
    ? Array.from(node.children.entries()).filter(([, ch]) => folderHasMatch(ch, kw))
    : Array.from(node.children.entries());

  if (kw && !folderHasMatch(node, kw)) return <></>;

  const folderActive = !!kw && node.name.toLowerCase().includes(kw);

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(nodePath)}
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm transition ${
          folderActive ? 'bg-amber-50 text-amber-800' : 'text-neutral-700 hover:bg-neutral-100'
        } ${level === 0 ? 'font-medium' : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {node.children.size > 0 || node.docs.length > 0 ? (
          isExpanded ? <ChevronDown size={14} className="text-neutral-400 shrink-0" /> : <ChevronRight size={14} className="text-neutral-400 shrink-0" />
        ) : <span className="w-3.5 shrink-0" />}
        {isExpanded ? <FolderOpen size={13} className="text-primary-500 shrink-0" /> : <Folder size={13} className="text-primary-500 shrink-0" />}
        <span className="truncate">{keyword ? highlight(node.name, keyword) : node.name}</span>
        <span className="ml-auto font-mono text-[10px] text-neutral-400">{visibleDocs.length}</span>
      </button>

      {isExpanded && (
        <>
          {visibleChildren.map(([name, child]) => (
            <TreeNodeRow key={name} node={child} path={nodePath} level={level + 1} expanded={expanded}
              onToggle={onToggle} onSelect={onSelect} activeDocId={activeDocId} keyword={keyword} />
          ))}
          {visibleDocs.map((doc) => {
            const isActive = activeDocId === doc.id;
            const status = STATUS_MAP[doc.status] ?? STATUS_MAP.synced;
            const docName = doc.title ?? doc.path.split('/').pop() ?? doc.path;
            const docActive = !!kw && (
              docName.toLowerCase().includes(kw) ||
              (doc.path.split('/').pop() ?? '').toLowerCase().includes(kw)
            );
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => onSelect(doc)}
                className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm transition ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : docActive
                      ? 'bg-amber-50 text-neutral-800'
                      : 'text-neutral-600 hover:bg-neutral-100'
                }`}
                style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }}
              >
                <span className="w-3.5 shrink-0" />
                <FileText size={13} className="text-neutral-400 shrink-0" />
                <span className="truncate">{keyword ? highlight(docName, keyword) : docName}</span>
                <span className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} title={status.label} />
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
  onNewDoc,
  onNewFolder,
  canWrite,
}: {
  docs: DocumentListItem[];
  activeDocId: string | null;
  onSelect: (d: DocumentListItem) => void;
  onBack: () => void;
  project: { sourceType?: string | null } | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNewDoc: () => void;
  onNewFolder: () => void;
  /** 当前用户是否可编辑文档（false = 只读：隐藏新建文档/文件夹入口，后端 POST 403 兜底） */
  canWrite: boolean;
}): React.ReactElement {
  const tree = useMemo(() => buildTree(docs), [docs]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [keyword, setKeyword] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

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

  // 搜索时自动展开所有命中目录（照抄原型 ProjectBrowse.jsx:550-573）
  useEffect(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return;
    const toExpand = new Set<string>(['']);
    const walk = (n: TreeNode, nodePath: string) => {
      if (folderHasMatch(n, kw)) toExpand.add(nodePath);
      n.children.forEach((child, name) => {
        walk(child, nodePath ? `${nodePath}/${name}` : name);
      });
    };
    walk(tree, '');
    setExpanded(toExpand);
  }, [keyword, tree]);

  const toggleExpand = (p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const modifiedCount = docs.filter((d) => d.status === 'modified' || d.status === 'conflict').length;
  const isGitSource = project?.sourceType === 'git' || project?.sourceType === 'repo-docs';
  const searchKw = keyword.trim().toLowerCase();
  const rootVisibleDocs = searchKw ? tree.docs.filter((d) => docMatchesKeyword(d, searchKw)) : tree.docs;
  const rootVisibleChildren = searchKw
    ? Array.from(tree.children.entries()).filter(([, ch]) => folderHasMatch(ch, searchKw))
    : Array.from(tree.children.entries());
  const noMatch = !!searchKw && rootVisibleDocs.length === 0 && rootVisibleChildren.length === 0;

  if (collapsed) {
    return (
      <aside className="h-full flex flex-col items-center py-3 border-r" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
        <button type="button" onClick={onToggleCollapse}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
          title="展开目录树">
          <ChevronRight size={14} />
        </button>
        <div className="mt-3 flex-1 flex flex-col items-center gap-1.5 w-full overflow-hidden">
          {docs.slice(0, 5).map((d) => (
            <button key={d.id} type="button" onClick={() => onSelect(d)} title={d.title ?? d.path}
              className={`w-6 h-6 rounded-md inline-flex items-center justify-center transition ${
                activeDocId === d.id ? 'bg-primary-50 text-primary-600' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60'
              }`}>
              <FileText size={12} />
            </button>
          ))}
        </div>
      </aside>
    );
  }

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
              {canWrite && (
                <>
                  <button type="button" onClick={onNewDoc}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    title="新建文档">
                    <FilePlus size={14} />
                  </button>
                  <button type="button" onClick={onNewFolder}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    title="新建文件夹">
                    <FolderPlus size={14} />
                  </button>
                </>
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

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-2 min-h-0">
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
              const docName = doc.title ?? doc.path.split('/').pop() ?? doc.path;
              return (
                <button key={doc.id} type="button" onClick={() => onSelect(doc)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm transition ${
                    isActive ? 'bg-primary-50 text-primary-700' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                  style={{ paddingLeft: '8px' }}>
                  <FileText size={13} className="text-neutral-400 shrink-0" />
                  <span className="truncate">{keyword ? highlight(docName, keyword) : docName}</span>
                  <span className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} title={status.label} />
                </button>
              );
            })}
            {rootVisibleChildren.map(([name, child]) => (
              <TreeNodeRow key={name} node={child} path="" level={0} expanded={expanded}
                onToggle={toggleExpand} onSelect={onSelect} activeDocId={activeDocId} keyword={keyword} />
            ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t px-3 py-2" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          {isGitSource ? (
            <>
              <GitBranch size={12} className="text-neutral-400" />
              <span className="font-mono">main</span>
              <span className="w-1 h-1 rounded-full bg-neutral-300" />
              <span className="text-amber-600">{modifiedCount} 待同步</span>
              <span className="flex-1" />
              <span className="text-neutral-400">{docs.length} 篇</span>
            </>
          ) : (
            <>
              <Activity size={12} className="text-emerald-500" />
              <span>已同步</span>
              <span className="w-1 h-1 rounded-full bg-neutral-300" />
              <span className="text-neutral-400">{docs.length} 篇文档</span>
            </>
          )}
        </div>
      </div>
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

// 格式工具栏（照抄原型 ProjectBrowse.jsx:789-797）
const FORMAT_TOOLS: Array<{ Icon: LucideIcon; label: string }> = [
  { Icon: Bold, label: '加粗' },
  { Icon: Italic, label: '斜体' },
  { Icon: Heading1, label: '标题' },
  { Icon: List, label: '列表' },
  { Icon: Code, label: '代码' },
  { Icon: Quote, label: '引用' },
  { Icon: Link2, label: '链接' },
];

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
}): React.ReactElement {
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const { isDark } = useTheme();
  const [fadeKey, setFadeKey] = useState(0);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [showThemeMenu, setShowThemeMenu] = useState(false);

  const tocItems = useMemo(() => extractToc(doc?.content ?? null), [doc?.content]);

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

  // 格式工具：对 textarea 选区做 Markdown 包裹
  const applyFormat = (label: string) => {
    const ta = editorWrapRef.current?.querySelector('textarea');
    if (!ta) return;
    const start = ta.selectionStart ?? editContent.length;
    const end = ta.selectionEnd ?? editContent.length;
    const selected = editContent.slice(start, end) || '文本';
    let ins = selected;
    if (label === '加粗') ins = `**${selected}**`;
    else if (label === '斜体') ins = `*${selected}*`;
    else if (label === '标题') ins = `\n## ${selected}\n`;
    else if (label === '列表') ins = `\n- ${selected.split('\n').join('\n- ')}\n`;
    else if (label === '代码') ins = selected.includes('\n') ? `\n\`\`\`\n${selected}\n\`\`\`\n` : `\`${selected}\``;
    else if (label === '引用') ins = `\n> ${selected}\n`;
    else if (label === '链接') ins = `[${selected}](https://)`;
    const next = editContent.slice(0, start) + ins + editContent.slice(end);
    onEditChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + ins.length;
      ta.setSelectionRange(pos, pos);
    });
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
          <span className={`tag ${status.tagClass}`}>{status.label}</span>
        </div>

        <div className="flex items-center justify-between gap-3 mt-1">
          <h1 className="text-xl font-bold text-neutral-900 truncate">{doc.title ?? doc.path}</h1>

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

      {/* 格式工具栏（仅编辑模式，照抄原型 :1005-1045） */}
      {view === 'edit' && (
        <div className="h-10 px-4 flex items-center gap-1 bg-neutral-50 border-b border-neutral-200 text-neutral-500 shrink-0 animate-fade-up">
          {FORMAT_TOOLS.map(({ Icon, label }) => (
            <button key={label} type="button" title={label}
              onClick={() => applyFormat(label)}
              className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-neutral-200 transition">
              <Icon size={14} />
            </button>
          ))}
          <span className="w-px h-4 bg-neutral-200 mx-1.5" />
          <button type="button" title="撤销（暂不支持）" disabled
            className="w-7 h-7 inline-flex items-center justify-center rounded opacity-40 cursor-not-allowed">
            <Undo2 size={14} />
          </button>
          <button type="button" title="重做（暂不支持）" disabled
            className="w-7 h-7 inline-flex items-center justify-center rounded opacity-40 cursor-not-allowed">
            <Redo2 size={14} />
          </button>
          <span className="w-px h-4 bg-neutral-200 mx-1.5" />
          <button type="button" title="切换到预览"
            onClick={() => setView('preview')}
            className="inline-flex items-center gap-1 px-2 h-7 rounded text-xs hover:bg-neutral-200 transition">
            <Eye size={13} /> 预览
          </button>
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
                dangerouslySetInnerHTML={{ __html: markdownToHtml(doc.content) }} />
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
            <MDEditor
              value={editContent}
              onChange={(v) => onEditChange(v ?? '')}
              preview="edit"
              hideToolbar={false}
              height="100%"
              className="h-full"
              style={{ height: '100%' }}
              // 编辑器内置明暗配色必须显式跟随 app 外观：默认 colorMode="auto" 只认系统偏好，
              // 亮色 app + 系统暗色时会渲染成黑块；见验收走查"编辑器主题不适配"
              data-color-mode={isDark ? 'dark' : 'light'}
              textareaProps={{
                placeholder: '开始编写 Markdown 文档…',
                spellCheck: false,
                // 编辑态双击切回预览（对齐原型 textarea onDoubleClick，:1117）
                onDoubleClick: () => setView('preview'),
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
  );
}

// ---------------------------------------------------------------------------
// Document card — grid 模式
// ---------------------------------------------------------------------------

function DocumentCard({ doc, onOpen, index }: {
  doc: DocumentListItem;
  onOpen: (d: DocumentListItem) => void;
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

  const docParam = searchParams.get('doc');
  const isFocused = !!docParam;

  // Local UI state
  const [keyword, setKeyword] = useState('');
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

  // 项目概览（与 ProjectLayout 共享 queryKey 缓存）
  const { data: projectOverview } = useQuery<{ id: string; name: string; sourceType?: string | null }>({
    queryKey: ['project-overview', projectId],
    queryFn: () => apiFetch<{ id: string; name: string; sourceType?: string | null }>(`/api/v1/projects/${projectId}/overview`),
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
      const p = payload as { documentId?: string; by?: string };
      if (!docParam || p.documentId !== docParam) return;
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

  // ---- Handlers ----
  const openDoc = (doc: DocumentListItem) => {
    navigate(`/projects/${projectId}/browse?doc=${doc.id}`);
  };
  const selectDocInSidebar = (doc: DocumentListItem) => {
    setSearchParams({ doc: doc.id });
    setFocusedView('preview');
  };
  const backToGrid = () => setSearchParams({});
  const handleNewDoc = () => {
    const title = prompt('文档标题', '未命名文档');
    if (!title) return;
    const slug = title.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
    const path = `${slug || 'untitled'}.md`;
    createDocMutation.mutate(
      { path, title, content: `# ${title}\n\n开始编写…\n` },
      {
        onSuccess: (doc) => {
          openDoc(doc);
        },
      },
    );
  };
  // 新建文件夹：目录树由文档 path 隐式派生（后端无文件夹实体），
  // 在目标文件夹下创建首篇文档使目录实体化，创建后打开该文档
  const handleNewFolder = () => {
    const folder = prompt('文件夹名称', '新建文件夹');
    if (!folder) return;
    const slug = folder.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
    const path = `${slug || 'new-folder'}/未命名文档.md`;
    createDocMutation.mutate(
      { path, title: '未命名文档', content: '# 未命名文档\n\n开始编写…\n' },
      {
        onSuccess: (doc) => {
          showToast(`文件夹「${folder.trim()}」已创建（目录随首篇文档生成）`);
          openDoc(doc);
        },
      },
    );
  };

  const docs = docData?.items ?? [];

  // ---- Visible docs (grid 模式) ----
  const visibleDocs = useMemo(() => {
    const sorted = [...docs].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const kw = keyword.trim().toLowerCase();
    if (!kw) return sorted;
    return sorted.filter((d) =>
      (d.title ?? '').toLowerCase().includes(kw) || (d.path ?? '').toLowerCase().includes(kw),
    );
  }, [docs, keyword]);

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
              <button type="button" className="btn-primary !h-9 !text-xs"
                onClick={handleNewDoc} disabled={createDocMutation.isPending}>
                <Plus size={15} /> {createDocMutation.isPending ? '创建中…' : '新建文档'}
              </button>
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
          ) : docs.length === 0 ? (
            <div className="card p-10 text-center text-neutral-400">
              <FileText size={40} className="mx-auto mb-3 text-neutral-300" />
              <p className="text-sm">该项目暂无文档</p>
              <p className="text-xs mt-1">请配置数据源并触发同步，或使用 StarterPack 初始化</p>
            </div>
          ) : visibleDocs.length === 0 ? (
            <div className="card p-10 text-center text-neutral-400 max-w-md mx-auto mt-10">
              <Search size={32} className="mx-auto mb-3 text-neutral-300" />
              <p className="text-sm">没有找到匹配的文档</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleDocs.map((d, i) => (
                <DocumentCard key={d.id} doc={d} onOpen={openDoc} index={i} />
              ))}
            </div>
          )}
        </div>
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
        onNewDoc={handleNewDoc}
        onNewFolder={handleNewFolder}
        canWrite={canWrite}
      />
      </Panel>
      <PanelResizeHandle className="resize-handle" />
      <Panel minSize={30} className="h-full min-w-0">
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
      />
      </Panel>
      {/* 右侧协作面板（AI/评论/历史）由 ProjectLayout.ProjectRightSidebar 承载，避免双右栏 */}
    </PanelGroup>
  );
}
