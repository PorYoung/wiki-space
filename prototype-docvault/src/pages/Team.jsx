import { useState, useEffect, useMemo } from 'react'
import {
  Users,
  UserPlus,
  Mail,
  MoreHorizontal,
  Shield,
  Crown,
  Pencil,
  Search,
  CheckCircle2,
  X,
  Activity,
  Bell,
} from 'lucide-react'
import { fetchTeam } from '../api/stubs.js'

// ---- helpers ----------------------------------------------------------

function relativeTime(iso) {
  if (!iso) return '刚刚'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} 小时前`
  const days = Math.floor(hrs / 24)
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} 周前`
  const months = Math.floor(days / 30)
  return `${months} 个月前`
}

// ---- config -----------------------------------------------------------

const ROLE_TABS = [
  { key: 'all', label: '全部成员' },
  { key: 'Owner', label: 'Owner' },
  { key: 'Maintainer', label: 'Maintainer' },
  { key: 'Editor', label: 'Editor' },
  { key: 'Guest', label: 'Guest' },
]

const ROLE_META = {
  Owner: { tagClass: 'tag-primary', Icon: Crown },
  Maintainer: { tagClass: 'tag-success', Icon: Shield },
  Editor: { tagClass: 'tag-warning', Icon: Pencil },
  Guest: { tagClass: 'tag-neutral', Icon: Users },
}

const INVITE_ROLES = [
  { key: 'Editor', label: 'Editor · 可编辑文档' },
  { key: 'Maintainer', label: 'Maintainer · 管理文档库' },
  { key: 'Guest', label: 'Guest · 仅查看' },
]

// ---- skeleton ---------------------------------------------------------

function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-neutral-100 last:border-0 animate-pulse">
      <div className="skeleton h-9 w-9 rounded-full flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="skeleton h-4 w-28" />
        <div className="skeleton h-3 w-40" />
      </div>
      <div className="skeleton h-5 w-20 rounded" />
      <div className="skeleton h-5 w-16 rounded" />
      <div className="skeleton h-3 w-20" />
      <div className="skeleton h-8 w-8 rounded-md flex-shrink-0" />
    </div>
  )
}

// ---- page -------------------------------------------------------------

export default function Team() {
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState([])
  const [activeTab, setActiveTab] = useState('all')
  const [search, setSearch] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [openMenu, setOpenMenu] = useState(null) // member id

  // invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('Editor')
  const [inviteMessage, setInviteMessage] = useState('')

  useEffect(() => {
    ;(async () => {
      const list = await fetchTeam()
      setMembers(list)
      setLoading(false)
    })()
  }, [])

  // close dropdown menus when clicking outside
  useEffect(() => {
    function onDocClick(e) {
      if (!e.target.closest('[data-member-menu]')) {
        setOpenMenu(null)
      }
    }
    if (openMenu !== null) {
      document.addEventListener('click', onDocClick)
      return () => document.removeEventListener('click', onDocClick)
    }
  }, [openMenu])

  // close modal with Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        setInviteOpen(false)
        setOpenMenu(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---------- derived stats ----------
  const stats = useMemo(() => {
    if (!members.length) return { total: 0, online: 0, weeklyActive: 0 }
    const now = Date.now()
    const WEEK_MS = 7 * 86400000
    return {
      total: members.length,
      online: members.filter((m) => m.online).length,
      weeklyActive: members.filter(
        (m) => now - new Date(m.lastActive).getTime() <= WEEK_MS,
      ).length,
    }
  }, [members])

  // ---------- filtered list ----------
  const filtered = useMemo(() => {
    let list = members
    if (activeTab !== 'all') list = list.filter((m) => m.role === activeTab)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q),
      )
    }
    // sort: online first, then most recent activity
    return [...list].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1
      return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime()
    })
  }, [members, activeTab, search])

  // ---------- handlers ----------
  function handleRoleChange(memberId, newRole) {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)),
    )
    setOpenMenu(null)
  }

  function handleSendInvite() {
    if (!inviteEmail.trim()) return
    // prototype: just close + reset. no real API call.
    setInviteOpen(false)
    setInviteEmail('')
    setInviteRole('Editor')
    setInviteMessage('')
  }

  // ---------- render ----------
  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-6">
      {/* Page header */}
      <section className="animate-fade-up">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-primary-600 text-xs font-medium mb-1">
              <Users size={14} />
              <span>Team</span>
            </div>
            <h1 className="font-display text-2xl font-bold text-neutral-900">
              团队与成员
            </h1>
            <p className="text-sm text-neutral-500 mt-1">
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
      <section
        className="flex flex-wrap items-center gap-3 animate-fade-up"
        style={{ animationDelay: '40ms' }}
      >
        <StatPill
          icon={<Users size={14} />}
          label="团队成员"
          value={loading ? null : stats.total}
        />
        <StatPill
          icon={<Activity size={14} className="text-emerald-500" />}
          label="在线"
          value={loading ? null : stats.online}
          tone="success"
        />
        <StatPill
          icon={<Bell size={14} className="text-primary-500" />}
          label="本周活跃"
          value={loading ? null : stats.weeklyActive}
          tone="primary"
        />
      </section>

      {/* Card */}
      <section
        className="card overflow-hidden animate-fade-up"
        style={{ animationDelay: '80ms' }}
      >
        {/* Card header: role tabs + search */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-5 py-4 border-b border-neutral-100">
          {/* Segmented control for role filter */}
          <div className="inline-flex items-center rounded-lg bg-neutral-100 p-1">
            {ROLE_TABS.map((tab) => {
              const selected = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    selected
                      ? 'bg-white text-primary-700 shadow-sm'
                      : 'text-neutral-600 hover:text-neutral-800'
                  }`}
                >
                  {tab.label}
                  {tab.key !== 'all' && !loading && (
                    <span
                      className={`ml-1.5 ${
                        selected ? 'text-primary-400' : 'text-neutral-400'
                      }`}
                    >
                      {members.filter((m) => m.role === tab.key).length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Search */}
          <div className="relative w-full md:w-60">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              type="text"
              placeholder="搜索姓名或邮箱…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-8 py-1.5 text-xs"
            />
          </div>
        </div>

        {/* Table header */}
        <div className="hidden md:grid grid-cols-[1.6fr_1.4fr_1fr_1fr_1fr_48px] gap-4 px-5 py-2.5 text-xs font-medium text-neutral-500 bg-neutral-50/60 border-b border-neutral-100">
          <div>成员</div>
          <div className="font-mono">邮箱</div>
          <div>角色</div>
          <div>在线状态</div>
          <div>最近活跃</div>
          <div></div>
        </div>

        {/* Rows */}
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <MemberRowSkeleton key={i} />
          ))
        ) : filtered.length === 0 ? (
          <div className="px-5 py-14 text-center text-sm text-neutral-400">
            没有符合条件的成员
          </div>
        ) : (
          filtered.map((m, idx) => <MemberRow key={m.id} member={m} index={idx} openMenu={openMenu} setOpenMenu={setOpenMenu} onRoleChange={handleRoleChange} />)
        )}
      </section>

      {/* Invite modal */}
      {inviteOpen && (
        <InviteModal
          email={inviteEmail}
          setEmail={setInviteEmail}
          role={inviteRole}
          setRole={setInviteRole}
          message={inviteMessage}
          setMessage={setInviteMessage}
          onClose={() => setInviteOpen(false)}
          onSend={handleSendInvite}
        />
      )}
    </div>
  )
}

// ---- sub-components ---------------------------------------------------

function StatPill({ icon, label, value, tone }) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-100 bg-emerald-50/60'
      : tone === 'primary'
      ? 'border-primary-100 bg-primary-50/60'
      : 'border-neutral-200 bg-white'
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm ${toneClass}`}
    >
      {icon}
      <span className="text-neutral-600">{label}</span>
      <span className="font-semibold text-neutral-900 tabular-nums">
        {value === null ? '—' : value}
      </span>
    </div>
  )
}

function MemberRow({ member, index, openMenu, setOpenMenu, onRoleChange }) {
  const meta = ROLE_META[member.role] || ROLE_META.Guest
  const RoleIcon = meta.Icon
  const menuOpen = openMenu === member.id

  function toggleMenu(e) {
    e.stopPropagation()
    setOpenMenu((prev) => (prev === member.id ? null : member.id))
  }

  return (
    <div
      className="relative md:grid md:grid-cols-[1.6fr_1.4fr_1fr_1fr_1fr_48px] md:gap-4 items-center px-5 py-4 border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60 transition animate-fade-up"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* 成员 */}
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
          style={{ backgroundColor: member.avatarColor }}
        >
          {member.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-neutral-900 truncate">
              {member.name}
            </span>
            <span className="text-neutral-300">·</span>
            <span className={`tag ${meta.tagClass} !px-1.5 !py-0`}>
              <RoleIcon size={10} />
            </span>
          </div>
        </div>
      </div>

      {/* 邮箱 */}
      <div className="hidden md:block font-mono text-xs text-neutral-500 truncate mt-1 md:mt-0">
        {member.email}
      </div>

      {/* 角色 */}
      <div className="mt-2 md:mt-0">
        <span className={`tag ${meta.tagClass}`}>
          <RoleIcon size={12} />
          {member.role}
        </span>
      </div>

      {/* 在线状态 */}
      <div className="flex items-center gap-2 mt-2 md:mt-0 text-xs">
        <span
          className={`h-2 w-2 rounded-full ${
            member.online ? 'bg-emerald-500' : 'bg-neutral-300'
          }`}
        />
        <span className={member.online ? 'text-emerald-600' : 'text-neutral-500'}>
          {member.online ? '在线' : '离线'}
        </span>
      </div>

      {/* 最近活跃 */}
      <div className="text-xs text-neutral-500 mt-2 md:mt-0">
        {relativeTime(member.lastActive)}
      </div>

      {/* 操作 */}
      <div className="flex justify-end mt-3 md:mt-0" data-member-menu>
        <button
          onClick={toggleMenu}
          className="btn-ghost !p-1.5 rounded-md"
          aria-label="更多操作"
        >
          <MoreHorizontal size={16} />
        </button>

        {menuOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-5 top-12 z-20 w-44 card p-1 shadow-lg animate-fade-up"
          >
            <div className="px-2 py-1.5 text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">
              变更角色
            </div>
            {Object.entries(ROLE_META).map(([role, { tagClass, Icon }]) => {
              const isCurrent = role === member.role
              return (
                <button
                  key={role}
                  disabled={isCurrent}
                  onClick={() => onRoleChange(member.id, role)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded text-xs transition ${
                    isCurrent
                      ? 'text-neutral-400 cursor-default'
                      : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`tag ${tagClass} !px-1.5 !py-0`}>
                      <Icon size={11} />
                    </span>
                    {role}
                  </span>
                  {isCurrent && <CheckCircle2 size={14} className="text-primary-500" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function InviteModal({
  email,
  setEmail,
  role,
  setRole,
  message,
  setMessage,
  onClose,
  onSend,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md card p-6 shadow-xl animate-fade-up">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
              <Mail size={18} />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold text-neutral-900">
                邀请成员
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                发送邀请邮件加入你的团队
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost !p-1.5 rounded-md"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1.5">
              邮箱地址
            </label>
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1.5">
              角色
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="input appearance-none cursor-pointer bg-no-repeat"
              style={{
                backgroundImage:
                  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%239ca3af\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'%3E%3C/polyline%3E%3C/svg%3E")',
                backgroundPosition: 'right 12px center',
                paddingRight: '32px',
              }}
            >
              {INVITE_ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1.5">
              附言 <span className="text-neutral-400 font-normal">(可选)</span>
            </label>
            <textarea
              rows={3}
              placeholder="写点什么让邀请更有温度…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="input resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button
            onClick={onSend}
            disabled={!email.trim()}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Mail size={16} />
            发送邀请
          </button>
        </div>
      </div>
    </div>
  )
}
