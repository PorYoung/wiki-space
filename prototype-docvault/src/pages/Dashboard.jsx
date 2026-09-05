import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  FolderOpen,
  FileText,
  GitBranch,
  Users,
  TrendingUp,
  Clock,
  ChevronRight,
  Plus,
  BookOpen,
  RefreshCw,
  AlertCircle,
  X,
  Database,
  HardDrive,
  GitFork,
} from 'lucide-react'
import {
  fetchProjects,
  fetchDocuments,
  fetchTeam,
  fetchActivities,
} from '../api/stubs.js'

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
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  return `${months} 个月前`
}

function sourceTypeLabel(type) {
  switch (type) {
    case 'git':
      return 'Git'
    case 'repo-docs':
      return '仓库 /docs'
    case 'local':
      return '本地'
    case 'github':
      return 'GitHub'
    case 'gitlab':
      return 'GitLab'
    default:
      return type || '—'
  }
}

const SOURCE_TAG_COLOR = {
  git: 'tag-primary',
  'repo-docs': 'tag-primary',
  local: 'tag-neutral',
}

// ---- sub-components ----------------------------------------------------

function SkeletonStat() {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="skeleton h-4 w-16 mb-3" />
          <div className="skeleton h-7 w-20" />
        </div>
        <div className="skeleton h-9 w-9 rounded-lg" />
      </div>
      <div className="skeleton h-5 w-14 mt-4" />
    </div>
  )
}

function ProjectRowSkeleton() {
  return (
    <div className="card-hover p-4 flex items-center gap-4">
      <div className="skeleton h-11 w-11 rounded-lg flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-3 w-2/3" />
      </div>
      <div className="skeleton h-5 w-16" />
    </div>
  )
}

function ActivityItemSkeleton() {
  return (
    <div className="flex items-start gap-3">
      <div className="skeleton h-8 w-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3 w-3/4" />
        <div className="skeleton h-3 w-24" />
      </div>
    </div>
  )
}

// ---- main page --------------------------------------------------------

export default function Dashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState([])
  const [documents, setDocuments] = useState([])
  const [team, setTeam] = useState([])
  const [activities, setActivities] = useState([])
  const [showNewProject, setShowNewProject] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    ;(async () => {
      const [p, d, t, a] = await Promise.all([
        fetchProjects(),
        fetchDocuments(),
        fetchTeam(),
        fetchActivities(),
      ])
      setProjects(p)
      setDocuments(d)
      setTeam(t)
      setActivities(a)
      setLoading(false)
    })()
  }, [])

  // ---------- derived ----------
  const sortedProjects = [...projects].sort(
    (a, b) => new Date(b.lastSynced) - new Date(a.lastSynced),
  )
  const topProjects = sortedProjects.slice(0, 3)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStartMs = today.getTime()
  const todayCount = activities.filter(
    (a) => new Date(a.timestamp).getTime() >= todayStartMs,
  ).length

  const activityFeed = [...activities]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 8)

  // actor avatar color lookup — mock 里 team 是 name/color，activity 里是 actor 字符串
  const teamMap = new Map(team.map((m) => [m.name, m]))
  const avatarColor = (actor) => teamMap.get(actor)?.avatarColor || '#6366f1'
  const avatarInitial = (actor) => (actor || '?').slice(0, 1).toUpperCase()

  // 需要关注 —— 带跳转目标的交互式提醒
  const conflictDocs = documents.filter((d) => d.status === 'conflict')
  const outdatedProjects = projects.filter((p) => {
    const days = (Date.now() - new Date(p.lastSynced).getTime()) / 86400000
    return days > 2
  })
  const modifiedDocs = documents.filter((d) => d.status === 'modified')

  const alerts = []
  if (conflictDocs.length > 0) {
    alerts.push({
      icon: AlertCircle,
      title: `${conflictDocs.length} 个文档存在 Git 冲突`,
      desc: '点击进入项目处理冲突合并',
      cta: '立即处理',
      target: `/project/${conflictDocs[0].projectId}/browse`,
      tone: 'danger',
      count: conflictDocs.length,
    })
  }
  outdatedProjects.forEach((p) => {
    const days = Math.floor(
      (Date.now() - new Date(p.lastSynced).getTime()) / 86400000,
    )
    alerts.push({
      icon: RefreshCw,
      title: `${p.name} 同步过期 ${days} 天`,
      desc: '建议手动触发一次同步以保持最新',
      cta: '查看项目',
      target: `/project/${p.id}/publish`,
      tone: 'warning',
      count: null,
    })
  })
  if (modifiedDocs.length > 0 && modifiedDocs.length <= 5) {
    alerts.push({
      icon: FileText,
      title: `${modifiedDocs.length} 个文档有本地修改待提交`,
      desc: '检查改动是否需要提交到 Git',
      cta: '查看改动',
      target: `/library`,
      tone: 'primary',
      count: modifiedDocs.length,
    })
  }

  // ---------- render ----------
  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-6">
      {/* Hero */}
      <section className="animate-fade-up">
        <div className="card p-6 bg-gradient-to-br from-primary-50 to-white border-primary-100">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-primary-600 text-xs font-medium mb-1">
                <LayoutDashboard size={14} />
                <span>Dashboard</span>
              </div>
              <h1 className="font-display text-2xl font-bold text-neutral-900">
                欢迎回来，张明 👋
              </h1>
              <p className="text-sm text-neutral-500 mt-1">
                今天有 <span className="font-semibold text-primary-600">3</span> 个文档需要处理
                {alerts.length > 0 && (
                  <span className="ml-1 text-warning">· {alerts.length} 个关注提醒</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowNewProject(true)}
                className="btn-primary"
              >
                <Plus size={16} />
                新建文档库
              </button>
              <Link to="/sources" className="btn-secondary">
                <RefreshCw size={16} />
                从 Git 导入
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stat cards */}
      <section
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-up"
        style={{ animationDelay: '60ms' }}
      >
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonStat key={i} />)
        ) : (
          <>
            <StatCard
              label="文档库"
              value={projects.length}
              icon={<FolderOpen size={18} />}
              iconBg="bg-primary-50 text-primary-600"
              pillClass="tag-primary"
              pill="全部项目"
            />
            <StatCard
              label="文档总数"
              value={documents.length}
              icon={<FileText size={18} />}
              iconBg="bg-emerald-50 text-emerald-600"
              pillClass="tag-success"
              pill="已同步"
            />
            <StatCard
              label="成员数"
              value={team.length}
              icon={<Users size={18} />}
              iconBg="bg-neutral-100 text-neutral-600"
              pillClass="tag-neutral"
              pill="活跃协作"
            />
            <StatCard
              label="今日活动"
              value={todayCount}
              icon={<TrendingUp size={18} />}
              iconBg="bg-amber-50 text-amber-600"
              pillClass="tag-warning"
              pill="24 小时内"
            />
          </>
        )}
      </section>

      {/* Two column */}
      <section
        className="flex flex-col lg:flex-row gap-6 animate-fade-up"
        style={{ animationDelay: '120ms' }}
      >
        {/* Left — recent projects */}
        <div className="flex-[2] min-w-0">
          <SectionHeading
            title="最近活跃的文档库"
            icon={<BookOpen size={16} />}
            to="/library"
          />
          <div className="space-y-3">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <ProjectRowSkeleton key={i} />
                ))
              : topProjects.map((p) => (
                  <Link
                    key={p.id}
                    to={`/project/${p.id}`}
                    className="card-hover p-4 flex items-center gap-4"
                  >
                    <div
                      className={`h-11 w-11 rounded-lg flex items-center justify-center ${p.color} flex-shrink-0`}
                    >
                      <FolderOpen size={20} className="text-neutral-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-neutral-900 truncate">
                          {p.name}
                        </h3>
                        <span
                          className={SOURCE_TAG_COLOR[p.sourceType] || 'tag-neutral'}
                        >
                          {sourceTypeLabel(p.sourceType)}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500 truncate mt-0.5">
                        {p.description}
                      </p>
                    </div>
                    <div className="hidden sm:flex flex-col items-end text-right gap-1 flex-shrink-0">
                      <span className="text-sm font-semibold text-neutral-800">
                        {p.docCount} <span className="text-xs font-normal text-neutral-500">文档</span>
                      </span>
                      <span className="text-xs text-neutral-400 flex items-center gap-1">
                        <Clock size={12} />
                        {relativeTime(p.lastSynced)}
                      </span>
                    </div>
                    <ChevronRight size={16} className="text-neutral-300 flex-shrink-0" />
                  </Link>
                ))}
          </div>
        </div>

        {/* Right — activity feed */}
        <div className="flex-1 min-w-0">
          <SectionHeading
            title="最近动态"
            icon={<GitBranch size={16} />}
          />
          <div className="card p-5">
            {loading ? (
              <div className="space-y-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <ActivityItemSkeleton key={i} />
                ))}
              </div>
            ) : (
              <ul className="space-y-4">
                {activityFeed.map((item, idx) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-3 animate-fade-up"
                    style={{ animationDelay: `${idx * 60}ms` }}
                  >
                    <div
                      className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                      style={{ backgroundColor: avatarColor(item.actor) }}
                    >
                      {avatarInitial(item.actor)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-700 leading-snug">
                        <span className="font-medium text-neutral-900">
                          {item.actor}
                        </span>
                        <span className="text-neutral-500"> {item.action} </span>
                        <span className="text-primary-600 font-medium">
                          {item.target}
                        </span>
                      </p>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {relativeTime(item.timestamp)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Alerts — interactive cards */}
      {!loading && alerts.length > 0 && (
        <section
          className="animate-fade-up"
          style={{ animationDelay: '180ms' }}
        >
          <SectionHeading
            title="需要关注"
            icon={<AlertCircle size={16} className="text-warning" />}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {alerts.map((alert, idx) => {
              const Icon = alert.icon
              const toneMap = {
                danger: {
                  bg: 'bg-red-50 border-red-100 hover:border-red-200 hover:bg-red-100/60',
                  iconBg: 'bg-danger/10 text-danger',
                  ctaCls: 'text-danger hover:text-red-700',
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
              }
              const tone = toneMap[alert.tone] || toneMap.warning

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => navigate(alert.target)}
                  className={`group p-4 rounded-xl border text-left transition-all animate-fade-up ${tone.bg}`}
                  style={{ animationDelay: `${200 + idx * 60}ms` }}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tone.iconBg}`}>
                      <Icon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-neutral-900 truncate">
                          {alert.title}
                        </h4>
                        {alert.count != null && alert.count > 1 && (
                          <span className="shrink-0 text-[10px] font-semibold text-white bg-neutral-800 rounded-full px-1.5 py-0.5">
                            {alert.count}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-500 mt-1 leading-relaxed line-clamp-2">
                        {alert.desc}
                      </p>
                      <div className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${tone.ctaCls} group-hover:gap-1.5 transition-all`}>
                        {alert.cta}
                        <ChevronRight size={13} />
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* New Project Modal */}
      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreate={(project) => {
            setShowNewProject(false)
            setToast(`已创建项目「${project.name}」`)
            setTimeout(() => setToast(null), 2000)
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-up">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium text-neutral-800 bg-white border border-neutral-200">
            <span className="text-emerald-500">✓</span>
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- small presentational components ----------------------------------

function StatCard({ label, value, icon, iconBg, pill, pillClass }) {
  return (
    <div className="card p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-neutral-500 mb-2">
            {label}
          </div>
          <div className="font-display text-2xl font-bold text-neutral-900 tabular-nums">
            {value}
          </div>
        </div>
        <div
          className={`h-9 w-9 rounded-lg flex items-center justify-center ${iconBg}`}
        >
          {icon}
        </div>
      </div>
      <div className={`mt-4 ${pillClass}`}>{pill}</div>
    </div>
  )
}

function SectionHeading({ title, icon, to }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="flex items-center gap-2 font-semibold text-neutral-900">
        <span className="text-primary-600">{icon}</span>
        {title}
      </h2>
      {to && (
        <Link
          to={to}
          className="text-xs text-primary-600 hover:text-primary-700 inline-flex items-center gap-1"
        >
          查看全部
          <ChevronRight size={14} />
        </Link>
      )}
    </div>
  )
}

// ---- New Project Modal ------------------------------------------------

const PROJECT_SOURCE_OPTIONS = [
  { key: 'local', label: '本地文件夹', desc: '从本地磁盘读取 Markdown 文档', icon: HardDrive },
  { key: 'git', label: 'Git 仓库', desc: '绑定 GitHub / GitLab 仓库自动同步', icon: GitFork },
  { key: 'sources', label: '使用已有数据源', desc: '从已连接的数据源创建项目', icon: Database },
]

const PROJECT_COLORS = [
  'bg-violet-100', 'bg-sky-100', 'bg-rose-100', 'bg-amber-100',
  'bg-emerald-100', 'bg-indigo-100', 'bg-teal-100', 'bg-orange-100',
]

function NewProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sourceType, setSourceType] = useState('git')
  const [url, setUrl] = useState('')
  const [color, setColor] = useState(PROJECT_COLORS[0])
  const [creating, setCreating] = useState(false)

  const SourceIcon = PROJECT_SOURCE_OPTIONS.find((o) => o.key === sourceType)?.icon || GitFork

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    await new Promise((r) => setTimeout(r, 600))
    onCreate({
      id: `p-new-${Date.now()}`,
      name: name.trim(),
      description: description.trim() || '新建文档库',
      sourceType,
      sourceUrl: url.trim(),
      color,
      docCount: 0,
      lastSynced: new Date().toISOString(),
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] bg-white rounded-xl shadow-xl border border-neutral-200 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
              <FolderOpen size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900">新建文档库</h3>
              <p className="text-xs text-neutral-500">创建一个新的知识库或文档项目</p>
            </div>
          </div>
          <button className="btn-ghost !p-2" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        {/* Form body - scrollable */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-5 space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                项目名称 <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                className="input"
                placeholder="例如：EdgeAgent Platform"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                描述
              </label>
              <input
                type="text"
                className="input"
                placeholder="简短描述这个项目的用途"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Source type */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                数据源类型
              </label>
              <div className="grid grid-cols-3 gap-2">
                {PROJECT_SOURCE_OPTIONS.map((opt) => {
                  const Icon = opt.icon
                  const active = sourceType === opt.key
                  return (
                    <button
                      type="button"
                      key={opt.key}
                      onClick={() => setSourceType(opt.key)}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        active
                          ? 'border-primary-400 bg-primary-50 ring-2 ring-primary-100'
                          : 'border-neutral-200 bg-white hover:border-neutral-300'
                      }`}
                    >
                      <Icon size={16} className={active ? 'text-primary-600' : 'text-neutral-500'} />
                      <div className="text-[12px] font-medium text-neutral-800 mt-1">{opt.label}</div>
                      <div className="text-[10px] text-neutral-500 leading-tight mt-0.5">{opt.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Source URL */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                {sourceType === 'local' ? '文件夹路径' : sourceType === 'git' ? '仓库地址' : '数据源'}
                <span className="text-danger ml-0.5">*</span>
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
                  <SourceIcon size={14} />
                </div>
                <input
                  type="text"
                  className="input pl-9 font-mono"
                  placeholder={
                    sourceType === 'local'
                      ? 'C:/Users/poryo/Documents/MyVault'
                      : sourceType === 'git'
                      ? 'https://github.com/user/repo.git'
                      : '选择已有数据源'
                  }
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Color picker */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                项目颜色
              </label>
              <div className="flex gap-2">
                {PROJECT_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-lg ${c} transition-all ${
                      color === c ? 'ring-2 ring-offset-2 ring-primary-400 scale-110' : 'hover:scale-105'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Footer - always visible */}
          <div className="sticky bottom-0 flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-100 bg-white">
            <button type="button" className="btn-secondary" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={creating || !name.trim()}
            >
              {creating ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <Plus size={14} />
                  创建项目
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
