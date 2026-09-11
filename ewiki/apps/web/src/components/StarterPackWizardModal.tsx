import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, Database, FileText, FolderKanban, GitBranch, Globe,
  HardDrive, Lock, RefreshCw, Sparkles, Users, Wand2, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { StarterPack } from '@ewiki/shared';
import { apiFetch } from '../lib/api/client';

// ---------------------------------------------------------------------------
// StarterPack 建库三步向导（PLAN 5.1.5，对照原型 Library.jsx StarterPackWizardModal）
// 字段取舍以 apps/server/src/http/routes-starter.ts 的 POST schema 为唯一事实源：
// schema 之外的原型字段一律隐藏或禁用（见各处「后端不支持」注释），绝不发送多余字段。
// ---------------------------------------------------------------------------

type Visibility = 'private' | 'team' | 'public';
// 「none」= 仅用模板、不绑定数据源（schema 中 sourceType 可为 null 的前端表达）
type SourceBackend = 'none' | 'git' | 'local';

// POST /api/v1/projects/init-from-starter 请求体（与 routes-starter.ts 逐字段对齐）
interface InitFromStarterBody {
  packId: string;
  name: string;
  visibility?: Visibility;
  sourceType?: 'git' | 'local' | null;
  sourceUrl?: string;
  autoSync?: boolean;
}

// POST 成功响应（201）shape：本地按需定义，仅声明 UI 用到的字段
interface InitFromStarterResp {
  project: { id: string; name: string };
  sourceId: string | null;
  packId: string;
}

interface ItemsResp<T> { items: T[]; }

// 向导第二步的表单状态
interface WizardForm {
  name: string;
  visibility: Visibility;
  sourceBackend: SourceBackend;
  sourceUrl: string;
  autoSync: boolean;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const VISIBILITY_OPTIONS: Array<{ value: Visibility; label: string; desc: string; Icon: LucideIcon }> = [
  { value: 'private', label: '私有', desc: '仅自己可见', Icon: Lock },
  { value: 'team', label: '团队', desc: '团队内成员可见', Icon: Users },
  { value: 'public', label: '公开', desc: '互联网可访问', Icon: Globe },
];

const BACKEND_OPTIONS: Array<{ key: SourceBackend; label: string; desc: string; Icon: LucideIcon }> = [
  { key: 'none', label: '仅模板', desc: '不绑定数据源', Icon: FileText },
  { key: 'git', label: 'Git 仓库', desc: '远程仓库同步', Icon: GitBranch },
  { key: 'local', label: '本地文件夹', desc: '本地路径导入', Icon: HardDrive },
];

const FORM_DEFAULT: WizardForm = {
  name: '',
  visibility: 'private',
  sourceBackend: 'none',
  sourceUrl: '',
  autoSync: false,
};

// ---------------------------------------------------------------------------
// 主组件（父级以条件渲染方式挂载，卸载即重置全部状态）
// ---------------------------------------------------------------------------

export function StarterPackWizardModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 步骤用 number 而非 1|2|3 字面量：上一步需要 setStep(step - 1)，字面量运算会收窄失败
  const [step, setStep] = useState(1);
  const [packId, setPackId] = useState<string | null>(null);
  const [form, setForm] = useState<WizardForm>(FORM_DEFAULT);
  const [created, setCreated] = useState<InitFromStarterResp | null>(null);

  // 模板包列表（GET /api/v1/starter-packs → { items: StarterPack[] }）
  const { data, isLoading } = useQuery<ItemsResp<StarterPack>>({
    queryKey: ['starter-packs'],
    queryFn: () => apiFetch<ItemsResp<StarterPack>>('/api/v1/starter-packs'),
  });
  const packs = data?.items ?? [];
  const selectedPack = packs.find((p) => p.id === packId) ?? null;

  // 创建知识库（POST /api/v1/projects/init-from-starter）
  const initMutation = useMutation({
    mutationFn: (body: InitFromStarterBody) =>
      apiFetch<InitFromStarterResp>('/api/v1/projects/init-from-starter', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (resp) => {
      // 后端会创建项目、（可选）新建数据源并触发首次同步，逐一并失效相关缓存
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['library-sources'] });
      void queryClient.invalidateQueries({ queryKey: ['library-documents'] });
      setCreated(resp);
      setStep(3);
    },
  });

  // 组装请求体：只发 schema 声明过的字段
  const buildBody = (): InitFromStarterBody => {
    const body: InitFromStarterBody = {
      packId: packId as string,
      name: form.name.trim(),
      visibility: form.visibility,
    };
    if (form.sourceBackend !== 'none') {
      body.sourceType = form.sourceBackend;
      if (form.sourceUrl.trim()) body.sourceUrl = form.sourceUrl.trim();
      // 自动同步仅对 Git 源开放（本地路径场景无轮询语义）
      if (form.sourceBackend === 'git') body.autoSync = form.autoSync;
    }
    return body;
  };

  // Step1 无选中模板包、或 Step2 Git 源缺地址时禁止推进
  const nextDisabled =
    (step === 1 && !selectedPack) ||
    (step === 2 && (!form.name.trim() || (form.sourceBackend === 'git' && !form.sourceUrl.trim())));

  const handleSubmit = (): void => {
    if (!packId || !form.name.trim() || initMutation.isPending) return;
    initMutation.mutate(buildBody());
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  const stepLabel = step === 1 ? '选择模板包' : step === 2 ? '预览并配置' : '创建完成';

  return (
    <div
      className="animate-fade-up fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-xl">
        {/* 步骤头 */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900">从模板初始化知识库</h3>
              <div className="mt-0.5 text-[11px] text-neutral-500">
                Step {step} / 3 · {stepLabel}
              </div>
            </div>
          </div>
          <button type="button" className="btn-ghost !p-2" onClick={onClose} aria-label="关闭向导">
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {/* ---- Step 1：模板包选择网格 ---- */}
          {step === 1 && (
            <div>
              <div className="mb-4 text-xs text-neutral-500">
                选择一个最匹配你使用场景的模板包，它会帮你生成一套开箱即用的目录结构与示例文档
              </div>
              {isLoading ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="skeleton h-[88px] rounded-lg" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {packs.map((p) => {
                    const active = packId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPackId(p.id)}
                        className={`card p-4 text-left transition-all hover:shadow-md ${
                          active ? 'border-primary-200 ring-2 ring-primary-400' : ''
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* 后端 StarterPack 不返回 emoji/配色字段，统一用中性图标，避免编造展示数据 */}
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                            <FileText size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-neutral-900">{p.name}</div>
                            <div className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">{p.description}</div>
                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-neutral-400">
                              <FileText size={10} />
                              {p.docCount} 篇示例
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ---- Step 2：目录树预览 + 配置表单 ---- */}
          {step === 2 && selectedPack && (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              {/* 左：目录结构预览（tree 来自 GET 响应，schema 支持） */}
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neutral-700">
                  <FolderKanban size={12} />
                  目录结构预览
                </div>
                <div className="card scrollbar-thin max-h-[380px] space-y-0.5 overflow-y-auto p-4 font-mono text-xs">
                  <div className="flex items-center gap-1 font-semibold text-primary-600">
                    📁 {form.name.trim() || selectedPack.name}/
                  </div>
                  {selectedPack.tree.map((line) => {
                    // 原型约定：缩进按前导双空格计数，以 / 结尾视为目录
                    const indent = (line.match(/^  /g) ?? []).length;
                    const isFolder = line.endsWith('/');
                    const clean = line.trim();
                    return (
                      <div
                        key={line}
                        className={`flex items-center gap-1 text-neutral-600 ${isFolder ? 'font-medium text-neutral-700' : ''}`}
                        style={{ paddingLeft: `${indent * 14 + 14}px` }}
                      >
                        {isFolder ? '📁' : '📄'} {clean}
                      </div>
                    );
                  })}
                </div>
                {selectedPack.sampleTags.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-[11px] text-neutral-500">示例标签</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedPack.sampleTags.map((t) => (
                        <span key={t} className="tag-neutral !text-[10px]">#{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 右：配置表单 */}
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-neutral-700">
                    知识库名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="例如：EdgeAgent 架构笔记"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    autoFocus
                  />
                </div>

                {/* 后端 init-from-starter 不接受 description 字段（项目描述固定取模板包描述），
                    故不渲染原型的描述输入框，待后端 schema 扩展后回补 */}

                <div>
                  <label className="mb-2 block text-sm font-medium text-neutral-700">可见性</label>
                  <div className="space-y-2">
                    {VISIBILITY_OPTIONS.map(({ value, label, desc, Icon }) => {
                      const active = form.visibility === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setForm({ ...form, visibility: value })}
                          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                            active
                              ? 'border-primary-200 bg-primary-50 ring-1 ring-primary-100'
                              : 'border-neutral-200 hover:border-neutral-300'
                          }`}
                        >
                          <Icon size={14} className={active ? 'text-primary-600' : 'text-neutral-400'} />
                          <div>
                            <div className="text-sm font-medium text-neutral-800">{label}</div>
                            <div className="text-[11px] text-neutral-500">{desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 数据源绑定（schema 仅支持 git / local；数据库后端暂不支持） */}
                <div className="border-t border-neutral-100 pt-3">
                  <label className="mb-2 block text-sm font-medium text-neutral-700">
                    数据源 <span className="font-normal text-neutral-400">(可选)</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {BACKEND_OPTIONS.map(({ key, label, Icon }) => {
                      const active = form.sourceBackend === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setForm({ ...form, sourceBackend: key, sourceUrl: '', autoSync: false })}
                          className={`rounded-lg border p-2.5 text-center transition-all ${
                            active
                              ? 'border-primary-200 bg-primary-50 text-primary-600 ring-2 ring-primary-100'
                              : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                          }`}
                        >
                          <Icon size={18} className="mx-auto" />
                          <div className="mt-1 text-[11px] font-medium">{label}</div>
                        </button>
                      );
                    })}
                  </div>
                  {/* 后端 init-from-starter 的 sourceType 仅支持 'git' | 'local'，数据库源暂不可选 */}
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-neutral-400">
                    <Database size={11} className="shrink-0" />
                    数据库数据源暂不支持，后续版本开放
                    {/* TODO：后端 sourceType 扩展 'database' 后回补数据库源表单 */}
                  </div>

                  {/* Git 源：仓库地址（schema 仅接受 sourceUrl 一个 Git 字段） */}
                  {form.sourceBackend === 'git' && (
                    <div className="mt-3 space-y-2">
                      <label className="block text-[11px] font-medium text-neutral-600">
                        仓库地址 <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        className="input font-mono !py-1.5 !text-xs"
                        placeholder="https://github.com/org/repo.git"
                        value={form.sourceUrl}
                        onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
                      />
                      {/* 后端固定 defaultBranch='main' 且不接受分支/认证参数，
                          原型的分支、认证方式、用户名、Token 表单字段裁剪 */}
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
                        <input
                          type="checkbox"
                          checked={form.autoSync}
                          onChange={(e) => setForm({ ...form, autoSync: e.target.checked })}
                          className="accent-primary-600"
                        />
                        创建后自动定时同步（每小时）
                      </label>
                    </div>
                  )}

                  {/* 本地源：文件夹路径（存入数据源 configPublic.path） */}
                  {form.sourceBackend === 'local' && (
                    <div className="mt-3 space-y-2">
                      <label className="block text-[11px] font-medium text-neutral-600">本地路径</label>
                      <input
                        type="text"
                        className="input font-mono !py-1.5 !text-xs"
                        placeholder="C:/Users/you/Documents/wiki/"
                        value={form.sourceUrl}
                        onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
                      />
                      {/* 后端源路径仅接受单个 url/path 字符串，原型的「最终路径预览」无拼接语义，裁剪 */}
                      <div className="text-[10px] text-neutral-400">
                        留空则先只用模板创建，之后可在数据源页面补充绑定
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-[11px] leading-relaxed text-neutral-500">
                  💡 模板只负责初始化目录结构和示例文档，之后你可以随时修改、新增或删除文件，也可以切换到其他模板。
                </div>
              </div>
            </div>
          )}

          {/* ---- Step 3：成功庆祝页 ---- */}
          {step === 3 && created && (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="text-lg font-semibold text-neutral-900">知识库已创建！</div>
              <div className="mt-1 text-sm text-neutral-500">
                「<span className="font-medium text-neutral-800">{created.project.name}</span>」
                已按 <span className="text-primary-600">{selectedPack?.name}</span> 模板初始化
                {selectedPack && <>，共 {selectedPack.docCount} 篇示例文档</>}。
              </div>
              {created.sourceId && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700">
                  <RefreshCw size={13} className="text-primary-600" />
                  数据源已绑定，正在同步首批文档
                </div>
              )}
              <div className="mt-5 flex items-center justify-center gap-3">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  留在文档库
                </button>
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-1.5"
                  onClick={() => navigate(`/projects/${created.project.id}/browse`)}
                >
                  进入文档库
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        {step < 3 && (
          <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50/50 px-6 py-4">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
              disabled={initMutation.isPending}
            >
              {step > 1 && <ArrowLeft size={14} />}
              {step > 1 ? '上一步' : '取消'}
            </button>
            <div className="flex items-center gap-2">
              {step === 1 && (
                <button
                  type="button"
                  className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!selectedPack}
                  onClick={() => setStep(2)}
                >
                  下一步
                  <ArrowRight size={14} />
                </button>
              )}
              {step === 2 && (
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={nextDisabled || initMutation.isPending}
                  onClick={handleSubmit}
                >
                  {initMutation.isPending ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      初始化中…
                    </>
                  ) : (
                    <>
                      <Wand2 size={14} />
                      创建知识库
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
