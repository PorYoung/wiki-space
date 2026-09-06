import { useState, useEffect, useRef, useMemo } from 'react'
import { Outlet, useParams, NavLink, Link, useLocation } from 'react-router-dom'
import {
  FolderKanban, Activity, Rocket, Share2, MoreHorizontal, ChevronDown,
  FolderOpen, Settings, Pencil, Trash2, ExternalLink, Users, UserCog,
  Network, Sun, Monitor, Moon,
  LayoutList, LayoutGrid, Clock, FileText,
  ChevronLeft, ChevronRight, Sparkles, History, MessageSquare,
} from 'lucide-react'
import { fetchProject, fetchTeam, fetchProjects, fetchActivities } from '../api/stubs.js'
import { useTheme } from '../context/ThemeContext.jsx'

// ---------------------------------------------------------------------------
// AppearanceToggle — 精简版单图标按钮（与 TopBar 共享设计）
// ---------------------------------------------------------------------------
function AppearanceToggle() {
  const { appearance, toggleAppearance } = useTheme()

  const meta = {
    light:  { Icon: Sun,    label: '亮色模式',   next: '暗色' },
    dark:   { Icon: Moon,   label: '暗色模式',   next: '跟随系统' },
    system: { Icon: Monitor,label: '跟随系统',   next: '亮色' },
  }[appearance] || { Icon: Sun, label: '亮色模式', next: '暗色' }

  const Icon = meta.Icon

  return (
    <button
      type="button"
      onClick={toggleAppearance}
      title={`${meta.label} · 点击切换到${meta.next}`}
      aria-label={`切换外观模式（当前：${meta.label}）`}
      className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-transparent text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-all duration-200"
    >
      <Icon size={16} className="transition-transform duration-300" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// 来源类型 → 颜色标签映射
// ---------------------------------------------------------------------------
const sourceTypeTagMap = {
  local:      { cls: 'tag-primary',  label: '本地源' },
  git:        { cls: 'tag-success',  label: 'Git 仓库' },
  database:   { cls: 'tag-success',  label: '数据库' },
}

// ---------------------------------------------------------------------------
// 右侧面板：tab 化（概览 / 动态 / 成员）+ 根据路由动态注入 AI助手/评论/历史
// 折叠按钮在面板自身的 header 上（不在顶部 header）
// ---------------------------------------------------------------------------
function ProjectRightSidebar({ project, team, activities, compact, onToggle }) {
  const location = useLocation()
  const [activeTab, setActiveTab] = useState('ai')  // browse 页默认 AI
  const [aiInput, setAiInput] = useState('')
  const [aiReply, setAiReply] = useState(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  const isBrowsePage = useMemo(() => location.pathname.includes('/browse'), [location.pathname])

  const baseTabs = [
    { id: 'overview', icon: FileText,    label: '概览' },
    { id: 'activity', icon: Activity,    label: '动态' },
    { id: 'members',  icon: Users,       label: '成员' },
  ]
  const collabTabs = [
    { id: 'ai',       icon: Sparkles,      label: 'AI助手' },
    { id: 'comments', icon: MessageSquare, label: '评论' },
    { id: 'history',  icon: History,       label: '历史' },
  ]

  // browse 页：collab 优先固定显示，base 收进下拉
  // 非 browse 页：只有 base，全固定显示
  const fixedTabs = isBrowsePage ? collabTabs : baseTabs
  const dropdownTabs = isBrowsePage ? baseTabs : []
  const allTabs = isBrowsePage ? [...collabTabs, ...baseTabs] : baseTabs

  // browse→非browse 时，如果当前 tab 是 collab 的要 reset
  useEffect(() => {
    if (!isBrowsePage && collabTabs.find(t => t.id === activeTab)) {
      setActiveTab('overview')
    }
  }, [location.pathname, isBrowsePage, activeTab])

  // 关闭下拉
  useEffect(() => {
    if (!dropdownOpen) return
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen])

  const recent = (activities || []).slice(0, 6)

  // Collapsed 竖条
  if (compact) {
    return (
      <aside className="w-10 shrink-0 h-full border-l border-neutral-200 bg-surface-subtle flex flex-col items-center py-2 gap-1 overflow-hidden">
        <button
          type="button"
          onClick={onToggle}
          title="展开右侧面板"
          className="h-6 w-6 inline-flex items-center justify-center rounded text-neutral-500 hover:text-primary-600 hover:bg-primary-50"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="w-4 h-px bg-neutral-200 my-1" />
        <div className="flex-1 flex flex-col items-center gap-1.5 overflow-hidden">
          {fixedTabs.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setActiveTab(id); onToggle() }}
              title={label}
              className={`h-6 w-6 rounded inline-flex items-center justify-center transition ${
                activeTab === id ? 'bg-primary-50 text-primary-600' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              <Icon size={12} />
            </button>
          ))}
          {dropdownTabs.length > 0 && (
            <button
              type="button"
              onClick={() => { setActiveTab(dropdownTabs[0].id); onToggle() }}
              title={dropdownTabs.find(t => t.id === activeTab)?.label || '更多'}
              className={`h-6 w-6 rounded inline-flex items-center justify-center transition ${
                dropdownTabs.find(t => t.id === activeTab) ? 'bg-primary-50 text-primary-600' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              <MoreHorizontal size={12} />
            </button>
          )}
        </div>
      </aside>
    )
  }

  const sendAI = (prompt) => {
    const q = prompt || aiInput.trim()
    if (!q) return
    setAiReply({
      question: q,
      answer: `我来帮你处理「${q}」。建议聚焦核心要点，保持每节 3-5 句话。`,
    })
    setAiInput('')
  }

  const mockComments = [
    { id: 'c-1', author: '林川', color: '#0ea5e9', text: '架构概览里提到的 MQTT QoS 1 能否加一段说明？', time: '2 小时前' },
    { id: 'c-2', author: '苏筱', color: '#ec4899', text: '整体写得很清晰！建议末尾加相关文档链接。', time: '8 小时前' },
  ]

  return (
    <aside className="w-72 shrink-0 h-full border-l border-neutral-200 bg-surface-subtle flex flex-col overflow-hidden animate-slide-in">
      {/* ---- 面板 Header：固定 tab + 可选「更多」下拉 + 折叠按钮 ---- */}
      <div className="shrink-0 h-11 bg-white border-b border-neutral-200 flex items-center">
        {/* 固定 tabs */}
        <div className="flex h-full overflow-x-auto scrollbar-thin">
          {fixedTabs.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`px-3 h-full inline-flex items-center justify-center gap-1 text-[12px] font-medium transition border-b-2 whitespace-nowrap ${
                activeTab === id
                  ? 'text-primary-700 border-primary-500 bg-primary-50/40'
                  : 'text-neutral-500 border-transparent hover:text-neutral-800 hover:bg-neutral-50'
              }`}
            >
              <Icon size={13} className="shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* 「更多」下拉（browse 页才出现） */}
        {dropdownTabs.length > 0 && (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              title="更多"
              className={`h-full px-2.5 inline-flex items-center justify-center border-b-2 transition ${
                dropdownTabs.find(t => t.id === activeTab)
                  ? 'text-primary-700 border-primary-500 bg-primary-50/40'
                  : dropdownOpen
                    ? 'text-neutral-700 border-neutral-300 bg-neutral-50'
                    : 'text-neutral-500 border-transparent hover:text-neutral-800 hover:bg-neutral-50'
              }`}
            >
              <MoreHorizontal size={14} />
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-40 bg-white border border-neutral-200 rounded-lg shadow-lg py-1.5 z-30 animate-fade-up">
                {dropdownTabs.map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => { setActiveTab(id); setDropdownOpen(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] transition ${
                      activeTab === id
                        ? 'text-primary-700 bg-primary-50 font-medium'
                        : 'text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    <Icon size={13} className="shrink-0" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* 折叠按钮 */}
        <button
          type="button"
          onClick={onToggle}
          title="折叠右侧面板"
          className="shrink-0 h-6 w-6 inline-flex items-center justify-center mx-1 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* ---- Tab 内容 ---- */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {activeTab === 'overview' && (
          <div className="px-4 py-4 space-y-5">
            <section>
              <h4 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">统计</h4>
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="文档" value={project?.docCount ?? 0} icon={FileText} tone="primary" />
                <StatTile label="成员" value={team?.length ?? 0} icon={Users} tone="emerald" />
                <StatTile label="动态" value={activities?.length ?? 0} icon={Activity} tone="sky" />
                <StatTile label="源" value={sourceTypeTagMap[project?.sourceType]?.label || '-'} icon={FolderKanban} tone="violet" isText />
              </div>
            </section>
            {team && team.length > 0 && (
              <section>
                <h4 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">成员 ({team.length})</h4>
                <ul className="space-y-1.5">
                  {team.slice(0, 5).map((m) => (
                    <li key={m.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-neutral-100 transition-colors cursor-pointer">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                        style={{ backgroundColor: m.avatarColor || '#6b7280' }}
                      >
                        {(m.name || '?').trim()[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-neutral-700 truncate">{m.name}</div>
                        <div className="text-[10px] text-neutral-400 truncate">{m.role || '成员'}</div>
                      </div>
                      {m.online && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="px-4 py-4">
            <h4 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Clock size={10} /> 最新动态
            </h4>
            <ul className="space-y-2.5">
              {recent.length === 0 && (
                <li className="text-xs text-neutral-400 text-center py-4">暂无动态</li>
              )}
              {recent.map((a, i) => (
                <li key={i} className="group relative pl-4">
                  <span className="absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full bg-primary-400 ring-2 ring-primary-100" />
                  <div className="text-xs text-neutral-700 leading-relaxed">
                    <span className="font-medium text-neutral-800">{a.actor || '系统'}</span>{' '}
                    <span className="text-neutral-500">{a.action || a.type || '更新了'}</span>{' '}
                    {a.target && <span className="font-medium text-primary-600">「{a.target}」</span>}
                  </div>
                  <div className="text-[10px] text-neutral-400 mt-0.5">{a.time || a.timestamp || '刚刚'}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {activeTab === 'members' && (
          <div className="px-4 py-4">
            <h4 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3">全部成员</h4>
            {(!team || team.length === 0) && <div className="text-xs text-neutral-400 text-center py-4">暂无成员</div>}
            <ul className="space-y-1.5">
              {team.map((m) => (
                <li key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-neutral-100 transition-colors cursor-pointer">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                    style={{ backgroundColor: m.avatarColor || '#6b7280' }}
                  >
                    {(m.name || '?').trim()[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-neutral-700 truncate">{m.name}</div>
                    <div className="text-[10px] text-neutral-400 truncate">{m.role || '成员'}</div>
                  </div>
                  {m.online && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />}
                </li>
              ))}
            </ul>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto scrollbar-thin">
              <div className="rounded-lg bg-primary-50 border border-primary-100 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary-700 mb-1">
                  <Sparkles size={11} /> AI 助手
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  我可以帮你总结文档、优化段落、翻译英文、生成代码示例。
                </p>
              </div>

              {aiReply && (
                <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2">
                  <div className="text-[11px] text-neutral-400">你的问题</div>
                  <div className="text-xs text-neutral-700 font-medium">{aiReply.question}</div>
                  <div className="border-t border-neutral-100 pt-2 text-xs text-neutral-700 whitespace-pre-wrap leading-relaxed">
                    {aiReply.answer}
                  </div>
                </div>
              )}

              {!aiReply && (
                <div className="space-y-2">
                  {['总结文档', '优化段落', '翻译为英文'].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => sendAI(chip)}
                      className="w-full text-left text-xs px-3 py-2 rounded-md border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 transition"
                    >
                      ✨ {chip}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="shrink-0 px-3 py-2 border-t border-neutral-200 bg-white">
              <form
                onSubmit={(e) => { e.preventDefault(); sendAI() }}
                className="flex items-center gap-1.5"
              >
                <input
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder="问点什么…"
                  className="flex-1 min-w-0 h-8 px-2.5 rounded-md border border-neutral-200 bg-white text-xs text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:border-primary-300"
                />
                <button
                  type="submit"
                  className="h-8 w-8 inline-flex items-center justify-center rounded-md bg-primary-600 text-white hover:bg-primary-700 transition"
                  title="发送"
                >
                  <span className="text-xs">→</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'comments' && (
          <div className="px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">评论 ({mockComments.length})</h4>
              <button className="text-[11px] text-primary-600 hover:text-primary-700 font-medium">+ 新增</button>
            </div>
            <ul className="space-y-3">
              {mockComments.map((c) => (
                <li key={c.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                      style={{ backgroundColor: c.color }}
                    >
                      {c.author[0]}
                    </div>
                    <div className="text-xs font-medium text-neutral-800">{c.author}</div>
                    <div className="text-[10px] text-neutral-400">{c.time}</div>
                  </div>
                  <p className="text-xs text-neutral-700 leading-relaxed">{c.text}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="px-4 py-4">
            <h4 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3">文档版本历史</h4>
            <ul className="space-y-1">
              {[
                { v: 'v1.4', time: '今天 14:22', who: '林川', note: '补充 QoS 段落' },
                { v: 'v1.3', time: '昨天 10:05', who: '苏筱', note: '术语表调整' },
                { v: 'v1.2', time: '2 天前',   who: '林川', note: '新增架构图' },
                { v: 'v1.1', time: '1 周前',   who: '系统',  note: '自动初始化' },
              ].map((h, i) => (
                <li key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-100 transition cursor-pointer">
                  <History size={12} className="text-neutral-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-neutral-700 truncate">{h.note}</div>
                    <div className="text-[10px] text-neutral-400">{h.v} · {h.time} · {h.who}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Stat tile inside right sidebar
// ---------------------------------------------------------------------------
function StatTile({ label, value, icon: Icon, tone = 'primary', isText = false }) {
  const toneMap = {
    primary: { bg: 'bg-primary-50', fg: 'text-primary-600' },
    emerald: { bg: 'bg-emerald-50', fg: 'text-emerald-600' },
    sky:     { bg: 'bg-sky-50',     fg: 'text-sky-600' },
    violet:  { bg: 'bg-violet-50',  fg: 'text-violet-600' },
  }
  const c = toneMap[tone] || toneMap.primary
  return (
    <div className={`rounded-lg border border-neutral-200 bg-white px-2.5 py-2 ${isText ? 'col-span-2' : ''}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <div className={`w-4 h-4 rounded ${c.bg} flex items-center justify-center`}>
          <Icon size={10} className={c.fg} />
        </div>
        <span className="text-[10px] text-neutral-500 font-medium">{label}</span>
      </div>
      <div className={`text-sm font-bold text-neutral-800 ${isText ? 'text-xs' : ''}`}>{value}</div>
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
// 骨架屏
// ---------------------------------------------------------------------------
function HeaderSkeleton() {
  return (
    <div className="h-14 px-6 flex items-center gap-3 bg-white border-b border-neutral-200">
      <div className="skeleton h-9 w-9 rounded-lg" />
      <div className="skeleton h-5 w-36 rounded" />
      <div className="flex-1" />
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
// 主组件
// ---------------------------------------------------------------------------
export default function ProjectLayout() {
  const { id } = useParams()
  const location = useLocation()

  const [project, setProject] = useState(null)
  const [team, setTeam] = useState([])
  const [projects, setProjects] = useState([])
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [toast, setToast] = useState(null)

  // 布局状态：navLayout 'top' | 'side'；左侧 nav 折叠；右侧面板折叠
  const [navLayout, setNavLayout] = useState('top')
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)

  const menuRef = useRef(null)
  const moreMenuRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([fetchProject(id), fetchTeam(), fetchProjects(), fetchActivities()])
      .then(([proj, members, allProjs, acts]) => {
        if (cancelled) return
        setProject(proj)
        setTeam(members || [])
        setProjects(allProjs || [])
        setActivities(acts || [])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    if (!menuOpen && !moreMenuOpen) return
    function handleClick(e) {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
      if (moreMenuOpen && moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setMoreMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen, moreMenuOpen])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  const tabs = [
    { to: 'browse',   label: '文档',    icon: FolderKanban },
    { to: 'graph',    label: '图谱',    icon: Network },
    { to: 'activity', label: '动态',    icon: Activity },
    { to: 'publish',  label: '发布',    icon: Rocket },
    { to: 'members',  label: '成员',    icon: Users },
    { to: 'settings', label: '设置',    icon: UserCog },
  ]

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

  // Header 左半部分
  const projectIdentity = (
    <>
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
            <div className="px-3 py-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide">切换项目</div>
            {otherProjects.length > 0 ? (
              otherProjects.map((p) => (
                <Link
                  key={p.id}
                  to={`/project/${p.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                  onClick={() => setMenuOpen(false)}
                >
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center ${p.color || 'bg-primary-100'}`}>
                    <span className="text-[10px] font-bold text-primary-700">{(p.name || '?').trim()[0]}</span>
                  </div>
                  <span className="truncate">{p.name}</span>
                </Link>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-neutral-400">暂无其他项目</div>
            )}
            <div className="my-1 h-px bg-neutral-200" />
            <Link to="/library" className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50" onClick={() => setMenuOpen(false)}>
              <FolderKanban size={15} className="text-neutral-400" />
              <span>返回全局文档库</span>
            </Link>
          </div>
        )}
      </div>

      <span className={`${sourceTag.cls} shrink-0`}>{sourceTag.label}</span>
    </>
  )

  const moreMenu = (
    <div className="relative" ref={moreMenuRef}>
      <button
        className={`btn-ghost !h-8 !w-8 !p-0 ${moreMenuOpen ? 'bg-neutral-100 text-primary-600' : ''}`}
        type="button"
        aria-label="更多"
        onClick={() => setMoreMenuOpen((v) => !v)}
      >
        <MoreHorizontal size={17} />
      </button>
      {moreMenuOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-neutral-200 rounded-lg shadow-lg py-2 z-30 animate-fade-up">
          <button onClick={() => { setMoreMenuOpen(false); setToast('已复制项目链接') }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
            <ExternalLink size={14} className="text-neutral-400" /> 访问发布网站
          </button>
          <div className="my-1 h-px bg-neutral-200" />
          <button onClick={() => { setMoreMenuOpen(false); setToast('重命名项目功能演示') }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
            <Pencil size={14} className="text-neutral-400" /> 重命名项目
          </button>
          <button onClick={() => { setMoreMenuOpen(false); setToast('删除项目功能演示') }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            <Trash2 size={14} /> 删除项目
          </button>
        </div>
      )}
    </div>
  )

  // 导航 tabs 垂直/水平复用
  function renderTabs() {
    return tabs.map((tab) => {
      const Icon = tab.icon
      return (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={false}
          className={({ isActive }) =>
            `inline-flex items-center rounded-md text-sm font-medium transition-colors ${
              navLayout === 'top'
                ? `gap-1.5 px-3 py-1.5 ${isActive ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800'}`
                : navCollapsed
                  ? `gap-0 w-full h-9 justify-center ${isActive ? 'bg-primary-50 text-primary-700' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800'}`
                  : `gap-2 px-2.5 py-2 w-full ${isActive ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800'}`
            }`
          }
          title={navLayout === 'side' && navCollapsed ? tab.label : undefined}
        >
          <Icon size={navLayout === 'side' ? 16 : 15} className="shrink-0" />
          {!(navLayout === 'side' && navCollapsed) && <span>{tab.label}</span>}
        </NavLink>
      )
    })
  }

  return (
    <div className="flex flex-col h-screen bg-surface-subtle animate-fade-up">
      {/* ===== Header ===== */}
      <header className="h-14 shrink-0 bg-white border-b border-neutral-200 flex items-center px-5 gap-3 z-20">
        {projectIdentity}

        {/* Top 模式：水平 tabs */}
        {navLayout === 'top' && (
          <nav className="flex items-center gap-0.5 ml-2">{renderTabs()}</nav>
        )}

        <div className="flex-1" />

        {/* 导航布局切换（顶部 ↔ 侧边） */}
        <div className="inline-flex items-center rounded-md border border-neutral-200 bg-neutral-50 p-0.5" title="切换导航布局">
          <button type="button" onClick={() => setNavLayout('top')} className={`flex items-center px-1.5 py-1 rounded transition ${navLayout === 'top' ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`} title="顶部导航">
            <LayoutList size={12} />
          </button>
          <button type="button" onClick={() => setNavLayout('side')} className={`flex items-center px-1.5 py-1 rounded transition ${navLayout === 'side' ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`} title="侧边导航">
            <LayoutGrid size={12} />
          </button>
        </div>

        <AppearanceToggle />

        <div className="flex items-center gap-2">
          <button className="btn-secondary !h-8 !text-xs" type="button" onClick={() => setToast('项目链接已复制')}>
            <Share2 size={14} />
            <span className="hidden sm:inline">分享</span>
          </button>
          {moreMenu}
        </div>
      </header>

      {/* ===== Body ===== */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Side 模式：左侧垂直导航（可折叠） */}
        {navLayout === 'side' && (
          <nav className={`shrink-0 h-full border-r border-neutral-200 bg-surface-subtle flex flex-col overflow-hidden transition-[width] duration-200 ${navCollapsed ? 'w-14' : 'w-48'}`}>
            {/* nav 自身 header（含折叠按钮） */}
            <div className="shrink-0 h-11 px-2 flex items-center justify-between border-b border-neutral-200 bg-white">
              {!navCollapsed && (
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold pl-1">项目导航</span>
              )}
              <button
                type="button"
                onClick={() => setNavCollapsed((v) => !v)}
                title={navCollapsed ? '展开导航' : '折叠导航'}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 ml-auto"
              >
                {navCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
            </div>
            <div className="flex-1 py-2 px-1.5 space-y-0.5 overflow-y-auto scrollbar-thin">
              {renderTabs()}
            </div>
          </nav>
        )}

        {/* 主内容区 */}
        <main key={location.pathname + location.search} className="flex-1 min-w-0 overflow-hidden animate-fade-up">
          <Outlet context={{ showToast: (msg) => setToast(msg) }} />
        </main>

        {/* 右侧面板（折叠按钮在面板自身 header，不在顶部 header） */}
        <ProjectRightSidebar
          project={project}
          team={team}
          activities={activities}
          compact={!rightPanelOpen}
          onToggle={() => setRightPanelOpen((v) => !v)}
        />
      </div>

      {toast && <HeaderToast message={toast} />}
    </div>
  )
}
