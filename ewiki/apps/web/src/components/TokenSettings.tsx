// ---------------------------------------------------------------------------
// 设置 →「API 令牌」（OPEN-API-MCP-DESIGN §6.1/§7.4）：
//   PAT 自助管理：签发（scope 预设 + write 二次风险确认，评审决议 1）/ 吊销 / 用量。
//   明文仅在签发响应中出现一次，弹窗展示 + 复制引导。
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenCheck, Copy, KeyRound, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api/client.js';
import { ClientOnboardingWizard } from './ClientOnboarding.js';

interface TokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastIp: string | null;
  revokedAt: string | null;
  createdAt: string;
  usage7d: { searchCount: number; readCount: number; writeCount: number; rejectedCount: number };
}

interface TokenPolicy {
  allowTokens: boolean;
  maxScope: 'search' | 'read' | 'write';
  ipAllowlist: string[];
}

interface IssuedToken {
  token: string;
  prefix: string;
  id: string;
  name: string;
  scopes: string[];
  expiresAt: string | null;
}

type Preset = 'search' | 'read' | 'write';
const PRESETS: Array<{ key: Preset; label: string; scopes: string[]; desc: string }> = [
  { key: 'search', label: '检索专用', scopes: ['search'], desc: '仅检索（AI 问答 / RAG）' },
  { key: 'read', label: '只读', scopes: ['search', 'read'], desc: '检索 + 读取文档全文与整理建议' },
  { key: 'write', label: '读写', scopes: ['search', 'read', 'write'], desc: '允许 AI 创建/修改/删除文档与新建知识库' },
];

function fmtDate(v: string | null): string {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return v;
  }
}

const SCOPE_LABEL: Record<string, string> = { search: '检索', read: '读', write: '写' };

export function TokenSettings(): React.ReactElement {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<Preset>('search');
  const [expiryDays, setExpiryDays] = useState<number>(365);
  const [writeAck, setWriteAck] = useState(false);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // AI 客户端接入向导（ClientOnboarding）：'' = 常驻入口占位预览；非空 = 携带刚签发的明文
  const [wizardToken, setWizardToken] = useState<string | null>(null);

  const { data: policy } = useQuery<TokenPolicy>({
    queryKey: ['me-token-policy'],
    queryFn: () => apiFetch<TokenPolicy>('/api/v1/me/token-policy'),
  });
  const { data, isLoading } = useQuery<{ items: TokenRow[] }>({
    queryKey: ['me-tokens'],
    queryFn: () => apiFetch<{ items: TokenRow[] }>('/api/v1/me/tokens'),
  });

  const presetScopes = useMemo(() => PRESETS.find((p) => p.key === preset)?.scopes ?? ['search'], [preset]);
  // write 二次风险确认（决议 1）：未勾选确认时禁用签发
  const needsAck = presetScopes.includes('write');
  const blocked = needsAck && !writeAck;

  const createMut = useMutation({
    mutationFn: (body: { name: string; scopes: string[]; expiresInDays: number | null }) =>
      apiFetch<IssuedToken>('/api/v1/me/tokens', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (res) => {
      setIssued(res);
      setCopied(false);
      setName('');
      setWriteAck(false);
      setFormMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['me-tokens'] });
    },
    onError: (e) => setFormMsg({ ok: false, text: e instanceof Error ? e.message : '签发失败' }),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/me/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['me-tokens'] }),
    onError: (e) => window.alert(e instanceof Error ? e.message : '吊销失败'),
  });

  const policyBlocked = policy ? !policy.allowTokens : false;
  const scopeExceeds = policy ? presetScopes.includes('write') && policy.maxScope !== 'write' : false;
  const canSubmit = name.trim().length > 0 && !blocked && !policyBlocked && !scopeExceeds && !createMut.isPending;

  const copyToken = async (): Promise<void> => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert('复制失败，请手动选中文本复制');
    }
  };

  return (
    <>
      {/* 签发表单 */}
      <section className="card p-6">
        <div className="mb-1 flex items-center gap-2">
          <KeyRound size={16} className="text-primary-600" />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>签发 API 令牌</h2>
          <button
            type="button"
            className="btn-ghost ml-auto !h-7 !px-2 !text-[11px]"
            onClick={() => setWizardToken('')}
            title="生成 edith / Claude / Cursor 等 AI 客户端的接入配置"
          >
            <BookOpenCheck size={13} /> AI 客户端接入
          </button>
        </div>
        <p className="mb-4 text-xs leading-relaxed" style={{ color: 'var(--text-muted, #94a3b8)' }}>
          供 AI 客户端（MCP）或第三方工具以你的身份访问知识库。令牌权限不超过你的账号权限；泄露请立即吊销。
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>令牌名称</label>
            <input className="input" placeholder="如：我的 Claude" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>权限预设</label>
            <div className="grid gap-2 sm:grid-cols-3">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => { setPreset(p.key); setWriteAck(false); }}
                  className={`rounded-lg border p-2.5 text-left transition ${
                    preset === p.key ? 'border-primary-400 bg-primary-50' : 'border-[var(--border-soft)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{p.label}</div>
                  <div className="mt-0.5 text-[11px] leading-snug" style={{ color: 'var(--text-muted, #94a3b8)' }}>{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>有效期</label>
            <select className="input" value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value))}>
              <option value={30}>30 天</option>
              <option value={90}>90 天</option>
              <option value={365}>1 年（推荐）</option>
              <option value={0}>永不过期</option>
            </select>
          </div>

          {needsAck && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                <ShieldAlert size={14} /> 写权限风险确认
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-amber-800">
                <input type="checkbox" className="mt-0.5 accent-amber-600" checked={writeAck} onChange={(e) => setWriteAck(e.target.checked)} />
                我了解：该令牌允许 AI 客户端以我的身份<strong>创建知识库、新建/修改/移动/删除文档</strong>（删除为软删，可在站内恢复）。
                泄露或被滥用的写入将计入我的账号审计记录。
              </label>
            </div>
          )}

          {policy?.maxScope && policy.maxScope !== 'write' && (
            <p className="text-xs" style={{ color: 'var(--text-muted, #94a3b8)' }}>
              所属团队策略将令牌权限封顶为「{SCOPE_LABEL[policy.maxScope] ?? policy.maxScope}」，更高权限的预设不可签发。
            </p>
          )}
          {policyBlocked && (
            <p className="text-xs text-rose-600">所属组织的团队令牌策略已禁用 API 令牌，请联系管理员。</p>
          )}
          {formMsg && !formMsg.ok && <p className="text-xs text-rose-600">{formMsg.text}</p>}

          <button type="button" className="btn-primary !h-9 w-full !text-xs" disabled={!canSubmit} onClick={() => createMut.mutate({ name: name.trim(), scopes: presetScopes, expiresInDays: expiryDays || null })}>
            <Plus size={14} /> {createMut.isPending ? '签发中…' : '签发令牌'}
          </button>
        </div>
      </section>

      {/* 令牌列表 */}
      <section className="card p-6">
        <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>我的令牌</h2>
        {isLoading ? (
          <div className="skeleton h-16 w-full" />
        ) : !data?.items.length ? (
          <p className="text-xs" style={{ color: 'var(--text-muted, #94a3b8)' }}>还没有令牌。签发后在 AI 客户端中以 Bearer 方式使用。</p>
        ) : (
          <div className="space-y-2.5">
            {data.items.map((t) => {
              const expired = t.expiresAt ? new Date(t.expiresAt).getTime() < Date.now() : false;
              return (
                <div key={t.id} className={`rounded-lg border p-3 ${t.revokedAt || expired ? 'opacity-55' : ''}`} style={{ borderColor: 'var(--border-soft)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t.name}</span>
                        <code className="rounded bg-[var(--bg-hover)] px-1 py-0.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>{t.tokenPrefix}…</code>
                        {t.scopes.map((s) => (
                          <span key={s} className="tag tag-neutral !text-[10px]">{SCOPE_LABEL[s] ?? s}</span>
                        ))}
                        {t.revokedAt ? <span className="tag tag-danger !text-[10px]">已吊销</span> : expired ? <span className="tag tag-danger !text-[10px]">已过期</span> : null}
                      </div>
                      <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--text-muted, #94a3b8)' }}>
                        创建于 {fmtDate(t.createdAt)} · 过期 {t.expiresAt ? fmtDate(t.expiresAt) : '永不'}
                        {' · '}最近使用 {t.lastUsedAt ? `${fmtDate(t.lastUsedAt)}${t.lastIp ? `（${t.lastIp}）` : ''}` : '从未'}
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted, #94a3b8)' }}>
                        近 7 天：检索 {t.usage7d.searchCount} · 读 {t.usage7d.readCount} · 写 {t.usage7d.writeCount}{t.usage7d.rejectedCount > 0 ? ` · 限流拒绝 ${t.usage7d.rejectedCount}` : ''}
                      </div>
                    </div>
                    {!t.revokedAt && (
                      <button
                        type="button"
                        className="btn-ghost !p-1.5 text-rose-600"
                        title="吊销（立即生效）"
                        onClick={() => {
                          if (window.confirm(`确定吊销令牌「${t.name}」？使用它的 AI 客户端将立即失去访问能力。`)) revokeMut.mutate(t.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 签发成功弹窗：明文仅显示一次（内联 modal，TeamPage 模式） */}
      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setIssued(null)}>
          <div className="card w-full max-w-md p-6 animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>令牌已签发</h3>
            <p className="mb-3 text-xs text-amber-700">请立即复制保存 —— 明文仅此一次显示，关闭后无法再次查看。</p>
            <div className="mb-3 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-[var(--bg-hover)] p-2.5 font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>{issued.token}</code>
              <button type="button" className="btn-secondary !h-8 shrink-0 !text-xs" onClick={() => void copyToken()}>
                <Copy size={13} /> {copied ? '已复制' : '复制'}
              </button>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn-primary !h-8 !text-xs"
                onClick={() => {
                  const tok = issued.token;
                  setIssued(null);
                  setWizardToken(tok);
                }}
              >
                <BookOpenCheck size={13} /> 接入 AI 客户端
              </button>
              <button type="button" className="btn-secondary !h-8 !text-xs" onClick={() => setIssued(null)}>我已保存，关闭</button>
            </div>
          </div>
        </div>
      )}
      {/* AI 客户端接入向导（edith 优先；携带明文或占位预览） */}
      {wizardToken !== null && <ClientOnboardingWizard token={wizardToken} onClose={() => setWizardToken(null)} />}
    </>
  );
}
