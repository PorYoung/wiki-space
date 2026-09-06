import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import {
  ChevronRight,
  Search,
  Bell,
  SquarePen,
  Settings,
  X,
  ExternalLink,
  MessageSquare,
  GitBranch,
  FolderOpen,
  BookOpen,
  Palette,
  Users,
  Database,
  FileText,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react'
import { fetchActivities, fetchDocuments } from '../api/stubs.js'
import { useTheme } from '../context/ThemeContext.jsx'

const routeLabels = {
  '/dashboard': '仪表盘',
  '/library': '文档库',
  '/sources': '数据源',
  '/team': '团队',
  '/themes': '主题模板',
  '/settings': '设置',
}

function IconButton({ icon: Icon, tooltip, hasBadge = false, onClick, active }) {
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        className={`relative p-2 rounded-md transition ${
          active ? 'bg-neutral-100 text-primary-600' : 'hover:bg-neutral-100 text-neutral-600'
        }`}
      >
        <Icon size={18} />
        {hasBadge && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
        )}
      </button>
      {tooltip && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-1 text-xs text-white bg-neutral-800 rounded whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition z-50">
          {tooltip}
          <span className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-neutral-800 rotate-45" />
        </div>
      )}
    </div>
  )
}

function Breadcrumb({ pathname }) {
  // Handle project routes like /project/p-001/browse
  if (pathname.startsWith('/project/')) {
    const parts = pathname.split('/').filter(Boolean)
    const projectId = parts[1]
    const subTab = parts[2]
    const subTabLabels = { browse: '文档浏览', activity: '项目动态', publish: '发布配置' }

    return (
      <nav className="flex items-center gap-1 text-sm">
        <Link to="/library" className="text-neutral-400 hover:text-neutral-700 transition">
          文档库
        </Link>
        <ChevronRight size={14} className="text-neutral-300" />
        <span className="text-neutral-500 font-mono text-xs">{projectId}</span>
        {subTab && (
          <>
            <ChevronRight size={14} className="text-neutral-300" />
            <span className="text-neutral-900 font-medium">
              {subTabLabels[subTab] || subTab}
            </span>
          </>
        )}
      </nav>
    )
  }

  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((seg) => ({
      key: seg,
      label: routeLabels[`/${seg}`] || seg,
    }))

  return (
    <nav className="flex items-center gap-1 text-sm">
      {segments.length === 0 ? (
        <span className="text-neutral-500">首页</span>
      ) : (
        segments.map((seg, idx) => (
          <div key={seg.key} className="flex items-center gap-1">
            {idx > 0 && (
              <ChevronRight size={14} className="text-neutral-300" />
            )}
            <span
              className={
                idx === segments.length - 1
                  ? 'text-neutral-900 font-medium'
                  : 'text-neutral-400'
              }
            >
              {seg.label}
            </span>
          </div>
        ))
      )}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Notification Dropdown
// ---------------------------------------------------------------------------

const NOTIFICATION_ICONS = {
  评论: MessageSquare,
  同步: GitBranch,
  发布: ExternalLink,
  编辑: FileText,
  新增: FolderOpen,
}

function NotificationDropdown({ activities, onClose }) {
  const notifications = activities.slice(0, 5)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-neutral-200 rounded-lg shadow-xl z-50 overflow-hidden animate-fade-up">
        <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-primary-600" />
            <span className="text-sm font-semibold text-neutral-900">通知中心</span>
          </div>
          <button
            className="p-1 rounded hover:bg-neutral-100 text-neutral-400"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-400">
              暂无通知
            </div>
          ) : (
            notifications.map((item, i) => {
              // Determine icon based on action content
              let Icon = FileText
              const action = item.action || ''
              if (action.includes('评论')) Icon = MessageSquare
              else if (action.includes('同步')) Icon = GitBranch
              else if (action.includes('发布') || action.includes('PR') || action.includes('MR')) Icon = ExternalLink
              else if (action.includes('新增')) Icon = FolderOpen

              return (
                <div
                  key={item.id}
                  className="px-4 py-3 hover:bg-neutral-50 cursor-pointer border-b border-neutral-50 last:border-0 transition-colors"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
                      <Icon size={14} className="text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-700 leading-snug">
                        <span className="font-medium text-neutral-900">{item.actor}</span>
                        <span className="text-neutral-500"> {item.action}</span>
                        <span className="font-medium text-primary-600">{item.target}</span>
                      </p>
                      <p className="text-[11px] text-neutral-400 mt-0.5">刚刚</p>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-neutral-100 bg-neutral-50 text-center">
          <button className="text-xs text-primary-600 hover:text-primary-700 font-medium">
            查看全部通知
          </button>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Quick Create Dropdown
// ---------------------------------------------------------------------------

function QuickCreateDropdown({ onClose }) {
  const navigate = useNavigate()

  const options = [
    { icon: FileText, label: '新建文档', desc: '在当前项目中创建 Markdown 文档', action: () => { onClose(); navigate('/library') } },
    { icon: FolderOpen, label: '新建文档库', desc: '创建一个新的知识库项目', action: () => { onClose(); navigate('/library') } },
    { icon: Database, label: '添加数据源', desc: '从 Git / 本地 / 网页连接源', action: () => { onClose(); navigate('/sources') } },
    { icon: Users, label: '邀请成员', desc: '添加协作者到你的团队', action: () => { onClose(); navigate('/team') } },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-neutral-200 rounded-lg shadow-xl z-50 overflow-hidden animate-fade-up">
        <div className="px-4 py-3 border-b border-neutral-100">
          <span className="text-sm font-semibold text-neutral-900">快速创建</span>
        </div>
        <div className="py-1">
          {options.map((opt, i) => {
            const Icon = opt.icon
            return (
              <button
                key={opt.label}
                onClick={opt.action}
                className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-neutral-50 text-left transition-colors"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="w-8 h-8 rounded-md bg-neutral-100 flex items-center justify-center shrink-0">
                  <Icon size={14} className="text-neutral-600" />
                </div>
                <div>
                  <div className="text-sm font-medium text-neutral-800">{opt.label}</div>
                  <div className="text-[11px] text-neutral-500 mt-0.5">{opt.desc}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// AppearanceToggle — 精简版单图标按钮
// 点击循环切换：light → dark → system → light
// 图标跟随当前状态：亮=☀️Sun / 暗=🌙Moon / 系统=🖥️Monitor
// ---------------------------------------------------------------------------
function AppearanceToggle({ compact = false }) {
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
      className={
        'inline-flex items-center justify-center rounded-md transition-all duration-200 ' +
        'border border-transparent ' +
        compact
          ? 'h-8 w-8 hover:bg-neutral-100 text-neutral-500 hover:text-neutral-800'
          : 'h-8 w-8 hover:bg-neutral-100 text-neutral-500 hover:text-neutral-800'
      }
    >
      <Icon size={16} className="transition-transform duration-300" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main TopBar
// ---------------------------------------------------------------------------

export default function TopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { appearance, toggleAppearance } = useTheme()
  const [notifOpen, setNotifOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [activities, setActivities] = useState([])
  const notifRef = useRef(null)
  const createRef = useRef(null)

  useEffect(() => {
    fetchActivities().then(setActivities)
  }, [])

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
      if (createRef.current && !createRef.current.contains(e.target)) setCreateOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <header className="h-14 bg-white border-b border-neutral-200 flex items-center justify-between px-6 sticky top-0 z-20">
      {/* Left: Breadcrumb */}
      <Breadcrumb pathname={location.pathname} />

      {/* Center: Search */}
      <div className="relative w-[360px]">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
        />
        <input
          type="text"
          placeholder="搜索文档、项目、团队..."
          className="w-full h-9 pl-9 pr-3 rounded-md border border-neutral-200 bg-neutral-50 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 focus:bg-white transition"
        />
      </div>

      {/* Right: Icon buttons */}
      <div className="flex items-center gap-1">
        {/* ===== Appearance toggle (single icon, click to cycle: light → dark → system → light) ===== */}
        <AppearanceToggle />


        <div className="w-px h-6 bg-neutral-200 mx-1" />

        <div ref={notifRef} className="relative">
          <IconButton
            icon={Bell}
            tooltip="通知"
            hasBadge
            onClick={() => { setCreateOpen(false); setNotifOpen((v) => !v) }}
            active={notifOpen}
          />
          {notifOpen && (
            <NotificationDropdown
              activities={activities}
              onClose={() => setNotifOpen(false)}
            />
          )}
        </div>

        <div ref={createRef} className="relative">
          <IconButton
            icon={SquarePen}
            tooltip="快速创建"
            onClick={() => { setNotifOpen(false); setCreateOpen((v) => !v) }}
            active={createOpen}
          />
          {createOpen && (
            <QuickCreateDropdown onClose={() => setCreateOpen(false)} />
          )}
        </div>

        <div className="w-px h-6 bg-neutral-200 mx-1" />

        <IconButton
          icon={Settings}
          tooltip="设置"
          onClick={() => navigate('/settings')}
        />
      </div>
    </header>
  )
}
