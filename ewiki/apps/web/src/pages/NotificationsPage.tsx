import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ChevronRight, Inbox } from 'lucide-react';
import { apiFetch } from '../lib/api/client';
import { notificationIcon, type NotificationItem } from '../components/layout/TopBar';

// ---------------------------------------------------------------------------
// 通知落地页（EXT-PLATFORM Step3）：个人收件箱全量视图。
//   游标分页（createdAt）+ 全部已读；未读项高亮，点击标记已读并可跳转 payload.link。
// ---------------------------------------------------------------------------

interface NotificationsResp {
  items: NotificationItem[];
  unread: number;
  nextCursor: string | null;
}

export function NotificationsPage(): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState<string | null>(null);
  const [acc, setAcc] = useState<NotificationItem[]>([]);

  const { data, isLoading } = useQuery<NotificationsResp>({
    queryKey: ['notifications-page', cursor],
    queryFn: () =>
      apiFetch<NotificationsResp>(`/api/v1/notifications?limit=30${cursor ? `&before=${cursor}` : ''}`),
  });

  // 首页替换、翻页追加（按 id 去重）；invalidate 后 cursor=null 的首页查询会重置列表
  useEffect(() => {
    if (!data) return;
    setAcc((prev) => {
      const merged = cursor ? [...prev, ...data.items] : data.items;
      const seen = new Set<string>();
      return merged.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
    });
  }, [data, cursor]);

  function loadMore(): void {
    if (data?.nextCursor) setCursor(data.nextCursor);
  }

  const items = acc;

  const readAll = useMutation({
    mutationFn: () => apiFetch<{ updated: number }>('/api/v1/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-page'] });
    },
  });

  const markRead = (item: NotificationItem): void => {
    if (!item.readAt) {
      void apiFetch(`/api/v1/notifications/${item.id}/read`, { method: 'POST' })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ['notifications'] });
          void queryClient.invalidateQueries({ queryKey: ['notifications-page'] });
        });
    }
    if (item.payload.link) navigate(item.payload.link);
  };

  const unread = data?.unread ?? 0;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-3xl p-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-neutral-400">
              <Bell size={13} />
              <span>通知中心</span>
            </div>
            <h1 className="text-xl font-bold text-neutral-900">全部通知</h1>
            <p className="mt-1 text-xs text-neutral-500">
              {unread > 0 ? `${unread} 条未读` : '全部已读'}
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary !h-8 !text-xs"
            disabled={unread === 0 || readAll.isPending}
            onClick={() => readAll.mutate()}
          >
            <CheckCheck size={13} /> 全部已读
          </button>
        </div>

        {/* List */}
        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="divide-y" style={{ borderColor: 'var(--border-soft)' }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3">
                  <div className="skeleton h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-3.5 w-40" />
                    <div className="skeleton h-2.5 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center p-12 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                <Inbox size={24} />
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>收件箱是空的</p>
              <p className="mt-1 text-xs text-neutral-400">同步失败、发布完成、导入结果与团队邀请都会出现在这里</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border-soft)' }}>
              {items.map((item, i) => {
                const Icon = notificationIcon(item.type);
                return (
                  <div
                    key={item.id}
                    role="button" tabIndex={0}
                    onClick={() => markRead(item)}
                    onKeyDown={(e) => { if (e.key === 'Enter') markRead(item); }}
                    className={`flex animate-fade-up cursor-pointer items-start gap-3 px-4 py-3.5 transition hover:bg-neutral-50 ${item.readAt ? '' : 'bg-primary-50/40'}`}
                    style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50">
                      <Icon size={14} className="text-primary-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {item.payload.title ?? '通知'}
                        </span>
                        {!item.readAt && <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />}
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        {item.payload.message ?? ''}
                      </p>
                      <p className="mt-1 text-[11px] text-neutral-400">
                        {new Date(item.createdAt).toLocaleString('zh-CN')}
                      </p>
                    </div>
                    {item.payload.link && (
                      <ChevronRight size={14} className="mt-2 shrink-0 text-neutral-300" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Load more（游标分页） */}
        {data?.nextCursor && (
          <div className="mt-4 text-center">
            <button type="button" className="btn-secondary !h-8 !text-xs" onClick={loadMore}>
              加载更早的通知
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
