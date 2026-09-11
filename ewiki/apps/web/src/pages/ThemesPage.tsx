import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Check, ChevronDown, Circle, Copy, Eye, Grid3X3, Monitor, Palette, Rocket, Sparkles, Star, Sun, Moon, Wand2, X,
} from 'lucide-react';
import { THEMES, type ThemeDef } from '@ewiki/theme';
import { apiFetch } from '../lib/api/client';
import { useTheme } from '../theme/ThemeProvider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PublishTemplate {
  id: string;
  name: string;
  zhLabel: string;
  desc: string;
  layout: string;
  accent: string;
  target: string;
  emoji: string;
  stars: number;
  // 分类筛选（PLAN 5.3.7，对齐原型 CATEGORY_TABS）：当前 5 套均为官方模板
  category: 'official' | 'community';
}

// 发布模板对齐原型 Themes.jsx TEMPLATE_META / mock data.js:853-897（PLAN 2.4 残留）
const PUBLISH_TEMPLATES: PublishTemplate[] = [
  {
    id: 't-docs',
    name: '标准文档 Docs',
    zhLabel: '文档站',
    desc: '左侧导航 + 右侧内容，技术文档的经典形态。',
    layout: 'sidebar-wide',
    accent: '#0ea5e9',
    target: '文档',
    emoji: '📚',
    stars: 1284,
    category: 'official',
  },
  {
    id: 't-blog',
    name: '博客 Blog',
    zhLabel: '博客',
    desc: '杂志风卡片 + 精选推荐位，适合发布产品故事。',
    layout: 'sidebar',
    accent: '#f43f5e',
    target: '博客',
    emoji: '✍️',
    stars: 932,
    category: 'official',
  },
  {
    id: 't-product',
    name: '产品官网 Product Site',
    zhLabel: '产品首页',
    desc: 'Hero + 特性三栏 + 定价 CTA，营销导向的单页模板。',
    layout: 'hero',
    accent: '#14b8a6',
    target: '官网',
    emoji: '🌐',
    stars: 756,
    category: 'official',
  },
  {
    id: 't-wiki',
    name: '团队 Wiki',
    zhLabel: '知识库',
    desc: '树形目录 + 知识图谱视图，沉淀组织的第二大脑。',
    layout: 'grid',
    accent: '#8b5cf6',
    target: '知识库',
    emoji: '🧠',
    stars: 1120,
    category: 'official',
  },
  {
    id: 't-api',
    name: 'API 参考 API Ref',
    zhLabel: 'API 参考',
    desc: '端点分组 + Try-it 面板，代码优先的 API 文档模板。',
    layout: 'split',
    accent: '#f59e0b',
    target: 'API',
    emoji: '🔗',
    stars: 640,
    category: 'official',
  },
];

/** 注意：不能与 ThemeProvider 用同一 key（'ewiki-ui-theme'）——否则会双向覆盖 */
const PUBLISH_TPL_KEY = 'ewiki-publish-template';
/** 模板收藏（PLAN 5.3.7，对齐原型 favorites，默认收藏 t-docs） */
const FAV_TPL_KEY = 'ewiki-tpl-favorites';

/** 分类筛选 tabs（对齐原型 Themes.jsx:84-89 CATEGORY_TABS） */
const CATEGORY_TABS: Array<{ key: 'all' | 'official' | 'community' | 'favorites'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'official', label: '官方模板' },
  { key: 'community', label: '社区模板' },
  { key: 'favorites', label: '我的收藏' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadStr(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function saveStr(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

function loadList(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : fallback;
  } catch { return fallback; }
}

function saveList(key: string, value: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Theme card — UI Theme 预览
// ---------------------------------------------------------------------------

function UiThemeCard({ theme, active, onSelect, dark, delayMs = 0 }: {
  theme: ThemeDef; active: boolean; onSelect: () => void; dark?: boolean; delayMs?: number;
}): React.ReactElement {
  const primary = theme.palette[500];
  const surface = dark ? '#0f172a' : '#fafafa';

  return (
    <button
      type="button"
      onClick={onSelect}
      // 卡片入场 stagger（PLAN 5.3.7，对齐原型 UiThemeCard animationDelay）
      className={`group animate-fade-up text-left rounded-xl border overflow-hidden transition-all ${
        active ? 'ring-2 ring-primary-500 ring-offset-2 border-primary-300' : 'border-neutral-200 hover:border-neutral-300 hover:shadow-md'
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {/* Preview */}
      <div
        className="relative h-28 p-3"
        style={{ background: surface }}
      >
        {/* 主题预览 · Navigation Bar 示例 */}
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-5 h-5 rounded"
            style={{ background: primary }}
          />
          <div
            className="h-2 w-14 rounded-full"
            style={{ background: dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }}
          />
          <div
            className="ml-auto h-5 w-14 rounded text-[8px] flex items-center justify-center font-medium"
            style={{ background: primary, color: '#fff' }}
          >
            主要
          </div>
        </div>
        {/* 主题预览 · Content Area 示例 */}
        <div className="space-y-1.5">
          <div
            className="h-2.5 w-3/4 rounded-full"
            style={{ background: dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.7)' }}
          />
          <div
            className="h-1.5 w-full rounded-full"
            style={{ background: dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }}
          />
          <div
            className="h-1.5 w-5/6 rounded-full"
            style={{ background: dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }}
          />
        </div>
        {/* Accent dot */}
        <div
          className="absolute bottom-3 right-3 w-2 h-2 rounded-full"
          style={{ background: theme.accent }}
        />
        {/* Check badge */}
        {active && (
          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary-600 text-white flex items-center justify-center shadow-sm">
            <Check size={12} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 border-t" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: primary }}
          />
          <span className="text-xs font-semibold text-neutral-900 truncate">{theme.name}</span>
        </div>
        <div className="text-[11px] text-neutral-500 mt-0.5 line-clamp-1">{theme.description}</div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Publish template card
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Publish template layout mock —— 卡片预览与 PreviewModal 共用
//   accent：外观定制主色覆盖（PreviewModal 用）；flip：侧栏放右侧（仅 sidebar 系布局生效）
// ---------------------------------------------------------------------------

function TemplateLayoutPreview({ tpl, accent, flip = false }: {
  tpl: PublishTemplate; accent?: string; flip?: boolean;
}): React.ReactElement {
  const a = accent ?? tpl.accent;
  const flipCls = flip ? ' flex-row-reverse' : '';
  return (
    <>
      {tpl.layout === 'sidebar' && (
        <div className={`flex h-full gap-1${flipCls}`}>
          <div className="w-1/3 rounded bg-neutral-100 p-1">
            <div className="h-1 w-full rounded bg-neutral-200 mb-1" />
            <div className="h-1 w-3/4 rounded bg-neutral-200 mb-0.5" />
            <div className="h-1 w-1/2 rounded bg-neutral-200" />
          </div>
          <div className="flex-1 rounded bg-neutral-50 p-1.5">
            <div className="h-2 w-2/3 rounded mb-1.5" style={{ background: a }} />
            <div className="h-1 w-full rounded bg-neutral-200 mb-0.5" />
            <div className="h-1 w-5/6 rounded bg-neutral-200 mb-0.5" />
            <div className="h-1 w-4/5 rounded bg-neutral-200" />
          </div>
        </div>
      )}
      {tpl.layout === 'sidebar-wide' && (
        <div className={`flex h-full gap-1${flipCls}`}>
          <div className="w-1/4 rounded bg-neutral-100" />
          <div className="flex-1 rounded bg-neutral-50 p-1.5">
            <div className="h-2 w-1/2 rounded mb-1.5" style={{ background: a }} />
            <div className="space-y-1">
              <div className="h-1 w-full rounded bg-neutral-200" />
              <div className="h-1 w-11/12 rounded bg-neutral-200" />
              <div className="h-1 w-4/5 rounded bg-neutral-200" />
              <div className="h-1 w-3/4 rounded bg-neutral-200" />
              <div className="h-1 w-5/6 rounded bg-neutral-200" />
            </div>
          </div>
        </div>
      )}
      {tpl.layout === 'split' && (
        <div className={`flex h-full gap-1${flipCls}`}>
          <div className="w-1/2 rounded bg-neutral-100 p-1">
            <div className="h-1.5 w-full rounded mb-1" style={{ background: a }} />
            <div className="h-1 w-full rounded bg-neutral-200 mb-0.5" />
            <div className="h-1 w-2/3 rounded bg-neutral-200" />
          </div>
          <div className="w-1/2 rounded bg-neutral-50 p-1">
            <div className="h-1.5 w-full rounded mb-1" style={{ background: a }} />
            <div className="h-1 w-full rounded bg-neutral-200 mb-0.5" />
            <div className="h-1 w-3/4 rounded bg-neutral-200" />
          </div>
        </div>
      )}
      {tpl.layout === 'grid' && (
        <div className="grid grid-cols-2 gap-1 h-full">
          <div className="rounded p-1.5 text-white" style={{ background: a }}>
            <div className="h-1 w-2/3 rounded bg-white/40" />
          </div>
          <div className="rounded bg-neutral-100 p-1">
            <div className="h-1 w-1/2 rounded bg-neutral-300 mb-1" />
            <div className="h-1 w-full rounded bg-neutral-200" />
          </div>
          <div className="rounded bg-neutral-100 p-1">
            <div className="h-1 w-3/5 rounded bg-neutral-300 mb-1" />
            <div className="h-1 w-full rounded bg-neutral-200" />
          </div>
          <div className="rounded bg-neutral-100 p-1">
            <div className="h-1 w-1/2 rounded bg-neutral-300 mb-1" />
            <div className="h-1 w-4/5 rounded bg-neutral-200" />
          </div>
        </div>
      )}
      {tpl.layout === 'hero' && (
        <div className="flex h-full flex-col gap-1.5">
          {/* Hero 大标题区 */}
          <div className="rounded p-2 flex flex-col items-center justify-center gap-1" style={{ background: `${a}18` }}>
            <div className="h-2.5 w-2/3 rounded" style={{ background: a }} />
            <div className="h-1 w-1/2 rounded bg-neutral-200" />
            <div className="h-4 w-16 rounded text-white text-[8px] flex items-center justify-center mt-0.5" style={{ background: a }}>
              CTA
            </div>
          </div>
          {/* 特性三栏 */}
          <div className="grid grid-cols-3 gap-1 flex-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded bg-neutral-50 p-1 flex flex-col gap-0.5">
                <div className="h-1.5 w-1/2 rounded" style={{ background: a }} />
                <div className="h-1 w-full rounded bg-neutral-200" />
                <div className="h-1 w-3/4 rounded bg-neutral-200" />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function PublishTemplateCard({ tpl, active, favorite, delayMs = 0, onSelect, onToggleFavorite, onPreview }: {
  tpl: PublishTemplate; active: boolean; favorite: boolean; delayMs?: number;
  onSelect: () => void; onToggleFavorite: () => void; onPreview: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      // 卡片入场 stagger（PLAN 5.3.7，对齐原型 PublishingTemplateCard index*70ms）
      className={`group animate-fade-up text-left rounded-xl border overflow-hidden transition-all ${
        active ? 'ring-2 ring-primary-500 ring-offset-2 border-primary-300' : 'border-neutral-200 hover:border-neutral-300 hover:shadow-md'
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="h-[180px] relative bg-white p-2.5">
        <TemplateLayoutPreview tpl={tpl} />
        {/* hover 遮罩（对齐原型 Themes.jsx:516-523 「预览效果」，点击打开 PreviewModal） */}
        <div className="absolute inset-0 bg-neutral-900/0 group-hover:bg-neutral-900/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <span role="button" tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-[11px] font-medium text-neutral-800 shadow">
            <Eye size={12} /> 预览效果
          </span>
        </div>
        {/* 分类角标（对齐原型 :488-508 官方/社区 pill） */}
        <span className={`absolute top-2 right-2 z-10 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          tpl.category === 'official'
            ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'
            : 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
        }`}>
          {tpl.category === 'official' ? <Sparkles size={9} /> : <Grid3X3 size={9} />}
          {tpl.category === 'official' ? '官方' : '社区'}
        </span>
        {active && (
          <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-primary-600 text-white flex items-center justify-center shadow-sm">
            <Check size={12} />
          </div>
        )}
      </div>
      <div className="p-3 border-t" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-neutral-900 truncate">{tpl.zhLabel} · {tpl.name.replace(/^(标准文档|博客|产品官网|团队|API 参考)/, '').trim() || tpl.name}</span>
          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">
            {tpl.target}
          </span>
        </div>
        <div className="text-[11px] text-neutral-500 mt-0.5 line-clamp-2 leading-relaxed">{tpl.desc}</div>
        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t text-[10px] text-neutral-400" style={{ borderColor: 'var(--border-soft)' }}>
          <span className="inline-flex items-center gap-1">
            <Star size={10} /> {tpl.stars}
          </span>
          {/* 收藏（PLAN 5.3.7，对齐原型 :553-569，amber 高亮） */}
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
              favorite ? 'bg-amber-50 text-amber-600' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
            }`}
          >
            <Star size={12} className={favorite ? 'fill-amber-400 text-amber-400' : ''} />
            {favorite ? '已收藏' : '收藏'}
          </span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// PreviewModal（EXT-PLATFORM Step1：预览接真实渲染 HTML，与 worker 发布同源 @ewiki/render）
//   画布 = 服务端 publish-preview 渲染的单文档页（iframe sandbox 隔离）；
//   未选项目/项目无文档时回退布局 mock。复制预览 HTML 已随端点解禁。
// ---------------------------------------------------------------------------

const PREVIEW_COLOR_PRESETS = ['#2ca894', '#0ea5e9', '#f43f5e', '#8b5cf6', '#f59e0b', '#14b8a6'];

function PreviewModal({ tpl, projects, targetProjectId, onTargetProject, onClose, onUseInPublish }: {
  tpl: PublishTemplate;
  projects: Array<{ id: string; name: string }>;
  targetProjectId: string;
  onTargetProject: (id: string) => void;
  onClose: () => void;
  onUseInPublish: () => void;
}): React.ReactElement {
  const [primaryColor, setPrimaryColor] = useState(tpl.accent);
  const [sidebarRight, setSidebarRight] = useState(false);
  const [copied, setCopied] = useState(false);

  // 预览样例文档：取项目内第一篇（无文档则端点回退索引页）
  const { data: docsData } = useQuery<{ items: Array<{ id: string }> }>({
    queryKey: ['preview-docs', targetProjectId],
    queryFn: () => apiFetch<{ items: Array<{ id: string }> }>(`/api/v1/projects/${targetProjectId}/documents`),
    enabled: !!targetProjectId,
  });
  const sampleDocId = docsData?.items[0]?.id ?? '';

  // 真实渲染 HTML（与发布管线同源）；参数变化即重渲染
  const { data: previewData, isLoading: previewLoading } = useQuery<{ html: string; scope: string }>({
    queryKey: ['publish-preview', targetProjectId, sampleDocId, tpl.id, primaryColor, sidebarRight],
    queryFn: () => apiFetch<{ html: string; scope: string }>(
      `/api/v1/projects/${targetProjectId}/publish-preview?docId=${sampleDocId}&templateId=${tpl.id}` +
      `&accent=${encodeURIComponent(primaryColor)}&sidebarSide=${sidebarRight ? 'right' : 'left'}`,
    ),
    enabled: !!targetProjectId && !!sampleDocId,
  });

  const previewHtml = previewData?.html ?? '';
  const copyHtml = async (): Promise<void> => {
    if (!previewHtml) return;
    try {
      await navigator.clipboard.writeText(previewHtml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 剪贴板不可用静默 */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-up items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl shadow-2xl"
        style={{ background: 'var(--bg-surface)' }}
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'var(--border-soft)' }}>
          <div>
            <div className="mb-0.5 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <Palette size={13} className="text-primary-600" />
              模板预览
            </div>
            <h2 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              {tpl.zhLabel} · {tpl.name}
            </h2>
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1.5" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_280px] min-h-0">
          {/* 预览画布：浏览器 chrome + 真实渲染 HTML（iframe sandbox 隔离） */}
          <div className="overflow-auto p-6 min-h-[360px]" style={{ background: 'var(--bg-page)' }}>
            <div className="mx-auto max-w-[680px] overflow-hidden rounded-lg shadow-md"
              style={{ background: 'var(--bg-surface)', borderTop: `3px solid ${primaryColor}` }}>
              <div className="flex h-8 items-center gap-2 border-b px-3" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-subtle)' }}>
                <div className="flex gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </div>
                <div className="flex h-4 flex-1 items-center rounded border px-2 text-[10px]" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                  https://docs.your-company.io/architecture/overview
                </div>
              </div>
              {previewLoading ? (
                <div className="space-y-2 p-8">
                  <div className="skeleton h-6 w-3/4" />
                  <div className="skeleton h-3 w-full" />
                  <div className="skeleton h-3 w-5/6" />
                  <div className="skeleton h-20 w-full rounded" />
                </div>
              ) : previewHtml ? (
                <iframe
                  title={`${tpl.zhLabel} 预览`}
                  srcDoc={previewHtml}
                  sandbox=""
                  className="h-[420px] w-full border-0 bg-white"
                />
              ) : (
                /* 未选项目或项目无文档：回退布局 mock */
                <div className="h-[420px] p-3">
                  <TemplateLayoutPreview tpl={tpl} accent={primaryColor} flip={sidebarRight} />
                </div>
              )}
            </div>
          </div>

          {/* 外观定制侧栏 */}
          <div className="overflow-auto border-l" style={{ borderColor: 'var(--border-soft)' }}>
            <div className="space-y-5 p-5">
              <div>
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <Palette size={14} className="text-primary-600" />
                  外观定制
                </h3>
                <label className="mb-2 block text-xs" style={{ color: 'var(--text-muted)' }}>主色调</label>
                <div className="mb-2 flex items-center gap-1.5">
                  {PREVIEW_COLOR_PRESETS.map((c) => (
                    <button key={c} type="button" onClick={() => setPrimaryColor(c)}
                      className={`h-6 w-6 rounded-md border-2 transition ${
                        primaryColor === c ? 'scale-110' : ''
                      }`}
                      style={{ backgroundColor: c, borderColor: primaryColor === c ? 'var(--text-primary)' : 'transparent' }}
                      aria-label={`选择颜色 ${c}`} />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border" style={{ borderColor: 'var(--border-soft)' }}
                    aria-label="自定义主色" />
                  <input type="text" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)}
                    className="input !w-24 !py-1 font-mono !text-xs" aria-label="主色色值" />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs" style={{ color: 'var(--text-muted)' }}>侧边栏位置</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'left', label: '左侧' },
                    { key: 'right', label: '右侧' },
                  ] as const).map((o) => (
                    <button key={o.key} type="button" onClick={() => setSidebarRight(o.key === 'right')}
                      className={`rounded-md border py-1.5 text-xs font-medium transition ${
                        (o.key === 'right') === sidebarRight
                          ? 'border-primary-400 bg-primary-50 text-primary-700'
                          : 'border-[var(--border-soft)] hover:bg-neutral-50'
                      }`}
                      style={(o.key === 'right') !== sidebarRight ? { color: 'var(--text-secondary)' } : undefined}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs" style={{ color: 'var(--text-muted)' }}>应用到已有项目</label>
                <div className="relative">
                  <select className="input cursor-pointer appearance-none pr-7"
                    value={targetProjectId} onChange={(e) => onTargetProject(e.target.value)}>
                    <option value="">— 选择项目 —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400" />
                </div>
              </div>

              <div className="rounded-md border border-primary-100 bg-primary-50/50 p-3 text-xs text-primary-800">
                <div className="flex items-start gap-1.5">
                  <Sparkles size={13} className="mt-0.5 shrink-0" />
                  <p>预览即发布效果：画布为服务端真实渲染的 HTML，与发布管线共用同一渲染器，原 Markdown 内容不会被修改。</p>
                </div>
              </div>

              <button type="button" disabled={!previewHtml}
                onClick={() => void copyHtml()}
                title={previewHtml ? '复制当前预览的完整 HTML' : '请先选择项目以生成预览'}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                {copied ? (
                  <><Check size={13} className="text-emerald-500" />已复制预览 HTML</>
                ) : (
                  <><Copy size={13} />复制预览 HTML</>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4" style={{ borderColor: 'var(--border-soft)' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
          <button type="button" className="btn-primary" onClick={onUseInPublish} disabled={!targetProjectId}
            title={targetProjectId ? `以「${tpl.zhLabel}」模板打开发布向导` : '请先选择目标项目'}>
            <Rocket size={15} />
            在发布中使用
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ThemesPage(): React.ReactElement {
  const { activeTheme, appearance, applyTheme, applyAppearance } = useTheme();
  const navigate = useNavigate();
  const [pendingThemeId, setPendingThemeId] = useState<string>(activeTheme.id);
  const [activePublishTpl, setActivePublishTpl] = useState<string>(() => loadStr(PUBLISH_TPL_KEY, 't-docs'));
  // 分类筛选 + 收藏（PLAN 5.3.7，对齐原型 Themes.jsx:826-827,856-877）
  const [categoryTab, setCategoryTab] = useState<'all' | 'official' | 'community' | 'favorites'>('all');
  const [favorites, setFavorites] = useState<string[]>(() => loadList(FAV_TPL_KEY, ['t-docs']));
  const [previewTplId, setPreviewTplId] = useState<string | null>(null);

  // 「在发布中使用」目标项目（PLAN 3.5/5.2.1：带 ?template= 跳转发布向导并预选模板）
  const { data: projectsData } = useQuery<{ items: Array<{ id: string; name: string }> }>({
    queryKey: ['projects'],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string }> }>('/api/v1/projects'),
  });
  const projects = projectsData?.items ?? [];
  const [targetProjectId, setTargetProjectId] = useState('');
  useEffect(() => {
    if (!targetProjectId && projects.length > 0) setTargetProjectId(projects[0].id);
  }, [projects, targetProjectId]);

  useEffect(() => { setPendingThemeId(activeTheme.id); }, [activeTheme.id]);
  useEffect(() => { saveStr(PUBLISH_TPL_KEY, activePublishTpl); }, [activePublishTpl]);
  useEffect(() => { saveList(FAV_TPL_KEY, favorites); }, [favorites]);

  const toggleFavorite = (id: string): void => {
    setFavorites((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // 分类过滤（对齐原型 Themes.jsx:856-863）
  const filteredTemplates = PUBLISH_TEMPLATES.filter((t) => {
    if (categoryTab === 'all') return true;
    if (categoryTab === 'official') return t.category === 'official';
    if (categoryTab === 'community') return t.category === 'community';
    if (categoryTab === 'favorites') return favorites.includes(t.id);
    return true;
  });
  const previewTpl = PUBLISH_TEMPLATES.find((t) => t.id === previewTplId) ?? null;

  const isDark = appearance === 'dark';
  const currentUi = THEMES.find((t) => t.id === pendingThemeId) ?? THEMES[0]!;
  const currentTpl = PUBLISH_TEMPLATES.find((t) => t.id === activePublishTpl) ?? PUBLISH_TEMPLATES[0]!;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-neutral-400 text-xs mb-1">
            <Palette size={13} />
            <span>外观定制</span>
          </div>
          <h1 className="text-xl font-bold text-neutral-900">主题与模板</h1>
          <p className="text-xs text-neutral-500 mt-1">
            定制编辑器与界面的视觉风格，以及发布站点的默认布局模板
          </p>
        </div>

        {/* Section 1: UI Themes */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Wand2 size={14} className="text-primary-600" />
              <h2 className="text-sm font-semibold text-neutral-900">UI 主题 · 8 套</h2>
              <span className="text-[11px] text-neutral-400">共 {THEMES.length} 套 · CSS 变量驱动</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => applyAppearance('light')}
                className={`inline-flex items-center gap-1 h-6 px-2 rounded ${
                  !isDark ? 'bg-primary-100 text-primary-700' : 'text-neutral-500 hover:bg-neutral-100'
                }`}
              >
                <Sun size={10} /> 浅色
              </button>
              <button
                type="button"
                onClick={() => applyAppearance('dark')}
                className={`inline-flex items-center gap-1 h-6 px-2 rounded ${
                  isDark ? 'bg-primary-100 text-primary-700' : 'text-neutral-500 hover:bg-neutral-100'
                }`}
              >
                <Moon size={10} /> 深色
              </button>
            </div>
          </div>

          {(
            [
              ['modern', '现代风格'],
              ['cn-traditional', '中国传统色'],
            ] as const
          ).map(([cat, label]) => {
            const group = THEMES.filter((t) => t.styleCategory === cat);
            if (group.length === 0) return null;
            return (
              <div key={cat} className="mb-6 last:mb-0">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs text-primary-600">◆</span>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</h3>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{group.length} 套</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {group.map((theme, gi) => (
                    <UiThemeCard
                      key={theme.id}
                      theme={theme}
                      active={pendingThemeId === theme.id}
                      dark={isDark}
                      delayMs={gi * 60}
                      onSelect={() => setPendingThemeId(theme.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Current theme summary */}
          <div className="mt-5 p-4 rounded-lg border flex items-center gap-3"
            style={{ borderColor: 'var(--border-soft)' }}>
            <div className="flex -space-x-1">
              <span className="w-6 h-6 rounded-full border-2 border-white" style={{ background: currentUi.palette[500] }} />
              <span className="w-6 h-6 rounded-full border-2 border-white" style={{ background: currentUi.accent }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-neutral-800">
                {pendingThemeId === activeTheme.id ? '当前' : '待应用'}：{currentUi.name}
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                {currentUi.description}
              </div>
            </div>
            <button
              type="button"
              onClick={() => applyTheme(pendingThemeId)}
              className="btn-secondary !h-7 !text-[11px]"
              disabled={pendingThemeId === activeTheme.id}
            >
              <Monitor size={11} /> {pendingThemeId === activeTheme.id ? '已应用' : '应用主题'}
            </button>
          </div>
        </section>

        {/* Section 2: Publish Templates */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-primary-600" />
              <h2 className="text-sm font-semibold text-neutral-900">发布模板 · 5 套</h2>
              <span className="text-[11px] text-neutral-400">
                服务端模板源 · GET /publish-templates
              </span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-neutral-500">
              <Eye size={11} /> 选中后可一键带入发布向导
            </div>
          </div>

          {/* 分类筛选 pills（PLAN 5.3.7，对齐原型 Themes.jsx:1025-1042；收藏数高亮） */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {CATEGORY_TABS.map((tab) => (
              <button key={tab.key} type="button" onClick={() => setCategoryTab(tab.key)}
                className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  categoryTab === tab.key
                    ? 'bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200'
                    : 'bg-neutral-100 text-neutral-500 hover:text-neutral-700'
                }`}
                style={categoryTab === tab.key ? { background: 'var(--bg-surface)' } : undefined}>
                {tab.label}
                {tab.key === 'favorites' && favorites.length > 0 && (
                  <span className="ml-1 text-amber-500">· {favorites.length}</span>
                )}
              </button>
            ))}
          </div>

          {filteredTemplates.length === 0 ? (
            <div className="card p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              {categoryTab === 'favorites' ? '还没有收藏模板，点击卡片下方的 ☆ 收藏' : '该分类下暂无模板'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTemplates.map((tpl, i) => (
                <PublishTemplateCard
                  key={tpl.id}
                  tpl={tpl}
                  active={activePublishTpl === tpl.id}
                  favorite={favorites.includes(tpl.id)}
                  delayMs={i * 70}
                  onSelect={() => setActivePublishTpl(tpl.id)}
                  onToggleFavorite={() => toggleFavorite(tpl.id)}
                  onPreview={() => setPreviewTplId(tpl.id)}
                />
              ))}
            </div>
          )}

          <div className="mt-5 p-4 rounded-lg border border-dashed flex items-center gap-3"
            style={{ borderColor: 'var(--border-soft)' }}>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: currentTpl.accent + '20', color: currentTpl.accent }}
            >
              <Circle size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-neutral-800">
                默认模板：{currentTpl.name}（{currentTpl.target}）
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                选择模板后，发布向导将默认以此布局创建站点
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* 多项目时让用户选择带入目标（单项目隐藏直接用唯一项） */}
              {projects.length > 1 && (
                <select
                  value={targetProjectId}
                  onChange={(e) => setTargetProjectId(e.target.value)}
                  className="input !h-7 !w-36 !text-[11px] cursor-pointer"
                  aria-label="选择目标项目"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={!targetProjectId}
                title={targetProjectId ? `以「${currentTpl.zhLabel}」模板打开发布向导` : '暂无可用项目，请先创建项目'}
                onClick={() => navigate(`/projects/${targetProjectId}/publish?template=${activePublishTpl}`)}
                className="btn-secondary !h-7 !text-[11px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Rocket size={12} />
                在发布中使用
              </button>
            </div>
          </div>
        </section>

        {/* Footer note */}
        <p className="mt-8 text-[11px] text-neutral-400 flex items-center gap-1.5">
          <Eye size={11} /> 主题与模板选择保存在本地（后续版本将接入云端同步）
        </p>
      </div>

      {/* PreviewModal（PLAN 5.2 前端占位） */}
      {previewTpl && (
        <PreviewModal
          tpl={previewTpl}
          projects={projects}
          targetProjectId={targetProjectId}
          onTargetProject={setTargetProjectId}
          onClose={() => setPreviewTplId(null)}
          onUseInPublish={() => {
            setActivePublishTpl(previewTpl.id);
            navigate(`/projects/${targetProjectId}/publish?template=${previewTpl.id}`);
          }}
        />
      )}
    </div>
  );
}
