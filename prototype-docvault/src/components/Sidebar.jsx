import { useLocation, Link } from 'react-router-dom'
import {
  BookOpen,
  LayoutDashboard,
  FolderOpen,
  PenTool,
  GitBranch,
  Palette,
  Database,
  Users,
} from 'lucide-react'

const mainNav = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/library', label: '文档库', icon: FolderOpen },
  { path: '/editor', label: '编辑器', icon: PenTool },
  { path: '/versions', label: '版本管理', icon: GitBranch },
  { path: '/templates', label: '主题模板', icon: Palette },
]

const secondaryNav = [
  { path: '/sources', label: '数据源', icon: Database },
  { path: '/team', label: '团队设置', icon: Users },
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
        {items.map((item) => (
          <NavItem
            key={item.path}
            item={item}
            isActive={currentPath === item.path}
          />
        ))}
      </nav>
    </div>
  )
}

export default function Sidebar() {
  const location = useLocation()
  const currentPath = location.pathname

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
            <div className="text-xs text-neutral-400">文档与知识资产</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3">
        <NavGroup label="工作区" items={mainNav} currentPath={currentPath} />
        <NavGroup label="配置" items={secondaryNav} currentPath={currentPath} />
      </div>

      {/* Profile card */}
      <div className="px-3 pb-4 pt-3 border-t border-neutral-200">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-neutral-50 cursor-pointer">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-semibold">
            张
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-neutral-800 truncate">
              张明
            </div>
            <div className="text-xs text-neutral-400 truncate">
              Workspace Owner
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
