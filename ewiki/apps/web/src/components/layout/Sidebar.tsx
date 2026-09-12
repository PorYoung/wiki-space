import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, FolderKanban, Palette,
  ChevronUp, User as UserIcon, LogOut, BookOpen, Bell, Users, HardDrive, ShieldCheck, Settings,
} from 'lucide-react';
import { apiFetch, tokenStore } from '../../lib/api/client';
import type { User as EwikiUser } from '@ewiki/shared';

// 迁移自 prototype Sidebar.jsx（TS 化；商业化入口按 PRD 4.1 移除）

const mainNav = [
  { path: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { path: '/library', label: '文档库', icon: FolderKanban },
  { path: '/themes', label: '主题管理', icon: Palette },
];
// 「配置」组：存储源（Git 连接等用户级凭据）/ 团队 / 设置
const secondaryNav = [
  { path: '/connections', label: '存储源', icon: HardDrive },
  { path: '/team', label: '团队', icon: Users },
  { path: '/settings', label: '设置', icon: Settings },
];

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof HardDrive }): React.ReactElement {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
      <Icon size={18} className="nav-icon" />
      <span>{label}</span>
    </NavLink>
  );
}

function NavGroup({ label, items }: { label: string; items: typeof mainNav }): React.ReactElement {
  return (
    <div className="mb-6">
      <div className="px-3 mb-2 text-[11px] font-semibold tracking-wider uppercase text-neutral-400">{label}</div>
      <nav className="space-y-1">
        {items.map((item) => (
          <NavItem key={item.path} to={item.path} label={item.label} icon={item.icon} />
        ))}
      </nav>
    </div>
  );
}

function UserMenu({ onClose, user }: { onClose: () => void; user: EwikiUser | null }): React.ReactElement {
  const navigate = useNavigate();
  const items = [
    { icon: UserIcon, label: '个人资料', desc: '编辑头像与个人信息', to: '/settings' },
    { icon: Bell, label: '通知偏好', desc: '管理提醒频率', to: '/settings' },
    { icon: Settings, label: '偏好设置', desc: '通用偏好与外观', to: '/settings' },
  ];
  const initial = (user?.name ?? '?').slice(0, 1);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 bottom-full mb-2 w-[260px] rounded-xl border shadow-xl z-50 overflow-hidden animate-fade-up"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
        {/* User header：渐变头 + 渐变底（对齐原型 Sidebar.jsx:93-105） */}
        <div className="border-b px-4 py-3" style={{ background: 'linear-gradient(135deg, var(--color-primary-50), var(--bg-surface))', borderColor: 'var(--border-soft)' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, var(--color-primary-400), var(--color-primary-600))' }}>
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{user?.name ?? '未登录'}</div>
              <div className="truncate text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{user?.email ?? ''}</div>
            </div>
          </div>
        </div>
        {items.map(({ icon: Icon, label, desc, to }) => (
          <button key={label} type="button" onClick={() => { onClose(); navigate(to); }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-neutral-50">
            {/* 菜单图标 w-8 h-8 容器（对齐原型 Sidebar.jsx:120-124） */}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">
              <Icon size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{label}</div>
              <div className="truncate text-[11px]" style={{ color: 'var(--text-muted, #64748b)' }}>{desc}</div>
            </div>
          </button>
        ))}
        <div className="border-t" style={{ borderColor: 'var(--border-soft)' }}>
          <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-danger hover:bg-red-50"
            onClick={() => { onClose(); tokenStore.clear(); navigate('/login'); }}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-danger/10 text-danger">
              <LogOut size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">退出登录</div>
              <div className="text-[11px]" style={{ color: 'var(--text-muted, #64748b)' }}>安全退出当前账户</div>
            </div>
          </button>
        </div>
      </div>
    </>
  );
}

export function Sidebar(): React.ReactElement {
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<EwikiUser>('/api/v1/me') });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const initial = (me?.name ?? '?').slice(0, 1);

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
      <div className="px-5 pt-5 pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ background: 'var(--color-primary-500)' }}>
            <BookOpen size={20} />
          </div>
          <div>
            <div className="text-base font-bold leading-tight">ewiki</div>
            <div className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>文档知识管理平台</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-3">
        <NavGroup label="导航" items={mainNav} />
        <NavGroup label="配置" items={secondaryNav} />
        {me?.globalRole === 'admin' && (
          <div className="mb-6">
            <div className="px-3 mb-2 text-[11px] font-semibold tracking-wider uppercase text-neutral-400">平台</div>
            <nav className="space-y-1">
              <NavLink to="/admin" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <ShieldCheck size={18} className="nav-icon" />
                <span>系统管理</span>
              </NavLink>
            </nav>
          </div>
        )}
        <div className="px-3 pt-2">
          <NavLink to="/library" className="block rounded-lg border border-primary-100 bg-primary-50 px-3 py-3 transition-colors hover:opacity-90">
            {/* 💡 前缀（对齐原型 Sidebar.jsx:191） */}
            <div className="mb-0.5 text-xs font-semibold text-primary-700">💡 进入项目聚焦</div>
            <div className="text-[11px] text-primary-600">在文档库中点击任一项目卡片即可进入专注管理</div>
          </NavLink>
        </div>
      </div>

      <div className="border-t px-3 pb-3 pt-3" style={{ borderColor: 'var(--border-soft)' }}>
        <div ref={userMenuRef} className="relative">
          <button type="button" onClick={() => setUserMenuOpen((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-neutral-50">
            {/* 渐变头像（对齐原型 Sidebar.jsx:205 from-primary-400 → primary-600） */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, var(--color-primary-400), var(--color-primary-600))' }}>
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{me?.name ?? '加载中…'}</div>
              <div className="truncate text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{me?.email ?? ''}</div>
            </div>
            <ChevronUp size={16} className={`shrink-0 transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {userMenuOpen && <UserMenu onClose={() => setUserMenuOpen(false)} user={me ?? null} />}
        </div>
      </div>
    </aside>
  );
}
