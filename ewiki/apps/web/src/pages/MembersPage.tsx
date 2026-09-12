import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  Mail,
  MoreHorizontal,
  Pencil,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api/client';

// ---------------------------------------------------------------------------
// Types — 后端 GET /api/v1/projects/:id/members
// ---------------------------------------------------------------------------

interface ProjectMember {
  id: string;
  projectId: string;
  role: string;
  status: string;
  joinedAt: string;
  userId: string | null;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  lastActive: string | null;
  online: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// 角色徽章统一走 .tag 令牌类（对齐原型 ROLE_META 与 TeamPage 约定）：
// owner=tag-primary，maintainer=tag-success，editor=tag-warning（契约色，旧实现误用 sky），guest=tag-neutral
const ROLE_META: Record<string, { label: string; dot: string; tagCls: string; icon: typeof ShieldCheck }> = {
  owner: { label: '所有者', dot: 'bg-rose-500', tagCls: 'tag-primary', icon: ShieldCheck },
  maintainer: { label: '维护者', dot: 'bg-emerald-500', tagCls: 'tag-success', icon: ShieldAlert },
  editor: { label: '编辑者', dot: 'bg-amber-500', tagCls: 'tag-warning', icon: Pencil },
  guest: { label: '访客', dot: 'bg-neutral-400', tagCls: 'tag-neutral', icon: ShieldX },
};

const STATUS_META: Record<string, { label: string; dot: string }> = {
  active: { label: '已加入', dot: 'bg-emerald-500' },
  pending: { label: '待确认', dot: 'bg-amber-500' },
  removed: { label: '已移除', dot: 'bg-neutral-300' },
};

const ROLE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'maintainer', label: '设为维护者' },
  { key: 'editor', label: '设为编辑者' },
  { key: 'guest', label: '设为访客' },
];

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '刚加入';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return '今天';
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;
  return `${Math.floor(diffDays / 30)} 个月前`;
}

// 头像底色统一走 primary token（原型为多色 hex 调色板，属视觉装饰，迁移收敛为设计令牌）
const AVATAR_CLS = 'bg-primary-500 text-white';

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function MembersPage(): React.ReactElement {
  const { id: projectId } = useParams();
  const queryClient = useQueryClient();
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showRoleMenuFor, setShowRoleMenuFor] = useState<string | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  // 默认角色：原型为 Editor（ProjectMembers.jsx:93），现行 guest —— 角色语义差异待产品确认后再对齐（PLAN 5.3.5）
  const [inviteRole, setInviteRole] = useState('guest');

  const membersQuery = useQuery<{ items: ProjectMember[]; total: number; myRole?: string | null; visibility?: string }>({
    queryKey: ['project-members', projectId],
    queryFn: () =>
      apiFetch<{ items: ProjectMember[]; total: number; myRole?: string | null; visibility?: string }>(
        `/api/v1/projects/${projectId}/members`,
      ),
    enabled: !!projectId,
  });

  // 当前用户在项目内的实际角色（后端 projectAccess 推导：null = 非成员的隐式只读读者，
  // 经 team/public 可见性访问；全局 admin 兜底 maintainer）。未加载完成前按可管理处理避免闪烁。
  const myRole = membersQuery.data ? (membersQuery.data.myRole ?? null) : 'owner';
  const canManage = myRole === 'owner' || myRole === 'maintainer';

  const allMembers = membersQuery.data?.items ?? [];
  // 角色筛选 + 姓名/邮箱搜索（对齐原型 :149-164 过滤逻辑）
  const members = allMembers.filter((m) => {
    if (roleFilter && m.role !== roleFilter) return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = `${m.name ?? ''} ${m.email ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const total = membersQuery.data?.total ?? allMembers.length;

  // Escape 关闭弹窗与角色菜单（原型 :314-322；PLAN 5.3.5）
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setShowInviteDialog(false);
        setShowRoleMenuFor(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 三 StatPill（原型 ProjectMembers.jsx:207-229；online/lastActive 为后端 5.2.1 新增真实推导字段）
  const onlineCount = allMembers.filter((m) => m.online).length;
  const pendingCount = allMembers.filter((m) => m.status === 'pending').length;

  const roleCounts = allMembers.reduce<Record<string, number>>((acc, m) => {
    acc[m.role] = (acc[m.role] ?? 0) + 1;
    return acc;
  }, {});

  // ---- Invite mutation ----
  const inviteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/projects/${projectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
      setShowInviteDialog(false);
      setInviteEmail('');
      setInviteRole('guest');
    },
  });

  // ---- Change role mutation ----
  const changeRoleMutation = useMutation({
    mutationFn: ({ uid, role }: { uid: string; role: string }) =>
      apiFetch(`/api/v1/projects/${projectId}/members/${uid}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
      setShowRoleMenuFor(null);
    },
  });

  // ---- Remove member mutation ----
  const removeMutation = useMutation({
    mutationFn: (uid: string) =>
      apiFetch(`/api/v1/projects/${projectId}/members/${uid}`, {
        method: 'PUT',
        body: JSON.stringify({ remove: true }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
      setShowRoleMenuFor(null);
    },
  });

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      {/* 容器 max-w-[1440px]（对齐原型 ProjectMembers.jsx:184） */}
      <div className="p-6 max-w-[1440px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 text-neutral-400 text-xs mb-1">
              <Users size={13} />
              <span>项目成员</span>
            </div>
            <h1 className="text-xl font-bold text-neutral-900">成员管理</h1>
            <p className="text-xs text-neutral-500 mt-1">
              共 {total} 位成员 · 配置成员角色与访问权限
            </p>
          </div>

          {/* Invite button — 仅所有者/维护者可见（后端 MANAGE_ROLES 校验，非管理者点击只会得到 403） */}
          {canManage && (
            <button
              type="button"
              className="btn-primary !h-9 !text-xs !px-3"
              onClick={() => setShowInviteDialog(true)}
            >
              <UserPlus size={14} /> 邀请成员
            </button>
          )}
        </div>

        {/* 只读身份提示：非成员（经可见性隐式只读访问）或访客成员 */}
        {membersQuery.data && (myRole === null || myRole === 'guest') && (
          <div
            className="flex items-start gap-2.5 rounded-lg border px-4 py-3 mb-4 text-xs"
            style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-muted, rgba(0,0,0,0.02))' }}
          >
            <Eye size={14} className="shrink-0 mt-0.5 text-neutral-400" />
            {myRole === null ? (
              <span className="text-neutral-600">
                你正在以<b>只读身份</b>查看该知识库
                {membersQuery.data.visibility === 'public' ? '（公开可见）' : '（团队可见）'}
                ，因此不在下方成员列表中。如需协作，请联系管理员邀请你加入。
              </span>
            ) : (
              <span className="text-neutral-600">
                你的角色是<b>访客</b>（只读）。如需编辑或管理权限，请联系项目所有者/维护者调整。
              </span>
            )}
          </div>
        )}

        {/* Stat pills（原型 :207-229：总成员/在线/待确认） */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {([
            { label: '全部成员', value: total, cls: 'border-primary-200 bg-primary-50/60 text-primary-700' },
            { label: '在线', value: onlineCount, cls: 'border-emerald-200 bg-emerald-50/60 text-emerald-700' },
            { label: '待确认', value: pendingCount, cls: 'border-amber-200 bg-amber-50/60 text-amber-700' },
          ] as const).map((s) => (
            <span key={s.label}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${s.cls}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {s.label}
              <span className="font-mono font-semibold tabular-nums">{s.value}</span>
            </span>
          ))}
        </div>

        {/* Role filter pills + 搜索框 */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setRoleFilter(null)}
              className={`inline-flex items-center gap-1.5 px-3 h-7 rounded-full text-xs font-medium transition ${
                roleFilter === null
                  ? 'bg-primary-50 text-primary-700 border border-primary-200'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200/70 border border-transparent'
              }`}
            >
              全部 <span className="font-mono text-[10px] opacity-70">{total}</span>
            </button>
            {Object.entries(ROLE_META).map(([key, meta]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRoleFilter(key)}
                className={`inline-flex items-center gap-1.5 px-3 h-7 rounded-full text-xs font-medium transition ${
                  roleFilter === key
                    ? 'bg-primary-50 text-primary-700 border border-primary-200'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200/70 border border-transparent'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
                <span className="font-mono text-[10px] opacity-70">{roleCounts[key] ?? 0}</span>
              </button>
            ))}
          </div>
          {/* 成员搜索框（对齐原型 :266-278，按姓名/邮箱过滤） */}
          <div className="relative sm:ml-auto w-full sm:w-60">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input
              type="text"
              placeholder="搜索姓名或邮箱…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-8 py-1.5 text-xs"
            />
          </div>
        </div>

        {/* Table card */}
        <div className="card overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block">
            <div className="grid grid-cols-[1fr_140px_130px_160px_48px] items-center gap-4 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 border-b"
              style={{ borderColor: 'var(--border-soft)' }}>
              <span>成员</span>
              <span>角色</span>
              <span>状态</span>
              <span>加入时间</span>
              <span />
            </div>

            {membersQuery.isLoading ? (
              <div className="divide-y" style={{ borderColor: 'var(--border-soft)' }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-[1fr_140px_130px_160px_48px] items-center gap-4 px-5 py-3">
                    <div className="flex items-center gap-3">
                      {/* 对齐原型 ProjectMembers.jsx:66：成员头像骨架 36px */}
                      <div className="skeleton h-9 w-9 rounded-full" />
                      <div className="space-y-1.5">
                        <div className="skeleton h-3 w-28" />
                        <div className="skeleton h-2.5 w-40" />
                      </div>
                    </div>
                    <div className="skeleton h-6 w-20 rounded-full" />
                    <div className="skeleton h-3 w-14" />
                    <div className="skeleton h-3 w-16" />
                  </div>
                ))}
              </div>
            ) : members.length === 0 ? (
              <div className="py-16 text-center text-neutral-400 text-sm">
                <Users size={32} className="mx-auto mb-2 text-neutral-300" />
                {allMembers.length === 0 ? '暂无成员' : search.trim() ? '没有符合搜索条件的成员' : '没有该角色的成员'}
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-soft)' }}>
                {members.map((m, index) => {
                  const role = ROLE_META[m.role] ?? ROLE_META.guest;
                  const status = STATUS_META[m.status] ?? STATUS_META.active;
                  const RoleIcon = role.icon;
                  const isOwner = m.role === 'owner';
                  return (
                    <div key={m.id}
                      className="grid grid-cols-[1fr_140px_130px_160px_48px] items-center gap-4 px-5 py-3 hover:bg-neutral-50/70 transition animate-fade-up"
                      style={{ animationDelay: `${index * 40}ms` }}>
                      {/* Member info */}
                      <div className="flex items-center gap-3 min-w-0">
                        {m.avatarUrl ? (
                          <img src={m.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <div
                            className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${AVATAR_CLS}`}
                          >
                            {(m.name ?? m.email ?? '?').slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-neutral-900 truncate">
                            {m.name ?? m.email ?? '未命名成员'}
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-neutral-400 truncate">
                            <Mail size={10} className="shrink-0" />
                            <span>{m.email ?? '未绑定邮箱'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Role badge — 统一 .tag 令牌徽章（editor=tag-warning 契约色） */}
                      <span className={`tag ${role.tagCls} w-fit`}>
                        <RoleIcon size={11} />
                        {role.label}
                      </span>

                      {/* Status */}
                      <div className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
                        <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                        {status.label}
                      </div>

                      {/* Joined */}
                      <div className="text-xs text-neutral-500 tabular-nums">
                        {relativeTime(m.joinedAt)}
                      </div>

                      {/* Actions — 仅所有者/维护者可管理成员，其他角色隐藏入口而非点击后 403 */}
                      <div className="relative flex justify-end">
                        {canManage && (
                          <>
                            <button
                              type="button"
                              disabled={isOwner}
                              onClick={() => setShowRoleMenuFor(showRoleMenuFor === m.id ? null : m.id)}
                              className="w-7 h-7 rounded-md inline-flex items-center justify-center text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={isOwner ? '所有者不可编辑' : '管理成员'}
                            >
                              <MoreHorizontal size={14} />
                            </button>
                            {showRoleMenuFor === m.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setShowRoleMenuFor(null)} />
                                <div
                                  className="absolute right-0 top-full mt-1 w-40 rounded-lg border shadow-xl z-20 py-1"
                                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}
                                >
                                  {ROLE_OPTIONS.map((opt) => (
                                    <button
                                      key={opt.key}
                                      type="button"
                                      disabled={changeRoleMutation.isPending}
                                      onClick={() => changeRoleMutation.mutate({ uid: m.userId!, role: opt.key })}
                                      className="w-full text-left px-3 py-1.5 text-xs disabled:opacity-50 transition-colors hover:bg-neutral-100"
                                      style={{ color: 'var(--text-secondary)' }}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                  <div className="border-t my-1" style={{ borderColor: 'var(--border-soft)' }} />
                                  <button
                                    type="button"
                                    disabled={removeMutation.isPending}
                                    onClick={() => {
                                      if (confirm(`确认移除 ${m.name ?? m.email}？`)) {
                                        removeMutation.mutate(m.userId!);
                                      }
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-xs text-rose-600 disabled:opacity-50 transition-colors hover:bg-rose-50"
                                  >
                                    移除成员
                                  </button>
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y" style={{ borderColor: 'var(--border-soft)' }}>
            {membersQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="skeleton h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-3 w-32" />
                    <div className="skeleton h-2.5 w-40" />
                  </div>
                  <div className="skeleton h-5 w-16 rounded-full" />
                </div>
              ))
            ) : members.length === 0 ? (
              <div className="py-12 text-center text-neutral-400 text-sm">
                <Users size={28} className="mx-auto mb-2 text-neutral-300" />
                {allMembers.length === 0 ? '暂无成员' : search.trim() ? '没有符合搜索条件的成员' : '没有该角色的成员'}
              </div>
            ) : (
              members.map((m) => {
                const role = ROLE_META[m.role] ?? ROLE_META.guest;
                const RoleIcon = role.icon;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    {m.avatarUrl ? (
                      <img src={m.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <div
                        className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${AVATAR_CLS}`}
                      >
                        {(m.name ?? m.email ?? '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-neutral-900 truncate">
                        {m.name ?? m.email ?? '未命名成员'}
                      </div>
                      <div className="text-[11px] text-neutral-400 truncate">{m.email ?? '未绑定邮箱'}</div>
                    </div>
                    <span className={`tag ${role.tagCls} !text-[10px] !px-2`}>
                      <RoleIcon size={9} />
                      {role.label}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Invite dialog（头部 Mail 图标块 + X 关闭，对齐原型 ProjectMembers.jsx:484-505） */}
      {showInviteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={() => !inviteMutation.isPending && setShowInviteDialog(false)} />
          <div
            className="relative rounded-xl shadow-2xl w-full max-w-md mx-4 card p-6 animate-fade-up"
            style={{ background: 'var(--bg-surface)' }}
          >
            <div className="mb-5 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  <Mail size={18} />
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>邀请成员</h2>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>添加协作者加入本项目</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInviteDialog(false)}
                disabled={inviteMutation.isPending}
                className="btn-ghost !p-1.5 rounded-md"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>
            {/* 裁剪维度：后端邀请为「直接加入」模型（被邀请邮箱须为已注册用户，见 POST /members 的 USER_NOT_FOUND），
                原型的邮件邀请流/附言字段无对应接口，故不渲染附言输入框 */}
            <p className="mb-4 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              输入已注册用户的邮箱，确认后直接加入项目
            </p>
            {inviteMutation.error && (
              <div className="mb-3 text-xs text-rose-600 bg-rose-50 rounded px-3 py-2">
                邀请失败：{(inviteMutation.error as Error).message.includes('USER_NOT_FOUND')
                  ? '用户不存在。请确认邮箱已注册。'
                  : (inviteMutation.error as Error).message}
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-neutral-600 block mb-1">邮箱</label>
                <input
                  type="email"
                  className="input"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 block mb-1">角色</label>
                <select
                  className="input"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  <option value="guest">访客 — 只能查看</option>
                  <option value="editor">编辑者 — 可编辑文档</option>
                  <option value="maintainer">维护者 — 可管理文档与同步</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button
                type="button"
                className="btn-secondary !text-xs"
                onClick={() => setShowInviteDialog(false)}
                disabled={inviteMutation.isPending}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary !text-xs"
                onClick={() => inviteMutation.mutate()}
                disabled={inviteMutation.isPending || !inviteEmail}
              >
                {inviteMutation.isPending ? '邀请中…' : '发送邀请'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
