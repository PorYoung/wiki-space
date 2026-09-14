import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Archive, Compass, Crown, Folder, Plus, Search, Shield, UserPlus, Users, X } from 'lucide-react';
import { apiFetch } from '../lib/api/client';
import { useShowToast } from '../components/Toast';

// ---------------------------------------------------------------------------
// 团队列表（TEAM-PERMISSIONS-DESIGN §6.1 F2）
// 数据源 GET /api/v1/teams（我加入的团队）；创建团队入口内联。
// 旧版「全平台用户表」已删除（越权 + 语义错位）：成员管理下沉到团队详情页。
// ---------------------------------------------------------------------------

export interface TeamItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: string;
  archived: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  projectCount: number;
  myRole: string | null;
}

// 团队可见性文案（internal=平台内可发现）；private=仅成员可见
export const TEAM_VISIBILITY_META: Record<string, { label: string; tagClass: string }> = {
  private: { label: '私有', tagClass: 'tag-neutral' },
  internal: { label: '可发现', tagClass: 'tag-primary' },
};

export const TEAM_ROLE_META: Record<string, { label: string; tagClass: string; Icon: typeof Crown }> = {
  owner: { label: 'Owner', tagClass: 'tag-primary', Icon: Crown },
  maintainer: { label: 'Maintainer', tagClass: 'tag-success', Icon: Shield },
  member: { label: 'Member', tagClass: 'tag-neutral', Icon: Users },
};

function CreateTeamModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useShowToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<TeamItem>('/api/v1/teams', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      }),
    onSuccess: (team) => {
      void queryClient.invalidateQueries({ queryKey: ['teams'] });
      showToast(`团队「${team.name}」已创建`);
      onClose();
      navigate(`/teams/${team.id}`);
    },
    onError: () => showToast('创建失败，请重试'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md card p-6 shadow-xl animate-fade-up" style={{ background: 'var(--bg-surface)' }}>
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <UserPlus size={18} />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>创建团队</h2>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>团队用于组织成员与文档库归属（类 GitLab Group）</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost !p-1.5 rounded-md" aria-label="关闭"><X size={16} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>团队名称 *</label>
            <input className="input" value={name} autoFocus placeholder="如：产品团队"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>描述 <span style={{ color: 'var(--text-muted)' }}>(可选)</span></label>
            <textarea rows={2} className="input resize-none" value={description} placeholder="这个团队负责什么…"
              onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>取消</button>
          <button className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? '创建中…' : '创建团队'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamCard({
  t,
  idx,
  mode = 'joined',
  onClick,
}: {
  t: TeamItem;
  idx: number;
  mode?: 'joined' | 'open';
  onClick: () => void;
}): React.ReactElement {
  const roleMeta = t.myRole ? TEAM_ROLE_META[t.myRole] : undefined;
  const RoleIcon = roleMeta?.Icon ?? Users;
  const visMeta = TEAM_VISIBILITY_META[t.visibility] ?? TEAM_VISIBILITY_META.private;
  return (
    <button
      type="button"
      onClick={onClick}
      className="card p-5 text-left transition hover:shadow-md animate-fade-up"
      style={{ animationDelay: `${idx * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <Users size={16} />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold" style={{ color: 'var(--text-primary)' }}>{t.name}</div>
            <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{t.slug}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {t.archived && <span className="tag tag-neutral"><Archive size={10} /> 已归档</span>}
          {mode === 'joined' && roleMeta && (
            <span className={`tag ${roleMeta.tagClass}`}>
              <RoleIcon size={11} /> {roleMeta.label}
            </span>
          )}
          <span className={`tag ${visMeta.tagClass}`}>{visMeta.label}</span>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.5em] text-xs" style={{ color: 'var(--text-muted)' }}>
        {t.description ?? '暂无描述'}
      </p>
      <div className="mt-3 flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span className="inline-flex items-center gap-1"><Users size={12} /> 成员 <b className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{t.memberCount}</b></span>
        <span className="inline-flex items-center gap-1"><Folder size={12} /> 文档库 <b className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{t.projectCount}</b></span>
        {mode === 'open' && !t.myRole && <span className="ml-auto text-[11px] text-primary-600">查看</span>}
      </div>
    </button>
  );
}

export function TeamPage(): React.ReactElement {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'mine' | 'discover'>('mine');

  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: () => apiFetch<{ items: TeamItem[] }>('/api/v1/teams'),
  });

  // 发现目录（B2 §12.3-3）：internal 团队对登录用户可见
  const discoverQuery = useQuery({
    queryKey: ['teams', 'discover', search],
    queryFn: () =>
      apiFetch<{ items: TeamItem[] }>(
        `/api/v1/teams/discover${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`,
      ),
  });

  const teams = useMemo(() => teamsQuery.data?.items ?? [], [teamsQuery.data]);
  const discoverTeams = useMemo(() => discoverQuery.data?.items ?? [], [discoverQuery.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q));
  }, [teams, search]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setCreateOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-6">
      {/* Header */}
      <section className="animate-fade-up">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-primary-600">
              <Users size={14} />
              <span>Teams</span>
            </div>
            <h1 className="font-display text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>团队</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              团队是文档库的归属主体：成员协同、按可见性档位访问，团队管理员可治理团队内全部文档库
            </p>
          </div>
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            创建团队
          </button>
        </div>
      </section>

      {/* Tab 分段：我的团队 / 发现（internal 团队目录） */}
      <section className="animate-fade-up" style={{ animationDelay: '20ms' }}>
        <div className="inline-flex rounded-lg p-1" style={{ background: 'var(--bg-subtle)' }}>
          {([['mine', '我的团队', teams.length], ['discover', '发现', discoverTeams.length]] as const).map(([key, label, n]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-4 text-sm font-medium transition ${
                  active ? 'bg-surface text-primary-600 shadow-sm' : 'text-muted hover:text-neutral-700'
                }`}
                style={active ? { background: 'var(--bg-surface)', color: 'var(--color-primary-600)' } : { color: 'var(--text-muted)' }}
              >
                {label}
                <span className="font-mono text-[10px] opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Search */}
      {(teams.length > 0 || tab === 'discover') && (
        <section className="animate-fade-up" style={{ animationDelay: '40ms' }}>
          <div className="relative w-full sm:w-72">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input type="text" placeholder={tab === 'discover' ? '搜索团队、描述或 slug…' : '搜索团队…'} value={search} onChange={(e) => setSearch(e.target.value)}
              className="input py-1.5 pl-8 text-xs" />
          </div>
        </section>
      )}

      {/* Team grid —— mine: 我的团队 / discover: internal 团队目录 */}
      {tab === 'mine' ? (
        teamsQuery.isLoading ? (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="skeleton h-5 w-32" />
                <div className="skeleton mt-3 h-3 w-48" />
                <div className="skeleton mt-4 h-4 w-40" />
              </div>
            ))}
          </section>
        ) : teams.length === 0 ? (
          <section className="card p-12 text-center animate-fade-up" style={{ animationDelay: '80ms' }}>
            <Users size={36} className="mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>你还没有加入任何团队</div>
            <p className="mx-auto mt-1 max-w-md text-xs" style={{ color: 'var(--text-muted)' }}>
              创建团队后，可以把文档库归属到团队、邀请成员，并按「团队只读 / 团队可写」档位统一授权。
            </p>
            <button className="btn-primary mt-5" onClick={() => setCreateOpen(true)}>
              <Plus size={15} /> 创建第一个团队
            </button>
          </section>
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((t, idx) => (
              <TeamCard key={t.id} t={t} idx={idx} onClick={() => navigate(`/teams/${t.id}`)} />
            ))}
            {/* 创建入口内联（卡片网格尾部） */}
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="grid min-h-[150px] place-items-center rounded-xl border border-dashed text-sm font-medium transition hover:border-primary-300 hover:text-primary-600 animate-fade-up"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}
            >
              <span className="inline-flex items-center gap-1.5"><Plus size={15} /> 创建团队</span>
            </button>
          </section>
        )
      ) : discoverQuery.isLoading ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="skeleton h-5 w-36" />
              <div className="skeleton mt-3 h-3 w-52" />
              <div className="skeleton mt-4 h-4 w-44" />
            </div>
          ))}
        </section>
      ) : discoverTeams.length === 0 ? (
        <section className="card p-12 text-center animate-fade-up" style={{ animationDelay: '80ms' }}>
          <Compass size={34} className="mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
          <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>暂无可发现的团队</div>
          <p className="mx-auto mt-1 max-w-md text-xs" style={{ color: 'var(--text-muted)' }}>
            设置为「可发现」的团队会出现在这里，供平台成员浏览并加入协作。
          </p>
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {discoverTeams.map((t, idx) => (
            <TeamCard
              key={t.id}
              t={t}
              idx={idx}
              mode={t.myRole ? 'joined' : 'open'}
              onClick={() => navigate(`/teams/${t.id}`)}
            />
          ))}
        </section>
      )}

      {/* 搜索无结果 */}
      {tab === 'mine' && teams.length > 0 && filtered.length === 0 && (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>没有匹配的团队</div>
      )}

      {createOpen && <CreateTeamModal onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
