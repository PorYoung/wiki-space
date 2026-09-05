import { useState, useRef, useEffect } from 'react'
import { useLocation, Link, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  LayoutDashboard,
  FolderKanban,
  Database,
  Palette,
  Settings,
  ChevronUp,
  User,
  LogOut,
  CreditCard,
  HelpCircle,
  Bell,
  Users,
  Sparkles,
} from 'lucide-react'

// 全局管理视图的导航项
const mainNav = [
  { path: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { path: '/library',   label: '文档库', icon: FolderKanban },
  { path: '/themes',    label: '主题管理', icon: Palette },
]

const secondaryNav = [
  { path: '/sources',   label: '数据源',   icon: Database },
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

// ---------------------------------------------------------------------------
// User Menu Dropdown
// ---------------------------------------------------------------------------

function UserMenu({ onClose }) {
  const navigate = useNavigate()

  const menuSections = [
    {
      items: [
        { icon: User,     label: '个人资料',       desc: '编辑头像与个人信息', action: () => { onClose(); navigate('/settings') } },
        { icon: Bell,     label: '通知偏好',       desc: '管理提醒频率',       action: () => { onClose(); navigate('/settings') } },
        { icon: Settings, label: '工作区设置',     desc: '通用偏好与外观',     action: () => { onClose(); navigate('/settings') } },
      ],
    },
    {
      items: [
        { icon: Users,      label: '切换工作区',     desc: '加入的 3 个工作区', action: () => onClose() },
        { icon: Sparkles,   label: '升级 Pro',       desc: '更多高级功能',     action: () => onClose() },
        { icon: CreditCard, label: '账单与订阅',     desc: '查看用量与发票',   action: () => onClose() },
      ],
    },
    {
      items: [
        { icon: HelpCircle, label: '帮助中心',       desc: '文档与社区支持',   action: () => onClose() },
        { icon: LogOut,     label: '退出登录',       desc: '安全退出当前账户', action: () => onClose(), danger: true },
      ],
    },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 bottom-full mb-2 w-[260px] bg-white border border-neutral-200 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-up">
        {/* User header */}
        <div className="px-4 py-3 border-b border-neutral-100 bg-gradient-to-br from-primary-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-semibold">
              张
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-neutral-900 truncate">张明</div>
              <div className="text-xs text-neutral-500 truncate">Workspace Owner · Pro</div>
            </div>
          </div>
        </div>

        {/* Menu sections */}
        {menuSections.map((section, si) => (
          <div key={si} className={si > 0 ? 'border-t border-neutral-100' : ''}>
            {section.items.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.label}
                  onClick={item.action}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-neutral-50 ${
                    item.danger ? 'hover:bg-danger/5' : ''
                  }`}
                >
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                    item.danger ? 'bg-danger/10 text-danger' : 'bg-neutral-100 text-neutral-600'
                  }`}>
                    <Icon size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${
                      item.danger ? 'text-danger' : 'text-neutral-800'
                    }`}>{item.label}</div>
                    <div className="text-[11px] text-neutral-500 truncate">{item.desc}</div>
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export default function Sidebar() {
  const location = useLocation()
  const currentPath = location.pathname
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef(null)

  // 判断是否在项目聚焦视图下 —— 在项目视图时 Sidebar 隐藏，让 ProjectLayout 接管
  const inProjectView = currentPath.startsWith('/project/')
  if (inProjectView) return null

  // Close menu on click outside
  useEffect(() => {
    function handleClick(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

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

      {/* Profile card — clickable with menu */}
      <div className="px-3 pb-3 pt-3 border-t border-neutral-200">
        <div ref={userMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-neutral-50 cursor-pointer transition-colors text-left"
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-semibold shrink-0">
              张
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-neutral-800 truncate">张明</div>
              <div className="text-xs text-neutral-400 truncate">Workspace Owner</div>
            </div>
            <ChevronUp
              size={16}
              className={`text-neutral-400 shrink-0 transition-transform duration-200 ${
                userMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
          {userMenuOpen && <UserMenu onClose={() => setUserMenuOpen(false)} />}
        </div>
      </div>
    </aside>
  )
}
