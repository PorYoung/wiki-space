import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Save, Sparkles } from 'lucide-react';
import { apiFetch } from '../lib/api/client';

// 检索与任务（SEARCH-VECTOR-DESIGN §15）：全局配置 · 队列与资源 · 构建任务视图（管理员）

interface SearchOverview {
  config: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    apiKeySet: boolean;
    model: string;
    dim: number;
    batchSize: number;
    timeoutMs: number;
    vectorEnabled: boolean;
    debounceSeconds: number;
    semanticMinScore: number;
  };
  columnDim: number;
  stats: {
    totalChunks: number;
    pendingChunks: number;
    vectorProjects: number;
    activeBuilds: number;
    buildFailedDocs: number;
    zhparser: boolean;
  };
  queues: Array<{ name: string; state: string; count: number }>;
  builds: Array<{
    id: string;
    project_name: string;
    kind: string;
    status: string;
    total_docs: number;
    done_docs: number;
    failed_docs: number;
    error: string | null;
    params: Record<string, unknown>;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
  }>;
}

const BUILD_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '排队中', cls: 'bg-amber-100 text-amber-700' },
  running: { label: '构建中', cls: 'bg-primary-100 text-primary-700' },
  done: { label: '已完成', cls: 'bg-emerald-100 text-emerald-700' },
  failed: { label: '失败', cls: 'bg-rose-100 text-rose-700' },
  canceled: { label: '已取消', cls: 'bg-neutral-100 text-neutral-500' },
};

const fmtTime = (t?: string | null): string => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—');

export function SearchAdminSection(): React.ReactElement {
  const queryClient = useQueryClient();
  const overviewQuery = useQuery({
    queryKey: ['admin-search-overview'],
    queryFn: () => apiFetch<SearchOverview>('/api/v1/admin/search/overview'),
    // 有进行中构建 3s 轮询，常态 15s（任务视图准实时）
    refetchInterval: (query) =>
      (query.state.data?.builds ?? []).some((b) => b.status === 'pending' || b.status === 'running') ? 3000 : 15000,
  });

  const cfg = overviewQuery.data?.config;
  const [form, setForm] = useState({
    provider: 'none',
    baseUrl: '',
    apiKey: '',
    model: '',
    batchSize: 32,
    timeoutMs: 10000,
    vectorEnabled: true,
    debounceSeconds: 30,
    semanticMinScore: 0.3,
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (cfg && !dirty) {
      setForm({
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        apiKey: '',
        model: cfg.model,
        batchSize: cfg.batchSize,
        timeoutMs: cfg.timeoutMs,
        vectorEnabled: cfg.vectorEnabled,
        debounceSeconds: cfg.debounceSeconds,
        semanticMinScore: cfg.semanticMinScore,
      });
    }
  }, [cfg, dirty]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/admin/search/config', {
        method: 'PUT',
        body: JSON.stringify({
          provider: form.provider,
          baseUrl: form.baseUrl.trim(),
          // apiKey 留空 = 保留现值；显式输入 = 覆盖
          ...(form.apiKey ? { apiKey: form.apiKey } : {}),
          model: form.model.trim(),
          batchSize: Number(form.batchSize) || 32,
          timeoutMs: Number(form.timeoutMs) || 10000,
          vectorEnabled: form.vectorEnabled,
          debounceSeconds: Number(form.debounceSeconds) || 0,
          semanticMinScore: Number(form.semanticMinScore),
        }),
      }),
    onSuccess: () => {
      setDirty(false);
      setForm((f) => ({ ...f, apiKey: '' }));
      void queryClient.invalidateQueries({ queryKey: ['admin-search-overview'] });
    },
    onError: (e) => window.alert(e instanceof Error ? e.message : '保存失败'),
  });

  const reconcileMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/admin/search/reconcile', { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-search-overview'] }),
    onError: () => window.alert('触发失败'),
  });

  const retryMutation = useMutation({
    mutationFn: (buildId: string) =>
      apiFetch(`/api/v1/admin/search/builds/${buildId}/retry`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-search-overview'] }),
    onError: (e) => window.alert(e instanceof Error ? e.message : '重试失败'),
  });

  const stats = overviewQuery.data?.stats;
  const modelChanged = cfg ? form.provider !== cfg.provider || form.model.trim() !== cfg.model : false;

  return (
    <div className="space-y-4">
      {/* ---- 全局配置 ---- */}
      <div className="card p-5">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={14} className="text-primary-600" /> 检索全局配置
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-primary-500"
              checked={form.vectorEnabled}
              onChange={(e) => { setDirty(true); setForm((f) => ({ ...f, vectorEnabled: e.target.checked })); }}
            />
            <span className="font-medium">启用向量检索</span>
            <span className="text-neutral-400">（关闭即全局暂停：语义检索下线、索引更新暂停，已有向量保留）</span>
          </label>
        </div>
        <p className="mb-4 text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>
          运行时配置：保存后 ≤10s 全站生效，无需重启；apiKey 加密存储、仅回显尾 4 位。
          向量列维度固定 <span className="font-mono">{overviewQuery.data?.columnDim ?? 1024}</span>，更换模型后需在各知识库执行「重新构建」。
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-xs">
            <span className="mb-1 block font-medium text-neutral-700">嵌入 Provider</span>
            <select
              className="input"
              value={form.provider}
              onChange={(e) => { setDirty(true); setForm((f) => ({ ...f, provider: e.target.value })); }}
            >
              <option value="none">none（向量检索下线）</option>
              <option value="openai-compatible">openai-compatible（OpenAI/智谱/通义/Ollama/vLLM）</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-neutral-700">Base URL（如 http://ollama:11434/v1）</span>
            <input className="input font-mono" value={form.baseUrl} disabled={form.provider === 'none'}
              onChange={(e) => { setDirty(true); setForm((f) => ({ ...f, baseUrl: e.target.value })); }} />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-neutral-700">API Key {cfg?.apiKeySet ? <span className="font-normal text-neutral-400">（当前 {cfg.apiKey}，留空保留）</span> : null}</span>
            <input className="input font-mono" type="password" placeholder={cfg?.apiKeySet ? '留空保留现值' : '未配置'}
              value={form.apiKey} onChange={(e) => { setDirty(true); setForm((f) => ({ ...f, apiKey: e.target.value })); }} />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-neutral-700">模型（如 bge-m3）</span>
            <input className="input font-mono" value={form.model} disabled={form.provider === 'none'}
              onChange={(e) => { setDirty(true); setForm((f) => ({ ...f, model: e.target.value })); }} />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-neutral-700">批量大小（条/次）</span>
            <input className="input" type="number" min={1} value={form.batchSize}
              onChange={(e) => { setDirty(true); setForm((f) => ({ ...f, batchSize: Number(e.target.value) })); }} />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-neutral-700">超时（ms）</span>
            <input className="input" type="number" min={1000} value={form.timeoutMs}
              onChange={(e) => { setDirty(true); setForm((f) => ({ ...f, timeoutMs: Number(e.target.value) })); }} />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-neutral-700">索引防抖窗口（秒）</span>
            <input className="input" type="number" min={0} max={600} value={form.debounceSeconds}
              onChange={(e) => { setDirty(true); setForm((f) => ({ ...f, debounceSeconds: Number(e.target.value) })); }} />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-neutral-700">语义相似度阈值（0–0.95）</span>
            <input className="input" type="number" min={0} max={0.95} step={0.01} value={form.semanticMinScore}
              onChange={(e) => { setDirty(true); setForm((f) => ({ ...f, semanticMinScore: Number(e.target.value) })); }} />
          </label>
        </div>

        {modelChanged && form.vectorEnabled ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-700">
            Provider/模型变更将使存量向量失效（chunk 按模型标记判定）：保存后请在各已开启向量检索的知识库执行「重新构建」。
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            className="btn-primary !h-8 !text-xs disabled:opacity-50"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            <Save size={12} /> {saveMutation.isPending ? '保存中…' : '保存全局配置'}
          </button>
          {dirty ? <span className="text-[11px] text-amber-600">有未保存的修改</span> : null}
        </div>
      </div>

      {/* ---- 资源与队列 ---- */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">资源与队列</div>
          <button
            type="button"
            className="btn-ghost !h-7 !px-2 !text-[11px]"
            disabled={reconcileMutation.isPending}
            onClick={() => reconcileMutation.mutate()}
            title="立即对账：补齐缺失/待嵌入/模型不符的 chunk，清除悬挂数据"
          >
            <RefreshCw size={12} /> 立即对账
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            { label: 'chunk 总量', value: stats?.totalChunks ?? '—' },
            { label: '待嵌入', value: stats?.pendingChunks ?? '—' },
            { label: '向量知识库', value: stats?.vectorProjects ?? '—' },
            { label: '进行中构建', value: stats?.activeBuilds ?? '—' },
            { label: '构建失败文档', value: stats?.buildFailedDocs ?? '—' },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border p-3" style={{ borderColor: 'var(--border-soft)' }}>
              <div className="text-[11px]" style={{ color: 'var(--text-muted, #64748b)' }}>{m.label}</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums">{m.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>
          <span>中文分词：{stats?.zhparser ? <span className="text-emerald-600">zhparser 已启用</span> : <span className="text-amber-600">降级 simple（建议部署检索扩展镜像）</span>}</span>
        </div>
        <table className="mt-3 w-full text-xs">
          <thead className="text-left text-neutral-500">
            <tr><th className="py-1 font-medium">队列</th><th className="py-1 font-medium">状态</th><th className="py-1 font-medium">积压</th></tr>
          </thead>
          <tbody>
            {(overviewQuery.data?.queues ?? []).length === 0 ? (
              <tr><td colSpan={3} className="py-2 text-neutral-400">无积压任务</td></tr>
            ) : (
              overviewQuery.data?.queues.map((q, i) => (
                <tr key={`${q.name}-${q.state}-${i}`} className="border-t" style={{ borderColor: 'var(--border-soft)' }}>
                  <td className="py-1 font-mono">{q.name}</td>
                  <td className="py-1">{q.state}</td>
                  <td className="py-1 font-medium tabular-nums">{q.count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ---- 构建任务视图 ---- */}
      <div className="card p-5">
        <div className="mb-3 text-sm font-semibold">构建任务视图（全平台最近 50 条）</div>
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-2 py-2 font-medium">知识库</th>
                <th className="px-2 py-2 font-medium">类型</th>
                <th className="px-2 py-2 font-medium">状态</th>
                <th className="px-2 py-2 font-medium">进度</th>
                <th className="px-2 py-2 font-medium">失败</th>
                <th className="px-2 py-2 font-medium">参数</th>
                <th className="px-2 py-2 font-medium">创建时间</th>
                <th className="px-2 py-2 font-medium">错误</th>
                <th className="px-2 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {(overviewQuery.data?.builds ?? []).length === 0 ? (
                <tr><td colSpan={9} className="px-2 py-4 text-center text-neutral-400">暂无构建任务 —— 在知识库设置中开启向量检索后自动创建</td></tr>
              ) : (
                overviewQuery.data?.builds.map((b) => {
                  const pct = b.total_docs > 0 ? Math.round((b.done_docs / b.total_docs) * 100) : 0;
                  return (
                    <tr key={b.id} className="border-t" style={{ borderColor: 'var(--border-soft)' }}>
                      <td className="max-w-[160px] truncate px-2 py-2" title={b.project_name}>{b.project_name}</td>
                      <td className="px-2 py-2">{b.kind === 'vector-rebuild' ? '重建' : '构建'}</td>
                      <td className="px-2 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BUILD_STATUS[b.status]?.cls ?? ''}`}>
                          {BUILD_STATUS[b.status]?.label ?? b.status}
                        </span>
                      </td>
                      <td className="px-2 py-2 tabular-nums">{b.done_docs}/{b.total_docs || '?'}（{pct}%）</td>
                      <td className="px-2 py-2 tabular-nums">{b.failed_docs || '—'}</td>
                      <td className="px-2 py-2 font-mono text-[10px]" style={{ color: 'var(--text-muted, #64748b)' }}>
                        {b.params && Object.keys(b.params).length > 0 ? JSON.stringify(b.params) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">{fmtTime(b.created_at)}</td>
                      <td className="max-w-[160px] truncate px-2 py-2 font-mono text-[10px] text-rose-600" title={b.error ?? ''}>{b.error ?? '—'}</td>
                      <td className="px-2 py-2 text-right">
                        {b.status === 'failed' || b.status === 'canceled' ? (
                          <button
                            type="button"
                            className="text-primary-600 hover:underline disabled:opacity-40"
                            disabled={retryMutation.isPending}
                            onClick={() => retryMutation.mutate(b.id)}
                          >
                            重试
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
