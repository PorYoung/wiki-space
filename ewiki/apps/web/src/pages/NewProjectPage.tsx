import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Cloud, GitBranch, FolderPlus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../lib/api/client';

/** 新建文档库向导（本期需求 5/7）：模板或空库 × 云文档或 Git 仓库（自动建仓/关联） */

interface LibraryTemplate {
  id: string;
  name: string;
  description: string;
  docCount: number;
}
interface ConnectionItem {
  id: string;
  name: string;
  kind: 'gitlab' | 'gitea';
  baseUrl: string;
  status: 'unverified' | 'ok' | 'error';
}
interface CreateResult {
  project: { id: string; name: string };
  docs: number;
  git?: { created: boolean; repo: string; branch: string; webUrl: string; message: string };
}

export function NewProjectPage(): React.ReactElement {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'team' | 'public'>('private');
  const [storageType, setStorageType] = useState<'cloud' | 'git'>('cloud');
  const [template, setTemplate] = useState('empty');
  const [connectionId, setConnectionId] = useState('');
  const [repoName, setRepoName] = useState('');
  const [autoInit, setAutoInit] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateResult | null>(null);

  const templatesQuery = useQuery({
    queryKey: ['library-templates'],
    queryFn: () => apiFetch<{ items: LibraryTemplate[] }>('/api/v1/library-templates'),
  });
  const connectionsQuery = useQuery({
    queryKey: ['connections'],
    queryFn: () => apiFetch<{ items: ConnectionItem[] }>('/api/v1/connections'),
  });
  const connections = useMemo(() => connectionsQuery.data?.items ?? [], [connectionsQuery.data]);

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<CreateResult>('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: description || undefined,
          visibility,
          template,
          storage:
            storageType === 'git'
              ? { kind: 'git', connectionId, repoName, autoInit }
              : { kind: 'local' },
        }),
      }),
    onSuccess: (res) => {
      setCreated(res);
      setStep(4);
    },
    onError: (err) => setError(err instanceof Error ? err.message : '创建失败'),
  });

  const canNext =
    (step === 1 && name.trim().length > 0) ||
    (step === 2 && (storageType === 'cloud' || (!!connectionId && /^[A-Za-z0-9_.-]{1,100}$/.test(repoName)))) ||
    step === 3;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg text-white" style={{ background: 'var(--color-primary-500)' }}>
          <FolderPlus size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold">新建文档库</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>基本信息 → 存储源 → 模板</p>
        </div>
      </div>

      <div className="mb-5 flex items-center gap-2">
        {['基本信息', '存储源', '模板', '完成'].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${step > i ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-400'}`}>
              {i + 1}
            </div>
            <span className={`text-xs ${step > i ? 'font-medium' : 'text-neutral-400'}`}>{s}</span>
            {i < 3 && <div className="h-px w-8 bg-neutral-200" />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="card space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium">知识库名称 *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：2026 旗舰项目空间" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">描述</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话介绍（可选）" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">可见性</label>
            <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'team' | 'public')}>
              <option value="private">私有（仅成员可见）</option>
              <option value="team">团队（登录用户可读）</option>
              <option value="public">公开（登录用户可读写入口可见）</option>
            </select>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <button type="button" onClick={() => setStorageType('cloud')}
            className={`card flex w-full items-center gap-4 p-5 text-left transition-all ${storageType === 'cloud' ? 'ring-2 ring-primary-500' : 'hover:opacity-90'}`}>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg text-white" style={{ background: 'var(--color-primary-500)' }}>
              <Cloud size={20} />
            </div>
            <div className="flex-1">
              <div className="font-semibold">本地存储（平台分配目录）</div>
              <div className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>
                文档保存在服务器配置的存储目录（模拟 NAS 盘），按文档库分目录落盘
              </div>
            </div>
            {storageType === 'cloud' && <CheckCircle2 size={18} className="text-primary-600" />}
          </button>

          <button type="button" onClick={() => setStorageType('git')}
            className={`card flex w-full items-center gap-4 p-5 text-left transition-all ${storageType === 'git' ? 'ring-2 ring-primary-500' : 'hover:opacity-90'}`}>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-900 text-white">
              <GitBranch size={20} />
            </div>
            <div className="flex-1">
              <div className="font-semibold">Git 仓库（GitLab / Gitea）</div>
              <div className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>
                指定仓库名称并选择连接配置；仓库不存在时自动初始化，每次保存文档自动提交推送
              </div>
            </div>
            {storageType === 'git' && <CheckCircle2 size={18} className="text-primary-600" />}
          </button>

          {storageType === 'git' && (
            <div className="card space-y-4 p-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium">连接配置 *</label>
                {connections.length === 0 ? (
                  <p className="text-xs text-danger">还没有存储源，请先到「存储源」页添加 GitLab / Gitea 连接。</p>
                ) : (
                  <select className="input" value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                    <option value="">请选择…</option>
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}（{c.kind === 'gitlab' ? 'GitLab' : 'Gitea'} · {c.status === 'ok' ? '已验证' : c.status === 'error' ? '验证失败' : '未验证'}）
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">仓库名称 *</label>
                <input className="input" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="如：team-wiki（字母/数字/._-）" />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted, #64748b)' }}>
                  仓库不存在时将自动创建并初始化；已存在时直接关联现有仓库
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={autoInit} onChange={(e) => setAutoInit(e.target.checked)} />
                仓库不存在时自动初始化
              </label>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          {(templatesQuery.data?.items ?? []).map((t) => (
            <button key={t.id} type="button" onClick={() => setTemplate(t.id)}
              className={`card flex w-full items-center gap-4 p-4 text-left transition-all ${template === t.id ? 'ring-2 ring-primary-500' : 'hover:opacity-90'}`}>
              <div className="flex-1">
                <div className="font-semibold">{t.name}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{t.description}</div>
              </div>
              <span className="text-xs text-neutral-400">{t.docCount > 0 ? `${t.docCount} 篇示例文档` : '空库'}</span>
              {template === t.id && <CheckCircle2 size={18} className="text-primary-600" />}
            </button>
          ))}
        </div>
      )}

      {step === 4 && created && (
        <div className="card p-6 text-center">
          <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" />
          <div className="text-lg font-bold">文档库「{created.project.name}」创建成功</div>
          <div className="mt-2 text-sm" style={{ color: 'var(--text-muted, #64748b)' }}>
            存储源：{created.git ? 'Git 仓库' : '本地存储（平台目录）'}
            {created.docs > 0 && ` · 已预置 ${created.docs} 篇模板文档`}
          </div>
          {created.git && (
            <div className="mx-auto mt-4 max-w-md rounded-lg bg-neutral-50 p-3 text-left text-xs">
              <div className="font-semibold">{created.git.created ? '已自动初始化仓库' : '已关联现有仓库'}</div>
              <div className="mt-1 font-mono" style={{ color: 'var(--text-muted, #64748b)' }}>
                {created.git.repo} · 默认分支 {created.git.branch}
              </div>
              <div className="mt-1">{created.git.message}</div>
              {created.git.webUrl && (
                <a className="mt-1 inline-block text-primary-600 underline" href={created.git.webUrl} target="_blank" rel="noreferrer">
                  在 Git 服务端查看仓库 →
                </a>
              )}
            </div>
          )}
          <button type="button" className="btn-primary mt-5" onClick={() => navigate(`/projects/${created.project.id}/browse`)}>
            进入文档库
          </button>
        </div>
      )}

      {error && step < 4 && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-danger">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {step < 4 && (
        <div className="mt-5 flex justify-between">
          <button type="button" className="btn-ghost" disabled={step === 1} onClick={() => { setStep((s) => s - 1); setError(null); }}>
            上一步
          </button>
          {step < 3 ? (
            <button type="button" className="btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              下一步
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? '创建中…' : '创建文档库'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
