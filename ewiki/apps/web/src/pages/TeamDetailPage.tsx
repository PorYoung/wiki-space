import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, Archive, ArrowLeft, CheckCircle2, Folder, FolderPlus, Mail,
  MoreHorizontal, Plus, Users, X,
} from 'lucide-react';
import { apiFetch } from '../lib/api/client';
import { useShowToast } from '../components/Toast';
import { visibilityMeta } from '../lib/visibility';
import { TEAM_ROLE_META, type TeamItem } from './TeamPage';

// ---------------------------------------------------------------------------
// 团队详情（TEAM-PERMISSIONS-DESIGN §6.1 F3）：成员 / 文档库 / 设置 三 Tab
// 权限自响应推导：myRole（owner/maintainer/member）——管理控件按 §3.6 矩阵收放。
// ---------------------------------------------------------------------------

interface TeamMemberRow {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  status: string;
  joinedAt: string;
  lastActive: string | null;
  online: boolean;
}

interface TeamProjectRow {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  archived: boolean;
  updatedAt: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

function InviteMemberModal({ teamId, onClose }: { teamId: string; onClose: () => void }): React.ReactElement {
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'maintainer' | 'owner'>('member');

  const addMutation = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/api/v1/teams/${teamId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), role }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team-members', teamId] });
      void queryClient.invalidateQueries({ queryKey: ['teams'] });
      showToast('成员已加入团队');
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : '';
      showToast(
        msg.includes('USER_NOT_FOUND')
          ? '该邮箱尚未注册：请让对方先注册账号，或由管理员在系统管理中创建'
          : msg.includes('ALREADY_MEMBER')
            ? '该用户已是团队成员'
            : msg.includes('FORBIDDEN')
              ? '只有 owner 可授予 owner 角色'
              : '添加失败，请重试',
      );
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md card p-6 shadow-xl animate-fade-up" style={{ background: 'var(--bg-surface)' }}>
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <Mail size={18} />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>添加成员</h2>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>仅支持已注册账号（输入邮箱精确匹配）</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost !p-1.5 rounded-md" aria-label="关闭"><X size={16} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>邮箱地址</label>
            <input type="email" className="input" value={email} autoFocus placeholder="name@example.com"
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>角色</label>
            <select className="input appearance-none cursor-pointer" value={role}
              onChange={(e) => setRole(e.target.value as 'member' | 'maintainer' | 'owner')}>
              <option value="member">Member · 按文档库可见性档位访问</option>
              <option value="maintainer">Maintainer · 管理成员与团队库</option>
              <option value="owner">Owner · 管理团队设置（仅 owner 可授予）</option>
            </select>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>取消</button>
          <button className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!email.trim() || addMutation.isPending}
            onClick={() => addMutation.mutate()}>
            {addMutation.isPending ? '添加中…' : '添加成员'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TeamDetailPage(): React.ReactElement {
  const { id: teamId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  const [tab, setTab] = useState<'members' | 'projects' | 'settings'>('members');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // 设置表单
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const teamQuery = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => apiFetch<TeamItem>(`/api/v1/teams/${teamId}`),
    enabled: !!teamId,
  });
  const membersQuery = useQuery({
    queryKey: ['team-members', teamId],
    queryFn: () => apiFetch<{ items: TeamMemberRow[]; total: number; myRole: string | null; archived: boolean }>(
      `/api/v1/teams/${teamId}/members`,
    ),
    enabled: !!teamId,
  });
  const projectsQuery = useQuery({
    queryKey: ['team-projects', teamId],
    queryFn: () => apiFetch<{ items: TeamProjectRow[]; total: number }>(`/api/v1/teams/${teamId}/projects`),
    enabled: !!teamId,
  });

  const team = teamQuery.data;
  const myRole = membersQuery.data?.myRole ?? team?.myRole ?? null;
  const canManageMembers = myRole === 'owner' || myRole === 'maintainer';
  const canManageTeam = myRole === 'owner';

  useEffect(() => {
    if (team) {
      setName(team.name);
      setDescription(team.description ?? '');
    }
  }, [team?.id]);

  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (!(e.target as HTMLElement).closest('[data-member-menu]')) setOpenMenu(null);
    }
    if (openMenu !== null) {
      document.addEventListener('click', onDocClick);
      return () => document.removeEventListener('click', onDocClick);
    }
  }, [openMenu]);

  const changeMember = useMutation({
    mutationFn: (payload: { uid: string; role?: string; remove?: boolean }) =>
      apiFetch<unknown>(`/api/v1/teams/${teamId}/members/${payload.uid}`, {
        method: 'PUT',
        body: JSON.stringify(payload.remove ? { remove: true } : { role: payload.role }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team-members', teamId] });
      void queryClient.invalidateQueries({ queryKey: ['teams'] });
      showToast('成员已更新');
      setOpenMenu(null);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : '';
      showToast(msg.includes('LAST_OWNER') ? '不可移除/降级最后一名 owner' : '操作失败，请检查权限');
      setOpenMenu(null);
    },
  });

  const saveTeam = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/api/v1/teams/${teamId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team', teamId] });
      void queryClient.invalidateQueries({ queryKey: ['teams'] });
      showToast('团队设置已保存');
    },
    onError: () => showToast('保存失败，请重试'),
  });

  const setVisibility = useMutation({
    mutationFn: (visibility: 'private' | 'internal') =>
      apiFetch<unknown>(`/api/v1/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify({ visibility }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team', teamId] });
      showToast('可见性已更新');
    },
    onError: () => showToast('更新失败'),
  });

  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) =>
      apiFetch<{ ok: boolean; archived: boolean }>(`/api/v1/teams/${teamId}/archive`, {
        method: 'POST',
        body: JSON.stringify({ archived }),
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['team', teamId] });
      void queryClient.invalidateQueries({ queryKey: ['teams'] });
      showToast(r.archived ? '团队已归档（只读）' : '团队已恢复');
    },
    onError: () => showToast('操作失败，请检查权限'),
  });

  const members = useMemo(() => membersQuery.data?.items ?? [], [membersQuery.data]);
  const projects = projectsQuery.data?.items ?? [];

  if (teamQuery.isError) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <AlertTriangle size={32} className="mx-auto mb-3 text-rose-400" />
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>团队不存在，或你不是团队成员</div>
        <button className="btn-secondary mt-4" onClick={() => navigate('/team')}>返回团队列表</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-6">
      {/* Header */}
      <section className="animate-fade-up">
        <button
          type="button"
          onClick={() => navigate('/team')}
          className="mb-3 inline-flex items-center gap-1 text-xs transition hover:text-primary-600"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={12} /> 团队列表
        </button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
              <Users size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {team?.name ?? '加载中…'}
                </h1>
                {team?.archived && <span className="tag tag-neutral"><Archive size={10} /> 已归档</span>}
                {myRole && TEAM_ROLE_META[myRole] && (
                  <span className={`tag ${TEAM_ROLE_META[myRole].tagClass}`}>
                    {TEAM_ROLE_META[myRole].label}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-xl text-sm" style={{ color: 'var(--text-muted)' }}>
                {team?.description ?? '暂无描述'}
              </p>
              <div className="mt-2 flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span>成员 <b className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{team?.memberCount ?? members.length}</b></span>
                <span>文档库 <b className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{team?.projectCount ?? projects.length}</b></span>
                <span className="font-mono">{team?.slug}</span>
              </div>
            </div>
          </div>
          {canManageMembers && !team?.archived && (
            <button className="btn-primary shrink-0" onClick={() => setInviteOpen(true)}>
              <Plus size={15} /> 添加成员
            </button>
          )}
        </div>
      </section>

      {/* Tabs */}
      <section className="card overflow-hidden animate-fade-up" style={{ animationDelay: '40ms' }}>
        <div className="flex border-b px-5" style={{ borderColor: 'var(--border-soft)' }}>
          {([['members', '成员'], ['projects', '文档库'], ['settings', '设置']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`relative px-4 py-3 text-sm font-medium transition ${tab === key ? 'text-primary-600' : 'hover:text-neutral-800'}`}
              style={{ color: tab === key ? undefined : 'var(--text-muted)' }}
            >
              {label}
              {tab === key && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary-500" />}
            </button>
          ))}
        </div>

        {/* 成员 Tab */}
        {tab === 'members' && (
          <div>
            {membersQuery.isLoading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-10 w-full rounded" />)}
              </div>
            ) : members.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>暂无成员</div>
            ) : (
              members.map((m, idx) => {
                const meta = TEAM_ROLE_META[m.role] ?? TEAM_ROLE_META.member;
                const RoleIcon = meta!.Icon;
                const menuOpen = openMenu === m.id;
                return (
                  <div
                    key={m.id}
                    className="relative grid grid-cols-[1.6fr_1.4fr_1fr_1fr_48px] items-center gap-4 border-b px-5 py-3.5 last:border-0 animate-fade-up"
                    style={{ borderColor: 'var(--border-soft)', animationDelay: `${idx * 30}ms` }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-xs font-semibold text-white">
                        {(m.name ?? m.email ?? '?').slice(0, 1).toUpperCase()}
                      </div>
                      <span className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>{m.name ?? m.email}</span>
                    </div>
                    <div className="hidden truncate font-mono text-xs md:block" style={{ color: 'var(--text-muted)' }}>{m.email}</div>
                    <div>
                      <span className={`tag ${meta!.tagClass}`}><RoleIcon size={11} /> {meta!.label}</span>
                    </div>
                    <div className="text-xs" style={{ color: m.online ? '#059669' : 'var(--text-muted)' }}>
                      {m.online ? '在线' : relativeTime(m.lastActive)}
                    </div>
                    <div className="flex justify-end" data-member-menu>
                      {canManageMembers && !team?.archived ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenMenu(menuOpen ? null : m.id); }}
                          className="btn-ghost !p-1.5 rounded-md" aria-label="更多操作"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      ) : null}
                      {menuOpen && (
                        <div onClick={(e) => e.stopPropagation()} className="absolute right-5 top-11 z-20 w-44 card p-1 shadow-lg animate-fade-up">
                          <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                            变更角色
                          </div>
                          {(['owner', 'maintainer', 'member'] as const).map((role) => {
                            const isCurrent = role === m.role;
                            const roleMeta = TEAM_ROLE_META[role]!;
                            const Icon = roleMeta.Icon;
                            return (
                              <button key={role} disabled={isCurrent}
                                onClick={() => changeMember.mutate({ uid: m.userId, role })}
                                className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-xs transition ${isCurrent ? 'cursor-default' : 'hover:bg-neutral-100'}`}
                                style={{ color: isCurrent ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                                <span className="flex items-center gap-2">
                                  <span className={`tag ${roleMeta.tagClass} !px-1.5 !py-0`}><Icon size={11} /></span>
                                  {roleMeta.label}
                                </span>
                                {isCurrent && <CheckCircle2 size={14} style={{ color: 'var(--color-primary-500)' }} />}
                              </button>
                            );
                          })}
                          <div className="my-1 border-t" style={{ borderColor: 'var(--border-soft)' }} />
                          <button
                            onClick={() => changeMember.mutate({ uid: m.userId, remove: true })}
                            className="w-full rounded px-2.5 py-2 text-left text-xs text-rose-600 transition hover:bg-rose-50"
                          >
                            移出团队
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 文档库 Tab */}
        {tab === 'projects' && (
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                团队库归属团队所有；团队成员按各库的可见性档位访问
              </div>
              {!team?.archived && (
                <button className="btn-secondary !h-8 !text-xs" onClick={() => navigate(`/projects/new?owner=${teamId}`)}>
                  <FolderPlus size={13} /> 在团队下建库
                </button>
              )}
            </div>
            {projectsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-12 w-full rounded" />)}
              </div>
            ) : projects.length === 0 ? (
              <div className="rounded-lg py-10 text-center text-sm" style={{ color: 'var(--text-muted)', background: 'var(--bg-subtle)' }}>
                暂无团队文档库 —— 点击右上角「在团队下建库」创建
              </div>
            ) : (
              <div className="space-y-2">
                {projects.map((p) => {
                  const vis = visibilityMeta(p.visibility);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => navigate(`/projects/${p.id}/browse`)}
                      className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition hover:bg-neutral-50"
                      style={{ outline: '1px solid var(--border-soft)' }}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                        <Folder size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                          <span className="tag tag-neutral !text-[10px]">{vis.label}</span>
                        </div>
                        <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                          {p.description ?? '暂无描述'} · 更新于 {relativeTime(p.updatedAt)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 设置 Tab */}
        {tab === 'settings' && (
          <div className="space-y-6 p-5">
            {!canManageTeam ? (
              <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                仅团队 owner 可修改团队设置
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>团队名称</label>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>团队标识（slug）</label>
                    <input className="input font-mono text-xs" disabled value={team?.slug ?? ''} />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>描述</label>
                  <textarea rows={2} className="input resize-none" value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div className="flex justify-end">
                  <button
                    className="btn-primary !h-8 !text-xs disabled:opacity-50"
                    disabled={saveTeam.isPending || !name.trim()}
                    onClick={() => saveTeam.mutate()}
                  >
                    {saveTeam.isPending ? '保存中…' : '保存设置'}
                  </button>
                </div>

                <div className="border-t pt-5" style={{ borderColor: 'var(--border-soft)' }}>
                  <div className="mb-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>团队可见性</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      ['private', '仅成员可见', '团队不出现在任何列表，仅成员可访问'],
                      ['internal', '平台内可发现', '全站登录用户可看到团队名称与简介'],
                    ] as const).map(([key, label, desc]) => (
                      <button
                        key={key}
                        type="button"
                        disabled={setVisibility.isPending}
                        onClick={() => setVisibility.mutate(key)}
                        className={`rounded-lg px-4 py-3 text-left transition ${team?.visibility === key ? 'bg-primary-50/70 ring-1 ring-primary-400' : 'hover:bg-neutral-50 ring-1 ring-transparent'}`}
                      >
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
                        <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg bg-amber-50/60 p-4 ring-1 ring-amber-200">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {team?.archived ? '恢复团队' : '归档团队'}
                      </div>
                      <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {team?.archived
                          ? '归档后团队只读；恢复后可继续管理与建库'
                          : '归档后团队只读：不可加成员、不可建库、全部操作冻结（可恢复）'}
                      </div>
                    </div>
                    <button
                      className="btn-secondary !h-8 shrink-0 !text-xs"
                      disabled={archiveMutation.isPending}
                      onClick={() => archiveMutation.mutate(!team?.archived)}
                    >
                      {archiveMutation.isPending ? '处理中…' : team?.archived ? '恢复团队' : '归档团队'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {inviteOpen && teamId && <InviteMemberModal teamId={teamId} onClose={() => setInviteOpen(false)} />}
    </div>
  );
}
