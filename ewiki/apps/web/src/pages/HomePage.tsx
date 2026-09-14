import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search, Bell, FolderOpen, FileText, Clock, ArrowRight, Sparkles,
  LogOut, User, Settings as SettingsIcon,
} from 'lucide-react';
import { apiFetch, tokenStore, decodeAccessToken } from '../lib/api/client';
import { useTheme } from '../theme/ThemeProvider';
import { notificationIcon } from '../components/layout/TopBar';
import type { Document, Project } from '@ewiki/shared';
import type { NotificationItem } from '../components/layout/TopBar';

function relativeTime(iso: string | null): string {
  if (!iso) return '刚刚';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

export function HomePage(): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { appearance, toggleAppearance } = useTheme();
  const [query, setQuery] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [focused, setFocused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifMenuRef = useRef<HTMLDivElement>(null);
  const user = decodeAccessToken();

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ['home-projects'],
    queryFn: () => apiFetch<{ items: Project[]; total: number }>('/api/v1/projects?page=1&pageSize=6'),
    staleTime: 60_000,
  });

  const { data: recentDocs, isLoading: docsLoading } = useQuery({
    queryKey: ['home-documents'],
    queryFn: () => apiFetch<{ items: Document[] }>('/api/v1/documents?page=1&pageSize=8'),
    staleTime: 60_000,
  });

  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['home-search', query],
    queryFn: () => apiFetch<{ items: (Document & { snippet?: string | null })[] }>(
      `/api/v1/documents?q=${encodeURIComponent(query)}&page=1&pageSize=10`
    ),
    enabled: query.length >= 2,
    staleTime: 30_000,
  });

  const { data: notificationsData } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => apiFetch<{ items: NotificationItem[]; unread: number }>('/api/v1/notifications?page=1&pageSize=5'),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const unreadCount = notificationsData?.unread ?? 0;
  const notifications = notificationsData?.items ?? [];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
      if (notifMenuRef.current && !notifMenuRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query)}`);
    }
  };

  const handleNotifClick = (item: NotificationItem): void => {
    if (!item.readAt) {
      void apiFetch(`/api/v1/notifications/${item.id}/read`, { method: 'POST' })
        .then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }));
    }
    if (item.payload.link) {
      setShowNotifications(false);
      navigate(item.payload.link);
    }
  };

  const handleLogout = () => {
    tokenStore.clear();
    navigate('/login');
  };

  const hasResults = query.length >= 2 && searchResults?.items && searchResults.items.length > 0;
  const showNoResults = query.length >= 2 && !searchLoading && searchResults?.items?.length === 0;

  const projectList = projectsData?.items ?? [];

  const heroStyle: React.CSSProperties = {
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(12px)',
    transition: 'opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
  };

  const searchStyle: React.CSSProperties = {
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.98)',
    transition: 'opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s',
  };

  const sectionsStyle: React.CSSProperties = {
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(10px)',
    transition: 'opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.25s, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.25s',
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: 'var(--bg-page)' }}>
      {/* 背景装饰 */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full pointer-events-none opacity-30"
        style={{
          background: 'radial-gradient(circle, var(--color-primary-100) 0%, transparent 70%)',
          filter: 'blur(40px)',
          ...heroStyle,
          transitionDuration: '1.2s',
        }}
      />

      <header className="flex items-center justify-between px-6 py-4 relative z-10">
        <Link to="/" className="flex items-center gap-2 group">
          <div
            className="h-8 w-8 rounded-lg flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg"
            style={{
              background: 'var(--color-primary-500)',
              boxShadow: '0 0 0 0 var(--color-primary-200)',
            }}
          >
            <Sparkles size={18} className="text-white" />
          </div>
          <span className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>ewiki</span>
        </Link>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleAppearance}
            aria-label="切换主题"
            className="rounded-md p-2 transition-all duration-200 hover:bg-neutral-100 active:scale-95"
            style={{ color: 'var(--text-secondary)' }}
          >
            {appearance === 'dark' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
            )}
          </button>

          <div className="relative" ref={notifMenuRef}>
            <button
              type="button"
              onClick={() => { setShowNotifications(!showNotifications); setShowUserMenu(false); }}
              aria-label="通知"
              className="relative rounded-md p-2 transition-all duration-200 hover:bg-neutral-100 active:scale-95"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {showNotifications && (
              <div
                className="absolute right-0 top-full mt-2 w-80 card shadow-xl z-50 overflow-hidden rounded-xl"
                style={{ animation: 'fade-down 0.2s cubic-bezier(0.16, 1, 0.3, 1) both' }}
              >
                <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-soft)' }}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">通知</span>
                    <Link to="/notifications" className="text-xs hover:underline" style={{ color: 'var(--color-primary-600)' }}>查看全部</Link>
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length > 0 ? (
                    notifications.map((item) => {
                      const Icon = notificationIcon(item.type);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleNotifClick(item)}
                          className="w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-neutral-50 transition-colors duration-150"
                          style={{ borderColor: 'var(--border-soft)' }}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--color-primary-50)' }}>
                              <Icon size={14} style={{ color: 'var(--color-primary-600)' }} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm leading-snug">
                                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                  {item.payload.title ?? '通知'}
                                </span>
                                {!item.readAt && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" />}
                              </p>
                              <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                                {item.payload.message ?? ''}
                              </p>
                              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                {new Date(item.createdAt).toLocaleString('zh-CN')}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                      暂无通知
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => { setShowUserMenu(!showUserMenu); setShowNotifications(false); }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-all duration-200 hover:bg-neutral-100 active:scale-95"
            >
              <div className="h-7 w-7 rounded-full bg-primary-500 text-white flex items-center justify-center text-xs font-medium">
                {user?.name?.charAt(0) ?? 'U'}
              </div>
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{user?.name ?? '用户'}</span>
            </button>
            {showUserMenu && (
              <div
                className="absolute right-0 top-full mt-2 w-48 card shadow-xl z-50 overflow-hidden rounded-xl"
                style={{ animation: 'fade-down 0.2s cubic-bezier(0.16, 1, 0.3, 1) both' }}
              >
                <Link
                  to="/dashboard"
                  className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-neutral-50 transition-colors duration-150"
                  style={{ color: 'var(--text-primary)' }}
                  onClick={() => setShowUserMenu(false)}
                >
                  <SettingsIcon size={16} />
                  管理控制台
                </Link>
                <Link
                  to="/settings"
                  className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-neutral-50 transition-colors duration-150"
                  style={{ color: 'var(--text-primary)' }}
                  onClick={() => setShowUserMenu(false)}
                >
                  <User size={16} />
                  个人设置
                </Link>
                <div className="border-t" style={{ borderColor: 'var(--border-soft)' }} />
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-neutral-50 transition-colors duration-150"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <LogOut size={16} />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-20 relative z-10">
        <div className="text-center mb-8" style={heroStyle}>
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs mb-6"
            style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}
          >
            <Sparkles size={12} />
            <span>让知识流动起来</span>
          </div>
          <h1
            className="font-display text-5xl md:text-6xl font-bold mb-4 tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            <span style={{
              background: 'linear-gradient(135deg, var(--color-primary-500), var(--color-primary-600))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>e</span>wiki
          </h1>
          <p className="text-base" style={{ color: 'var(--text-muted)' }}>
            搜索你的知识，发现每一个答案
          </p>
        </div>

        <form onSubmit={handleSearch} className="w-full max-w-2xl relative" style={searchStyle}>
          <div className="relative">
            <Search
              size={20}
              className="absolute left-5 top-1/2 -translate-y-1/2 transition-all duration-300"
              style={{ color: focused ? 'var(--color-primary-500)' : 'var(--text-muted)' }}
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="搜索文档、项目..."
              className="w-full h-14 pl-14 pr-32 text-base rounded-2xl border shadow-sm focus:shadow-lg focus:outline-none transition-all duration-300"
              style={{
                background: 'var(--bg-surface)',
                borderColor: focused ? 'var(--color-primary-500)' : 'var(--border-soft)',
                color: 'var(--text-primary)',
                boxShadow: focused ? '0 0 0 4px var(--color-primary-100)' : '0 1px 3px rgba(0,0,0,0.05)',
              }}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <button
                type="submit"
                className="btn-primary h-10 px-5 rounded-xl text-sm font-medium transition-all duration-200 hover:shadow-md active:scale-95"
              >
                搜索
              </button>
            </div>
          </div>

          {query.length >= 2 && (
            <div
              className="absolute left-0 right-0 top-full mt-2 card shadow-xl z-40 overflow-hidden rounded-xl"
              style={{ animation: 'fade-down 0.25s cubic-bezier(0.16, 1, 0.3, 1) both' }}
            >
              {searchLoading ? (
                <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  搜索中...
                </div>
              ) : showNoResults ? (
                <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  未找到相关文档
                </div>
              ) : hasResults ? (
                <div className="max-h-96 overflow-y-auto">
                  {searchResults.items.map((doc, idx) => (
                    <Link
                      key={doc.id}
                      to={`/read/${doc.id}`}
                      className="block px-4 py-3 hover:bg-neutral-50 transition-colors duration-150 border-b last:border-b-0"
                      style={{
                        borderColor: 'var(--border-soft)',
                        animation: `fade-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) both`,
                        animationDelay: `${idx * 0.03}s`,
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <FileText size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-primary-500)' }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {doc.title || doc.path.split('/').pop() || '未命名'}
                          </div>
                          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                            {doc.snippet || doc.path}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                  <button
                    type="submit"
                    className="w-full px-4 py-3 text-left text-sm font-medium hover:bg-neutral-50 transition-colors duration-150 flex items-center justify-center gap-1 group"
                    style={{ color: 'var(--color-primary-600)' }}
                  >
                    查看全部结果
                    <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </form>

        {!query && (
          <div className="w-full max-w-4xl mt-14 grid grid-cols-1 md:grid-cols-2 gap-8" style={sectionsStyle}>
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  <FolderOpen size={16} style={{ color: 'var(--color-primary-500)' }} />
                  最近项目
                </h2>
                <Link to="/library" className="text-xs flex items-center gap-1 group" style={{ color: 'var(--color-primary-600)' }}>
                  全部
                  <ArrowRight size={12} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </div>
              <div className="space-y-1">
                {projectsLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="card-hover p-3 rounded-lg">
                      <div className="skeleton-shimmer h-4 w-32 mb-2 rounded" />
                      <div className="skeleton-shimmer h-3 w-20 rounded" />
                    </div>
                  ))
                ) : (
                  projectList.slice(0, 5).map((p) => (
                    <Link
                      key={p.id}
                      to={`/projects/${p.id}/browse`}
                      className="card-hover flex items-center gap-3 p-3 rounded-lg transition-all duration-200 hover:shadow-md hover:-translate-y-px"
                    >
                      <div
                        className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110"
                        style={{ background: 'var(--color-primary-100, #d1fae5)' }}
                      >
                        <FolderOpen size={18} style={{ color: 'var(--color-primary-600)' }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {p.name}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {(p as { description?: string }).description?.slice(0, 30) || '—'}
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  <Clock size={16} style={{ color: 'var(--color-primary-500)' }} />
                  最近文档
                </h2>
                <Link to="/library" className="text-xs flex items-center gap-1 group" style={{ color: 'var(--color-primary-600)' }}>
                  全部
                  <ArrowRight size={12} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </div>
              <div className="space-y-1">
                {docsLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="card-hover p-3 rounded-lg">
                      <div className="skeleton-shimmer h-4 w-32 mb-2 rounded" />
                      <div className="skeleton-shimmer h-3 w-20 rounded" />
                    </div>
                  ))
                ) : (
                  recentDocs?.items?.slice(0, 5).map((doc) => (
                    <Link
                      key={doc.id}
                      to={`/read/${doc.id}`}
                      className="card-hover flex items-center gap-3 p-3 rounded-lg transition-all duration-200 hover:shadow-md hover:-translate-y-px"
                    >
                      <div
                        className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110"
                        style={{ background: 'var(--color-primary-50, #ecfdf5)' }}
                      >
                        <FileText size={18} style={{ color: 'var(--color-primary-500)' }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {doc.title || doc.path.split('/').pop() || '未命名'}
                        </div>
                        <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                          {relativeTime(doc.updatedAt)} · {doc.path}
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <footer
        className="py-4 text-center text-xs relative z-10"
        style={{
          color: 'var(--text-muted)',
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.7s ease 0.4s',
        }}
      >
        ewiki · 让知识流动起来
      </footer>
    </div>
  );
}
