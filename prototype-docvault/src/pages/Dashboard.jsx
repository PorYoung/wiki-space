import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
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
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState([])
  const [documents, setDocuments] = useState([])
  const [team, setTeam] = useState([])
  const [activities, setActivities] = useState([])

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

  // 需要关注
  const conflictDocs = documents.filter((d) => d.status === 'conflict')
  const outdatedProjects = projects.filter((p) => {
    const days = (Date.now() - new Date(p.lastSynced).getTime()) / 86400000
    return days > 2
  })

  const alerts = []
  if (conflictDocs.length > 0) {
    alerts.push(`有 ${conflictDocs.length} 个文档存在 Git 冲突待处理`)
  }
  outdatedProjects.forEach((p) => {
    const days = Math.floor(
      (Date.now() - new Date(p.lastSynced).getTime()) / 86400000,
    )
    alerts.push(`${p.name} 上次同步已过期 ${days} 天`)
  })

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
              <Link to="/library/new" className="btn-primary">
                <Plus size={16} />
                新建文档库
              </Link>
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
                    to={`/library/${p.id}`}
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

      {/* Alerts */}
      {!loading && alerts.length > 0 && (
        <section
          className="animate-fade-up"
          style={{ animationDelay: '180ms' }}
        >
          <div className="card p-5 border-warning/40 bg-amber-50/40">
            <div className="flex items-start gap-3">
              <AlertCircle
                size={18}
                className="text-warning flex-shrink-0 mt-0.5"
              />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-neutral-900">
                  需要关注
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-neutral-600 list-disc list-inside marker:text-warning">
                  {alerts.map((text, idx) => (
                    <li key={idx}>{text}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
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
