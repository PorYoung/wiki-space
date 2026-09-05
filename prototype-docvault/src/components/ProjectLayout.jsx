import { useState, useEffect, useRef } from 'react'
import { Outlet, useParams, NavLink, Link, useLocation } from 'react-router-dom'
import {
  FolderKanban, Activity, Rocket, Share2, MoreHorizontal, ChevronDown,
  FolderOpen,
} from 'lucide-react'
import { fetchProject, fetchTeam, fetchProjects } from '../api/stubs.js'

// ---------------------------------------------------------------------------
// 来源类型 → 颜色标签映射
// ---------------------------------------------------------------------------
const sourceTypeTagMap = {
  local:      { cls: 'tag-primary',  label: '本地源' },
  git:        { cls: 'tag-success',  label: 'Git 仓库' },
  'repo-docs': { cls: 'tag-warning', label: '仓库 /docs' },
}

// ---------------------------------------------------------------------------
// 团队头像：28px 彩色圆 + 名字首字 + 在线绿点
// ---------------------------------------------------------------------------
function Avatar({ member }) {
  const initial = (member.name || '?').trim()[0]
  return (
    <div className="relative">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold ring-2 ring-white"
        style={{ backgroundColor: member.avatarColor || '#6b7280' }}
        title={member.name}
      >
        {initial}
      </div>
      {member.online && (
        <span className="absolute -bottom-0 -right-0 w-2 h-2 rounded-full bg-success border-2 border-white" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toast（通过 Outlet context 提供给子页面）
// ---------------------------------------------------------------------------
function HeaderToast({ message }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-up pointer-events-none">
      <div className="px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium text-neutral-800 bg-white border border-neutral-200">
        <span className="text-emerald-500">✓</span>
        {message}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 骨架屏：单行 shell
// ---------------------------------------------------------------------------
function HeaderSkeleton() {
  return (
    <div className="h-14 px-6 flex items-center gap-3 bg-white border-b border-neutral-200">
      <div className="skeleton h-9 w-9 rounded-lg" />
      <div className="skeleton h-5 w-36 rounded" />
      <div className="flex-1" />
      <div className="flex -space-x-1">
        <div className="skeleton w-7 h-7 rounded-full" />
        <div className="skeleton w-7 h-7 rounded-full" />
        <div className="skeleton w-7 h-7 rounded-full" />
      </div>
    </div>
  )
}

function ProjectNotFound({ id }) {
  return (
    <div className="flex-1 overflow-auto scrollbar-thin p-10 flex items-start justify-center">
      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-10 text-center max-w-lg">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-neutral-100 flex items-center justify-center">
          <FolderOpen size={26} className="text-neutral-400" />
        </div>
        <h2 className="text-lg font-semibold text-neutral-900 mb-2">未找到项目</h2>
        <p className="text-sm text-neutral-500 mb-5">
          项目 <code className="font-mono bg-white border border-neutral-200 rounded px-1.5 py-0.5 text-xs">{id}</code> 不存在或已被删除。
        </p>
        <Link to="/library" className="btn-primary">返回全局文档库</Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 主组件：Shell 只承载「项目身份 + 导航 + 全局操作」，不含任何页面级操作
// ---------------------------------------------------------------------------
export default function ProjectLayout() {
  const { id } = useParams()
  const location = useLocation()

  const [project, setProject] = useState(null)
  const [team, setTeam] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const menuRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([fetchProject(id), fetchTeam(), fetchProjects()])
      .then(([proj, members, allProjs]) => {
        if (cancelled) return
        setProject(proj)
        setTeam(members || [])
        setProjects(allProjs || [])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  // 点击外部关闭项目下拉
  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  // Toast 自动消失
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  const tabs = [
    { to: 'browse',   label: '文档',    icon: FolderKanban },
    { to: 'activity', label: '项目动态', icon: Activity },
    { to: 'publish',  label: '发布配置', icon: Rocket },
  ]

  const topMembers = team.slice(0, 5)
  const otherProjects = projects.filter((p) => p.id !== id).slice(0, 3)

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-surface-subtle">
        <HeaderSkeleton />
        <div className="flex-1" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col h-screen bg-surface-subtle">
        <ProjectNotFound id={id} />
      </div>
    )
  }

  const sourceTag = sourceTypeTagMap[project.sourceType] || { cls: 'tag-neutral', label: project.sourceType }

  return (
    <div className="flex flex-col h-screen bg-surface-subtle animate-fade-up">
      {/* ===== Shell 栏：项目身份 + 主导航 + 全局操作（无页面级工具） ===== */}
      <header className="h-14 shrink-0 bg-white border-b border-neutral-200 flex items-center px-5 gap-3 z-20">
        {/* ① 项目身份：色彩图标 + 项目名下拉 */}
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${project.color || 'bg-primary-100'}`}
        >
          <span className="text-sm font-bold text-primary-700">
            {(project.name || '?').trim()[0]}
          </span>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="flex items-center gap-1 hover:bg-neutral-100 rounded-md px-1.5 py-1 -ml-1.5 transition-colors"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <h1 className="text-[15px] font-bold text-neutral-900 truncate max-w-[200px]">
              {project.name}
            </h1>
            <ChevronDown
              size={15}
              className={`text-neutral-400 transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-full mt-2 w-64 bg-white border border-neutral-200 rounded-lg shadow-lg py-2 z-30">
              <div className="px-3 py-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                切换项目
              </div>
              {otherProjects.length > 0 ? (
                otherProjects.map((p) => (
                  <Link
                    key={p.id}
                    to={`/project/${p.id}`}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
                    onClick={() => setMenuOpen(false)}
                  >
                    <div
                      className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${p.color || 'bg-primary-100'}`}
                    >
                      <span className="text-[10px] font-bold text-primary-700">
                        {(p.name || '?').trim()[0]}
                      </span>
                    </div>
                    <span className="truncate">{p.name}</span>
                  </Link>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-neutral-400">暂无其他项目</div>
              )}

              <div className="my-1 h-px bg-neutral-200" />

              <Link
                to="/library"
                className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <FolderKanban size={15} className="text-neutral-400" />
                <span>返回全局文档库</span>
              </Link>
            </div>
          )}
        </div>

        <span className={`${sourceTag.cls} shrink-0`}>{sourceTag.label}</span>

        {/* ② 主导航 tabs */}
        <nav className="flex items-center gap-0.5 ml-2">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={false}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-50 text-primary-700 font-semibold'
                      : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800'
                  }`
                }
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* ③ Spacer */}
        <div className="flex-1" />

        {/* ④ 全局操作：团队头像 + 文档数 + 分享 + 更多 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center -space-x-1.5">
            {topMembers.map((m) => (
              <Avatar key={m.id} member={m} />
            ))}
          </div>

          <span className="hidden md:inline-flex items-center gap-1 text-xs text-neutral-400">
            <FolderKanban size={12} />
            {project.docCount ?? 0} 篇文档
          </span>

          <button className="btn-secondary !h-8 !text-xs" type="button" onClick={() => setToast('项目链接已复制')}>
            <Share2 size={14} />
            分享
          </button>
          <button className="btn-ghost !h-8 !w-8 !p-0" type="button" aria-label="更多">
            <MoreHorizontal size={17} />
          </button>
        </div>
      </header>

      {/* ===== 内容区：子路由自带上下文工具（搜索/保存/筛选等都在内容侧） ===== */}
      <main key={location.pathname + location.search} className="flex-1 min-h-0 overflow-hidden animate-fade-up">
        <Outlet context={{ showToast: (msg) => setToast(msg) }} />
      </main>

      {toast && <HeaderToast message={toast} />}
    </div>
  )
}
