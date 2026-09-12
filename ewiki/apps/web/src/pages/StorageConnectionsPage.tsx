import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, RefreshCw, Trash2, Plus, HardDrive } from 'lucide-react';
import { apiFetch } from '../lib/api/client';

/** 存储源：用户级 GitLab / Gitea 连接配置管理；验证连通性，供新建 Git 文档库时选择 */

interface ConnectionItem {
  id: string;
  name: string;
  kind: 'gitlab' | 'gitea';
  baseUrl: string;
  defaultNamespace: string | null;
  status: 'unverified' | 'ok' | 'error';
  lastCheckAt: string | null;
  lastCheckMsg: string | null;
  createdAt: string;
}

export function StorageConnectionsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'gitlab' | 'gitea'>('gitlab');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [namespace, setNamespace] = useState('');
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: () => apiFetch<{ items: ConnectionItem[] }>('/api/v1/connections'),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; status: string; message: string }>('/api/v1/connections', {
        method: 'POST',
        body: JSON.stringify({ name, kind, baseUrl, token, defaultNamespace: namespace || undefined }),
      }),
    onSuccess: (res) => {
      setFormMsg({ ok: res.status === 'ok', text: res.message });
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
      if (res.status === 'ok') {
        setShowForm(false);
        setName(''); setBaseUrl(''); setToken(''); setNamespace('');
      }
    },
    onError: (err) => setFormMsg({ ok: false, text: err instanceof Error ? err.message : '保存失败' }),
  });

  const validateMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ message: string }>(`/api/v1/connections/${id}/validate`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['connections'] }),
    onError: () => void queryClient.invalidateQueries({ queryKey: ['connections'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/connections/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['connections'] }),
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg text-white" style={{ background: 'var(--color-primary-500)' }}>
            <HardDrive size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold">存储源</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>
              管理 Git 托管服务连接；新建「Git 仓库」文档库时将使用这些配置
            </p>
          </div>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          <Plus size={15} className="mr-1 inline" /> 添加连接配置
        </button>
      </div>

      {showForm && (
        <div className="card mb-6 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">配置名称 *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：公司 GitLab" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">类型 *</label>
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'gitlab' | 'gitea')}>
                <option value="gitlab">GitLab（REST v4）</option>
                <option value="gitea">Gitea（兼容演示）</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">服务地址 *</label>
              <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://gitlab.example.com" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">访问令牌 Token *</label>
              <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="glpat-…（需 api 权限）" />
            </div>
            <div className="col-span-2">
              <label className="mb-1.5 block text-sm font-medium">默认命名空间（可选，默认用账号个人空间）</label>
              <input className="input" value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="如：团队组名" />
            </div>
          </div>
          {formMsg && (
            <p className={`mt-3 text-sm ${formMsg.ok ? 'text-emerald-600' : 'text-danger'}`}>{formMsg.text}</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => { setShowForm(false); setFormMsg(null); }}>取消</button>
            <button type="button" className="btn-primary" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? '验证并保存中…' : '保存并验证'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {isLoading && <div className="card p-6 text-sm" style={{ color: 'var(--text-muted, #64748b)' }}>加载中…</div>}
        {!isLoading && (data?.items.length ?? 0) === 0 && (
          <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-muted, #64748b)' }}>
            还没有连接配置。添加 GitLab（或演示用 Gitea）连接后，即可创建 Git 仓库类型的文档库。
          </div>
        )}
        {data?.items.map((conn) => (
          <div key={conn.id} className="card flex items-center gap-4 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
              style={{ background: conn.kind === 'gitlab' ? '#fc6d26' : '#609926' }}>
              {conn.kind === 'gitlab' ? 'GL' : 'GT'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{conn.name}</span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                  {conn.kind === 'gitlab' ? 'GitLab' : 'Gitea'}
                </span>
                {conn.status === 'ok' && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle2 size={12} /> 已连接</span>
                )}
                {conn.status === 'error' && (
                  <span className="flex items-center gap-1 text-[11px] text-danger"><XCircle size={12} /> 验证失败</span>
                )}
                {conn.status === 'unverified' && <span className="text-[11px] text-neutral-400">未验证</span>}
              </div>
              <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>
                {conn.baseUrl}{conn.lastCheckMsg ? ` · ${conn.lastCheckMsg}` : ''}
              </div>
            </div>
            <button type="button" className="btn-ghost !px-2.5" title="重新验证" disabled={validateMutation.isPending}
              onClick={() => validateMutation.mutate(conn.id)}>
              <RefreshCw size={14} />
            </button>
            <button type="button" className="btn-ghost !px-2.5 text-danger" title="删除"
              onClick={() => { if (window.confirm(`确认删除连接配置「${conn.name}」？`)) deleteMutation.mutate(conn.id); }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
