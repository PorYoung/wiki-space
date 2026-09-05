import { useLocation } from 'react-router-dom'
import {
  ChevronRight,
  Search,
  Bell,
  SquarePen,
  Settings,
} from 'lucide-react'

const routeLabels = {
  '/dashboard': '仪表盘',
  '/library': '文档库',
  '/editor': '编辑器',
  '/versions': '版本管理',
  '/templates': '主题模板',
  '/sources': '数据源',
  '/team': '团队设置',
}

function IconButton({ icon: Icon, tooltip, hasBadge = false }) {
  return (
    <div className="relative group">
      <button
        type="button"
        className="relative p-2 rounded-md hover:bg-neutral-100 transition"
      >
        <Icon size={18} className="text-neutral-600" />
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

export default function TopBar() {
  const location = useLocation()

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
        <IconButton icon={Bell} tooltip="通知" hasBadge />
        <IconButton icon={SquarePen} tooltip="新建文档" />
        <IconButton icon={Settings} tooltip="设置" />
      </div>
    </header>
  )
}
