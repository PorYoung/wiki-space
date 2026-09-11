import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, Bell, CheckCircle2, Crown, Mail, MoreHorizontal, Pencil, Search,
  Shield, UserPlus, Users, X,
} from 'lucide-react';
import { apiFetch } from '../lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TeamRole = 'Owner' | 'Maintainer' | 'Editor' | 'Guest';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  online: boolean;
  lastActive: string | null;
  avatarUrl: string | null;
  status: string;
}

interface TeamResponse {
  members: TeamMember[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null): string {
  if (!iso) return '刚刚';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} 周前`;
  return `${Math.floor(days / 30)} 个月前`;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROLE_TABS: Array<{ key: 'all' | TeamRole; label: string }> = [
  { key: 'all', label: '全部成员' },
  { key: 'Owner', label: 'Owner' },
  { key: 'Maintainer', label: 'Maintainer' },
  { key: 'Editor', label: 'Editor' },
  { key: 'Guest', label: 'Guest' },
];

const ROLE_META: Record<TeamRole, { tagClass: string; Icon: typeof Crown }> = {
  Owner: { tagClass: 'tag-primary', Icon: Crown },
  Maintainer: { tagClass: 'tag-success', Icon: Shield },
  Editor: { tagClass: 'tag-warning', Icon: Pencil },
  Guest: { tagClass: 'tag-neutral', Icon: Users },
};

const INVITE_ROLES: Array<{ key: TeamRole; label: string }> = [
  { key: 'Editor', label: 'Editor · 可编辑文档' },
  { key: 'Maintainer', label: 'Maintainer · 管理文档库' },
  { key: 'Guest', label: 'Guest · 仅查看' },
];

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function MemberRowSkeleton(): React.ReactElement {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b last:border-0 animate-pulse"
      style={{ borderColor: 'var(--border-soft)' }}>
      <div className="skeleton h-9 w-9 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="skeleton h-4 w-28" />
        <div className="skeleton h-3 w-40" />
      </div>
      <div className="skeleton h-5 w-20 rounded" />
      <div className="skeleton h-5 w-16 rounded" />
      <div className="skeleton h-3 w-20" />
      <div className="skeleton h-8 w-8 rounded-md shrink-0" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatPill({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: number | null;
  tone?: 'success' | 'primary';
}): React.ReactElement {
  const toneClass = tone === 'success'
    ? 'border-emerald-100 bg-emerald-50/60'
    : tone === 'primary'
    ? 'border-primary-100 bg-primary-50/60'
    : 'bg-white';
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm ${toneClass}`}
      style={{ borderColor: tone ? undefined : 'var(--border-soft)' }}>
      {icon}
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {value === null ? '—' : value}
      </span>
    </div>
  );
}

function MemberRow({ member, index, openMenu, setOpenMenu, onRoleChange }: {
  member: TeamMember;
  index: number;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  onRoleChange: (id: string, role: TeamRole) => void;
}): React.ReactElement {
  const meta = ROLE_META[member.role];
  const RoleIcon = meta.Icon;
  const menuOpen = openMenu === member.id;

  function toggleMenu(e: React.MouseEvent): void {
    e.stopPropagation();
    setOpenMenu(menuOpen ? null : member.id);
  }

  return (
    <div
      className="relative md:grid md:grid-cols-[1.6fr_1.4fr_1fr_1fr_1fr_48px] md:gap-4 items-center px-5 py-4 border-b last:border-0 transition animate-fade-up hover:bg-neutral-50/60"
      style={{ animationDelay: `${index * 40}ms`, borderColor: 'var(--border-soft)' }}
    >
      {/* Member */}
      <div className="flex items-center gap-3 min-w-0">
        {/* 头像底色统一走 primary token（后端无 avatarColor 调色板字段，收敛为设计令牌） */}
        <div className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0 bg-primary-500">
          {member.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {member.name}
            </span>
            <span style={{ color: 'var(--border-soft)' }}>·</span>
            <span className={`tag ${meta.tagClass} !px-1.5 !py-0`}>
              <RoleIcon size={10} />
            </span>
          </div>
        </div>
      </div>

      {/* Email */}
      <div className="hidden md:block font-mono text-xs truncate mt-1 md:mt-0"
        style={{ color: 'var(--text-muted)' }}>
        {member.email}
      </div>

      {/* Role */}
      <div className="mt-2 md:mt-0">
        <span className={`tag ${meta.tagClass}`}>
          <RoleIcon size={12} /> {member.role}
        </span>
      </div>

      {/* Online status */}
      <div className="flex items-center gap-2 mt-2 md:mt-0 text-xs">
        <span className={`h-2 w-2 rounded-full ${member.online ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
        <span style={{ color: member.online ? '#059669' : 'var(--text-muted)' }}>
          {member.online ? '在线' : '离线'}
        </span>
      </div>

      {/* Last active */}
      <div className="text-xs mt-2 md:mt-0" style={{ color: 'var(--text-muted)' }}>
        {relativeTime(member.lastActive)}
      </div>

      {/* Actions */}
      <div className="flex justify-end mt-3 md:mt-0" data-member-menu>
        <button onClick={toggleMenu} className="btn-ghost !p-1.5 rounded-md" aria-label="更多操作">
          <MoreHorizontal size={16} />
        </button>

        {menuOpen && (
          <div onClick={(e) => e.stopPropagation()}
            className="absolute right-5 top-12 z-20 w-44 card p-1 shadow-lg animate-fade-up">
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-muted)' }}>
              变更角色
            </div>
            {(Object.entries(ROLE_META) as Array<[TeamRole, typeof ROLE_META[TeamRole]]>).map(([role, { tagClass, Icon }]) => {
              const isCurrent = role === member.role;
              return (
                <button key={role} disabled={isCurrent}
                  onClick={() => onRoleChange(member.id, role)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded text-xs transition ${
                    isCurrent ? 'cursor-default' : 'hover:bg-neutral-100'
                  }`}
                  style={{ color: isCurrent ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                  <span className="flex items-center gap-2">
                    <span className={`tag ${tagClass} !px-1.5 !py-0`}><Icon size={11} /></span>
                    {role}
                  </span>
                  {isCurrent && <CheckCircle2 size={14} style={{ color: 'var(--color-primary-500)' }} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function InviteModal({ email, setEmail, role, setRole, message, setMessage, onClose, onSend, sending }: {
  email: string; setEmail: (v: string) => void;
  role: TeamRole; setRole: (v: TeamRole) => void;
  message: string; setMessage: (v: string) => void;
  onClose: () => void; onSend: () => void; sending?: boolean;
}): React.ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — 遮罩用 bg-black/40 避免暗色下翻转为亮色 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md card p-6 shadow-xl animate-fade-up"
        style={{ background: 'var(--bg-surface)' }}>
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-primary-50 text-primary-600">
              <Mail size={18} />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                邀请成员
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                发送邀请邮件加入你的团队
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost !p-1.5 rounded-md" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              邮箱地址
            </label>
            <input type="email" placeholder="name@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)} className="input" autoFocus />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              角色
            </label>
            <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}
              className="input appearance-none cursor-pointer bg-no-repeat"
              style={{
                backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%239ca3af\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'%3E%3C/polyline%3E%3C/svg%3E")',
                backgroundPosition: 'right 12px center',
                paddingRight: '32px',
              }}>
              {INVITE_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              附言 <span className="font-normal" style={{ color: 'var(--text-muted)' }}>(可选)</span>
            </label>
            <textarea rows={3} placeholder="写点什么让邀请更有温度…"
              value={message} onChange={(e) => setMessage(e.target.value)}
              className="input resize-none" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-secondary">取消</button>
          <button onClick={onSend} disabled={!email.trim() || sending}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
            <Mail size={16} />
            {sending ? '发送中…' : '发送邀请'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function TeamPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<TeamResponse>({
    queryKey: ['team'],
    queryFn: () => apiFetch<TeamResponse>('/api/v1/team'),
  });

  const members = data?.members ?? [];

  const [activeTab, setActiveTab] = useState<'all' | TeamRole>('all');
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('Editor');
  const [inviteMessage, setInviteMessage] = useState('');

  // Role change mutation — 后端 PATCH /api/v1/team/:id/role 已实现（PLAN 5.2.1，TeamRole 映射 globalRole）
  const changeRole = useMutation({
    mutationFn: (payload: { id: string; role: TeamRole }) =>
      apiFetch<unknown>(`/api/v1/team/${payload.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: payload.role }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team'] });
    },
  });

  // Invite mutation — 后端 POST /api/v1/team/invite 已实现（PLAN 5.2.1：创建 invited 账号）
  const invite = useMutation({
    mutationFn: () =>
      apiFetch<unknown>('/api/v1/team/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          message: inviteMessage.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team'] });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('Editor');
      setInviteMessage('');
    },
  });

  // close dropdown menus when clicking outside
  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (!(e.target as HTMLElement).closest('[data-member-menu]')) setOpenMenu(null);
    }
    if (openMenu !== null) {
      document.addEventListener('click', onDocClick);
      return () => document.removeEventListener('click', onDocClick);
    }
  }, [openMenu]);

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setInviteOpen(false);
        setOpenMenu(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Stats
  const stats = useMemo(() => {
    const WEEK_MS = 7 * 86_400_000;
    const now = Date.now();
    return {
      total: members.length,
      online: members.filter((m) => m.online).length,
      weeklyActive: members.filter((m) => m.lastActive && now - new Date(m.lastActive).getTime() <= WEEK_MS).length,
    };
  }, [members]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = members;
    if (activeTab !== 'all') list = list.filter((m) => m.role === activeTab);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
    return [...list].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return new Date(b.lastActive ?? 0).getTime() - new Date(a.lastActive ?? 0).getTime();
    });
  }, [members, activeTab, search]);

  function handleRoleChange(id: string, role: TeamRole): void {
    changeRole.mutate({ id, role });
    setOpenMenu(null);
  }

  function handleSendInvite(): void {
    if (!inviteEmail.trim()) return;
    void invite.mutateAsync();
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-6">
      {/* Header */}
      <section className="animate-fade-up">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-primary-600">
              <Users size={14} />
              <span>Team</span>
            </div>
            <h1 className="font-display text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              团队与成员
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              邀请成员、管理角色与权限，协同编辑你的知识库
            </p>
          </div>
          <button className="btn-primary" onClick={() => setInviteOpen(true)}>
            <UserPlus size={16} />
            邀请成员
          </button>
        </div>
      </section>

      {/* Stats pills */}
      <section className="flex flex-wrap items-center gap-3 animate-fade-up" style={{ animationDelay: '40ms' }}>
        <StatPill icon={<Users size={14} />} label="团队成员" value={isLoading ? null : stats.total} />
        <StatPill icon={<Activity size={14} className="text-emerald-500" />}
          label="在线" value={isLoading ? null : stats.online} tone="success" />
        <StatPill icon={<Bell size={14} style={{ color: 'var(--color-primary-500)' }} />}
          label="本周活跃" value={isLoading ? null : stats.weeklyActive} tone="primary" />
      </section>

      {/* Table card */}
      <section className="card overflow-hidden animate-fade-up" style={{ animationDelay: '80ms' }}>
        {/* Card header: role tabs + search */}
        <div className="flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center md:justify-between"
          style={{ borderColor: 'var(--border-soft)' }}>
          {/* Segmented role filter */}
          <div className="inline-flex items-center rounded-lg bg-neutral-100 p-1">
            {ROLE_TABS.map((tab) => {
              const selected = activeTab === tab.key;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    selected ? 'bg-white text-primary-700 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                  }`}>
                  {tab.label}
                  {tab.key !== 'all' && !isLoading && (
                    <span className={`ml-1.5 ${selected ? 'text-primary-400' : 'text-neutral-400'}`}>
                      {members.filter((m) => m.role === tab.key).length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="relative w-full md:w-60">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }} />
            <input type="text" placeholder="搜索姓名或邮箱…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-8 py-1.5 text-xs" />
          </div>
        </div>

        {/* Table header */}
        <div className="hidden md:grid grid-cols-[1.6fr_1.4fr_1fr_1fr_1fr_48px] gap-4 border-b bg-neutral-50/60 px-5 py-2.5 text-xs font-medium"
          style={{ color: 'var(--text-muted)', borderColor: 'var(--border-soft)' }}>
          <div>成员</div>
          <div className="font-mono">邮箱</div>
          <div>角色</div>
          <div>在线状态</div>
          <div>最近活跃</div>
          <div></div>
        </div>

        {/* Rows */}
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <MemberRowSkeleton key={i} />)
        ) : filtered.length === 0 ? (
          <div className="px-5 py-14 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            没有符合条件的成员
          </div>
        ) : (
          filtered.map((m, idx) => (
            <MemberRow key={m.id} member={m} index={idx}
              openMenu={openMenu} setOpenMenu={setOpenMenu} onRoleChange={handleRoleChange} />
          ))
        )}
      </section>

      {/* Invite modal */}
      {inviteOpen && (
        <InviteModal
          email={inviteEmail} setEmail={setInviteEmail}
          role={inviteRole} setRole={setInviteRole}
          message={inviteMessage} setMessage={setInviteMessage}
          onClose={() => setInviteOpen(false)}
          onSend={handleSendInvite}
          sending={invite.isPending}
        />
      )}
    </div>
  );
}
