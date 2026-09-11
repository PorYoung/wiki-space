import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Filter,
  GitBranch,
  GitCommit,
  MessageSquare,
  RefreshCw,
  Search,
  Star,
  User,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useShowToast } from '../components/Toast';
import { apiFetch } from '../lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentListItem {
  id: string;
  projectId: string;
  path: string;
  title: string | null;
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

interface Activity {
  id: string;
  projectId: string | null;
  actorId: string | null;
  actorName: string | null;
  verb: string; // comment | sync | publish | edit | delete | create
  targetType: string;
  targetId: string | null;
  targetTitle: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '刚刚';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs} 小时前`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;
  // 对齐原型 Sources.jsx:28-40：超过 30 天进入「个月前」档
  return `${Math.floor(diffDays / 30)} 个月前`;
}

// 头像底色统一走 primary token（原型为多色 hex 调色板，属视觉装饰，迁移收敛为设计令牌）
const AVATAR_CLS = 'bg-primary-500 text-white';

// verb → 中文文案（与 DashboardPage VERB_TEXT 保持一致）
const VERB_TEXT: Record<string, string> = {
  comment: '评论了', sync: '同步了', publish: '发布了',
  edit: '编辑了', delete: '删除了', create: '创建了',
};

function activityToFilter(verb: string): string {
  switch (verb) {
    case 'comment': return '评论';
    case 'sync': return '同步';
    case 'publish': return '发布';
    case 'edit':
    case 'create':
    case 'delete': return '编辑';
    default: return 'all';
  }
}

const FEED_FILTER_CHIPS = [
  { key: 'all', label: '全部' },
  { key: '编辑', label: '编辑' },
  { key: '评论', label: '评论' },
  { key: '同步', label: '同步' },
  { key: '发布', label: '发布' },
] as const;

type FeedFilterKey = typeof FEED_FILTER_CHIPS[number]['key'];

// ---------------------------------------------------------------------------
// changedSummary diff 解析
// 后端 documentVersions.changed_summary 为 jsonb 列，但当前版本保存逻辑
// （server routes.ts 版本快照 insert / worker 同步）均未写入该字段，
// 因此线上数据恒为 null —— 真实 diff 内容属于待后端补齐的裁剪维度。
// 此处按「未来后端可能写入的形态」做防御性解析：
//   - 数组：['+ 新增行', '- 删除行', ' 上下文行'] 或 ['+', '新增行'] 元组
//   - 对象：{ lines: string[] } / { additions: string[], deletions: string[] }
//   - 字符串：按换行切分
// 无数据时由调用方渲染裁剪提示，绝不使用原型里的 mockDiffPreview 假数据。
// ---------------------------------------------------------------------------

type DiffLineType = 'add' | 'del' | 'ctx';

interface DiffLine {
  type: DiffLineType;
  text: string;
}

function parseDiffLine(raw: unknown): DiffLine | null {
  if (typeof raw !== 'string') return null;
  const line = raw.replace(/\n/g, ' ');
  const trimmed = line.trimStart();
  if (trimmed.startsWith('+')) return { type: 'add', text: trimmed.slice(1).trim() };
  if (trimmed.startsWith('-') || trimmed.startsWith('−')) {
    return { type: 'del', text: trimmed.slice(1).trim() };
  }
  return { type: 'ctx', text: trimmed };
}

function parseChangedSummary(summary: unknown): DiffLine[] {
  if (summary == null) return [];
  const pushLine = (acc: DiffLine[], raw: unknown): void => {
    if (Array.isArray(raw) && raw.length >= 2) {
      // 元组形态：['+', '文本'] / ['-', '文本', ''] / [' ', '文本']
      const marker = String(raw[0]);
      const text = String(raw[1] ?? '');
      if (marker === '+') acc.push({ type: 'add', text });
      else if (marker === '-' || marker === '−') acc.push({ type: 'del', text });
      else acc.push({ type: 'ctx', text });
      return;
    }
    const parsed = parseDiffLine(raw);
    if (parsed && parsed.text) acc.push(parsed);
  };

  const lines: DiffLine[] = [];
  if (Array.isArray(summary)) {
    summary.forEach((item) => pushLine(lines, item));
  } else if (typeof summary === 'object') {
    const obj = summary as Record<string, unknown>;
    if (Array.isArray(obj.lines)) obj.lines.forEach((l) => pushLine(lines, l));
    if (Array.isArray(obj.additions)) {
      obj.additions.forEach((l) => pushLine(lines, `+ ${String(l)}`));
    }
    if (Array.isArray(obj.deletions)) {
      obj.deletions.forEach((l) => pushLine(lines, `- ${String(l)}`));
    }
  } else if (typeof summary === 'string') {
    summary.split('\n').forEach((l) => pushLine(lines, l));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function VersionSkeleton(): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="animate-fade-up flex items-center gap-3 p-3 card" style={{ animationDelay: '60ms' }}>
        <div className="skeleton h-9 w-40 rounded-md" />
        <div className="skeleton h-9 flex-1 rounded-md" />
        <div className="skeleton h-9 w-24 rounded-md" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-fade-up card p-4 space-y-3" style={{ animationDelay: `${100 + i * 70}ms` }}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full skeleton shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <div className="skeleton h-4 w-28" />
                <div className="skeleton h-4 w-16" />
              </div>
              <div className="skeleton h-4 w-3/4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedSkeleton(): React.ReactElement {
  return (
    <div className="space-y-3">
      <div className="animate-fade-up flex items-center gap-2 flex-wrap" style={{ animationDelay: '60ms' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-7 w-20 rounded-full" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-fade-up card p-4 space-y-2.5" style={{ animationDelay: `${100 + i * 70}ms` }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full skeleton shrink-0" />
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 w-32" />
          </div>
          <div className="skeleton h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommitCard — 版本时间线条目
// ---------------------------------------------------------------------------

interface AggregatedVersion extends DocumentVersion {
  docTitle: string;
}

function CommitCard({ version, docTitle, delay }: {
  version: AggregatedVersion;
  docTitle: string | null;
  delay: number;
}): React.ReactElement {
  const [hover, setHover] = useState(false);
  const showToast = useShowToast();

  // 真实 changedSummary 解析；后端尚未写入时 diffLines 为空数组
  const diffLines = useMemo(
    () => parseChangedSummary(version.changedSummary),
    [version.changedSummary],
  );
  const additions = diffLines.filter((l) => l.type === 'add').length;
  const deletions = diffLines.filter((l) => l.type === 'del').length;

  // 裁剪维度：完整 diff / 版本回滚 / 版本星标 均无后端接口支撑
  // （versions 列表不返回 content，无 rollback / star 端点），按计划先 toast 占位
  const handleViewDiff = (): void => {
    if (diffLines.length > 0) {
      showToast('完整 diff 对比视图即将上线');
    } else {
      showToast('该版本暂无差异摘要数据');
    }
  };
  const handleRollback = (): void => showToast('版本回滚功能即将上线');
  const handleStar = (): void => showToast('版本星标功能即将上线');

  return (
    <div
      className="card p-4 transition-all duration-200 animate-fade-up hover:shadow-md"
      style={{ animationDelay: `${delay}ms` }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: 'var(--bg-page)' }}>
          <GitCommit size={16} className="text-neutral-400" />
        </div>

        <div className="flex-1 min-w-0">
          {docTitle && (
            <div className="mb-1 flex items-center gap-1 text-[11px] text-neutral-500">
              <FileText size={12} className="text-neutral-400" />
              <span className="font-medium text-neutral-700 truncate">{docTitle}</span>
            </div>
          )}

          {/* meta row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-neutral-500 flex items-center gap-1">
              {/* 对齐原型 ProjectActivity.jsx:141：时间前的 Clock 图标 */}
              <Clock size={14} className="text-neutral-400" />
              {relativeTime(version.createdAt)}
            </span>
            <span className="text-neutral-300">·</span>
            <div className="flex items-center gap-1">
              <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-medium ${AVATAR_CLS}`}>
                {(version.authorName ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="text-sm text-neutral-600 truncate">{version.authorName ?? '未知用户'}</span>
            </div>
            <span className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5"
              style={{ background: 'var(--bg-page)', color: 'var(--text-muted, #64748b)' }}>
              <GitBranch size={11} />
              v{version.versionNo}
            </span>
          </div>

          {/* hash + message */}
          <div className="mt-1.5 flex items-start gap-2">
            {version.commitHash && (
              <code className="shrink-0 font-mono text-xs rounded-full px-2 py-0.5"
                style={{ background: 'var(--bg-page)', color: 'var(--text-muted, #64748b)' }}>
                {version.commitHash.slice(0, 7)}
              </code>
            )}
            <span className="text-sm text-neutral-800 leading-6 break-all">
              {version.message ?? '—'}
            </span>
          </div>

          {/* 变更统计 + hover 三操作（操作后端未实现，toast 占位） */}
          <div className="mt-2 flex items-center gap-3 text-xs">
            {diffLines.length > 0 ? (
              <>
                <span className="font-medium text-emerald-600">+{additions}</span>
                <span className="font-medium text-red-500">−{deletions}</span>
              </>
            ) : (
              <span className="text-neutral-400">无差异摘要</span>
            )}
            {hover && (
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleViewDiff}
                  title="查看完整 diff"
                  className="p-1.5 rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-primary-600"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  onClick={handleRollback}
                  title="回滚到此版本"
                  className="p-1.5 rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-primary-600"
                >
                  <ArrowLeftRight size={14} />
                </button>
                <button
                  type="button"
                  onClick={handleStar}
                  title="设为星标"
                  className="p-1.5 rounded-md text-neutral-500 transition-colors hover:text-amber-500"
                >
                  <Star size={14} />
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* diff 预览块：原型 :42-54 的 +绿/-红 两行式渲染，数据来自 changedSummary */}
      {diffLines.length > 0 && (
        <div
          className="mt-3 rounded-md overflow-hidden border"
          style={{ background: 'var(--bg-page)', borderColor: 'var(--border-soft)' }}
        >
          {diffLines.slice(0, 6).map((line, i) => {
            if (line.type === 'add') {
              return (
                <div key={i} className="px-3 py-0.5 text-xs font-mono leading-5 bg-emerald-50 text-emerald-700">
                  <span className="mr-2 text-emerald-500">+</span>
                  {line.text}
                </div>
              );
            }
            if (line.type === 'del') {
              return (
                <div key={i} className="px-3 py-0.5 text-xs font-mono leading-5 bg-red-50 text-red-700">
                  <span className="mr-2 text-red-500">−</span>
                  {line.text}
                </div>
              );
            }
            return (
              <div key={i} className="px-3 py-0.5 text-xs font-mono leading-5 text-neutral-500">
                <span className="mr-2 text-neutral-300"> </span>
                {line.text}
              </div>
            );
          })}
          {diffLines.length > 6 && (
            <div className="px-3 py-1 text-[11px] text-neutral-400 border-t"
              style={{ borderColor: 'var(--border-soft)' }}>
              … 共 {diffLines.length} 行变更
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FeedCard — 活动动态条目
// ---------------------------------------------------------------------------

function FeedCard({ item, delay }: { item: Activity; delay: number }): React.ReactElement {
  const verbColor = (() => {
    const f = activityToFilter(item.verb);
    if (f === '发布') return 'text-primary-600';
    if (f === '同步') return 'text-emerald-600';
    if (f === '评论') return 'text-amber-600';
    // 对齐原型 ProjectActivity.jsx:252：「删除」类动作用 danger 红（activityToFilter 将删除归入编辑类，故单独判断 verb）
    if (item.verb === 'delete') return 'text-danger';
    return 'text-neutral-600';
  })();

  return (
    <div
      className="card p-4 flex items-start gap-3 animate-fade-up hover:border-neutral-300 transition"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ring-2 ring-white shadow-sm ${AVATAR_CLS}`}
      >
        {(item.actorName || '?').slice(0, 1).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm leading-6 text-neutral-800">
          <span className="font-semibold">{item.actorName ?? '系统'}</span>
          <span className={`ml-1 ${verbColor}`}>{VERB_TEXT[item.verb] ?? item.verb}</span>
          {item.targetTitle && (
            <span className="font-semibold text-neutral-800 ml-1">{item.targetTitle}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1 text-[11px] text-neutral-400">
          {/* 对齐原型 ProjectActivity.jsx:275：动态时间前的 Clock 图标 */}
          <Clock size={12} />
          {relativeTime(item.createdAt)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function ActivityPage(): React.ReactElement {
  const { id: projectId } = useParams();
  const [subTab, setSubTab] = useState<'versions' | 'feed'>('versions');

  // shared filter state
  const [selectedDocId, setSelectedDocId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [feedFilter, setFeedFilter] = useState<FeedFilterKey>('all');

  // ---- Queries ----

  // documents for versions filter dropdown
  const docsQ = useQuery<{ items: DocumentListItem[] }>({
    queryKey: ['project-documents', projectId],
    queryFn: () => apiFetch<{ items: DocumentListItem[] }>(`/api/v1/projects/${projectId}/documents`),
    enabled: !!projectId,
  });

  // all versions (并行拉取每个 document 的 versions)
  const versionsQs = useQueries({
    queries: (docsQ.data?.items ?? []).map((doc) => ({
      queryKey: ['document-versions', doc.id],
      queryFn: () => apiFetch<{ items: DocumentVersion[] }>(`/api/v1/documents/${doc.id}/versions`),
      enabled: !!doc.id,
    })),
  });

  // activity feed
  const feedQ = useQuery<{ items: Activity[] }>({
    queryKey: ['activities', projectId],
    queryFn: () => apiFetch<{ items: Activity[] }>(`/api/v1/activities?projectId=${projectId}`),
    enabled: !!projectId,
  });

  // ---- Aggregate versions ----
  const docTitleMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docsQ.data?.items ?? []) {
      m.set(d.id, d.title ?? d.path.split('/').pop() ?? d.id);
    }
    return m;
  }, [docsQ.data?.items]);

  const allVersions = useMemo<AggregatedVersion[]>(() => {
    const docs = docsQ.data?.items ?? [];
    const merged: AggregatedVersion[] = [];
    versionsQs.forEach((q, i) => {
      const doc = docs[i];
      if (!doc || !q.data?.items) return;
      q.data.items.forEach((v) => {
        merged.push({
          ...v,
          docTitle: docTitleMap.get(doc.id) ?? doc.id,
        });
      });
    });
    return merged.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [versionsQs, docsQ.data?.items, docTitleMap]);

  const versionsLoading = docsQ.isLoading || allVersions.length === 0 && versionsQs.some((q) => q.isLoading);

  // ---- Filtered versions ----
  const filteredVersions = useMemo(() => {
    let list = allVersions;
    if (selectedDocId !== 'all') {
      list = list.filter((v) => v.documentId === selectedDocId);
    }
    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (v) =>
          (v.message ?? '').toLowerCase().includes(needle) ||
          (v.authorName ?? '').toLowerCase().includes(needle) ||
          v.docTitle.toLowerCase().includes(needle),
      );
    }
    return list;
  }, [allVersions, selectedDocId, search]);

  // ---- Filtered feed ----
  const filteredFeed = useMemo(() => {
    const feed = feedQ.data?.items ?? [];
    let list = feed;
    if (feedFilter !== 'all') {
      list = list.filter((a) => activityToFilter(a.verb) === feedFilter);
    }
    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (a) =>
          (a.actorName ?? '').toLowerCase().includes(needle) ||
          (VERB_TEXT[a.verb] ?? a.verb).toLowerCase().includes(needle) ||
          (a.targetTitle ?? '').toLowerCase().includes(needle),
      );
    }
    return list;
  }, [feedQ.data?.items, feedFilter, search]);

  // ---- Export ----
  const handleExport = () => {
    if (filteredVersions.length === 0) return;
    const header = selectedDocId === 'all'
      ? '# Changelog — 本项目全部文档\n\n'
      : `# Changelog — ${docTitleMap.get(selectedDocId) ?? ''}\n\n`;
    const body = filteredVersions
      .map((v) =>
        `- \`${(v.commitHash ?? '').slice(0, 7) || 'v' + v.versionNo}\` ` +
        `${v.authorName ?? '未知'}: ${v.message ?? ''} (${relativeTime(v.createdAt)})`,
      )
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'changelog.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const docs = docsQ.data?.items ?? [];

  return (
    <div className="h-full overflow-y-auto scrollbar-thin"
      style={{ background: 'var(--bg-page)' }}>
      <div className="max-w-[1100px] mx-auto px-6 pt-5 pb-10">
        {/* ===== 顶部工具栏 ===== */}
        <div className="mb-5">
          <div className="flex items-center gap-3 flex-wrap">
            {/* 分段切换 */}
            {/* 分段切换：容器对齐原型 :436 bg-neutral-100（令牌 --bg-hover），选中 pill 文字走 primary 色；入场延迟 40ms */}
            <div
              className="inline-flex items-center p-1 rounded-full animate-fade-up"
              style={{ background: 'var(--bg-hover)', animationDelay: '40ms' }}>
              <button
                type="button"
                onClick={() => setSubTab('versions')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                  subTab === 'versions'
                    ? 'bg-white shadow-sm text-primary-600'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <GitBranch size={14} />
                版本历史
              </button>
              <button
                type="button"
                onClick={() => setSubTab('feed')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                  subTab === 'feed'
                    ? 'bg-white shadow-sm text-primary-600'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <MessageSquare size={14} />
                活动动态
              </button>
            </div>

            {/* 版本历史：文档范围筛选 */}
            {subTab === 'versions' && (
              <div className="relative animate-fade-up" style={{ animationDelay: '60ms' }}>
                <select
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className="appearance-none text-sm border rounded-md pl-3 pr-8 py-2 text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary-300 min-w-[220px] !h-9"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}
                >
                  <option value="all">全部文档（合并时间线）</option>
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title ?? d.path}
                    </option>
                  ))}
                </select>
                <ChevronRight size={16} className="text-neutral-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90" />
              </div>
            )}

            <div className="flex-1" />

            {/* 搜索框 */}
            <div className="relative w-64">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              />
              <input
                type="text"
                placeholder={subTab === 'versions' ? '搜索提交信息…' : '搜索动态…'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input !pl-9 !h-9 w-full"
              />
            </div>

            {/* 版本历史：导出 changelog */}
            {subTab === 'versions' && (
              <button
                type="button"
                onClick={handleExport}
                disabled={filteredVersions.length === 0}
                className="btn-secondary !h-9 text-xs disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <Download size={13} />
                导出 changelog
              </button>
            )}
          </div>

          {/* 活动动态：类型筛选 chips */}
          {subTab === 'feed' && (
            <div
              className="flex items-center gap-2 flex-wrap mt-3 animate-fade-up"
              style={{ animationDelay: '80ms' }}
            >
              {FEED_FILTER_CHIPS.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setFeedFilter(chip.key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                    feedFilter === chip.key
                      ? 'bg-primary-50 text-primary-700 border-primary-200'
                      : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:text-neutral-800'
                  }`}
                >
                  {chip.key === 'all' && <Filter size={12} />}
                  {chip.label}
                </button>
              ))}
              <span className="ml-auto text-xs text-neutral-500 inline-flex items-center gap-1">
                <RefreshCw size={12} />
                {filteredFeed.length} 条活动
              </span>
            </div>
          )}
        </div>

        {/* ========= Sub-tab: Versions ========= */}
        {subTab === 'versions' && (
          <div className="animate-fade-up" key="versions">
            {versionsLoading ? (
              <VersionSkeleton />
            ) : filteredVersions.length === 0 ? (
              <div className="card p-12 text-center text-neutral-400">
                <GitCommit size={40} className="mx-auto mb-3 text-neutral-300" />
                <p className="text-sm">暂无版本记录</p>
                <p className="text-xs text-neutral-400 mt-1">
                  文档被修改或同步后，会自动生成版本快照
                </p>
              </div>
            ) : (
              <div className="relative">
                {/* vertical timeline line */}
                <div className="absolute left-[18px] top-0 bottom-0 w-px"
                  style={{ background: 'var(--border-soft)' }} />
                <div className="space-y-4 pl-2">
                  {filteredVersions.map((v, i) => (
                    <div key={v.id} className="relative">
                      {/* timeline dot */}
                      <div
                        className="absolute -left-[2px] top-5 w-[10px] h-[10px] rounded-full bg-white border-2 border-primary-500 z-10"
                      />
                      <CommitCard
                        version={v}
                        docTitle={selectedDocId === 'all' ? v.docTitle : null}
                        delay={i * 55}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========= Sub-tab: Feed ========= */}
        {subTab === 'feed' && (
          <div className="animate-fade-up" key="feed">
            {feedQ.isLoading ? (
              <FeedSkeleton />
            ) : filteredFeed.length === 0 ? (
              <div className="card p-12 text-center text-neutral-400">
                <User size={40} className="mx-auto mb-3 text-neutral-300" />
                <p className="text-sm">暂无活动记录</p>
                <p className="text-xs text-neutral-400 mt-1">
                  项目内的编辑、评论、同步等操作会在这里展示
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredFeed.map((item, i) => (
                  <FeedCard
                    key={item.id}
                    item={item}
                    delay={i * 55}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
