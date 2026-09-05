import { useLocation, Link } from 'react-router-dom'
import {
  BookOpen,
  LayoutDashboard,
  FolderKanban,
  Database,
  Users,
  Palette,
  Settings,
} from 'lucide-react'

// 全局管理视图的导航项
const mainNav = [
  { path: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { path: '/library',   label: '文档库', icon: FolderKanban },
  { path: '/themes',    label: '主题管理', icon: Palette },
]

const secondaryNav = [
  { path: '/sources',   label: '数据源',   icon: Database },
  { path: '/team',      label: '团队',     icon: Users },
  { path: '/settings',  label: '设置',     icon: Settings },
]

function NavItem({ item, isActive }) {
  const Icon = item.icon
  return (
    <Link
      to={item.path}
      className={`nav-item ${isActive ? 'active' : ''}`}
    >
      <Icon size={18} className="nav-icon" />
      <span>{item.label}</span>
    </Link>
  )
}

function NavGroup({ label, items, currentPath }) {
  return (
    <div className="mb-6">
      <div className="px-3 mb-2 text-[11px] font-semibold tracking-wider uppercase text-neutral-400">
        {label}
      </div>
      <nav className="space-y-1">
        {items.map((item) => {
          const isActive = item.path === currentPath
          return <NavItem key={item.path} item={item} isActive={isActive} />
        })}
      </nav>
    </div>
  )
}

export default function Sidebar() {
  const location = useLocation()
  const currentPath = location.pathname

  // 判断是否在项目聚焦视图下 —— 在项目视图时 Sidebar 隐藏，让 ProjectLayout 接管
  const inProjectView = currentPath.startsWith('/project/')
  if (inProjectView) return null

  return (
    <aside className="w-[248px] bg-white border-r border-neutral-200 flex flex-col fixed inset-y-0 left-0 z-30">
      {/* Logo area */}
      <div className="px-5 pt-5 pb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary-500 flex items-center justify-center">
            <BookOpen size={20} className="text-white" />
          </div>
          <div>
            <div className="text-base font-bold text-neutral-900 leading-tight">
              DocVault
            </div>
            <div className="text-xs text-neutral-400">全局管理视图</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3">
        <NavGroup label="工作区" items={mainNav} currentPath={currentPath} />
        <NavGroup label="配置" items={secondaryNav} currentPath={currentPath} />

        {/* 提示入口 */}
        <div className="px-3 pt-2">
          <Link to="/library" className="block px-3 py-3 rounded-lg bg-primary-50 border border-primary-100 hover:bg-primary-100 transition">
            <div className="text-xs font-semibold text-primary-700 mb-0.5">💡 进入项目聚焦</div>
            <div className="text-[11px] text-primary-600/70">在文档库中点击任一项目卡片即可进入专注管理</div>
          </Link>
        </div>
      </div>

      {/* Profile card */}
      <div className="px-3 pb-4 pt-3 border-t border-neutral-200">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-neutral-50 cursor-pointer">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-semibold">
            张
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-neutral-800 truncate">张明</div>
            <div className="text-xs text-neutral-400 truncate">Workspace Owner</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
