import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Activity } from '@ewiki/shared';
import {
  Activity as ActivityIcon, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink,
  FolderKanban, FolderOpen, History, MessageSquare, MoreHorizontal, Network, Pencil,
  Rocket, Share2, Sparkles, Trash2, UserCog, Users, FileText, RotateCcw, Diff,
} from 'lucide-react';
import { diffLines, type ChangeObject } from 'diff';
import { resolveFileType } from '@ewiki/shared';
import { apiFetch } from '../../lib/api/client';
import { useProjectRole } from '../../lib/api/use-project-role';
import { HeaderToast, type ProjectOutletContext } from '../Toast';
import { AppearanceToggle } from '../AppearanceToggle';
import { useUiStore } from '../../stores/uiStore';
import { downloadFile } from '../../fileview/api';
import { humanSize } from '../../fileview/util';

// 迁移自 prototype ProjectLayout.jsx（774 行 → TS + 真实 API）：
// 身份区 / 项目切换器 / 分享+更多菜单 / AppearanceToggle / 右侧信息栏 / toast 通道 /
// HeaderSkeleton / NotFound / tab 图标 + main key 重放入场。
// 裁剪声明更新：AI助手/评论/历史 三 tab 已按原型 ProjectLayout.jsx:50-230 补齐——
// browse 路由时固定显示，概览/动态/成员 收进面板 header「更多」下拉（对齐原型交互）。
// AI 对话与评论的后端端点未实现，tab 内容为禁用占位（不编造 mock）。
// 顶部↔侧边导航布局切换未迁移（不在计划 3.1 分块清单内）。

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectOverview {
  id: string;
  name: string;
  description?: string | null;
  backendKind?: 'git' | 'local' | null;
  storageStatus?: string | null;
  visibility?: string | null;
  accent?: string | null;
  docCount: number;
  memberCount: number;
}

interface ProjectSummary {
  id: string;
  name: string;
  accent?: string | null;
}

interface DocumentVersionInfo {
  id: string;
  versionNo: number;
  message: string | null;
  authorName: string | null;
  createdAt: string;
  // P3a 契约：二进制版本下发大小与存储引用（文本类为 null/缺省）
  size?: number | null;
  storageRef?: string | null;
}

interface MemberRow {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  avatarUrl?: string | null;
  status?: string;
}

// ---------------------------------------------------------------------------
// Helpers / Config
// ---------------------------------------------------------------------------

const TABS = [
  { to: 'browse', label: '文档', icon: FolderKanban },
  { to: 'graph', label: '图谱', icon: Network },
  { to: 'activity', label: '动态', icon: ActivityIcon },
  { to: 'publish', label: '发布', icon: Rocket },
  { to: 'members', label: '成员', icon: Users },
  { to: 'settings', label: '设置', icon: UserCog },
];

// 存储后端徽章：项目行内嵌 storage_kind（git | local）
const BACKEND_TYPE_TAG: Record<string, { cls: string; label: string }> = {
  git: { cls: 'tag-primary', label: 'Git 仓库' },
  local: { cls: 'tag-neutral', label: '本地存储' },
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '刚刚';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

function avatarColor(seed: string): string {
  const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length]!;
}

// ---------------------------------------------------------------------------
// Right sidebar
// ---------------------------------------------------------------------------

function StatTile({ label, value, icon: Icon, tone }: {
  label: string; value: string | number; icon: typeof FileText; tone: 'primary' | 'emerald' | 'sky' | 'violet';
}): React.ReactElement {
  // 暗色安全：bg 统一半透明色（亮/暗均可读）；fg 取 400 级提亮色板（亮色下亦可读，暗色下不发闷）
  const toneMap = {
    primary: { bg: 'color-mix(in srgb, var(--color-primary-600) 15%, transparent)', fg: 'var(--color-primary-500)' },
    emerald: { bg: 'rgba(16,185,129,0.12)', fg: '#10b981' },
    sky: { bg: 'rgba(14,165,233,0.12)', fg: '#0ea5e9' },
    violet: { bg: 'rgba(139,92,246,0.12)', fg: '#8b5cf6' },
  };
  const c = toneMap[tone];
  return (
    <div className="rounded-lg border px-2.5 py-2"
      style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface)' }}>
      <div className="mb-1 flex items-center gap-1.5">
        <div className="flex h-4 w-4 items-center justify-center rounded" style={{ background: c.bg }}>
          <Icon size={10} style={{ color: c.fg }} />
        </div>
        <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function MemberAvatar({ name, size = 24 }: { name: string | null; size?: number }): React.ReactElement {
  const seed = name ?? '?';
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: avatarColor(seed), fontSize: size * 0.42 }}
    >
      {seed.trim().charAt(0).toUpperCase()}
    </div>
  );
}

// 右侧栏 tab 定义：base = 项目信息三 tab；collab = 文档页协作三 tab（原型 ProjectLayout.jsx:63-72）
const BASE_TABS = [
  { id: 'overview', icon: FileText, label: '概览' },
  { id: 'activity', icon: ActivityIcon, label: '动态' },
  { id: 'members', icon: Users, label: '成员' },
] as const;
const COLLAB_TABS = [
  { id: 'ai', icon: Sparkles, label: 'AI 助手' },
  { id: 'comments', icon: MessageSquare, label: '评论' },
  { id: 'history', icon: History, label: '历史' },
] as const;
type SidebarTabId = (typeof BASE_TABS)[number]['id'] | (typeof COLLAB_TABS)[number]['id'];

function ProjectRightSidebar({ overview, members, activities, compact, onToggle }: {
  overview: ProjectOverview | null;
  members: MemberRow[];
  activities: Activity[];
  compact: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<SidebarTabId>('overview');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const recent = useMemo(() => activities.slice(0, 6), [activities]);

  // 文档页（browse 路由，含 ?doc= 聚焦态）：collab 三 tab 固定，base 收进「更多」下拉；
  // 其他页面：仅 base，全固定（对齐原型 ProjectLayout.jsx:74-78）
  const isBrowsePage = location.pathname.includes('/browse');
  const docParam = searchParams.get('doc');
  const fixedTabs: readonly { id: SidebarTabId; icon: typeof FileText; label: string }[] = isBrowsePage ? COLLAB_TABS : BASE_TABS;
  const dropdownTabs: readonly { id: SidebarTabId; icon: typeof FileText; label: string }[] = isBrowsePage ? BASE_TABS : [];
  const activeInDropdown = dropdownTabs.some((t) => t.id === activeTab);

  // browse→非 browse 时，当前 tab 若是 collab 的要 reset（原型 :81-85）
  useEffect(() => {
    if (!isBrowsePage && COLLAB_TABS.some((t) => t.id === activeTab)) setActiveTab('overview');
  }, [isBrowsePage, activeTab]);

  // 关闭「更多」下拉
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  // 历史版本：与 BrowsePage 共享 queryKey 缓存（['document-versions', doc]），
  // 面板不重复请求，选中文档变化时自动跟随
  const { data: versionsData } = useQuery<{ items: DocumentVersionInfo[] }>({
    queryKey: ['document-versions', docParam],
    queryFn: () => apiFetch<{ items: DocumentVersionInfo[] }>(`/api/v1/documents/${docParam}/versions`),
    enabled: isBrowsePage && !!docParam,
  });

  // 当前文档详情：判断二进制形态 + 提供下载所需 path（与信息面板共享 ['document', id] 缓存）
  const { data: currentDoc } = useQuery<{ id: string; path: string; title?: string | null; mime?: string | null }>({
    queryKey: ['document', docParam],
    queryFn: () => apiFetch(`/api/v1/documents/${docParam}`),
    enabled: isBrowsePage && !!docParam && activeTab === 'history',
  });
  const isBinaryDoc = !!currentDoc && resolveFileType(currentDoc.path, currentDoc.mime).kind === 'binary';
  const [downloadingNo, setDownloadingNo] = useState<number | null>(null);

  // 外部（目录树/查看器/信息面板）请求查看历史：切到 history tab
  const historyRequestId = useUiStore((s) => s.historyRequestId);
  useEffect(() => {
    if (historyRequestId > 0 && isBrowsePage) setActiveTab('history');
  }, [historyRequestId, isBrowsePage]);

  // ---- P3c：版本 diff modal / 恢复 ----
  const qc = useQueryClient();
  const [diffTargetV, setDiffTargetV] = useState<number | null>(null);
  const [restoringV, setRestoringV] = useState<number | null>(null);

  // HEAD（最新版本，用于 diff 左列）
  const headVersionNo = useMemo(() => (versionsData?.items?.[0]?.versionNo ?? 0), [versionsData]);

  // 目标版本详情（diff 对比 + 恢复前置）
  const { data: targetVersion } = useQuery<{
    id: string; versionNo: number; authorName: string | null; message: string | null;
    content: string; size: number; storageRef: string | null; kind: 'text' | 'binary';
    changedSummary: { lines: string[] } | null; createdAt: string;
  }>({
    queryKey: ['document-version', docParam, diffTargetV],
    queryFn: () => apiFetch(`/api/v1/documents/${docParam}/versions/${diffTargetV}`),
    enabled: !!docParam && diffTargetV !== null && diffTargetV >= 1,
  });

  // HEAD 详情（当前文档内容）
  const { data: headVersion } = useQuery<{ content: string }>({
    queryKey: ['document', docParam],
    queryFn: () => apiFetch(`/api/v1/documents/${docParam}`),
    enabled: !!docParam && diffTargetV !== null,
  });

  // 恢复 mutation
  const restoreMutation = useMutation({
    mutationFn: (payload: { versionNo: number; message?: string }) =>
      apiFetch<{ ok: boolean; restored: boolean; version?: number; restoredFrom?: number }>(
        `/api/v1/documents/${docParam}/restore`,
        { method: 'POST', body: JSON.stringify(payload) },
      ),
    onMutate: (v) => setRestoringV(v.versionNo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-versions', docParam] });
      qc.invalidateQueries({ queryKey: ['document', docParam] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      setRestoringV(null);
      setDiffTargetV(null);
    },
    onError: () => setRestoringV(null),
  });

  // ProjectRightSidebar 自身判定可写（恢复按钮）
  const { id: projectId } = useParams();
  const { canWrite } = useProjectRole(projectId);

  // ---- P3c：版本 diff 数据（组件顶层 useMemo，禁止在 renderTabContent 条件分支内调用） ----
  const diffChanges = useMemo<ChangeObject<string>[] | null>(() => {
    if (isBinaryDoc || !targetVersion || !headVersion) return null;
    return diffLines(headVersion.content ?? '', targetVersion.content ?? '') as ChangeObject<string>[];
  }, [isBinaryDoc, targetVersion, headVersion]);
  const diffStat = useMemo(() => {
    if (!diffChanges) return null;
    let add = 0, rem = 0;
    for (const c of diffChanges) {
      if (c.added) add += c.value.split('\n').length - (c.value.endsWith('\n') ? 1 : 0);
      else if (c.removed) rem += c.value.split('\n').length - (c.value.endsWith('\n') ? 1 : 0);
    }
    return { add, rem };
  }, [diffChanges]);

  const renderTabContent = (): React.ReactElement => {
    if (activeTab === 'overview') {
      return (
        <div className="space-y-5 px-4 py-4">
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>统计</h4>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="文档" value={overview?.docCount ?? 0} icon={FileText} tone="primary" />
              <StatTile label="成员" value={overview?.memberCount ?? members.length} icon={Users} tone="emerald" />
              <StatTile label="动态" value={activities.length} icon={ActivityIcon} tone="violet" />
            </div>
          </section>
          {members.length > 0 && (
            <section>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                成员 ({members.length})
              </h4>
              <ul className="space-y-1.5">
                {members.slice(0, 5).map((m) => (
                  <li key={m.id} className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-neutral-100">
                    <MemberAvatar name={m.name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{m.name ?? '未命名'}</div>
                      <div className="truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>{m.role || '成员'}</div>
                    </div>
                    {m.status === 'active' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      );
    }
    if (activeTab === 'activity') {
      return (
        <div className="px-4 py-4">
          <h4 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            最新动态
          </h4>
          <ul className="space-y-2.5">
            {recent.length === 0 && (
              <li className="py-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>暂无动态</li>
            )}
            {recent.map((a) => (
              <li key={a.id} className="relative pl-4">
                <span className="absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full ring-2"
                  style={{ background: 'var(--color-primary-400)' }} />
                <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{a.actorName ?? '系统'}</span>{' '}
                  <span style={{ color: 'var(--text-muted)' }}>{a.verb}</span>{' '}
                  {a.targetTitle && <span className="font-medium text-primary-600">「{a.targetTitle}」</span>}
                </div>
                <div className="mt-0.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {relativeTime(a.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    if (activeTab === 'members') {
      return (
        <div className="px-4 py-4">
          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>全部成员</h4>
          {members.length === 0 && (
            <div className="py-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>暂无成员</div>
          )}
          <ul className="space-y-1.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-neutral-100">
                <MemberAvatar name={m.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{m.name ?? '未命名'}</div>
                  <div className="truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>{m.role || '成员'}</div>
                </div>
                {m.status === 'active' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    if (activeTab === 'ai') {
      return (
        <div className="space-y-3">
          <textarea rows={3} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="让 AI 帮你润色、总结…" className="input !text-xs !py-2 resize-none" />
          {/* TODO: AI 对话端点未实现，发送保持禁用（迁移规则：不编造 mock） */}
          <button type="button" disabled title="TODO: AI 对话端点未实现"
            className="btn-primary w-full !h-8 !text-xs disabled:opacity-50 disabled:cursor-not-allowed">
            <Sparkles size={12} /> 发送（即将上线）
          </button>
          <div className="flex flex-wrap gap-1.5">
            {['总结文档', '优化段落', '翻译为英文'].map((chip) => (
              <button key={chip} type="button" disabled title="TODO: AI 对话端点未实现"
                className="tag tag-neutral cursor-default disabled:opacity-60">
                {chip}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (activeTab === 'comments') {
      // TODO: 评论功能后端（comments 表/端点）未实现，空态占位
      return (
        <div className="flex h-full flex-col items-center justify-center py-10 text-center">
          <MessageSquare size={28} className="mb-2 text-neutral-300" />
          <div className="text-xs font-medium text-neutral-600">评论功能即将上线</div>
          <div className="mt-1 text-[11px] text-neutral-400">上线后可在文档内与团队成员讨论</div>
        </div>
      );
    }
    // history：文本版本可点击查看 diff / 恢复；二进制版本展示大小 + 下载 + 恢复
    const handleVersionDownload = (v: DocumentVersionInfo) => {
      if (!currentDoc || downloadingNo !== null) return;
      setDownloadingNo(v.versionNo);
      void downloadFile(
        { id: currentDoc.id, path: currentDoc.path, title: currentDoc.title ?? '',
          kind: 'binary', ext: '', mime: currentDoc.mime ?? '', size: v.size ?? 0, versionNo: v.versionNo },
        v.versionNo,
      ).catch(() => undefined).finally(() => setDownloadingNo(null));
    };

    const versions = versionsData?.items ?? [];
    const isHead = (v: DocumentVersionInfo) => v.versionNo === versions[0]?.versionNo;

    return (
      <>
        <div className="space-y-1">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">历史版本</span>
            {(versions.length > 0) && (
              <span className="text-[10px] text-neutral-400">{headVersionNo > 0 ? `共 v${headVersionNo}` : '—'}</span>
            )}
          </div>
          {versions.length > 0 ? (
            versions.slice(0, 12).map((v) => {
              const head = isHead(v);
              return isBinaryDoc ? (
                <div key={v.id} className="rounded-md px-2 py-1.5 hover:bg-neutral-50">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDiffTargetV(v.versionNo)}
                      title={head ? '已是当前版本' : '查看版本详情'}
                      className="rounded bg-primary-50 px-1.5 py-0.5 font-mono text-[10px] text-primary-600 hover:bg-primary-100 hover:underline"
                    >v{v.versionNo}</button>
                    <span className="text-[10px] text-neutral-500">{typeof v.size === 'number' ? humanSize(v.size) : '大小未知'}</span>
                    <span className="ml-auto flex items-center gap-1">
                      {!head && canWrite && (
                        <button type="button"
                          disabled={restoringV !== null}
                          onClick={() => {
                            if (confirm(`确定要将二进制文件恢复到 v${v.versionNo} 吗？此操作会生成新版本记录。`)) {
                              restoreMutation.mutate({ versionNo: v.versionNo });
                            }
                          }}
                          title="恢复到此版本"
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 transition hover:bg-neutral-200/70 hover:text-emerald-600 disabled:opacity-50">
                          <RotateCcw size={12} className={restoringV === v.versionNo ? 'animate-spin' : ''} />
                        </button>
                      )}
                      <button type="button" disabled={downloadingNo !== null}
                        onClick={() => handleVersionDownload(v)}
                        title={`下载 v${v.versionNo}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 transition hover:bg-neutral-200/70 hover:text-primary-600 disabled:opacity-50">
                        <Download size={12} className={downloadingNo === v.versionNo ? 'animate-pulse' : ''} />
                      </button>
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-neutral-400">
                    {/* 文件管理重构 §4.5：二进制版本行展示 mime（同文档所有版本 mime 一致，复用 currentDoc） */}
                    {currentDoc?.mime && <span className="truncate font-mono">{currentDoc.mime}</span>}
                    {currentDoc?.mime && <span className="w-1 h-1 shrink-0 rounded-full bg-neutral-300" />}
                    <span className="truncate">{v.authorName ?? '未知用户'}</span>
                    <span className="w-1 h-1 shrink-0 rounded-full bg-neutral-300" />
                    <span className="shrink-0">{relativeTime(v.createdAt)}</span>
                    {head && <span className="rounded bg-emerald-50 px-1 text-emerald-600">当前</span>}
                  </div>
                </div>
              ) : (
                <div key={v.id} className="rounded-md px-2 py-1.5 hover:bg-neutral-50">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDiffTargetV(v.versionNo)}
                      title={head ? '已是当前版本' : `对比当前与 v${v.versionNo}`}
                      className="rounded bg-primary-50 px-1.5 py-0.5 font-mono text-[10px] text-primary-600 hover:bg-primary-100 hover:underline"
                    >v{v.versionNo}</button>
                    <span className="truncate text-[11px] text-neutral-500">
                      {v.authorName ?? '未知用户'} · {relativeTime(v.createdAt)}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      {!head && canWrite && (
                        <button type="button"
                          disabled={restoringV !== null}
                          onClick={() => {
                            if (confirm(`确定要恢复到 v${v.versionNo} 吗？此操作会生成新版本记录。`)) {
                              restoreMutation.mutate({ versionNo: v.versionNo });
                            }
                          }}
                          title="恢复到此版本"
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 transition hover:bg-neutral-200/70 hover:text-emerald-600 disabled:opacity-50">
                          <RotateCcw size={12} className={restoringV === v.versionNo ? 'animate-spin' : ''} />
                        </button>
                      )}
                      {!head && (
                        <button type="button"
                          onClick={() => setDiffTargetV(v.versionNo)}
                          title="查看 diff"
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 transition hover:bg-neutral-200/70 hover:text-primary-600">
                          <Diff size={12} />
                        </button>
                      )}
                      {head && <span className="rounded bg-emerald-50 px-1 text-emerald-600 text-[10px]">当前</span>}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-neutral-600">{v.message ?? `${v.authorName ?? '用户'} 的修改`}</div>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center py-8 text-center">
              <History size={24} className="mb-2 text-neutral-300" />
              <div className="text-[11px] text-neutral-400">{docParam ? '暂无版本记录' : '从目录树选择文档后查看历史'}</div>
            </div>
          )}
        </div>

        {/* Diff Modal */}
        {diffTargetV !== null && diffTargetV >= 1 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDiffTargetV(null)}>
            <div
              className="flex max-h-[80vh] w-[min(90vw,900px)] flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-neutral-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b px-4 py-2.5 dark:border-neutral-800">
                <div className="flex items-center gap-2 text-sm">
                  <Diff size={14} className="text-primary-600" />
                  <span className="font-medium">版本对比</span>
                  {headVersionNo > 0 && (
                    <span className="font-mono text-[11px] text-neutral-400">
                      当前 v{headVersionNo} → 目标 v{diffTargetV}
                    </span>
                  )}
                  {diffStat && (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">
                      <span className="text-emerald-600">+{diffStat.add}</span>
                      <span className="mx-1 text-neutral-400">/</span>
                      <span className="text-rose-600">-{diffStat.rem}</span>
                    </span>
                  )}
                </div>
                <button type="button"
                  onClick={() => setDiffTargetV(null)}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800">
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                {targetVersion === undefined ? (
                  <div className="p-6 text-center text-sm text-neutral-400">加载中…</div>
                ) : isBinaryDoc ? (
                  <div className="p-6 text-center text-sm text-neutral-500">
                    二进制文件无文本内容，仅支持大小/下载比较
                    {typeof targetVersion.size === 'number' && (
                      <div className="mt-1 text-xs text-neutral-400">v{targetVersion.versionNo} · {humanSize(targetVersion.size)}</div>
                    )}
                  </div>
                ) : diffChanges ? (
                  <pre className="m-0 whitespace-pre-wrap break-all p-3 font-mono text-[12px] leading-5">
                    {diffChanges.map((c, i) => {
                      const cls = c.added ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : c.removed ? 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        : 'text-neutral-400';
                      return <code key={i} className={`block ${cls}`}>{c.value}</code>;
                    })}
                  </pre>
                ) : (
                  <div className="p-6 text-center text-sm text-neutral-500">当前内容与 v{diffTargetV} 完全一致</div>
                )}
              </div>
              {canWrite && targetVersion && !isHead({ versionNo: diffTargetV } as DocumentVersionInfo) && !isBinaryDoc && (
                <div className="flex items-center justify-between border-t px-4 py-2.5 dark:border-neutral-800">
                  <span className="text-[11px] text-neutral-400">恢复操作将创建新版本 v{headVersionNo + 1}</span>
                  <button type="button"
                    disabled={restoreMutation.isPending}
                    onClick={() => {
                      restoreMutation.mutate({ versionNo: diffTargetV });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-50">
                    <RotateCcw size={12} /> 恢复到 v{diffTargetV}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    );
  };

  // 折叠竖条
  if (compact) {
    return (
      <aside className="flex h-full w-10 shrink-0 flex-col items-center gap-1 overflow-hidden border-l py-2"
        style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-subtle)' }}>
        <button type="button" onClick={onToggle} title="展开右侧面板"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-primary-600 hover:bg-neutral-100">
          <ChevronLeft size={14} />
        </button>
        <div className="my-1 h-px w-4" style={{ background: 'var(--border-soft)' }} />
        <div className="flex flex-1 flex-col items-center gap-1.5 overflow-hidden">
          {fixedTabs.map(({ id, icon: Icon, label }) => (
            <button key={id} type="button"
              onClick={() => { setActiveTab(id); onToggle(); }} title={label}
              className={`inline-flex h-6 w-6 items-center justify-center rounded transition ${
                activeTab === id ? 'bg-neutral-200/60 text-primary-600' : 'text-[var(--text-muted)] hover:bg-neutral-100'
              }`}>
              <Icon size={12} />
            </button>
          ))}
          {/* 「更多」按钮（browse 页才有）：点击展开并跳到第一个下拉 tab（原型 :126-137） */}
          {dropdownTabs.length > 0 && (
            <button type="button"
              onClick={() => { setActiveTab(dropdownTabs[0]!.id); onToggle(); }}
              title={activeInDropdown ? dropdownTabs.find((t) => t.id === activeTab)?.label : '更多'}
              className={`inline-flex h-6 w-6 items-center justify-center rounded transition ${
                activeInDropdown ? 'bg-neutral-200/60 text-primary-600' : 'text-[var(--text-muted)] hover:bg-neutral-100'
              }`}>
              <MoreHorizontal size={12} />
            </button>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-hidden border-l"
      style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-subtle)' }}>
      {/* Panel header：固定 tab + 「更多」下拉（browse 页）+ 折叠按钮（原型 :160-231） */}
      <div className="flex h-11 shrink-0 items-center border-b"
        style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface)' }}>
        <div className="flex h-full overflow-x-auto scrollbar-thin">
          {fixedTabs.map(({ id, icon: Icon, label }) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)}
              className={`inline-flex h-full items-center justify-center gap-1 whitespace-nowrap border-b-2 px-3 text-[12px] font-medium transition ${
                activeTab === id
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-transparent text-[var(--text-muted)]'
              }`}>
              <Icon size={13} className="shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* 「更多」下拉（browse 页才出现）：承载 概览/动态/成员 */}
        {dropdownTabs.length > 0 && (
          <div className="relative h-full" ref={dropdownRef}>
            <button type="button" onClick={() => setDropdownOpen((v) => !v)} title="更多"
              className={`inline-flex h-full items-center border-b-2 px-2.5 transition ${
                activeInDropdown
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : dropdownOpen
                    ? 'border-neutral-300 bg-neutral-50 text-neutral-700'
                    : 'border-transparent text-[var(--text-muted)] hover:bg-neutral-50'
              }`}>
              <MoreHorizontal size={14} />
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 w-40 rounded-lg border py-1.5 shadow-lg animate-fade-up"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
                {dropdownTabs.map(({ id, icon: Icon, label }) => (
                  <button key={id} type="button"
                    onClick={() => { setActiveTab(id); setDropdownOpen(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-[12px] transition ${
                      activeTab === id
                        ? 'bg-primary-50 font-medium text-primary-700'
                        : 'text-[var(--text-secondary)] hover:bg-neutral-50'
                    }`}>
                    <Icon size={13} className="shrink-0" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />
        <button type="button" onClick={onToggle} title="折叠右侧面板"
          className="mx-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-neutral-100"
          style={{ color: 'var(--text-muted)' }}>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        {renderTabContent()}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Skeleton / NotFound
// ---------------------------------------------------------------------------

function HeaderSkeleton(): React.ReactElement {
  return (
    <div className="flex h-14 items-center gap-3 border-b px-6"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
      <div className="skeleton h-9 w-9 rounded-lg" />
      <div className="skeleton h-5 w-36 rounded" />
      <div className="flex-1" />
    </div>
  );
}

function ProjectNotFound({ id }: { id: string | undefined }): React.ReactElement {
  return (
    <div className="flex flex-1 items-start justify-center overflow-auto p-10 scrollbar-thin">
      <div className="max-w-lg rounded-lg border p-10 text-center"
        style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-soft)' }}>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100">
          <FolderOpen size={26} style={{ color: 'var(--text-muted)' }} />
        </div>
        <h2 className="mb-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>未找到项目</h2>
        <p className="mb-5 text-sm" style={{ color: 'var(--text-muted)' }}>
          项目 <code className="rounded border px-1.5 py-0.5 font-mono text-xs"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>{id}</code> 不存在或已被删除。
        </p>
        <Link to="/library" className="btn-primary">返回全局文档库</Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main layout
// ---------------------------------------------------------------------------

export function ProjectLayout(): React.ReactElement {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  // 项目内角色（与 members 接口共用缓存）：canManage 控制重命名/删除入口，canWrite 控制设置 tab
  const { canWrite, canManage } = useProjectRole(id);

  const [menuOpen, setMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  // 右栏开合上收 uiStore：查看器/目录树请求「历史」时可同时强制展开面板
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const [toast, setToast] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const { data: overview, isLoading, error } = useQuery<ProjectOverview>({
    queryKey: ['project-overview', id],
    queryFn: () => apiFetch<ProjectOverview>(`/api/v1/projects/${id}/overview`),
    enabled: !!id,
  });
  const { data: membersData } = useQuery<{ items: MemberRow[] }>({
    queryKey: ['project-members', id],
    queryFn: () => apiFetch<{ items: MemberRow[] }>(`/api/v1/projects/${id}/members`),
    enabled: !!id,
  });
  // GET /api/v1/projects 实际返回 { items }（此前误按 { projects } 解构导致切换下拉恒为空）
  const { data: projectsData } = useQuery<{ items: ProjectSummary[] }>({
    queryKey: ['projects'],
    queryFn: () => apiFetch<{ items: ProjectSummary[] }>('/api/v1/projects'),
  });
  // 项目侧边栏「动态」= 最近 6 条项目动态（PRD 5.3）；必须带 projectId 过滤，
  // 否则拉的是全局动态流、会混入其他项目行为（后端对 projectId 已做可见性校验）
  const { data: actData } = useQuery<{ items: Activity[] }>({
    queryKey: ['activities', id],
    queryFn: () => apiFetch<{ items: Activity[] }>(`/api/v1/activities?projectId=${id}`),
    enabled: !!id,
  });

  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  // 重命名接线（PLAN 5.1.1）：PATCH /api/v1/projects/:id 后端已实现，替换旧 disabled+TODO
  const renameMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch<unknown>(`/api/v1/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-overview', id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setRenameOpen(false);
      showToast('项目已重命名');
    },
    onError: () => showToast('重命名失败，请重试'),
  });
  // 删除项目接线（PLAN 5.2.1）：DELETE /api/v1/projects/:id 后端已实现（软删）
  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/api/v1/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setMoreMenuOpen(false);
      showToast('项目已删除');
      navigate('/library');
    },
    onError: () => showToast('删除失败，请重试'),
  });

  function handleDeleteProject(): void {
    if (!window.confirm(`确定删除项目「${overview?.name ?? ''}」吗？\n删除后项目将从列表消失，此操作不可在界面中撤销。`)) return;
    deleteMutation.mutate();
  }

  const members = membersData?.items ?? [];
  const activities = actData?.items ?? [];
  const otherProjects = (projectsData?.items ?? []).filter((p) => p.id !== id).slice(0, 3);

  // close dropdowns on outside click
  useEffect(() => {
    if (!menuOpen && !moreMenuOpen) return;
    function handleClick(e: MouseEvent): void {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (moreMenuOpen && moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen, moreMenuOpen]);

  // toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  function showToast(msg: string): void {
    setToast(msg);
  }

  async function handleShare(): Promise<void> {
    try { await navigator.clipboard.writeText(window.location.href); } catch { /* clipboard 不可用时仍提示 */ }
    setToast('项目链接已复制');
  }

  if (isLoading) {
    return (
      <div className="flex h-screen flex-col" style={{ background: 'var(--bg-page)' }}>
        <HeaderSkeleton />
        <div className="flex-1" />
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="flex h-screen flex-col" style={{ background: 'var(--bg-page)' }}>
        <ProjectNotFound id={id} />
      </div>
    );
  }

  const accent = overview.accent ?? '#6366f1';
  // 存储后端类型直接取项目行 storage_kind；未知值不渲染标签
  const backendMeta = BACKEND_TYPE_TAG[overview.backendKind ?? ''];

  const outletContext: ProjectOutletContext = { showToast };

  return (
    <div className="flex h-screen flex-col animate-fade-up" style={{ background: 'var(--bg-page)' }}>
      {/* ===== Header ===== */}
      <header className="z-20 flex h-14 shrink-0 items-center gap-3 border-b px-5"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
        {/* 项目身份区：字母色块 + 名称切换器 + 存储后端 tag */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: accent }}>
          <span className="text-sm font-bold text-white">{(overview.name || '?').trim().charAt(0)}</span>
        </div>

        <div className="relative" ref={menuRef}>
          <button type="button" onClick={() => setMenuOpen((v) => !v)}
            className="-ml-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-neutral-100">
            <h1 className="max-w-[200px] truncate text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>
              {overview.name}
            </h1>
            <ChevronDown size={15} className={`transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
              style={{ color: 'var(--text-muted)' }} />
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-lg border py-2 shadow-lg animate-fade-up"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>切换项目</div>
              {otherProjects.length > 0 ? (
                otherProjects.map((p) => (
                  <Link key={p.id} to={`/projects/${p.id}`}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-50"
                    style={{ color: 'var(--text-secondary)' }} onClick={() => setMenuOpen(false)}>
                    <div className="flex h-6 w-6 items-center justify-center rounded-md"
                      style={{ background: p.accent ?? '#6366f1' }}>
                      <span className="text-[10px] font-bold text-white">{(p.name || '?').trim().charAt(0)}</span>
                    </div>
                    <span className="truncate">{p.name}</span>
                  </Link>
                ))
              ) : (
                <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>暂无其他项目</div>
              )}
              <div className="my-1 h-px" style={{ background: 'var(--border-soft)' }} />
              <Link to="/library" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-50"
                style={{ color: 'var(--text-secondary)' }} onClick={() => setMenuOpen(false)}>
                <FolderKanban size={15} style={{ color: 'var(--text-muted)' }} />
                <span>返回全局文档库</span>
              </Link>
            </div>
          )}
        </div>

        {backendMeta && <span className={`tag shrink-0 ${backendMeta.cls}`}>{backendMeta.label}</span>}

        {/* 水平 tabs —— 设置页全为写操作（保存配置/同步/AI/导入/删除），只读用户无可用功能，隐藏入口 */}
        <nav className="ml-2 flex items-center gap-0.5">
          {TABS.filter(({ to }) => to !== 'settings' || canWrite).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={false}
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-primary-50 font-semibold text-primary-700' : 'text-[var(--text-muted)] hover:bg-neutral-100'
                }`
              }
            >
              <Icon size={15} className="shrink-0" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        <AppearanceToggle />

        <div className="flex items-center gap-2">
          <button className="btn-secondary !h-8 !text-xs" type="button" onClick={() => void handleShare()}>
            <Share2 size={14} />
            <span className="hidden sm:inline">分享</span>
          </button>

          {/* 更多菜单 */}
          <div className="relative" ref={moreMenuRef}>
            <button
              className={`btn-ghost !h-8 !w-8 !p-0 ${moreMenuOpen ? 'bg-neutral-100' : ''}`}
              type="button" aria-label="更多" onClick={() => setMoreMenuOpen((v) => !v)}>
              <MoreHorizontal size={17} />
            </button>
            {moreMenuOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-lg border py-2 shadow-lg animate-fade-up"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
                {/* 更多菜单：访问发布网站（只读可看）+ 重命名/删除（仅所有者/维护者，后端 403 兜底） */}
                <button type="button" onClick={() => { setMoreMenuOpen(false); navigate(`/projects/${id}/publish`); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-50"
                  style={{ color: 'var(--text-secondary)' }}>
                  <ExternalLink size={14} style={{ color: 'var(--text-muted)' }} /> 访问发布网站
                </button>
                {canManage && (
                  <>
                    <div className="my-1 h-px" style={{ background: 'var(--border-soft)' }} />
                    <button type="button"
                      onClick={() => { setMoreMenuOpen(false); setRenameValue(overview.name); setRenameOpen(true); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-50"
                      style={{ color: 'var(--text-secondary)' }}>
                      <Pencil size={14} style={{ color: 'var(--text-muted)' }} /> 重命名项目
                    </button>
                    {/* 删除项目（PLAN 5.2.1：DELETE /projects/:id 已接线，二次确认） */}
                    <button type="button"
                      onClick={() => { setMoreMenuOpen(false); handleDeleteProject(); }}
                      disabled={deleteMutation.isPending}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-rose-50 disabled:opacity-50"
                      style={{ color: '#ef4444' }}>
                      <Trash2 size={14} /> {deleteMutation.isPending ? '删除中…' : '删除项目'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 重命名弹窗（PLAN 5.1.1：PATCH /projects/:id 已就绪） */}
      {renameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up"
          onClick={(e) => { if (e.target === e.currentTarget) setRenameOpen(false); }}>
          <div className="card w-full max-w-sm p-5 shadow-xl animate-fade-up">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>重命名项目</h3>
            <input
              className="input mt-3"
              value={renameValue}
              autoFocus
              maxLength={80}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && renameValue.trim()) renameMutation.mutate(renameValue.trim()); }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary !h-8 !text-xs" onClick={() => setRenameOpen(false)}>取消</button>
              <button type="button" className="btn-primary !h-8 !text-xs disabled:opacity-50"
                disabled={!renameValue.trim() || renameValue.trim() === overview.name || renameMutation.isPending}
                onClick={() => renameMutation.mutate(renameValue.trim())}>
                {renameMutation.isPending ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Body ===== */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main key={location.pathname + location.search} className="min-w-0 flex-1 animate-fade-up overflow-hidden">
          <Outlet context={outletContext} />
        </main>

        <ProjectRightSidebar
          overview={overview}
          members={members}
          activities={activities}
          compact={!rightPanelOpen}
          onToggle={toggleRightPanel}
        />
      </div>

      {toast && <HeaderToast message={toast} />}
    </div>
  );
}
