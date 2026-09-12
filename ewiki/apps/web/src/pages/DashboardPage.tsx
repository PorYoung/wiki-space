import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, FolderOpen, FileText, Users, TrendingUp, Clock, ChevronRight,
  Plus, BookOpen, RefreshCw, AlertCircle, GitBranch,
} from 'lucide-react';
import { apiFetch, fetchAllDocuments } from '../lib/api/client';
import type { Activity, Document, Project, User } from '@ewiki/shared';

// 迁移自 prototype Dashboard.jsx（TS 化 + 真实 API：F01–F05）

function relativeTime(iso: string | null): string {
  if (!iso) return '刚刚';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

const VERB_TEXT: Record<string, string> = {
  comment: '评论了', sync: '同步了', publish: '发布了',
  edit: '编辑了', delete: '删除了', create: '创建了',
};

// 头像底色统一走 primary token（原型为多色 hex 调色板，属视觉装饰，迁移收敛为设计令牌）
const AVATAR_CLS = 'bg-primary-500 text-white';

function StatCard({ label, value, icon, iconBg, pill, dot }: {
  label: string; value: number; icon: React.ReactNode; iconBg: string; pill: string; dot: string;
}): React.ReactElement {
  return (
    <div className="card p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-2 text-xs font-medium" style={{ color: 'var(--text-muted, #64748b)' }}>{label}</div>
          <div className="font-display text-2xl font-bold tabular-nums">{value}</div>
        </div>
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${iconBg}`}>{icon}</div>
      </div>
      {/* 统计卡徽标统一为「中性安静底 + 卡片强调色圆点」：原先四种 tag 彩底（primary/success/neutral/warning）
          在暗色下渲染成四个互不相关的实色块，并列看像错乱的筛选按钮；收敛为 tag-neutral 统一底，
          用小圆点保留各卡与图标一致的色彩语义（对齐 BrowsePage/MembersPage 的 dot 惯例） */}
      <div className="tag tag-neutral mt-4">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        {pill}
      </div>
    </div>
  );
}

function SectionHeading({ title, icon, to }: { title: string; icon: React.ReactNode; to?: string }): React.ReactElement {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 font-semibold">
        <span className="text-primary-600">{icon}</span>
        {title}
      </h2>
      {to && (
        <Link to={to} className="inline-flex items-center gap-1 text-xs text-primary-600">
          查看全部 <ChevronRight size={14} />
        </Link>
      )}
    </div>
  );
}

// ---- 骨架屏（对齐原型 Dashboard.jsx:68-106，加载期间避免渲染空数字） ----
function SkeletonStat(): React.ReactElement {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="skeleton mb-3 h-4 w-16" />
          <div className="skeleton h-7 w-20" />
        </div>
        <div className="skeleton h-9 w-9 rounded-lg" />
      </div>
      <div className="skeleton mt-4 h-5 w-14" />
    </div>
  );
}

function ProjectRowSkeleton(): React.ReactElement {
  return (
    <div className="card-hover flex items-center gap-4 p-4">
      <div className="skeleton h-11 w-11 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-3 w-2/3" />
      </div>
      <div className="skeleton h-5 w-16" />
    </div>
  );
}

function ActivityItemSkeleton(): React.ReactElement {
  return (
    <div className="flex items-start gap-3">
      <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3 w-3/4" />
        <div className="skeleton h-3 w-24" />
      </div>
    </div>
  );
}
// 新建文档库统一入口（平台化需求 5/7）：跳转 /projects/new 完整向导 —— 模板或空库 × 云文档/Git 仓库；
// Git 需选择「存储配置」连接 + 仓库名称，支持仓库不存在时自动初始化。原页内简版弹窗（直填仓库地址模式）已下线。

export function DashboardPage(): React.ReactElement {
  const navigate = useNavigate();

  const { data: projData, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<{ items: Project[] }>('/api/v1/projects'),
  });
  const { data: docData, isLoading: docsLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => fetchAllDocuments<Document>(),
  });
  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ['team'],
    queryFn: () => apiFetch<{ items: User[] }>('/api/v1/team'),
  });
  const { data: actData, isLoading: activitiesLoading } = useQuery({
    queryKey: ['activities'],
    queryFn: () => apiFetch<{ items: Activity[] }>('/api/v1/activities'),
  });
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<User>('/api/v1/me') });

  const projects = projData?.items ?? [];
  const documents = docData ?? [];
  const activities = actData?.items ?? [];
  const team = teamData?.items ?? [];

  const sortedProjects = [...projects].sort(
    (a, b) => new Date(b.updatedAt ?? Date.now()).getTime() - new Date(a.updatedAt ?? Date.now()).getTime(),
  );
  const topProjects = sortedProjects.slice(0, 3);

  const todayStartMs = new Date().setHours(0, 0, 0, 0);
  const todayCount = activities.filter((a) => new Date(a.createdAt).getTime() >= todayStartMs).length;

  const docCountOf = (projectId: string): number => documents.filter((d) => d.projectId === projectId).length;

  // 需要关注（F04 规则，阈值以原型为准）
  const conflictDocs = documents.filter((d) => d.status === 'conflict');
  const outdatedProjects = projects.filter(
    (p) => (Date.now() - new Date(p.updatedAt ?? Date.now()).getTime()) / 86_400_000 > 2,
  );
  const modifiedDocs = documents.filter((d) => d.status === 'modified');

  const alerts: Array<{ icon: typeof AlertCircle; title: string; desc: string; cta: string; target: string; tone: 'danger' | 'warning' | 'primary'; count: number | null }> = [];
  if (conflictDocs.length > 0) {
    alerts.push({
      icon: AlertCircle, title: `${conflictDocs.length} 个文档存在 Git 冲突`,
      desc: '点击进入项目处理冲突合并', cta: '立即处理',
      target: `/projects/${conflictDocs[0]!.projectId}/browse`, tone: 'danger', count: conflictDocs.length,
    });
  }
  for (const p of outdatedProjects.slice(0, 3)) {
    const days = Math.floor((Date.now() - new Date(p.updatedAt ?? Date.now()).getTime()) / 86_400_000);
    alerts.push({
      icon: RefreshCw, title: `${p.name} 更新过期 ${days} 天`,
      desc: '建议手动触发一次同步以保持最新', cta: '查看项目',
      target: `/projects/${p.id}/publish`, tone: 'warning', count: null,
    });
  }
  if (modifiedDocs.length > 0 && modifiedDocs.length <= 5) {
    alerts.push({
      icon: FileText, title: `${modifiedDocs.length} 个文档有本地修改待提交`,
      desc: '检查改动是否需要提交到 Git', cta: '查看改动', target: '/library', tone: 'primary', count: modifiedDocs.length,
    });
  }

  // 提醒卡彩色体系（对齐原型 :410-426）：卡片底、图标盒底、CTA 文字色分 tone 配置
  const toneMap: Record<'danger' | 'warning' | 'primary', { bg: string; iconBg: string; ctaCls: string }> = {
    danger: {
      bg: 'bg-red-50 border-red-100 hover:border-red-200 hover:bg-red-100/60',
      iconBg: 'bg-red-100 text-red-600',
      ctaCls: 'text-red-600 hover:text-red-700',
    },
    warning: {
      bg: 'bg-amber-50 border-amber-100 hover:border-amber-200 hover:bg-amber-100/60',
      iconBg: 'bg-amber-100 text-amber-600',
      ctaCls: 'text-amber-600 hover:text-amber-700',
    },
    primary: {
      bg: 'bg-primary-50 border-primary-100 hover:border-primary-200 hover:bg-primary-100/60',
      iconBg: 'bg-primary-100 text-primary-600',
      ctaCls: 'text-primary-600 hover:text-primary-700',
    },
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-6">
      <section className="animate-fade-up">
        {/* Hero 渐变（对齐原型 :210；primary-50 在暗色下不翻转，用 color-mix 半透明替代，深色模式自适配） */}
        <div className="card border border-primary-100 p-6"
          style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary-600) 12%, var(--bg-surface)), var(--bg-surface))' }}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-primary-600">
                <LayoutDashboard size={14} /><span>Dashboard</span>
              </div>
              <h1 className="font-display text-2xl font-bold">欢迎回来，{me?.name ?? '用户'}</h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted, #64748b)' }}>
                今天有 <span className="font-semibold text-primary-600">{todayCount}</span> 条动态
                {alerts.length > 0 && <span className="ml-1 text-warning">· {alerts.length} 个关注提醒</span>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="btn-primary" onClick={() => navigate('/projects/new')}>
                <Plus size={16} /> 新建文档库
              </button>
              <Link to="/projects/new" className="btn-secondary"><GitBranch size={16} /> 新建 Git 文档库</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-up">
        {projectsLoading || docsLoading || teamLoading || activitiesLoading ? (
          <>
            <SkeletonStat />
            <SkeletonStat />
            <SkeletonStat />
            <SkeletonStat />
          </>
        ) : (
          <>
            <StatCard label="文档库" value={projects.length} icon={<FolderOpen size={18} />} iconBg="bg-primary-50 text-primary-600" dot="bg-primary-500" pill="全部项目" />
            <StatCard label="文档总数" value={documents.length} icon={<FileText size={18} />} iconBg="bg-emerald-50 text-emerald-600" dot="bg-emerald-500" pill="已纳管" />
            <StatCard label="成员数" value={team.length} icon={<Users size={18} />} iconBg="bg-neutral-100 text-neutral-600" dot="bg-neutral-400" pill="活跃协作" />
            <StatCard label="今日动态" value={todayCount} icon={<TrendingUp size={18} />} iconBg="bg-amber-50 text-amber-600" dot="bg-amber-500" pill="24 小时内" />
          </>
        )}
      </section>

      <section className="flex flex-col gap-6 lg:flex-row animate-fade-up">
        <div className="min-w-0 flex-[2]">
          <SectionHeading title="最近活跃的文档库" icon={<BookOpen size={16} />} to="/library" />
          <div className="space-y-3">
            {projectsLoading ? (
              <>
                <ProjectRowSkeleton />
                <ProjectRowSkeleton />
                <ProjectRowSkeleton />
              </>
            ) : topProjects.length > 0 ? (
              topProjects.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="card-hover flex items-center gap-4 p-4">
                  {/* project.color 存 Tailwind 浅底类名（原型约定，见 PROJECT_COLORS）；历史空值回退 primary-100 */}
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${p.color ?? 'bg-primary-100'}`}>
                    <FolderOpen size={20} className="text-primary-700" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-medium">{p.name}</h3>
                      <span className="tag tag-primary">{p.visibility === 'public' ? '公开' : p.visibility === 'team' ? '团队' : '私有'}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{p.description ?? ''}</p>
                  </div>
                  <div className="hidden flex-col items-end gap-1 text-right sm:flex shrink-0">
                    <span className="text-sm font-semibold">{docCountOf(p.id)} <span className="text-xs font-normal" style={{ color: 'var(--text-muted, #64748b)' }}>文档</span></span>
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted, #94a3b8)' }}>
                      <Clock size={12} /> {relativeTime(p.updatedAt ?? null)}
                    </span>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-neutral-300" />
                </Link>
              ))
            ) : (
              <div className="card p-6 text-center text-sm" style={{ color: 'var(--text-muted, #94a3b8)' }}>
                暂无文档库，点击右上角「新建文档库」开始
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {/* 原型 Dashboard.jsx:352 最近动态标题图标为 GitBranch（与上方 BookOpen 区分语义） */}
          <SectionHeading title="最近动态" icon={<GitBranch size={16} />} />
          <div className="card p-5">
            <ul className="space-y-4">
              {activitiesLoading ? (
                <>
                  <ActivityItemSkeleton />
                  <ActivityItemSkeleton />
                  <ActivityItemSkeleton />
                  <ActivityItemSkeleton />
                  <ActivityItemSkeleton />
                  <ActivityItemSkeleton />
                </>
              ) : activities.length > 0 ? (
                activities.slice(0, 8).map((item, idx) => (
                  <li key={item.id} className="flex items-start gap-3 animate-fade-up"
                    style={{ animationDelay: `${idx * 60}ms` }}>
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${AVATAR_CLS}`}>
                      {(item.actorName ?? '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">
                        <span className="font-medium">{item.actorName ?? '系统'}</span>
                        <span style={{ color: 'var(--text-muted, #64748b)' }}> {VERB_TEXT[item.verb] ?? item.verb} </span>
                        <span className="font-medium text-primary-600">{item.targetTitle ?? ''}</span>
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted, #94a3b8)' }}>{relativeTime(item.createdAt)}</p>
                    </div>
                  </li>
                ))
              ) : (
                <li className="text-sm" style={{ color: 'var(--text-muted, #94a3b8)' }}>暂无动态</li>
              )}
            </ul>
          </div>
        </div>
      </section>

      {alerts.length > 0 && (
        <section className="animate-fade-up">
          <SectionHeading title="需要关注" icon={<AlertCircle size={16} className="text-warning" />} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {alerts.map((alert, idx) => {
              const Icon = alert.icon;
              const tone = toneMap[alert.tone];
              return (
                <button key={idx} type="button" onClick={() => navigate(alert.target)}
                  className={`group animate-fade-up rounded-xl border p-4 text-left transition-all ${tone.bg}`}
                  style={{ animationDelay: `${200 + idx * 60}ms` }}>
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.iconBg}`}><Icon size={18} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-sm font-semibold">{alert.title}</h4>
                        {/* 计数徽章（对齐原型 :446-450）：同类提醒多条时展示数量 */}
                        {alert.count != null && alert.count > 1 && (
                          <span className="shrink-0 rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {alert.count}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-muted, #64748b)' }}>{alert.desc}</p>
                      <div className={`mt-2 inline-flex items-center gap-1 text-xs font-medium transition-all group-hover:gap-1.5 ${tone.ctaCls}`}>
                        {alert.cta} <ChevronRight size={13} />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
