// ---------------------------------------------------------------------------
// 管理端 →「开放接口」（OPEN-API-MCP-DESIGN §10）：公开检索开关 · 配额 ·
// per-token 用量视图 · 全平台令牌全景与强制吊销。后端契约见 /api/v1/admin/open-api*。
// 结构对齐 SearchAdminSection（card 区块 + 受控表单 + dirty 标记 + 动态轮询）。
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api/client';

interface OpenApiSettings {
  publicSearchEnabled: boolean;
  publicPerIpPerMin: number;
  searchPerMin: number;
  readPerMin: number;
  writePerMin: number;
}
interface OpenApiOverview {
  settings: OpenApiSettings;
  envEnabled: boolean;
  counts: { active_tokens: number; total_tokens: number; write_tokens: number };
}
interface UsageByToken {
  tokenId: string;
  tokenName: string;
  tokenPrefix: string;
  userName: string;
  userEmail: string;
  revokedAt: string | null;
  searchCount: number;
  readCount: number;
  writeCount: number;
  rejectedCount: number;
}
interface UsageDaily {
  day: string;
  searchCount: number;
  readCount: number;
  writeCount: number;
  rejectedCount: number;
}
interface AdminTokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  userName: string;
  userEmail: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastIp: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const QUOTA_FIELDS: Array<{ key: keyof OpenApiSettings; label: string; hint: string }> = [
  { key: 'publicPerIpPerMin', label: '匿名 / IP（次/分）', hint: '公开检索（站点 + 平台公开面）' },
  { key: 'searchPerMin', label: '检索 / 令牌（次/分）', hint: 'D2 search scope' },
  { key: 'readPerMin', label: '读取 / 令牌（次/分）', hint: 'D2 read scope' },
  { key: 'writePerMin', label: '写入 / 令牌（次/分）', hint: 'D3 write scope' },
];

export function OpenApiAdminSection(): React.ReactElement {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OpenApiSettings | null>(null);
  const [dirty, setDirty] = useState(false);

  const overviewQuery = useQuery<OpenApiOverview>({
    queryKey: ['admin-openapi'],
    queryFn: () => apiFetch<OpenApiOverview>('/api/v1/admin/open-api'),
  });
  const usageQuery = useQuery<{ byToken: UsageByToken[]; daily: UsageDaily[] }>({
    queryKey: ['admin-openapi-usage'],
    queryFn: () => apiFetch(`/api/v1/admin/open-api/usage?days=14`),
    refetchInterval: (q) => (q.state.data ? 30_000 : false),
  });
  const tokensQuery = useQuery<{ items: AdminTokenRow[] }>({
    queryKey: ['admin-openapi-tokens'],
    queryFn: () => apiFetch('/api/v1/admin/open-api/tokens'),
  });

  // 服务端数据到达后回填表单（dirty 时不覆盖用户输入）
  useEffect(() => {
    if (overviewQuery.data && !dirty) setForm(overviewQuery.data.settings);
  }, [overviewQuery.data, dirty]);

  const saveMut = useMutation({
    mutationFn: (patch: Partial<OpenApiSettings>) =>
      apiFetch('/api/v1/admin/open-api', { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['admin-openapi'] });
    },
    onError: (e) => window.alert(e instanceof Error ? e.message : '保存失败'),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/admin/open-api/tokens/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-openapi-tokens'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-openapi'] });
    },
    onError: (e) => window.alert(e instanceof Error ? e.message : '吊销失败'),
  });

  if (overviewQuery.isLoading || !form) return <div className="skeleton h-24 w-full" />;
  const usage = usageQuery.data;

  return (
    <div className="space-y-5">
      {/* 开关 + 配额 */}
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-primary-600" />
            <h3 className="text-sm font-semibold">公开检索与配额</h3>
          </div>
          <button
            type="button"
            className="btn-primary !h-8 !text-xs"
            disabled={!dirty || saveMut.isPending}
            onClick={() => saveMut.mutate(form)}
          >
            保存配置
          </button>
        </div>

        <label className="mb-1 flex cursor-pointer items-center justify-between rounded-lg border p-3" style={{ borderColor: 'var(--border-soft)' }}>
          <div>
            <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>公开检索总开关（D1）</div>
            <div className="mt-0.5 text-[11px] leading-snug" style={{ color: 'var(--text-muted, #94a3b8)' }}>
              关闭时发布站搜索框与 /public/search 一律 404（应急 kill switch）。{!overviewQuery.data?.envEnabled && ' 当前进程 OPENAPI_ENABLED=false，开放面整体未启用。'}
            </div>
          </div>
          <input
            type="checkbox"
            className="accent-primary-500"
            checked={form.publicSearchEnabled}
            onChange={(e) => { setForm({ ...form, publicSearchEnabled: e.target.checked }); setDirty(true); }}
          />
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {QUOTA_FIELDS.map(({ key, label, hint }) => (
            <div key={key}>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</label>
              <input
                className="input"
                type="number"
                min={0}
                value={form[key] as number}
                onChange={(e) => { setForm({ ...form, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }); setDirty(true); }}
              />
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted, #94a3b8)' }}>{hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-4 text-[11px]" style={{ color: 'var(--text-muted, #94a3b8)' }}>
          <span>活跃令牌 {overviewQuery.data?.counts.active_tokens ?? 0}</span>
          <span>含写权限 {overviewQuery.data?.counts.write_tokens ?? 0}</span>
          <span>累计 {overviewQuery.data?.counts.total_tokens ?? 0}</span>
        </div>
      </div>

      {/* per-token 用量（近 14 天） */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">调用量（近 14 天，按令牌）</h3>
          <button type="button" className="btn-ghost !p-1.5" title="刷新" onClick={() => void usageQuery.refetch()}>
            <RefreshCw size={13} />
          </button>
        </div>
        {!usage?.byToken.length ? (
          <p className="text-xs" style={{ color: 'var(--text-muted, #94a3b8)' }}>暂无调用记录。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 text-left" style={{ color: 'var(--text-muted, #94a3b8)', background: 'var(--bg-surface)' }}>
                <tr>
                  <th className="px-2 py-1.5 font-medium">令牌</th>
                  <th className="px-2 py-1.5 font-medium">属主</th>
                  <th className="px-2 py-1.5 font-medium">检索</th>
                  <th className="px-2 py-1.5 font-medium">读</th>
                  <th className="px-2 py-1.5 font-medium">写</th>
                  <th className="px-2 py-1.5 font-medium">限流拒绝</th>
                </tr>
              </thead>
              <tbody>
                {usage.byToken.map((t) => (
                  <tr key={t.tokenId} className="border-t" style={{ borderColor: 'var(--border-soft)' }}>
                    <td className="px-2 py-1.5">
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{t.tokenName}</span>
                      <code className="ml-1 text-[10px]" style={{ color: 'var(--text-muted, #94a3b8)' }}>{t.tokenPrefix}…</code>
                      {t.revokedAt && <span className="tag tag-danger !text-[10px]">已吊销</span>}
                    </td>
                    <td className="px-2 py-1.5">{t.userName}</td>
                    <td className="px-2 py-1.5">{t.searchCount}</td>
                    <td className="px-2 py-1.5">{t.readCount}</td>
                    <td className="px-2 py-1.5">{t.writeCount}</td>
                    <td className="px-2 py-1.5">{t.rejectedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 令牌全景 */}
      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">全平台令牌</h3>
        {!tokensQuery.data?.items.length ? (
          <p className="text-xs" style={{ color: 'var(--text-muted, #94a3b8)' }}>暂无令牌。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left" style={{ color: 'var(--text-muted, #94a3b8)' }}>
                <tr>
                  <th className="px-2 py-1.5 font-medium">令牌</th>
                  <th className="px-2 py-1.5 font-medium">属主</th>
                  <th className="px-2 py-1.5 font-medium">权限</th>
                  <th className="px-2 py-1.5 font-medium">最近使用</th>
                  <th className="px-2 py-1.5 font-medium">状态</th>
                  <th className="px-2 py-1.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {tokensQuery.data.items.map((t) => (
                  <tr key={t.id} className="border-t" style={{ borderColor: 'var(--border-soft)' }}>
                    <td className="px-2 py-1.5">
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{t.name}</span>
                      <code className="ml-1 text-[10px]" style={{ color: 'var(--text-muted, #94a3b8)' }}>{t.tokenPrefix}…</code>
                    </td>
                    <td className="px-2 py-1.5">{t.userName}</td>
                    <td className="px-2 py-1.5">{t.scopes.join('/')}</td>
                    <td className="px-2 py-1.5">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}{t.lastIp ? ` · ${t.lastIp}` : ''}</td>
                    <td className="px-2 py-1.5">{t.revokedAt ? <span className="tag tag-danger !text-[10px]">已吊销</span> : <span className="tag tag-success !text-[10px]">有效</span>}</td>
                    <td className="px-2 py-1.5 text-right">
                      {!t.revokedAt && (
                        <button
                          type="button"
                          className="btn-ghost !p-1 text-rose-600"
                          title="强制吊销"
                          onClick={() => {
                            if (window.confirm(`强制吊销「${t.userName}」的令牌「${t.name}」？`)) revokeMut.mutate(t.id);
                          }}
                        >
                          吊销
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
