import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Database, ScrollText, ShieldCheck, UserCheck, UserX, KeyRound, UserCog } from 'lucide-react';
import { apiFetch } from '../lib/api/client';

/** 系统管理（本期需求 1）：用户管理 / 数据库与存储基础设施 / 审计台账 */

interface AdminUser {
  id: string;
  email: string;
  name: string;
  globalRole: 'admin' | 'user';
  status: 'active' | 'disabled' | 'invited';
  createdAt: string;
  lastLoginAt: string | null;
  projectCount: number;
}
interface SystemInfo {
  db: { version: string; bytes: number; tables: Array<{ table: string; rows: number }> };
  storage: { nasRoot: string; nasWritable: boolean; reposRoot: string; perUser: Array<{ user: string; bytes: number; files: number }> };
  runtime: { node: string; platform: string; uptimeSeconds: number; git: string };
  counts: { users: number; projects: number; documents: number; publishSites: number; connections: number };
}
interface AuditRow {
  id: string;
  createdAt: string;
  action: string;
  resourceType: string;
  meta: Record<string, unknown>;
  actorName: string | null;
  actorEmail: string | null;
}

type Tab = 'users' | 'system' | 'audit';
const fmtBytes = (n: number): string => (n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n > 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`);
const fmtTime = (t?: string | null): string => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—');

export function AdminPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('users');
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const usersQuery = useQuery({ queryKey: ['admin-users'], queryFn: () => apiFetch<{ items: AdminUser[] }>('/api/v1/admin/users') });
  const systemQuery = useQuery({ queryKey: ['admin-system'], queryFn: () => apiFetch<SystemInfo>('/api/v1/admin/system') });
  const auditQuery = useQuery({
    queryKey: ['admin-audit', actorFilter, actionFilter],
    queryFn: () =>
      apiFetch<{ items: AuditRow[] }>(
        `/api/v1/admin/audit?${new URLSearchParams(actorFilter ? { actor: actorFilter } : {})}${actionFilter ? `&action=${encodeURIComponent(actionFilter)}` : ''}`,
      ),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'disabled' }) =>
      apiFetch(`/api/v1/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e) => window.alert(e instanceof Error ? e.message : '操作失败'),
  });
  const resetPwdMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => {
      const pw = window.prompt('输入新密码（至少 8 位）：');
      if (!pw) return Promise.reject(new Error('已取消'));
      return apiFetch(`/api/v1/admin/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password: pw }) });
    },
    onSuccess: () => { window.alert('密码已重置'); void queryClient.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e) => window.alert(e instanceof Error ? e.message : '操作失败'),
  });
  const roleMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => {
      const next = window.prompt('输入角色：admin 或 user');
      if (!next || !['admin', 'user'].includes(next)) return Promise.reject(new Error('角色需为 admin 或 user'));
      return apiFetch(`/api/v1/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ globalRole: next }) });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e) => window.alert(e instanceof Error ? e.message : '操作失败'),
  });

  const tabs: Array<{ key: Tab; label: string; icon: typeof Users }> = [
    { key: 'users', label: '用户管理', icon: Users },
    { key: 'system', label: '数据库与存储', icon: Database },
    { key: 'audit', label: '审计日志', icon: ScrollText },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg text-white" style={{ background: 'var(--color-primary-500)' }}>
          <ShieldCheck size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold">系统管理</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>平台管理功能：用户、数据库与存储基础设施、审计台账</p>
        </div>
      </div>

      <div className="mb-5 flex gap-1 rounded-lg border p-1 w-fit" style={{ borderColor: 'var(--border-soft)' }}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button"
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${tab === key ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100'}`}
            onClick={() => setTab(key)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">用户</th>
                <th className="px-4 py-2.5 font-medium">角色</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">项目数</th>
                <th className="px-4 py-2.5 font-medium">注册时间</th>
                <th className="px-4 py-2.5 font-medium">最近登录</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {usersQuery.data?.items.map((u) => (
                <tr key={u.id} className="border-t" style={{ borderColor: 'var(--border-soft)' }}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{u.email}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${u.globalRole === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-neutral-100 text-neutral-600'}`}>
                      {u.globalRole === 'admin' ? '管理员' : '普通用户'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {u.status === 'active' ? <span className="text-emerald-600">正常</span> : <span className="text-danger">已禁用</span>}
                  </td>
                  <td className="px-4 py-2.5">{u.projectCount}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{fmtTime(u.createdAt)}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{fmtTime(u.lastLoginAt)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      {u.status === 'active' ? (
                        <button type="button" className="btn-ghost !px-2 text-danger" title="禁用账号"
                          onClick={() => { if (window.confirm(`确认禁用 ${u.name}？该用户将立即无法登录。`)) statusMutation.mutate({ id: u.id, status: 'disabled' }); }}>
                          <UserX size={14} />
                        </button>
                      ) : (
                        <button type="button" className="btn-ghost !px-2 text-emerald-600" title="启用账号"
                          onClick={() => statusMutation.mutate({ id: u.id, status: 'active' })}>
                          <UserCheck size={14} />
                        </button>
                      )}
                      <button type="button" className="btn-ghost !px-2" title="重置密码" onClick={() => resetPwdMutation.mutate({ id: u.id })}>
                        <KeyRound size={14} />
                      </button>
                      <button type="button" className="btn-ghost !px-2" title="调整角色" onClick={() => roleMutation.mutate({ id: u.id })}>
                        <UserCog size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'system' && systemQuery.data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: '注册用户', value: systemQuery.data.counts.users },
              { label: '项目空间', value: systemQuery.data.counts.projects },
              { label: '文档总数', value: systemQuery.data.counts.documents },
              { label: '存储连接', value: systemQuery.data.counts.connections },
            ].map((m) => (
              <div key={m.label} className="card p-4">
                <div className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{m.label}</div>
                <div className="mt-1 text-2xl font-bold">{m.value}</div>
              </div>
            ))}
          </div>

          <div className="card p-5">
            <div className="mb-3 text-sm font-semibold">数据库（PostgreSQL）</div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>版本：<span className="font-mono text-xs">{systemQuery.data.db.version}</span></div>
              <div>体积：{fmtBytes(systemQuery.data.db.bytes)}</div>
              <div>节点：{systemQuery.data.runtime.node} · {systemQuery.data.runtime.platform}</div>
            </div>
            <table className="mt-3 w-full text-xs">
              <thead className="text-left text-neutral-500">
                <tr><th className="py-1 font-medium">数据表</th><th className="py-1 font-medium">行数</th></tr>
              </thead>
              <tbody>
                {systemQuery.data.db.tables.map((t) => (
                  <tr key={t.table} className="border-t" style={{ borderColor: 'var(--border-soft)' }}>
                    <td className="py-1 font-mono">{t.table}</td><td>{t.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-5">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
              存储基础设施（模拟 NAS 盘）
              {systemQuery.data.storage.nasWritable
                ? <span className="flex items-center gap-1 text-[11px] font-normal text-emerald-600"><UserCheck size={12} /> 可写</span>
                : <span className="text-[11px] font-normal text-danger">⚠ 不可写，请检查目录权限</span>}
            </div>
            <div className="font-mono text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{systemQuery.data.storage.nasRoot}</div>
            <div className="mt-1 font-mono text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>Git 工作副本：{systemQuery.data.storage.reposRoot}</div>
            <div className="mt-1 font-mono text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>git：{systemQuery.data.runtime.git} · 运行时长 {Math.round(systemQuery.data.runtime.uptimeSeconds / 60)} 分钟</div>
            {systemQuery.data.storage.perUser.length > 0 && (
              <table className="mt-3 w-full text-xs">
                <thead className="text-left text-neutral-500">
                  <tr><th className="py-1 font-medium">用户目录</th><th className="py-1 font-medium">文件数</th><th className="py-1 font-medium">占用</th></tr>
                </thead>
                <tbody>
                  {systemQuery.data.storage.perUser.map((u) => (
                    <tr key={u.user} className="border-t" style={{ borderColor: 'var(--border-soft)' }}>
                      <td className="py-1 font-mono">{u.user}</td><td>{u.files}</td><td>{fmtBytes(u.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div>
          <div className="mb-3 flex gap-2">
            <input className="input !w-48" placeholder="按操作人筛选" value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} />
            <input className="input !w-48" placeholder="按动作筛选（如 git.auto_commit）" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} />
          </div>
          <div className="card max-h-[560px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-50 text-left text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">时间</th>
                  <th className="px-3 py-2 font-medium">操作人</th>
                  <th className="px-3 py-2 font-medium">动作</th>
                  <th className="px-3 py-2 font-medium">资源</th>
                  <th className="px-3 py-2 font-medium">详情</th>
                </tr>
              </thead>
              <tbody>
                {auditQuery.data?.items.map((a) => (
                  <tr key={a.id} className="border-t align-top" style={{ borderColor: 'var(--border-soft)' }}>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono">{new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
                    <td className="px-3 py-1.5">{a.actorName ?? '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{a.action}</td>
                    <td className="px-3 py-1.5">{a.resourceType}</td>
                    <td className="max-w-[260px] truncate px-3 py-1.5 font-mono text-[11px]" style={{ color: 'var(--text-muted, #64748b)' }} title={JSON.stringify(a.meta)}>
                      {JSON.stringify(a.meta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
