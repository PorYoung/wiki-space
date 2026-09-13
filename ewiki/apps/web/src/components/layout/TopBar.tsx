import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search, Bell, SquarePen, Settings, X, ExternalLink, AlertTriangle,
  GitBranch, FolderOpen, Download, Users, ChevronRight, Sun, Moon, Monitor,
  FileText,
} from 'lucide-react';
import { apiFetch } from '../../lib/api/client';
import { useTheme } from '../../theme/ThemeProvider';

// 迁移自 prototype TopBar.jsx（TS 化）
// 通知中心数据源：/notifications 个人收件箱（EXT-PLATFORM Step3）；项目动态流仍走 /activities（ActivityPage）

export interface NotificationItem {
  id: string;
  userId: string;
  type: string; // sync.error | publish.finished | import.finished | import.failed | team.invite | project.invite
  payload: { projectId?: string; title?: string; message?: string; link?: string };
  readAt: string | null;
  createdAt: string;
}

const routeLabels: Record<string, string> = {
  dashboard: '仪表盘', library: '文档库', connections: '存储源', themes: '主题模板', settings: '设置', team: '团队', notifications: '通知中心',
};

function Breadcrumb(): React.ReactElement {
  const { pathname } = useLocation();
  // 项目内路由 /projects/:id/:tab —— 照抄原型 TopBar.jsx:60-85
  if (pathname.startsWith('/projects/')) {
    const parts = pathname.split('/').filter(Boolean);
    const projectId = parts[1];
    const subTab = parts[2];
    const subTabLabels: Record<string, string> = {
      browse: '文档浏览', graph: '关系图谱', activity: '项目动态',
      publish: '发布配置', members: '成员管理', settings: '项目设置',
    };
    return (
      <nav className="flex items-center gap-1 text-sm">
        <Link to="/library" className="transition" style={{ color: 'var(--text-muted, #94a3b8)' }}>文档库</Link>
        <ChevronRight size={14} className="text-neutral-300" />
        <span className="font-mono text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{projectId}</span>
        {subTab && (
          <>
            <ChevronRight size={14} className="text-neutral-300" />
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{subTabLabels[subTab] ?? subTab}</span>
          </>
        )}
      </nav>
    );
  }
  const segments = pathname.split('/').filter(Boolean);
  return (
    <nav className="flex items-center gap-1 text-sm">
      {segments.length === 0 ? (
        <span style={{ color: 'var(--text-muted, #64748b)' }}>首页</span>
      ) : (
        segments.map((seg, idx) => (
          <div key={seg} className="flex items-center gap-1">
            {idx > 0 && <ChevronRight size={14} className="text-neutral-300" />}
            <span className={idx === segments.length - 1 ? 'font-medium' : ''}
              style={{ color: idx === segments.length - 1 ? 'var(--text-primary)' : 'var(--text-muted, #94a3b8)' }}>
              {routeLabels[seg] ?? seg}
            </span>
          </div>
        ))
      )}
    </nav>
  );
}

function IconButton({ icon: Icon, tooltip, hasBadge = false, onClick, active }: {
  icon: typeof Bell; tooltip: string; hasBadge?: boolean; onClick: () => void; active?: boolean;
}): React.ReactElement {
  return (
    <div className="relative group">
      <button type="button" onClick={onClick} aria-label={tooltip}
        className={`relative rounded-md p-2 transition ${active ? 'bg-neutral-100 text-primary-600' : 'hover:bg-neutral-100'}`}>
        <Icon size={18} />
        {hasBadge && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />}
      </button>
      {tooltip && (
        <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100">
          {tooltip}
        </div>
      )}
    </div>
  );
}

export function notificationIcon(type: string): typeof Bell {
  switch (type) {
    case 'sync.error': return AlertTriangle;
    case 'publish.finished': return ExternalLink;
    case 'import.finished':
    case 'import.failed': return Download;
    case 'team.invite':
    case 'project.invite': return Users;
    default: return GitBranch;
  }
}

function NotificationDropdown({ onClose, items }: { onClose: () => void; items: NotificationItem[] }): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 点击项：未读 → 标记已读；有链接 → 跳转
  const handleItemClick = (item: NotificationItem): void => {
    if (!item.readAt) {
      void apiFetch(`/api/v1/notifications/${item.id}/read`, { method: 'POST' })
        .then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }));
    }
    if (item.payload.link) {
      onClose();
      navigate(item.payload.link);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border shadow-xl animate-fade-up"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-soft)' }}>
          <span className="text-sm font-semibold">通知中心</span>
          <button type="button" className="rounded p-1 text-neutral-400 hover:bg-neutral-100" onClick={onClose} aria-label="关闭通知"><X size={14} /></button>
        </div>
        <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted, #94a3b8)' }}>暂无通知</div>
          ) : (
            items.map((item, i) => {
              const Icon = notificationIcon(item.type);
              return (
                <div key={item.id}
                  role="button" tabIndex={0}
                  onClick={() => handleItemClick(item)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleItemClick(item); }}
                  className={`flex animate-fade-up cursor-pointer items-start gap-3 border-b px-4 py-3 last:border-0 hover:bg-neutral-50 ${item.readAt ? '' : 'bg-primary-50/40'}`}
                  style={{ borderColor: 'var(--border-soft)', animationDelay: `${i * 50}ms` }}>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50">
                    <Icon size={14} className="text-primary-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">
                      <span className="font-medium">{item.payload.title ?? '通知'}</span>
                      {!item.readAt && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" />}
                    </p>
                    <p className="truncate text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{item.payload.message ?? ''}</p>
                    <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted, #94a3b8)' }}>
                      {new Date(item.createdAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="border-t px-4 py-2.5 text-center" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-subtle)' }}>
          <button type="button" className="inline-flex items-center gap-0.5 text-xs font-medium text-primary-600"
            onClick={() => { onClose(); navigate('/notifications'); }}>
            查看全部通知 <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </>
  );
}

function QuickCreateDropdown({ onClose }: { onClose: () => void }): React.ReactElement {
  const navigate = useNavigate();
  // 对齐原型 TopBar.jsx:210-215
  const options = [
    { icon: FileText,  label: '新建文档',   desc: '在当前项目中创建 Markdown 文档', to: '/library' },
    { icon: FolderOpen, label: '新建文档库', desc: '创建一个新的知识库项目',        to: '/library' },
    { icon: GitBranch, label: '新建 Git 文档库', desc: '关联 GitLab / Gitea 仓库', to: '/projects/new' },
    { icon: Users,     label: '邀请成员',   desc: '添加协作者到你的团队',          to: '/team' },
  ];
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border shadow-xl animate-fade-up"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
        <div className="border-b px-4 py-3 text-sm font-semibold" style={{ borderColor: 'var(--border-soft)' }}>快速创建</div>
        <div className="py-1">
          {options.map(({ icon: Icon, label, desc, to }, i) => (
            <button key={label} type="button" onClick={() => { onClose(); navigate(to); }}
              className="flex w-full animate-fade-up items-start gap-3 px-4 py-2.5 text-left hover:bg-neutral-50"
              style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100"><Icon size={14} /></div>
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted, #64748b)' }}>{desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export function TopBar(): React.ReactElement {
  const navigate = useNavigate();
  const { appearance, toggleAppearance } = useTheme();
  const [notifOpen, setNotifOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  const { data: notifData } = useQuery<{ items: NotificationItem[]; unread: number }>({
    queryKey: ['notifications'],
    queryFn: () => apiFetch<{ items: NotificationItem[]; unread: number }>('/api/v1/notifications?limit=10'),
    // 通知事件已由 realtime 广播，前端先轮询兜底（EXT-PLATFORM §7）
    refetchInterval: 60_000,
  });
  const unreadCount = notifData?.unread ?? 0;

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (createRef.current && !createRef.current.contains(e.target as Node)) setCreateOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const AppearanceIcon = appearance === 'dark' ? Moon : appearance === 'light' ? Sun : Monitor;

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b px-6"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
      <Breadcrumb />
      <div className="relative w-[360px]">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input type="text" placeholder="搜索文档、项目、团队..." aria-label="全局搜索"
          className="h-9 w-full rounded-md border pl-9 pr-3 text-sm"
          style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-subtle)', color: 'var(--text-primary)' }} />
      </div>
      <div className="flex items-center gap-1">
        <IconButton icon={AppearanceIcon} tooltip="切换外观" onClick={toggleAppearance} />
        <div className="mx-1 h-6 w-px bg-neutral-200" />
        <div ref={notifRef} className="relative">
          <IconButton icon={Bell} tooltip="通知" hasBadge={unreadCount > 0} onClick={() => { setCreateOpen(false); setNotifOpen((v) => !v); }} active={notifOpen} />
          {notifOpen && <NotificationDropdown onClose={() => setNotifOpen(false)} items={notifData?.items ?? []} />}
        </div>
        <div ref={createRef} className="relative">
          <IconButton icon={SquarePen} tooltip="快速创建" onClick={() => { setNotifOpen(false); setCreateOpen((v) => !v); }} active={createOpen} />
          {createOpen && <QuickCreateDropdown onClose={() => setCreateOpen(false)} />}
        </div>
        <div className="mx-1 h-6 w-px bg-neutral-200" />
        <IconButton icon={Settings} tooltip="设置" onClick={() => navigate('/settings')} />
      </div>
    </header>
  );
}
