import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Database,
  Folder,
  GitBranch,
  Globe,
  HardDrive,
  Import,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api/client';
import { useProjectRole } from '../lib/api/use-project-role';
import { useShowToast } from '../components/Toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectOverview {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  template: string | null;
  ownerId: string;
  docCount: number;
  sourceCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string | null;
}

interface SourceItem {
  id: string;
  projectId: string;
  type: string;
  name: string;
  configPublic: Record<string, unknown>;
  defaultBranch: string | null;
  autoSync: boolean;
  intervalSeconds: number;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

// configPublic → 展示地址（git→url / local→path，其余 url|host 兜底；与 SourcesPage.sourceUrl 同规则）
function sourceUrlOf(s: SourceItem): string {
  const pub = (s.configPublic ?? {}) as Record<string, string | undefined>;
  if (s.type === 'git') return pub.url ?? '—';
  if (s.type === 'local') return pub.path ?? '—';
  if (pub.url) return pub.url;
  if (pub.host) return `${pub.host}${pub.port ? ':' + pub.port : ''}`;
  return '—';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '从未';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs} 小时前`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays} 天前`;
}

const VISIBILITY_META: Record<string, { label: string; desc: string }> = {
  private: { label: '私有', desc: '仅成员可见' },
  team: { label: '团队', desc: '企业内可发现' },
  public: { label: '公开', desc: '任何人可查看' },
};

const SOURCE_TYPE_META: Record<string, { label: string; icon: typeof HardDrive }> = {
  local: { label: '本地文件夹', icon: HardDrive },
  git: { label: 'Git 仓库', icon: GitBranch },
  github: { label: 'GitHub', icon: GitBranch },
  gitlab: { label: 'GitLab', icon: GitBranch },
};

const SOURCE_STATUS_META: Record<string, { label: string; dot: string }> = {
  active: { label: '正常', dot: 'bg-emerald-500' },
  syncing: { label: '同步中', dot: 'bg-amber-500' },
  error: { label: '异常', dot: 'bg-rose-500' },
  paused: { label: '已暂停', dot: 'bg-neutral-400' },
};

// ---------------------------------------------------------------------------
// Section sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ title, desc, icon }: {
  title: string; desc: string; icon: React.ReactElement;
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-[11px] text-neutral-500 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

// ---- 基本信息 ----
function BasicInfoSection({ project, projectId, canManage }: { project: ProjectOverview | undefined; projectId: string; canManage: boolean }): React.ReactElement {
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [visibility, setVisibility] = useState('team');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDesc(project.description ?? '');
      setVisibility(project.visibility);
      setDirty(false);
    }
  }, [project?.id]);

  useEffect(() => {
    setDirty(
      name !== (project?.name ?? '') ||
      (desc ?? null) !== (project?.description ?? '') ||
      visibility !== (project?.visibility ?? ''),
    );
  }, [name, desc, visibility, project]);

  // 保存接线（PLAN 5.1.1）：PATCH /api/v1/projects/:id 后端已实现（name/description/visibility/color），
  // 替换旧的「无 PATCH」过时 TODO 注释
  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), description: desc.trim() || null, visibility }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-overview', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      showToast('设置已保存');
    },
    onError: () => showToast('保存失败，请重试'),
  });

  return (
    <section className="card p-6">
      <SectionHeader
        icon={<Settings2 size={15} />}
        title="基本信息"
        desc="项目名称、描述与可见范围"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">项目名称</label>
          <input
            type="text"
            className="input"
            disabled={!canManage}
            value={name}
            onChange={(e) => { setName(e.target.value); }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">项目 ID</label>
          <input
            type="text"
            className="input font-mono text-xs text-neutral-500 bg-neutral-50"
            disabled
            value={project?.id ?? ''}
          />
        </div>
      </div>

      <div className="mt-5">
        <label className="block text-xs font-medium text-neutral-700 mb-1.5">项目描述</label>
        <textarea
          className="input !resize-none"
          rows={3}
          placeholder="一句话说明这个项目的用途…"
          value={desc}
          disabled={!canManage}
          onChange={(e) => { setDesc(e.target.value); }}
        />
      </div>

      <div className="mt-5">
        <label className="block text-xs font-medium text-neutral-700 mb-2">可见范围</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {Object.entries(VISIBILITY_META).map(([key, meta]) => (
            <button
              key={key}
              type="button"
              disabled={!canManage}
              onClick={() => setVisibility(key)}
              className={`flex items-start gap-3 p-3 rounded-lg border text-left transition ${
                visibility === key
                  ? 'border-primary-300 bg-primary-50/60 ring-1 ring-primary-200'
                  : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
              }`}
            >
              <span className="w-6 h-6 rounded-md bg-white border border-neutral-200 flex items-center justify-center shrink-0">
                <Globe size={11} className="text-neutral-500" />
              </span>
              <div>
                <div className="text-xs font-medium text-neutral-800">{meta.label}</div>
                <div className="text-[11px] text-neutral-500 mt-0.5">{meta.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between border-t pt-4" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="text-[11px] text-neutral-400">
          <span>创建于 {project ? new Date(project.createdAt).toLocaleDateString() : '—'}</span>
          <span className="mx-2">·</span>
          <span>上次更新 {project?.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : '—'}</span>
        </div>
        {canManage ? (
          <button
            type="button"
            className="btn-primary !h-8 !text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            <Save size={12} /> {saveMutation.isPending ? '保存中…' : '保存变更'}
          </button>
        ) : (
          <span className="text-[11px] text-neutral-400">仅项目所有者/维护者可修改基本信息</span>
        )}
      </div>
    </section>
  );
}

// ---- 数据源 ----
function SourcesSection({ sources, projectId, canWrite }: { sources: SourceItem[]; projectId: string; canWrite: boolean }): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // 真实同步触发（PLAN 5.1.4：修正旧实现点击跳转 /sources 的语义错位）
  const syncMutation = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/api/v1/sources/${id}/sync`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      showToast('同步已触发');
    },
    onError: () => showToast('同步触发失败，请重试'),
  });

  async function handleSync(id: string): Promise<void> {
    if (syncingId) return;
    setSyncingId(id);
    try {
      await syncMutation.mutateAsync(id);
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <section className="card p-6">
      <SectionHeader
        icon={<Database size={15} />}
        title="数据源"
        desc="已绑定的 Git / 本地 / 云盘数据源，点击查看详情或手动同步"
      />

      {sources.length === 0 ? (
        <div className="py-10 text-center text-neutral-400">
          <HardDrive size={32} className="mx-auto mb-2 text-neutral-300" />
          <p className="text-sm">还没有绑定任何数据源</p>
          {canWrite && (
            <button
              type="button"
              className="btn-secondary !h-8 !text-xs mt-3"
              onClick={() => navigate('/sources')}
              title="前往全局数据源管理添加"
            >
              <Plus /> 前往添加数据源
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-soft)' }}>
          <div className="divide-y" style={{ borderColor: 'var(--border-soft)' }}>
            {sources.map((s) => {
              const meta = SOURCE_TYPE_META[s.type] ?? { label: s.type, icon: Folder };
              const status = SOURCE_STATUS_META[s.status] ?? SOURCE_STATUS_META.active;
              const TypeIcon = meta.icon;
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50/70 transition">
                  <div className="w-9 h-9 rounded-lg bg-neutral-100 flex items-center justify-center shrink-0 text-neutral-600">
                    <TypeIcon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-neutral-900 truncate">{s.name}</span>
                      <span className={`shrink-0 inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10px] font-medium ${
                        s.status === 'active' ? 'bg-emerald-50 text-emerald-700'
                        : s.status === 'syncing' ? 'bg-amber-50 text-amber-700'
                        : s.status === 'error' ? 'bg-rose-50 text-rose-700'
                        : 'bg-neutral-100 text-neutral-600'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                        {status.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-neutral-500">
                      <span>{meta.label}</span>
                      {s.defaultBranch && <span className="font-mono">{s.defaultBranch}</span>}
                      <span className="flex items-center gap-1"><RefreshCw size={10} /> 上次 {relativeTime(s.lastSyncedAt)}</span>
                    </div>
                    {/* 仓库地址 / 本地路径展示（GET /sources 已下发 configPublic，PLAN 5.1.4） */}
                    <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-400" title={sourceUrlOf(s)}>
                      {sourceUrlOf(s)}
                    </div>
                    {s.lastError && (
                      <div className="mt-1 text-[11px] text-rose-600 truncate">⚠ {s.lastError}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {canWrite && (
                      <button
                        type="button"
                        className="w-7 h-7 rounded-md inline-flex items-center justify-center text-neutral-400 hover:text-primary-600 hover:bg-primary-50 transition disabled:opacity-60"
                        title="立即同步"
                        disabled={syncingId === s.id}
                        onClick={() => void handleSync(s.id)}
                      >
                        <RefreshCw size={13} className={syncingId === s.id ? 'animate-spin text-primary-500' : ''} />
                      </button>
                    )}
                    <ChevronRight size={14} className="text-neutral-300" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 前往全局数据源管理提示卡（PLAN 5.1.4，对齐原型 ProjectSettings.jsx:303-315） */}
      <div className="mt-4 rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-subtle)' }}>
        <div className="text-xs text-neutral-600 mb-2">
          💡 需要更详细的数据源配置（认证 Token、分支、同步间隔等）？
        </div>
        <button
          type="button"
          onClick={() => navigate('/sources')}
          className="btn-secondary !h-7 !px-2.5 !text-xs"
        >
          前往全局数据源管理
          <ChevronRight size={13} />
        </button>
      </div>
    </section>
  );
}

// ---- 同步设置（PLAN 5.1.2） ----
function SyncSettingsSection({ sources, canWrite, canManage }: { sources: SourceItem[]; canWrite: boolean; canManage: boolean }): React.ReactElement {
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  // 项目的同步设置作用于其主数据源（业务上一个项目通常只绑一个源）
  const source = sources[0] ?? null;
  const [syncing, setSyncing] = useState(false);

  const patchMutation = useMutation({
    mutationFn: (patch: { autoSync?: boolean; intervalSeconds?: number }) =>
      apiFetch<unknown>(`/api/v1/sources/${source?.id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      showToast('同步设置已更新');
    },
    onError: () => showToast('保存失败，请重试'),
  });

  const syncNow = useMutation({
    mutationFn: () => apiFetch<unknown>(`/api/v1/sources/${source?.id}/sync`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      showToast('同步已触发');
    },
    onError: () => showToast('同步触发失败，请重试'),
  });

  if (!source) {
    return (
      <section className="card p-6">
        <SectionHeader icon={<RefreshCw size={15} />} title="同步设置" desc="控制文档的自动同步行为" />
        <div className="py-10 text-center text-neutral-400">
          <HardDrive size={32} className="mx-auto mb-2 text-neutral-300" />
          <p className="text-sm">尚未绑定数据源，无法配置同步</p>
          <p className="text-xs mt-1">请先在「数据源」页绑定 Git / 本地源，或通过 Library 的 StarterPack 向导创建</p>
        </div>
      </section>
    );
  }

  // 间隔四档（对齐原型 ProjectSettings.jsx:343-362）；选择档位即视为启用自动同步
  const INTERVALS: Array<{ key: string; label: string; seconds: number }> = [
    { key: '30m', label: '30 分钟', seconds: 30 * 60 },
    { key: '1h', label: '1 小时', seconds: 60 * 60 },
    { key: '6h', label: '6 小时', seconds: 6 * 60 * 60 },
    { key: '24h', label: '每天', seconds: 24 * 60 * 60 },
  ];

  return (
    <section className="card p-6 space-y-5">
      <SectionHeader icon={<RefreshCw size={15} />} title="同步设置" desc={`${source.name} · 控制文档的自动同步行为`} />

      {/* 启用自动同步 —— 修改数据源配置为管理操作（后端 PUT sources 403 兜底） */}
      <label className={`flex items-center justify-between gap-3 p-4 rounded-lg border transition ${canManage ? 'cursor-pointer hover:bg-neutral-50' : 'opacity-60 cursor-not-allowed'}`}
        style={{ borderColor: 'var(--border-soft)' }}>
        <span>
          <span className="block text-sm font-medium text-neutral-800">启用自动同步</span>
          <span className="block text-xs text-neutral-500 mt-0.5">根据设定的间隔自动拉取最新内容并重建索引</span>
        </span>
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary-500"
          checked={source.autoSync}
          disabled={!canManage || patchMutation.isPending}
          onChange={(e) =>
            patchMutation.mutate({
              autoSync: e.target.checked,
              intervalSeconds: e.target.checked ? (source.intervalSeconds > 0 ? source.intervalSeconds : 3600) : 0,
            })
          }
        />
      </label>

      {/* 同步间隔四档 */}
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-2">同步间隔</label>
        <div className="grid grid-cols-4 gap-2">
          {INTERVALS.map((o) => {
            const active = source.autoSync && source.intervalSeconds === o.seconds;
            return (
              <button
                key={o.key}
                type="button"
                disabled={!canManage || patchMutation.isPending}
                onClick={() => patchMutation.mutate({ autoSync: true, intervalSeconds: o.seconds })}
                className={`py-2 rounded-md text-xs font-medium border transition ${
                  active
                    ? 'border-primary-400 bg-primary-50 text-primary-700'
                    : 'border-[var(--border-soft)] text-[var(--text-secondary)] hover:bg-neutral-50'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-neutral-400 mt-1.5">
          当前：{source.autoSync ? `每 ${source.intervalSeconds / 3600} 小时` : '手动同步'}
        </div>
      </div>

      {/* 立即同步一次（触发同步为编辑权限操作） */}
      <div className="pt-2 border-t" style={{ borderColor: 'var(--border-soft)' }}>
        {canWrite ? (
          <button
            type="button"
            className="btn-primary !h-8 !text-xs"
            disabled={syncing || syncNow.isPending}
            onClick={async () => {
              setSyncing(true);
              try {
                await syncNow.mutateAsync();
              } finally {
                setSyncing(false);
              }
            }}
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? '同步中…' : '立即同步一次'}
          </button>
        ) : (
          <span className="text-[11px] text-neutral-400">只读身份无法触发同步</span>
        )}
      </div>
    </section>
  );
}

// ---- AI 整理（EXT-PLATFORM Step2：后端 ai-classify 路由已落地，解禁触发与建议列表） ----
interface AiClassifyRun {
  id: string;
  scope: string;
  status: string;
  stats: { action?: string; documentId?: string; suggestion?: { folder?: string; tags?: string[] } } | null;
  createdAt: string;
}

function AiClassifySection({ projectId, canWrite }: { projectId: string; canWrite: boolean }): React.ReactElement {
  const queryClient = useQueryClient();
  const showToast = useShowToast();

  const runsQuery = useQuery<{ items: AiClassifyRun[] }>({
    queryKey: ['ai-classify-runs', projectId],
    queryFn: () => apiFetch<{ items: AiClassifyRun[] }>(`/api/v1/projects/${projectId}/ai-classify-runs`),
    enabled: !!projectId,
  });

  const startMutation = useMutation({
    mutationFn: () => apiFetch<unknown>(`/api/v1/projects/${projectId}/ai-classify`, { method: 'POST' }),
    onSuccess: () => {
      showToast('整理任务已开始，稍后刷新查看建议');
      // worker 消费有延迟，延迟刷新一次
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['ai-classify-runs', projectId] }), 2500);
    },
    onError: () => showToast('整理任务启动失败，请重试'),
  });

  const runs = runsQuery.data?.items ?? [];
  // 最近一轮（同批次 createdAt 相同）的建议聚合展示
  const latestBatchAt = runs[0]?.createdAt;
  const latestRuns = latestBatchAt ? runs.filter((r) => r.createdAt === latestBatchAt) : [];

  return (
    <section className="card p-6">
      <SectionHeader
        icon={<Wand2 size={15} />}
        title="AI 整理"
        desc="自动为文档生成分类与标签建议（生成-确认两段式：建议不直接改动文档）"
      />

      <div className="flex items-center gap-4 p-4 rounded-lg border" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center shrink-0">
          <Sparkles size={16} className="text-violet-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-neutral-800">AI 整理任务</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            启发式分类器（自研）· 扫描项目文档并产出目录/标签建议
          </div>
        </div>
        {canWrite ? (
          <button
            type="button"
            className="btn-secondary !h-8 !text-xs shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={startMutation.isPending}
            onClick={() => startMutation.mutate()}
          >
            <Wand2 size={12} /> {startMutation.isPending ? '启动中…' : '开始整理'}
          </button>
        ) : (
          <span className="text-[11px] text-neutral-400 shrink-0">只读身份无法触发</span>
        )}
      </div>

      <div className="mt-4">
        {runsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-8 w-full rounded" />)}
          </div>
        ) : latestRuns.length === 0 ? (
          <div className="text-[11px] text-neutral-400">暂无历史整理记录 —— 点击「开始整理」生成第一批建议</div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              最新建议 · {latestRuns.length} 篇文档
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto scrollbar-thin">
              {latestRuns.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
                  style={{ borderColor: 'var(--border-soft)' }}>
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>
                    {r.stats?.documentId?.slice(0, 8) ?? '文档'}…
                  </span>
                  {(r.stats?.suggestion?.tags ?? []).map((t) => (
                    <span key={t} className="tag tag-primary !text-[10px]">{t}</span>
                  ))}
                </div>
              ))}
            </div>
            <div className="text-[11px] text-neutral-400">建议需人工确认后才会应用到文档（确认流待后续版本）</div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---- 外部导入（EXT-PLATFORM Step2：folder / web-crawler 已可用；Notion 等深度连接器后期适配器接入） ----
interface ImportJob {
  id: string;
  importer: string;
  status: string; // queued | running | done | failed
  progress: number;
  stats: { docs?: number } | null;
  error: string | null;
  createdAt: string;
}

const IMPORTER_META: Array<{ key: string; label: string; desc: string; enabled: boolean; placeholder: string }> = [
  { key: 'folder', label: '本地文件夹', desc: '递归导入 *.md', enabled: true, placeholder: '/path/to/docs' },
  { key: 'web-crawler', label: '网页抓取', desc: '单页 HTML → MD', enabled: true, placeholder: 'https://example.com/docs' },
  { key: 'notion', label: 'Notion', desc: '深度连接器 · 即将上线', enabled: false, placeholder: '' },
];

function ExternalImportSection({ projectId, canWrite }: { projectId: string; canWrite: boolean }): React.ReactElement {
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  const [importer, setImporter] = useState<string>('folder');
  const [paramValue, setParamValue] = useState('');

  const jobsQuery = useQuery<{ items: ImportJob[] }>({
    queryKey: ['import-jobs', projectId],
    queryFn: () => apiFetch<{ items: ImportJob[] }>(`/api/v1/projects/${projectId}/import-jobs`),
    enabled: !!projectId,
    // 有进行中任务时 3s 轮询进度
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some((j) => j.status === 'queued' || j.status === 'running') ? 3000 : false,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<ImportJob>(`/api/v1/projects/${projectId}/import-jobs`, {
        method: 'POST',
        body: JSON.stringify({ importer, params: importer === 'folder' ? { path: paramValue.trim() } : { url: paramValue.trim() } }),
      }),
    onSuccess: () => {
      showToast('导入任务已创建');
      setParamValue('');
      void queryClient.invalidateQueries({ queryKey: ['import-jobs', projectId] });
    },
    onError: () => showToast('导入任务创建失败，请检查参数'),
  });

  const jobs = jobsQuery.data?.items ?? [];
  const activeMeta = IMPORTER_META.find((m) => m.key === importer);

  return (
    <section className="card p-6">
      <SectionHeader
        icon={<Import size={15} />}
        title="外部导入"
        desc="从本地文件夹或网页批量迁移文档到本项目"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {IMPORTER_META.map(({ key, label, desc, enabled }) => {
          const Icon = key === 'folder' ? Import : key === 'web-crawler' ? Globe : Upload;
          const active = importer === key;
          return (
            <button
              key={key}
              type="button"
              disabled={!enabled}
              onClick={() => enabled && setImporter(key)}
              title={enabled ? undefined : '深度连接器开发中，后期以适配器形式接入'}
              className={`group flex flex-col items-center gap-1.5 p-4 rounded-lg border text-center transition ${
                enabled ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
              } ${active && enabled ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-200' : 'hover:border-neutral-300'}`}
              style={active && enabled ? undefined : { borderColor: 'var(--border-soft)' }}
            >
              <Icon size={20} className={active && enabled ? 'text-primary-600' : 'text-neutral-500'} />
              <div className="text-xs font-medium text-neutral-700">{label}</div>
              <div className="text-[10px] text-neutral-400">{desc}</div>
            </button>
          );
        })}
      </div>

      {canWrite && activeMeta?.enabled && (
        <div className="mt-3 flex items-center gap-2">
          <input
            className="input !h-8 flex-1 font-mono !text-xs"
            placeholder={activeMeta.placeholder}
            value={paramValue}
            onChange={(e) => setParamValue(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary !h-8 !text-xs shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!paramValue.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Upload size={12} /> {createMutation.isPending ? '创建中…' : '开始导入'}
          </button>
        </div>
      )}
      {!canWrite && activeMeta?.enabled && (
        <div className="mt-3 text-[11px] text-neutral-400">只读身份无法创建导入任务</div>
      )}

      <div className="mt-4">
        {jobsQuery.isLoading ? (
          <div className="skeleton h-8 w-full rounded" />
        ) : jobs.length === 0 ? (
          <div className="text-[11px] text-neutral-400 flex items-center gap-1.5">
            <AlertTriangle size={11} /> 暂无导入记录 —— folder 导入服务器上可达的目录，网页抓取为单页（无深度/robots，见设计文档边界）
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">最近任务</div>
            <div className="max-h-48 space-y-1 overflow-y-auto scrollbar-thin">
              {jobs.map((j) => (
                <div key={j.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
                  style={{ borderColor: 'var(--border-soft)' }}>
                  <span className="tag tag-neutral !text-[10px]">{j.importer}</span>
                  <span className={`tag !text-[10px] ${j.status === 'done' ? 'tag-success' : j.status === 'failed' ? 'tag-danger' : 'tag-warning'}`}>
                    {j.status === 'done' ? '完成' : j.status === 'failed' ? '失败' : j.status === 'running' ? `进行中 ${j.progress}` : '排队中'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-neutral-400">
                    {j.error ?? (j.stats?.docs != null ? `${j.stats.docs} 篇文档` : '')}
                  </span>
                  <span className="shrink-0 text-[10px] text-neutral-400">
                    {new Date(j.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---- 危险区 ----
function DangerZoneSection({ projectId, projectName, canManage }: { projectId: string; projectName?: string; canManage: boolean }): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useShowToast();

  // 删除项目（PLAN 5.2.1）：DELETE /api/v1/projects/:id 后端已实现（软删 deletedAt）
  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/api/v1/projects/${projectId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      showToast('项目已删除');
      navigate('/library');
    },
    onError: () => showToast('删除失败，请重试'),
  });

  function handleDelete(): void {
    const name = projectName ?? '该项目';
    if (!window.confirm(`确定删除项目「${name}」吗？\n删除后项目及其文档将从全站消失，此操作不可在界面中撤销。`)) return;
    deleteMutation.mutate();
  }

  return (
    // 边框色统一由 border-rose-200/70 类声明（去除旧 class+style 双写；暗色由 index.css 覆写层降饱和）
    <section className="card p-6 border-rose-200/70">
      <SectionHeader
        icon={<AlertTriangle size={15} className="text-rose-600" />}
        title="危险区"
        desc="以下操作不可逆，请谨慎执行"
      />

      {/* 浅红底统一走 bg-rose-50 类（暗色覆盖见 index.css:83），去除旧 rgb 内联硬编码 */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-rose-50/50 border border-rose-200">
        <div>
          <div className="text-sm font-medium text-neutral-900">删除项目</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">删除后项目及其文档将从全站列表消失（软删除，后端暂不提供界面恢复入口）</div>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="btn-danger !h-8 !text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={12} /> {deleteMutation.isPending ? '删除中…' : '删除项目'}
          </button>
        ) : (
          <span className="text-[11px] text-rose-400 shrink-0">仅项目所有者/维护者可删除</span>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ProjectSettingsPage(): React.ReactElement {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  // 项目内角色：设置页各区块按 canManage（改配置/删项目）/ canWrite（同步/AI/导入）收口
  const { canWrite, canManage } = useProjectRole(projectId);
  const [activeTab, setActiveTab] = useState<
    'basic' | 'sources' | 'sync' | 'ai' | 'import' | 'danger'
  >('basic');

  const { data: project, isLoading: projectLoading } = useQuery<ProjectOverview>({
    queryKey: ['project-overview', projectId],
    queryFn: () => apiFetch<ProjectOverview>(`/api/v1/projects/${projectId}/overview`),
    enabled: !!projectId,
  });

  const { data: allSourcesData } = useQuery<{ items: SourceItem[]; total: number }>({
    queryKey: ['sources'],
    queryFn: () => apiFetch<{ items: SourceItem[]; total: number }>('/api/v1/sources'),
    enabled: !!projectId,
  });

  // 前端按 projectId 过滤 — 后端 sourcesRoute 暂不支持 projectId 查询参数
  const sources = (allSourcesData?.items ?? []).filter((s) => s.projectId === projectId);

  const tabs: Array<{ key: typeof activeTab; label: string; icon: React.ReactElement }> = [
    { key: 'basic', label: '基本信息', icon: <Settings2 size={13} /> },
    { key: 'sources', label: '数据源', icon: <Database size={13} /> },
    { key: 'sync', label: '同步设置', icon: <RefreshCw size={13} /> },
    { key: 'ai', label: 'AI 整理', icon: <Sparkles size={13} /> },
    { key: 'import', label: '外部导入', icon: <Import size={13} /> },
    { key: 'danger', label: '危险区', icon: <AlertTriangle size={13} /> },
  ];

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Breadcrumb / back */}
        <button
          type="button"
          onClick={() => navigate(`/projects/${projectId}/browse`)}
          className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-primary-600 transition-colors mb-4"
        >
          <ArrowRight size={12} style={{ transform: 'rotate(180deg)' }} />
          返回 {project?.name ?? '项目'}
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-neutral-400 text-xs mb-1">
            <Folder size={13} />
            <span>{project?.name ?? '加载中…'}</span>
            <ChevronRight size={11} />
            <span>设置</span>
          </div>
          <h1 className="text-xl font-bold text-neutral-900">项目设置</h1>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: '文档', value: project?.docCount ?? '—' },
            { label: '数据源', value: project?.sourceCount ?? '—' },
            { label: '成员', value: project?.memberCount ?? '—' },
          ].map((s) => (
            <div key={s.label} className="card p-4 text-center">
              <div className="font-display text-lg font-bold tabular-nums text-neutral-900">{s.value}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tab pills (mobile) / Sidebar nav (desktop) */}
        <div className="flex flex-col md:flex-row gap-6">
          {/* Tab nav */}
          <nav className="md:w-48 shrink-0 md:sticky md:top-6 md:self-start">
            <div className="hidden md:block text-[10px] uppercase tracking-wider text-neutral-400 font-semibold mb-2">设置</div>
            <div className="flex md:flex-col gap-1 md:gap-0.5 overflow-x-auto md:overflow-visible">
              {tabs.map((tab) => {
                const active = activeTab === tab.key;
                const dangerous = tab.key === 'danger';
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`shrink-0 md:w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition ${
                      active
                        ? (dangerous ? 'bg-rose-50 text-rose-700' : 'bg-primary-50 text-primary-700')
                        : dangerous
                          ? 'text-rose-600 hover:bg-rose-50/60'
                          : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeTab === 'basic' && (
              projectLoading ? (
                <div className="card p-6 space-y-4">
                  <div className="skeleton h-4 w-32" />
                  <div className="skeleton h-10 w-full" />
                  <div className="skeleton h-10 w-full" />
                </div>
              ) : (
                <BasicInfoSection project={project} projectId={projectId!} canManage={canManage} />
              )
            )}

            {activeTab === 'sources' && <SourcesSection sources={sources} projectId={projectId!} canWrite={canWrite} />}
            {activeTab === 'sync' && <SyncSettingsSection sources={sources} canWrite={canWrite} canManage={canManage} />}
            {activeTab === 'ai' && <AiClassifySection projectId={projectId!} canWrite={canWrite} />}
            {activeTab === 'import' && <ExternalImportSection projectId={projectId!} canWrite={canWrite} />}
            {activeTab === 'danger' && <DangerZoneSection projectId={projectId!} projectName={project?.name} canManage={canManage} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Local Plus icon (避免未使用 import 警告) ----
function Plus(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
