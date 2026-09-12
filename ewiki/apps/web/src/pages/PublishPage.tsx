import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  LayoutTemplate,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Settings,
  X,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api/client';
import { useProjectRole } from '../lib/api/use-project-role';

// ---------------------------------------------------------------------------
// Types — 后端 publish-sites 端点 shape
// ---------------------------------------------------------------------------

type SiteStatus = 'active' | 'pending';

interface PublishSite {
  id: string;
  projectId: string;
  mode: 'hosted' | 'custom';
  slug: string | null;
  addressMode: 'subdomain' | 'subpath' | null;
  customDomain: string | null;
  schedule: string;
  autoSync: boolean;
  templateId: string | null;
  currentVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

// 发布模板元数据（GET /api/v1/publish-templates 响应项，服务端权威源；PLAN 3.5/5.2.1）
interface PublishTemplateMeta {
  id: string;
  name: string;
  zhLabel: string;
  desc: string;
  layout: string;
  accent: string;
  target: string;
  emoji: string;
  stars: number;
}

type JobStatus = 'queued' | 'building' | 'published' | 'failed';

interface PublishJob {
  id: string;
  siteId: string;
  versionNo: number;
  status: JobStatus;
  commitHash: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

// 向导 Step1 使用的文档列表最小 shape（与 BrowsePage 的 documents 端点一致）
interface WizardDoc {
  id: string;
  title: string | null;
  path: string;
}

type ScheduleKey = 'git-push' | 'daily' | 'manual';
type AddressMode = 'subdomain' | 'subpath';

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
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;
  // 对齐原型 Sources.jsx:28-40：超过 30 天进入「个月前」档
  return `${Math.floor(diffDays / 30)} 个月前`;
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

// slug 生成：小写化、非 [a-z0-9] 字符折叠为连字符（中文会被折叠，允许结果为空）
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// slug 校验：仅小写字母、数字、连字符
function validateSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug);
}

function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 站点访问地址派生（hosted 模式）：子路径为平台真实可访问地址 /sites/<slug>/；子域名为后续域名绑定的展示形态
function siteUrlOf(slug: string, addressMode: AddressMode): string {
  return addressMode === 'subpath' ? `${window.location.origin}/sites/${slug}/` : `${slug}.${'ewiki.yfzx.cn'}`;
}

const STATUS_META: Record<SiteStatus, { label: string; dot: string; text: string }> = {
  active: { label: '运行中', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  pending: { label: '待发布', dot: 'bg-amber-500', text: 'text-amber-700' },
};

const JOB_STATUS_META: Record<JobStatus, { label: string; color: string }> = {
  queued: { label: '等待中', color: 'text-neutral-500' },
  building: { label: '构建中', color: 'text-blue-600' },
  published: { label: '成功', color: 'text-emerald-600' },
  failed: { label: '失败', color: 'text-red-600' },
};

const SCHEDULE_LABEL: Record<string, string> = {
  'git-push': 'Git push 时自动发布',
  daily: '每日凌晨 03:00',
  manual: '手动触发',
};

const SCHEDULE_OPTIONS: Array<{ key: ScheduleKey; label: string; desc: string; Icon: LucideIcon }> = [
  { key: 'git-push', label: 'Git push 时', desc: '推送后自动发布', Icon: RefreshCw },
  { key: 'daily', label: '每日 03:00', desc: '定时构建发布', Icon: Clock },
  { key: 'manual', label: '手动触发', desc: '仅手动发布', Icon: Play },
];

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function PublishSkeleton(): React.ReactElement {
  return (
    <div className="px-6 py-8 max-w-[860px] mx-auto space-y-5">
      {/* 骨架 3+1 卡（对齐原型 ProjectPublish.jsx:32-48：三张步骤卡 + 底部操作条占位） */}
      {[1, 2, 3].map((n) => (
        <div key={n} className="animate-fade-up card p-5 space-y-4" style={{ animationDelay: `${n * 80}ms` }}>
          <div className="flex items-center gap-3">
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="skeleton h-5 w-40" />
          </div>
          <div className="skeleton h-10 w-full rounded-md" />
          <div className="skeleton h-20 w-full rounded-md" />
        </div>
      ))}
      <div className="animate-fade-up skeleton h-28 w-full rounded-lg" style={{ animationDelay: '360ms' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 向导通用小组件
// ---------------------------------------------------------------------------

function StepNumber({ n }: { n: number }): React.ReactElement {
  return (
    <div className="w-8 h-8 rounded-full bg-primary-500 text-white flex items-center justify-center shrink-0">
      <span className="text-sm font-bold">{n}</span>
    </div>
  );
}

function ScheduleCard({ option, selected, onSelect }: {
  option: { key: ScheduleKey; label: string; desc: string; Icon: LucideIcon };
  selected: boolean;
  onSelect: (key: ScheduleKey) => void;
}): React.ReactElement {
  const { Icon } = option;
  return (
    <button
      type="button"
      onClick={() => onSelect(option.key)}
      className={`text-left rounded-lg border p-3 flex items-start gap-2.5 transition ${
        selected
          ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-300'
          : 'border-neutral-200 bg-white hover:border-neutral-300'
      }`}
    >
      <span
        className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
          selected ? 'border-primary-500' : 'border-neutral-300'
        }`}
      >
        {selected && <span className="w-2 h-2 rounded-full bg-primary-500" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-800">
          <Icon size={12} className={selected ? 'text-primary-600' : 'text-neutral-400'} />
          {option.label}
        </span>
        <span className="block text-[11px] text-neutral-500 mt-0.5">{option.desc}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// PublishWizard — 三步发布向导（对齐原型 ProjectPublish）
// Step1 版本/文档/内容范围  Step2 主题预览+自动同步  Step3 地址+调度+发布
// ---------------------------------------------------------------------------

function PublishWizard({ projectId, initialTemplateId, onClose }: {
  projectId: string;
  initialTemplateId?: string | null;
  onClose: () => void;
}): React.ReactElement {
  const queryClient = useQueryClient();

  // ---- Step1 状态 ----
  const [versionScope, setVersionScope] = useState<'current' | 'published'>('current');
  const [contentScope, setContentScope] = useState<'single' | 'whole'>('whole');
  const [selectedDocId, setSelectedDocId] = useState('');
  const [autoSync, setAutoSync] = useState(true);

  // ---- Step2 状态：发布模板（Themes「在发布中使用」带参进入时预选；PLAN 3.5/5.2.1） ----
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId ?? null);

  // ---- Step3 状态 ----
  const [addressMode, setAddressMode] = useState<AddressMode>('subpath');
  const [slugInput, setSlugInput] = useState('');
  const [schedule, setSchedule] = useState<ScheduleKey>('git-push');
  const [copyLabel, setCopyLabel] = useState('复制');
  const [publishedSite, setPublishedSite] = useState<PublishSite | null>(null);
  const [publishedAt, setPublishedAt] = useState<Date | null>(null);

  // ---- 真实数据：项目概览（默认 slug 来源）+ 文档列表（Step1 选择） ----
  const { data: overview } = useQuery<{ id: string; name: string }>({
    queryKey: ['project-overview', projectId],
    queryFn: () => apiFetch<{ id: string; name: string }>(
      `/api/v1/projects/${projectId}/overview`,
    ),
    enabled: !!projectId,
  });

  const { data: docsData } = useQuery<{ items: WizardDoc[] }>({
    queryKey: ['project-documents', projectId],
    queryFn: () => apiFetch<{ items: WizardDoc[] }>(`/api/v1/projects/${projectId}/documents`),
    enabled: !!projectId,
  });
  const documents = useMemo(() => docsData?.items ?? [], [docsData?.items]);

  // 发布模板列表（服务端权威源）
  const { data: templatesData } = useQuery<{ items: PublishTemplateMeta[] }>({
    queryKey: ['publish-templates'],
    queryFn: () => apiFetch<{ items: PublishTemplateMeta[] }>('/api/v1/publish-templates'),
  });
  const templates = useMemo(() => templatesData?.items ?? [], [templatesData]);

  // 默认 slug：项目名派生（仅在用户未输入时填充）
  useEffect(() => {
    if (overview?.name && slugInput === '') {
      setSlugInput(toSlug(overview.name));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview?.name]);

  // 默认文档：标题为「首页」优先，否则第一篇
  useEffect(() => {
    if (selectedDocId === '' && documents.length > 0) {
      const home = documents.find((d) => d.title === '首页');
      setSelectedDocId(home?.id ?? documents[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents]);

  // ---- 创建站点（成功后顺带触发一次构建任务） ----
  const createSiteMutation = useMutation({
    mutationFn: async (): Promise<PublishSite> => {
      const site = await apiFetch<PublishSite>(`/api/v1/projects/${projectId}/publish-sites`, {
        method: 'POST',
        body: JSON.stringify({
          slug: slugInput.trim() || undefined,
          addressMode,
          schedule,
          autoSync,
          templateId: templateId ?? undefined,
        }),
      });
      // 触发首次构建；失败不阻塞（站点已创建，可在列表中手动发布）
      try {
        await apiFetch<{ ok: boolean }>(`/api/v1/publish-sites/${site.id}/jobs`, { method: 'POST' });
      } catch {
        // 构建触发失败时忽略，站点列表仍可手动发布
      }
      return site;
    },
    onSuccess: (site) => {
      setPublishedSite(site);
      setPublishedAt(new Date());
      void queryClient.invalidateQueries({ queryKey: ['project-publish-sites', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['publish-site-jobs', site.id] });
    },
  });

  const slugValid = validateSlug(slugInput.trim());
  const previewUrl = slugValid ? siteUrlOf(slugInput.trim(), addressMode) : '';
  const publishedUrl = publishedSite
    ? publishedSite.customDomain ??
      siteUrlOf(publishedSite.slug ?? '', (publishedSite.addressMode as AddressMode | null) ?? 'subpath')
    : '';
  const selectedDoc = documents.find((d) => d.id === selectedDocId);
  const publishing = createSiteMutation.isPending;
  const publishDisabled =
    publishing || publishedSite !== null || !slugValid || (contentScope === 'single' && !selectedDoc);

  const handleCopy = () => {
    if (!previewUrl) return;
    void navigator.clipboard.writeText(previewUrl).then(() => {
      setCopyLabel('已复制');
      window.setTimeout(() => setCopyLabel('复制'), 1500);
    });
  };

  const handlePublish = () => {
    if (publishDisabled) return;
    createSiteMutation.mutate();
  };

  const scopeText = contentScope === 'whole' ? `整个知识库（${documents.length} 篇）` : '单文档';

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-page)' }}>
      {/* ===== 可滚动内容区 ===== */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-[880px] mx-auto px-6 pt-5 pb-16">
          {/* ========= Step 1：选择发布内容 ========= */}
          <section className="animate-fade-up card p-5 mb-4" style={{ animationDelay: '80ms' }}>
            <div className="flex items-center gap-3 mb-4">
              <StepNumber n={1} />
              <h2 className="text-base font-semibold text-neutral-900">选择发布内容</h2>
              {/* 版本范围 pill */}
              <div className="ml-auto inline-flex items-center p-0.5 bg-neutral-100 rounded-full">
                {(['current', 'published'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVersionScope(v)}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition ${
                      versionScope === v ? 'bg-white text-primary-700 shadow-sm' : 'text-neutral-500'
                    }`}
                  >
                    {v === 'current' ? '当前草稿' : '已发布版本'}
                  </button>
                ))}
              </div>
            </div>

            {/* 文档选择 */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">发布文档</label>
              <div className="relative">
                <select
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  disabled={contentScope === 'whole'}
                  className="input appearance-none pr-8 w-full disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {documents.length === 0 && <option value="">暂无文档</option>}
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title ?? d.path}{d.title === '首页' ? '（默认首页）' : ''}
                    </option>
                  ))}
                </select>
                <ChevronRight className="w-4 h-4 text-neutral-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90" />
              </div>
              {contentScope === 'whole' && (
                <p className="mt-1 text-[11px] text-neutral-400">内容范围为整个知识库时，将发布全部 {documents.length} 篇文档</p>
              )}
            </div>

            {/* 内容范围 pills */}
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">内容范围</label>
              <div className="inline-flex items-center p-1 bg-neutral-100 rounded-full">
                <button
                  type="button"
                  onClick={() => setContentScope('single')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                    contentScope === 'single'
                      ? 'bg-white text-primary-700 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  <FileText size={12} />
                  单文档
                </button>
                <button
                  type="button"
                  onClick={() => setContentScope('whole')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                    contentScope === 'whole'
                      ? 'bg-white text-primary-700 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  <Globe size={12} />
                  整个知识库
                </button>
              </div>
            </div>
          </section>

          {/* ========= Step 2：主题与预览 ========= */}
          <section className="animate-fade-up card p-5 mb-4" style={{ animationDelay: '160ms' }}>
            <div className="flex items-center gap-3 mb-4">
              <StepNumber n={2} />
              <h2 className="text-base font-semibold text-neutral-900">选择主题与预览</h2>
              <span className="ml-auto tag-neutral !py-0.5 !text-[11px]">
                <LayoutTemplate size={11} />
                {templates.find((t) => t.id === templateId)?.zhLabel ?? '默认主题'}
              </span>
            </div>

            {/* 模板网格（GET /api/v1/publish-templates 服务端权威源；PLAN 3.5/5.2.1 接线） */}
            {templates.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-4 flex flex-col items-center justify-center text-center opacity-70 animate-pulse"
                  >
                    <LayoutTemplate size={18} className="text-neutral-300 mb-2" />
                    <div className="text-xs font-medium text-neutral-400">模板加载中…</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
                {templates.map((tpl, i) => {
                  const selected = templateId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setTemplateId(selected ? null : tpl.id)}
                      className={`animate-fade-up rounded-lg border p-3.5 text-left transition ${selected ? 'ring-1' : 'hover:border-neutral-300'}`}
                      style={{
                        animationDelay: `${i * 50}ms`,
                        borderColor: selected ? tpl.accent : 'var(--border-soft)',
                        background: selected ? `${tpl.accent}0d` : 'var(--bg-surface)',
                        // ring 色随模板 accent（模板数据驱动色，非 UI 主题色）
                        ...(selected ? { boxShadow: `0 0 0 1px ${tpl.accent}` } : {}),
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm"
                          style={{ background: `${tpl.accent}1f` }}
                        >
                          {tpl.emoji}
                        </span>
                        <span className="text-sm font-semibold truncate text-neutral-900">{tpl.zhLabel}</span>
                        {selected && <CheckCircle2 size={14} className="ml-auto shrink-0" style={{ color: tpl.accent }} />}
                      </div>
                      <p className="line-clamp-2 text-[11px] leading-relaxed text-neutral-500">{tpl.desc}</p>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 实时预览：TODO 后端尚无渲染预览接口，接口就绪前展示占位 */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-neutral-700 flex items-center gap-1.5">
                  <Globe size={12} className="text-primary-500" />
                  实时预览
                </label>
              </div>
              <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                <div className="flex items-center gap-1.5 px-3 py-2 border-b border-neutral-100 bg-neutral-50">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span className="ml-2 text-[10px] text-neutral-400 font-mono">
                    {previewUrl || 'preview.ewiki.local'}
                  </span>
                </div>
                <div className="h-[120px] flex items-center justify-center text-center px-4">
                  <span className="text-[11px] text-neutral-400 inline-flex items-center gap-1.5">
                    <RefreshCw size={12} />
                    渲染预览接口尚未提供，发布后可访问站点查看效果
                  </span>
                </div>
              </div>
            </div>

            {/* 自动同步开关（真实字段 autoSync） */}
            <div className="pt-3 border-t border-neutral-100 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-neutral-700">自动同步</div>
                <div className="text-[11px] text-neutral-500">每次 Git push 自动重新发布</div>
              </div>
              <button
                type="button"
                onClick={() => setAutoSync((v) => !v)}
                className={`relative w-10 h-[22px] rounded-full transition-colors ${
                  autoSync ? 'bg-primary-500' : 'bg-neutral-300'
                }`}
                aria-pressed={autoSync}
                aria-label="自动同步开关"
              >
                <span
                  className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${
                    autoSync ? 'translate-x-[20px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </section>

          {/* ========= Step 3：发布配置 ========= */}
          <section className="animate-fade-up card p-5 mb-4" style={{ animationDelay: '240ms' }}>
            <div className="flex items-center gap-3 mb-4">
              <StepNumber n={3} />
              <h2 className="text-base font-semibold text-neutral-900">发布配置</h2>
            </div>

            {/* 地址模式 */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">地址模式</label>
              <div className="inline-flex items-center p-1 bg-neutral-100 rounded-full">
                {(['subdomain', 'subpath'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAddressMode(m)}
                    className={`text-[11px] font-medium px-3 py-1.5 rounded-full transition ${
                      addressMode === m ? 'bg-white text-primary-700 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                    }`}
                  >
                    {m === 'subdomain' ? '子域名（域名绑定，后续开放）' : '子路径（平台子路径，本期支持）'}
                  </button>
                ))}
              </div>
            </div>

            {/* 访问地址 */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                访问地址
                {slugInput.trim() !== '' && !slugValid && (
                  <span className="ml-1 text-red-500 inline-flex items-center gap-1">
                    <AlertTriangle size={11} /> 仅支持小写字母、数字和连字符
                  </span>
                )}
              </label>
              <div className="flex items-stretch rounded-md overflow-hidden border border-neutral-200 focus-within:ring-2 focus-within:ring-primary-200 focus-within:border-primary-400">
                <span className="inline-flex items-center px-3 bg-neutral-50 border-r border-neutral-200 text-xs text-neutral-500 font-mono shrink-0">
                  {addressMode === 'subdomain' ? 'https://' : `${window.location.origin}/sites/`}
                </span>
                <input
                  type="text"
                  value={slugInput}
                  onChange={(e) => setSlugInput(e.target.value)}
                  placeholder="your-project-slug"
                  className="flex-1 px-3 py-2 text-sm text-neutral-800 font-mono bg-white placeholder:text-neutral-400 focus:outline-none min-w-0"
                />
                {addressMode === 'subdomain' && (
                  <span className="inline-flex items-center px-3 bg-neutral-50 border-l border-neutral-200 text-xs text-neutral-500 font-mono shrink-0">
                    .ewiki.local
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!previewUrl}
                  className="inline-flex items-center gap-1 px-3 text-xs text-neutral-500 hover:text-primary-600 bg-white border-l border-neutral-200 disabled:opacity-40 transition-colors shrink-0"
                  title="复制完整地址"
                >
                  {copyLabel === '已复制' ? <Check size={12} /> : <Copy size={12} />}
                  {copyLabel}
                </button>
              </div>
              {previewUrl && (
                <div className="mt-1.5 text-[11px] text-neutral-500 font-mono">
                  预览地址：<span className="text-primary-600">https://{previewUrl}</span>
                </div>
              )}
            </div>

            {/* 自动发布计划 */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-neutral-700 mb-2">自动发布计划</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {SCHEDULE_OPTIONS.map((opt) => (
                  <ScheduleCard
                    key={opt.key}
                    option={opt}
                    selected={schedule === opt.key}
                    onSelect={setSchedule}
                  />
                ))}
              </div>
            </div>

            {/* 发布按钮 / 成功条 */}
            {!publishedSite ? (
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishDisabled}
                className="w-full btn-primary justify-center !h-11 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {publishing ? (
                  <>
                    <RefreshCw size={15} className="animate-spin" />
                    发布中…
                  </>
                ) : (
                  <>
                    <Rocket size={15} />
                    立即发布
                  </>
                )}
              </button>
            ) : (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 animate-fade-up">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                    <CheckCircle2 size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-emerald-700">发布成功！</div>
                    <div className="text-xs text-emerald-600 mt-0.5">
                      发布时间：{publishedAt ? formatDateTime(publishedAt) : '—'}
                    </div>
                    <a
                      href={`https://${publishedUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 mt-1 underline underline-offset-2 font-mono"
                    >
                      {publishedUrl}
                      <ExternalLink size={11} />
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPublishedSite(null)}
                    className="text-emerald-500 hover:text-emerald-700"
                    aria-label="关闭"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            )}

            {createSiteMutation.isError && !publishedSite && (
              <div className="mt-3 text-xs text-red-500 inline-flex items-center gap-1.5">
                <AlertTriangle size={12} />
                发布失败：{(createSiteMutation.error as Error).message}
              </div>
            )}
          </section>

          {/* ========= 发布概览 ========= */}
          <section
            className={`animate-fade-up rounded-lg border p-4 ${
              publishedSite ? 'bg-primary-50 border-primary-200' : 'bg-neutral-50 border-neutral-200'
            }`}
            style={{ animationDelay: '320ms' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Settings size={14} className="text-primary-600" />
              <span className="text-sm font-semibold text-neutral-800">发布概览</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-[11px] text-neutral-500">项目</div>
                <div className="mt-0.5 font-medium text-neutral-800 truncate">{overview?.name || '—'}</div>
              </div>
              <div>
                <div className="text-[11px] text-neutral-500">主题</div>
                <div className="mt-0.5 font-medium text-neutral-800 truncate">默认主题</div>
              </div>
              <div>
                <div className="text-[11px] text-neutral-500">内容范围</div>
                <div className="mt-0.5 font-medium text-neutral-800 truncate">
                  {contentScope === 'whole' ? scopeText : (selectedDoc?.title ?? '单文档')}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-neutral-500">下次发布</div>
                <div className="mt-0.5 font-medium text-neutral-800">
                  {schedule === 'git-push' && 'Git push 时'}
                  {schedule === 'daily' && '每天 03:00'}
                  {schedule === 'manual' && '手动触发'}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* ===== 底部固定操作栏（不随内容滚动） ===== */}
      <footer className="shrink-0 border-t border-neutral-200 bg-white px-6 py-3 flex items-center justify-between gap-3">
        <div className="text-xs text-neutral-500 truncate">
          {versionScope === 'current' ? '当前草稿' : '已发布版本'} · {scopeText} · 主题：默认主题
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={publishing}
            className="btn-secondary !h-11 !px-5 text-xs disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishDisabled}
            className="btn-primary !h-11 !px-5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishing ? (
              <>
                <RefreshCw size={13} className="animate-spin" />
                发布中…
              </>
            ) : (
              <>
                <Rocket size={13} />
                立即发布
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SiteCard — 单个 publish site 卡片（可展开查看 jobs）
// ---------------------------------------------------------------------------

function SiteCard({ site, expanded, canManage, onToggle }: {
  site: PublishSite;
  expanded: boolean;
  /** 触发发布为管理操作（后端 403 兜底）；只读用户仅查看状态与构建记录 */
  canManage: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const { data: jobsData, isLoading: jobsLoading } = useQuery<{ items: PublishJob[] }>({
    queryKey: ['publish-site-jobs', site.id],
    queryFn: () => apiFetch<{ items: PublishJob[] }>(`/api/v1/publish-sites/${site.id}/jobs`),
    enabled: expanded,
  });

  const queryClient = useQueryClient();
  const publishJobMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; siteId: string; queued: boolean }>(
        `/api/v1/publish-sites/${site.id}/jobs`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['publish-site-jobs', site.id] });
      void queryClient.invalidateQueries({ queryKey: ['project-publish-sites', site.projectId] });
    },
  });

  const jobs = useMemo(
    () => (jobsData?.items ?? []).slice(0, 10),
    [jobsData?.items],
  );

  // 后端行无 name/url/status 列 → 前端派生展示值
  const siteName = site.slug ?? `site-${site.id.slice(0, 6)}`;
  const siteUrl = site.customDomain ?? `${siteName}.ewiki.local`;
  const statusMeta = STATUS_META[site.currentVersion ? 'active' : 'pending'];
  const lastPublishedAt =
    jobs.find((j) => j.status === 'published')?.finishedAt ?? null;
  const latestJob = jobs[0];

  return (
    <div className="card animate-fade-up" style={{ animationDelay: '60ms' }}>
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-5"
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
            <Globe size={18} className="text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-neutral-900 truncate">{siteName}</h3>
              <span className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 ${statusMeta.text}`}
                style={{ background: 'var(--bg-page)' }}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                {statusMeta.label}
              </span>
              {site.currentVersion != null && (
                <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500 rounded-full px-2 py-0.5"
                  style={{ background: 'var(--bg-page)' }}>
                  v{site.currentVersion}
                </span>
              )}
            </div>

            <div className="mt-2 flex items-center gap-4 text-xs text-neutral-500 flex-wrap">
              <a
                href={`https://${siteUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary-600 hover:underline font-mono"
                onClick={(e) => e.stopPropagation()}
              >
                {siteUrl}
                <ExternalLink size={11} />
              </a>
              <span className="inline-flex items-center gap-1">
                调度：{SCHEDULE_LABEL[site.schedule] ?? site.schedule}
              </span>
              <span className="inline-flex items-center gap-1">
                上次发布：{relativeTime(lastPublishedAt)}
              </span>
            </div>
          </div>
          <ChevronRight
            size={18}
            className={`text-neutral-400 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </div>
      </button>

      {/* Actions: 立即发布（管理操作） */}
      <div
        className="border-t px-5 py-2.5 flex items-center gap-3"
        style={{ borderColor: 'var(--border-soft)' }}
      >
        {canManage ? (
          <>
            <button
              type="button"
              onClick={() => publishJobMutation.mutate()}
              disabled={publishJobMutation.isPending}
              className="btn-primary !h-11 !px-4 !text-xs disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <Rocket size={12} />
              {publishJobMutation.isPending ? '发布中…' : '立即发布'}
            </button>
            {publishJobMutation.isError && (
              <span className="text-xs text-red-500 truncate">
                发布触发失败：{(publishJobMutation.error as Error).message}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-neutral-400">仅项目所有者/维护者可触发发布</span>
        )}
      </div>

      {/* Expanded: Jobs timeline */}
      {expanded && (
        <div className="border-t px-5 py-4" style={{ borderColor: 'var(--border-soft)' }}>
          <div className="flex items-center gap-2 mb-3">
            <ChevronDown size={13} className="text-neutral-400" />
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
              最近发布记录
            </span>
            {jobs.length > 0 && (
              <span className="ml-auto text-[11px] text-neutral-400">
                共 {jobs.length} 条
              </span>
            )}
          </div>

          {jobsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton h-8 w-full rounded-md" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center text-xs text-neutral-400 py-4">
              暂无发布记录
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => {
                const meta = JOB_STATUS_META[job.status] ?? JOB_STATUS_META.queued;
                const durationMs =
                  job.finishedAt && job.createdAt
                    ? new Date(job.finishedAt).getTime() - new Date(job.createdAt).getTime()
                    : null;
                return (
                  <div
                    key={job.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-md"
                    style={{ background: 'var(--bg-page)' }}
                  >
                    <div className="shrink-0">
                      {job.status === 'building' ? (
                        <RefreshCw size={13} className="text-blue-500 animate-spin" />
                      ) : job.status === 'published' ? (
                        <CheckCircle2 size={13} className="text-emerald-500" />
                      ) : job.status === 'failed' ? (
                        <XCircle size={13} className="text-red-500" />
                      ) : (
                        <div className="w-[13px] h-[13px] rounded-full border-2 border-neutral-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                        <span className="text-neutral-300">·</span>
                        <span className="text-neutral-500">版本 v{job.versionNo}</span>
                        {job.commitHash && (
                          <>
                            <span className="text-neutral-300">·</span>
                            <code className="font-mono text-[10px] text-neutral-500">
                              {job.commitHash.slice(0, 7)}
                            </code>
                          </>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-400">
                        <span>{relativeTime(job.finishedAt ?? job.createdAt)}</span>
                        <span className="text-neutral-300">·</span>
                        <span>耗时 {formatDuration(durationMs)}</span>
                        {job.error && (
                          <>
                            <span className="text-neutral-300">·</span>
                            <span className="text-red-500 truncate">{job.error}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Latest job summary */}
          {latestJob && (
            <div className="mt-3 pt-3 border-t flex items-center gap-2 text-[11px] text-neutral-500"
              style={{ borderColor: 'var(--border-soft)' }}>
              <RefreshCw size={11} />
              最近一次：{JOB_STATUS_META[latestJob.status]?.label ?? latestJob.status} · {relativeTime(latestJob.finishedAt ?? latestJob.createdAt)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function PublishPage(): React.ReactElement {
  const { id: projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const templateParam = searchParams.get('template');
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);
  // 发布配置/触发为管理操作（后端 canManage 403 兜底），只读用户与编辑者仅可查看站点状态
  const { canManage } = useProjectRole(projectId);
  // Themes「在发布中使用」带 ?template= 进入时自动打开向导并预选模板（PLAN 3.5/5.2.1）；
  // 无管理权限时不自动弹向导
  const [wizardOpen, setWizardOpen] = useState(() => !!templateParam && canManage);

  const { data: sitesData, isLoading, error, refetch } = useQuery<{ items: PublishSite[] }>({
    queryKey: ['project-publish-sites', projectId],
    queryFn: () => apiFetch<{ items: PublishSite[] }>(`/api/v1/projects/${projectId}/publish-sites`),
    enabled: !!projectId,
  });

  const sites = useMemo(() => sitesData?.items ?? [], [sitesData]);

  // ---- Loading ----
  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto scrollbar-thin" style={{ background: 'var(--bg-page)' }}>
        <PublishSkeleton />
      </div>
    );
  }

  // ---- Error ----
  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-6" style={{ background: 'var(--bg-page)' }}>
        <div className="text-center max-w-md">
          <XCircle size={40} className="mx-auto mb-3 text-red-400" />
          <div className="text-sm font-semibold text-neutral-700">发布站点加载失败</div>
          <div className="text-xs text-neutral-500 mt-1">
            {(error as Error).message}
          </div>
          <button type="button" onClick={() => void refetch()}
            className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-neutral-200 hover:bg-neutral-50 transition">
            <RefreshCw size={13} /> 重试
          </button>
        </div>
      </div>
    );
  }

  // ---- 三步向导（空态首次创建 / 列表态「新建发布站点」共用） ----
  if (wizardOpen && projectId) {
    return (
      <PublishWizard
        projectId={projectId}
        initialTemplateId={templateParam}
        onClose={() => {
          setWizardOpen(false);
          // 清掉 ?template= 参数，避免下次手动打开向导仍带旧预选
          if (templateParam !== null) setSearchParams({}, { replace: true });
        }}
      />
    );
  }

  // ---- Empty ----
  if (sites.length === 0) {
    return (
      <div className="h-full overflow-y-auto scrollbar-thin" style={{ background: 'var(--bg-page)' }}>
        <div className="max-w-[600px] mx-auto px-6 py-16 animate-fade-up">
          <div className="rounded-lg border p-10 text-center"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
            <div className="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center"
              style={{ background: 'var(--bg-page)' }}>
              <Rocket size={24} className="text-primary-500" />
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 mb-2">还没有发布站点</h2>
            <p className="text-sm text-neutral-500 mb-6">
              发布站点可以把项目内的文档生成可公开访问的网站。<br />
              通过三步向导配置内容、主题与地址，即可一键发布。
            </p>
            {canManage && (
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="btn-primary !h-9 !px-4"
              >
                <Plus size={15} /> 创建发布站点
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- Main：站点列表 ----
  const activeSite = sites[0];
  const activeSiteName = activeSite ? (activeSite.slug ?? `site-${activeSite.id.slice(0, 6)}`) : '';
  const activeSiteUrl = activeSite ? (activeSite.customDomain ?? `${activeSiteName}.ewiki.local`) : '';

  return (
    <div className="h-full overflow-y-auto scrollbar-thin" style={{ background: 'var(--bg-page)' }}>
      <div className="max-w-[860px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-neutral-900">发布站点</h1>
              <p className="text-xs text-neutral-500 mt-1">
                管理此项目关联的已发布站点及其构建状态
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => void refetch()}
                className="btn-secondary !h-8 !text-xs"
                title="刷新">
                <RefreshCw size={13} /> 刷新
              </button>
              {/* 后端约束每个项目仅一个站点；重复创建将返回 409 SITE_EXISTS；创建为管理操作 */}
              {canManage && (
                <button
                  type="button"
                  onClick={() => setWizardOpen(true)}
                  className="btn-primary !h-8 !text-xs"
                  title="一个项目仅允许一个发布站点"
                >
                  <Plus size={13} /> 新建发布站点
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Overview card */}
        {activeSite && (
          <div className="rounded-lg p-4 mb-5 animate-fade-up"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)', borderWidth: 1, borderStyle: 'solid' }}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <CheckCircle2 size={18} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-neutral-900">
                  {activeSiteName}
                </div>
                <a
                  href={`https://${activeSiteUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline font-mono mt-0.5"
                >
                  {activeSiteUrl}
                  <ExternalLink size={11} />
                </a>
                <div className="text-[11px] text-neutral-500 mt-1">
                  {SCHEDULE_LABEL[activeSite.schedule] ?? activeSite.schedule}
                  {activeSite.autoSync ? ' · 自动同步已开启' : ''}
                  {activeSite.currentVersion != null ? ` · 当前版本 v${activeSite.currentVersion}` : ' · 尚未发布'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sites list */}
        <div className="space-y-3">
          {sites.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              expanded={expandedSiteId === site.id}
              canManage={canManage}
              onToggle={() =>
                setExpandedSiteId((prev) => (prev === site.id ? null : site.id))
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
