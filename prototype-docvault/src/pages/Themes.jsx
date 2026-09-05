import { useState, useEffect } from 'react'
import {
  Palette,
  Rocket,
  Sparkles,
  Check,
  Star,
  Eye,
  X,
  ChevronDown,
  ArrowRight,
  Copy,
  Download,
  Layout,
  BookOpen,
  LifeBuoy,
  FileCode,
  Grid3X3,
} from 'lucide-react'
import { fetchTemplates, fetchProjects, renderPreview } from '../api/stubs.js'

// ---------------------------------------------------------------------------
// UI Themes — 管理视图主题（本地固定选项）
// ---------------------------------------------------------------------------

const UI_THEMES = [
  {
    id: 'fresh-emerald',
    name: '清新翠绿',
    accent: '#10b981',
    description: '低饱和翠绿为主色，适合长时间阅读不疲劳，侧边栏清爽。',
    bodyFont: 'font-sans',
  },
  {
    id: 'deep-indigo',
    name: '深邃靛蓝',
    accent: '#4f46e5',
    description: '沉稳靛蓝搭配冷灰，科技感强，适合工程团队。',
    bodyFont: 'font-sans',
  },
  {
    id: 'warm-amber',
    name: '暖阳琥珀',
    accent: '#f59e0b',
    description: '暖色调主色，卡片密度舒适，适合内容创作场景。',
    bodyFont: 'font-serif',
  },
  {
    id: 'minimal-rose',
    name: '极简玫瑰',
    accent: '#f43f5e',
    description: '低饱和玫红点缀，紧凑卡片密度，适合追求简约的团队。',
    bodyFont: 'font-sans',
  },
]

// ---------------------------------------------------------------------------
// Publishing Theme Meta（从旧 Templates.jsx 复制）
// ---------------------------------------------------------------------------

const TEMPLATE_META = {
  't-docs': {
    zhLabel: '文档站',
    category: 'official',
    author: 'DocVault 官方',
    stars: 1284,
    accent: '#0ea5e9',
    description: '左侧导航 + 右侧内容，技术文档的经典形态。',
    bodyFont: 'font-sans',
  },
  't-blog': {
    zhLabel: '博客',
    category: 'official',
    author: 'DocVault 官方',
    stars: 932,
    accent: '#f43f5e',
    description: '杂志风卡片 + 精选推荐位，适合发布产品故事。',
    bodyFont: 'font-serif',
  },
  't-product': {
    zhLabel: '产品首页',
    category: 'official',
    author: 'DocVault 官方',
    stars: 756,
    accent: '#14b8a6',
    description: 'Hero + 特性三栏 + 定价 CTA，营销导向的单页模板。',
    bodyFont: 'font-sans',
  },
  't-wiki': {
    zhLabel: '知识库',
    category: 'official',
    author: 'DocVault 官方',
    stars: 1120,
    accent: '#8b5cf6',
    description: '树形目录 + 知识图谱视图，沉淀组织的第二大脑。',
    bodyFont: 'font-sans',
  },
  't-api': {
    zhLabel: 'API 参考',
    category: 'official',
    author: 'DocVault 官方',
    stars: 640,
    accent: '#f59e0b',
    description: '端点分组 + Try-it 面板，代码优先的 API 文档模板。',
    bodyFont: 'font-mono',
  },
}

const CATEGORY_TABS = [
  { key: 'all', label: '全部' },
  { key: 'official', label: '官方模板' },
  { key: 'community', label: '社区模板' },
  { key: 'favorites', label: '我的收藏' },
]

// ---------------------------------------------------------------------------
// UI Theme Card — 管理视图主题卡片
// ---------------------------------------------------------------------------

function UiThemeCard({ theme, isActive, onApply, delayMs = 0 }) {
  return (
    <div
      className="card-hover animate-fade-up relative group"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="p-5 space-y-4">
        {/* Accent swatch + active check */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-xl ring-2 ring-white shadow-sm flex items-center justify-center"
              style={{ backgroundColor: theme.accent }}
            >
              <Sparkles size={18} className="text-white" />
            </div>
            {isActive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[11px] font-semibold">
                <Check size={11} />
                已应用
              </span>
            )}
          </div>
        </div>

        {/* Name + description */}
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-neutral-900 leading-tight">
            {theme.name}
          </h3>
          <p className="text-xs text-neutral-500 leading-relaxed line-clamp-2">
            {theme.description}
          </p>
        </div>

        {/* Accent bar */}
        <div className="flex items-center gap-1.5">
          <div
            className="h-1.5 flex-1 rounded-full"
            style={{ backgroundColor: theme.accent }}
          />
          <span className="text-[10px] font-mono text-neutral-400 uppercase">
            {theme.accent}
          </span>
        </div>

        {/* Apply button */}
        <button
          type="button"
          onClick={() => onApply(theme.id)}
          className={`w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition ${
            isActive
              ? 'bg-neutral-100 text-neutral-500 cursor-default'
              : 'btn-primary'
          }`}
        >
          {isActive ? (
            <>
              <Check size={13} />
              当前主题
            </>
          ) : (
            <>
              应用
              <ArrowRight size={13} />
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 模板预览区 — 内联 SVG + Tailwind mock（从旧 Templates.jsx 复制）
// ---------------------------------------------------------------------------

function DocsPreview() {
  return (
    <div className="h-full w-full bg-gradient-to-b from-sky-50 to-white relative overflow-hidden">
      <div className="h-5 bg-white border-b border-neutral-200 flex items-center px-2">
        <div className="w-10 h-1 rounded bg-sky-500/60" />
        <div className="w-6 h-1 rounded bg-neutral-200 ml-2" />
      </div>
      <div className="flex h-[calc(100%-20px)]">
        <div className="w-[34%] bg-white border-r border-neutral-200 p-2.5 space-y-1.5">
          <div className="h-1.5 w-full rounded bg-sky-100" />
          <div className="h-1 w-3/4 rounded bg-sky-100/70" />
          <div className="h-1 w-5/6 rounded bg-neutral-100 mt-1.5" />
          <div className="h-1 w-2/3 rounded bg-neutral-100" />
          <div className="h-1 w-4/5 rounded bg-neutral-100" />
          <div className="h-1 w-1/2 rounded bg-neutral-100 mt-1.5" />
          <div className="h-1 w-3/5 rounded bg-neutral-100" />
        </div>
        <div className="flex-1 p-3">
          <div className="h-2.5 w-11/12 rounded bg-neutral-800 mb-2" />
          <div className="h-1.5 w-full rounded bg-neutral-200 mb-1" />
          <div className="h-1.5 w-11/12 rounded bg-neutral-200 mb-1" />
          <div className="h-1.5 w-4/5 rounded bg-neutral-200 mb-2" />
          <div className="h-1.5 w-8/12 rounded bg-sky-100 mb-1" />
          <div className="h-1.5 w-10/12 rounded bg-neutral-200 mt-1" />
          <div className="h-1.5 w-full rounded bg-neutral-200" />
          <div className="mt-2 h-10 rounded-md bg-neutral-900/90 relative overflow-hidden">
            <div className="absolute top-1.5 left-2 w-10 h-1 rounded bg-neutral-600" />
            <div className="absolute top-3.5 left-2 w-14 h-1 rounded bg-primary-400/80" />
            <div className="absolute top-5.5 left-2 w-8 h-1 rounded bg-sky-400/80" />
          </div>
        </div>
      </div>
    </div>
  )
}

function BlogPreview() {
  return (
    <div className="h-full w-full bg-gradient-to-br from-rose-50 via-white to-amber-50 relative overflow-hidden p-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[7px] font-semibold tracking-wider text-rose-500 uppercase">
          The Journal
        </div>
        <div className="flex gap-1">
          <div className="w-5 h-0.5 bg-neutral-800" />
          <div className="w-3 h-0.5 bg-neutral-300" />
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1.5 h-[calc(100%-20px)]">
        <div className="col-span-3 rounded-sm overflow-hidden relative bg-gradient-to-br from-rose-400 via-rose-500 to-pink-600">
          <div className="absolute inset-0 opacity-30">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <circle cx="70" cy="30" r="28" fill="white" opacity="0.25" />
              <circle cx="20" cy="80" r="20" fill="white" opacity="0.2" />
              <path d="M0 60 Q 25 40 50 55 T 100 50 L 100 100 L 0 100 Z" fill="white" opacity="0.18" />
            </svg>
          </div>
          <div className="absolute bottom-1.5 left-2 right-2">
            <div className="h-1 w-3/4 rounded bg-white/80 mb-1" />
            <div className="h-0.5 w-1/2 rounded bg-white/50" />
          </div>
        </div>

        <div className="col-span-2 space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white/80 rounded-sm p-1.5 border border-neutral-200">
              <div className="h-1 w-full rounded bg-neutral-800 mb-0.5" />
              <div className="h-0.5 w-4/5 rounded bg-neutral-300 mb-0.5" />
              <div className="h-0.5 w-3/4 rounded bg-neutral-300" />
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-1.5 right-2 text-[7px] text-rose-500 font-medium flex items-center gap-0.5">
        阅读更多
        <ArrowRight size={8} />
      </div>
    </div>
  )
}

function ProductSitePreview() {
  return (
    <div className="h-full w-full bg-white relative overflow-hidden">
      <div className="h-[42%] bg-gradient-to-br from-teal-500 via-teal-600 to-cyan-700 relative overflow-hidden">
        <svg viewBox="0 0 200 80" className="absolute inset-0 w-full h-full opacity-25">
          <defs>
            <pattern id="dots-product" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="0.8" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots-product)" />
        </svg>
        <div className="absolute inset-0 p-3 flex flex-col justify-center">
          <div className="h-2.5 w-10/12 rounded bg-white/95 mb-1.5" />
          <div className="h-1 w-7/12 rounded bg-white/60 mb-2" />
          <div className="flex gap-1.5">
            <div className="h-2.5 w-10 rounded bg-white rounded-sm" />
            <div className="h-2.5 w-10 rounded bg-white/20 border border-white/60 rounded-sm" />
          </div>
        </div>
      </div>

      <div className="h-[58%] grid grid-cols-3 gap-1.5 p-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-md border border-neutral-200 p-1.5 bg-neutral-50/50">
            <div
              className="w-3.5 h-3.5 rounded-sm mb-1.5"
              style={{
                background: ['linear-gradient(135deg,#14b8a6,#22d3ee)', 'linear-gradient(135deg,#14b8a6,#0ea5e9)', 'linear-gradient(135deg,#14b8a6,#a7f3d0)'][i],
              }}
            />
            <div className="h-1 w-full rounded bg-neutral-800 mb-0.5" />
            <div className="h-0.5 w-4/5 rounded bg-neutral-300 mb-0.5" />
            <div className="h-0.5 w-3/5 rounded bg-neutral-300" />
          </div>
        ))}
      </div>
    </div>
  )
}

function WikiPreview() {
  return (
    <div className="h-full w-full bg-gradient-to-br from-violet-50 via-white to-indigo-50 relative overflow-hidden">
      <div className="h-5 bg-white/90 backdrop-blur border-b border-neutral-200 flex items-center px-2 gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
        <div className="h-1 w-12 rounded bg-neutral-300" />
        <div className="ml-auto h-1 w-4 rounded bg-neutral-300" />
      </div>

      <div className="flex h-[calc(100%-20px)]">
        <div className="w-[30%] p-1.5 bg-white/60 border-r border-neutral-200 space-y-1">
          {['📁 方法论', '📁 读书笔记', '📁 AI', '📄 第二大脑.md', '📄 提示词工程', '📄 思考快与慢'].map(
            (label, i) => (
              <div
                key={label}
                className={`h-2.5 rounded px-1 text-[6px] flex items-center ${
                  i === 3 ? 'bg-violet-100 text-violet-700' : 'bg-transparent text-neutral-600'
                }`}
              >
                {label}
              </div>
            ),
          )}
        </div>

        <div className="flex-1 relative">
          <svg viewBox="0 0 200 160" className="w-full h-full">
            <line x1="100" y1="80" x2="50" y2="40" stroke="#c4b5fd" strokeWidth="0.8" />
            <line x1="100" y1="80" x2="160" y2="50" stroke="#c4b5fd" strokeWidth="0.8" />
            <line x1="100" y1="80" x2="60" y2="130" stroke="#c4b5fd" strokeWidth="0.8" />
            <line x1="100" y1="80" x2="150" y2="125" stroke="#c4b5fd" strokeWidth="0.8" />
            <line x1="50" y1="40" x2="160" y2="50" stroke="#ddd6fe" strokeWidth="0.6" strokeDasharray="2,2" />

            <circle cx="100" cy="80" r="10" fill="#8b5cf6" />
            <circle cx="100" cy="80" r="14" fill="#8b5cf6" opacity="0.18" />
            <text x="100" y="83" textAnchor="middle" fontSize="6" fill="white" fontWeight="600">
              中心笔记
            </text>

            {[
              { x: 50, y: 40, label: '方法论', color: '#a78bfa' },
              { x: 160, y: 50, label: 'AI', color: '#c084fc' },
              { x: 60, y: 130, label: '读书', color: '#818cf8' },
              { x: 150, y: 125, label: '项目', color: '#a5b4fc' },
              { x: 100, y: 25, label: '灵感', color: '#e879f9' },
            ].map((n) => (
              <g key={n.label}>
                <circle cx={n.x} cy={n.y} r="7" fill={n.color} opacity="0.85" />
                <text x={n.x} y={n.y + 2} textAnchor="middle" fontSize="5" fill="white">
                  {n.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  )
}

function ApiRefPreview() {
  return (
    <div className="h-full w-full bg-neutral-50 relative overflow-hidden flex font-mono">
      <div className="w-[40%] bg-white border-r border-neutral-200 flex flex-col">
        <div className="h-5 px-2 flex items-center border-b border-neutral-200 bg-neutral-50">
          <div className="h-1 w-10 rounded bg-neutral-300" />
        </div>
        <div className="flex-1 overflow-hidden">
          {[
            { m: 'GET', p: '/v1/devices', active: true, c: 'bg-emerald-500' },
            { m: 'POST', p: '/v1/devices', c: 'bg-amber-500' },
            { m: 'GET', p: '/v1/devices/:id', c: 'bg-emerald-500' },
            { m: 'DELETE', p: '/v1/devices/:id', c: 'bg-rose-500' },
            { m: 'GET', p: '/v1/health', c: 'bg-emerald-500' },
            { m: 'WS', p: '/v1/events', c: 'bg-sky-500' },
          ].map((ep) => (
            <div
              key={ep.p}
              className={`flex items-center gap-1 px-2 py-1 border-b border-neutral-100 text-[8px] ${
                ep.active ? 'bg-amber-50' : ''
              }`}
            >
              <span
                className={`${ep.c} text-white px-1 rounded-sm text-[6px] font-bold tracking-wide w-8 text-center`}
              >
                {ep.m}
              </span>
              <span className="text-neutral-700 truncate flex-1">{ep.p}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 bg-neutral-900 p-2 relative">
        <div className="flex gap-1 mb-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        </div>
        <pre className="text-[7px] leading-[14px]">
          <code>
            <span className="text-slate-500">{`// GET /v1/devices`}</span>{'\n'}
            <span className="text-pink-400">curl</span>{' '}
            <span className="text-emerald-300">-H</span>{' '}
            <span className="text-amber-300">'Authorization: Bearer ...'</span>{'\n\n'}
            <span className="text-slate-500">{`// Response 200 OK`}</span>{'\n'}
            <span className="text-sky-300">{'{'}</span>{'\n'}
            <span>{'  '}</span>
            <span className="text-violet-300">"items"</span>
            <span className="text-slate-400">:</span> <span className="text-sky-300">[</span>{'\n'}
            <span>{'    '}</span>
            <span className="text-violet-300">"id"</span>
            <span className="text-slate-400">:</span>{' '}
            <span className="text-amber-200">"dev-001"</span>
            <span className="text-slate-400">,</span>{'\n'}
            <span>{'    '}</span>
            <span className="text-violet-300">"status"</span>
            <span className="text-slate-400">:</span>{' '}
            <span className="text-emerald-300">"online"</span>{'\n'}
            <span>{'  '}</span>
            <span className="text-sky-300">]</span>
            <span className="text-slate-400">,</span>{'\n'}
            <span>{'  '}</span>
            <span className="text-violet-300">"total"</span>
            <span className="text-slate-400">:</span>{' '}
            <span className="text-amber-200">128</span>{'\n'}
            <span className="text-sky-300">{'}'}</span>
          </code>
        </pre>
      </div>
    </div>
  )
}

const PREVIEW_MAP = {
  docs: DocsPreview,
  blog: BlogPreview,
  'product-site': ProductSitePreview,
  wiki: WikiPreview,
  'api-ref': ApiRefPreview,
}

// ---------------------------------------------------------------------------
// Publishing Template Card — 带"发布"悬停按钮 + 官方/社区标签
// ---------------------------------------------------------------------------

function PublishingTemplateCard({
  template,
  onOpen,
  onToggleFavorite,
  favorite,
  onPublish,
  index,
}) {
  const meta = TEMPLATE_META[template.id] || {
    zhLabel: template.name,
    accent: '#6366f1',
    author: '社区贡献',
    stars: 120,
    description: template.description,
    category: 'community',
  }
  const PreviewComp = PREVIEW_MAP[template.type] || DocsPreview

  return (
    <div
      className="card-hover overflow-hidden animate-fade-up relative group"
      style={{ animationDelay: `${index * 70}ms` }}
      onClick={() => onOpen(template)}
    >
      {/* Top-right category tag */}
      <div className="absolute top-2 right-2 z-10">
        <span
          className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            meta.category === 'official'
              ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'
              : 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
          }`}
        >
          {meta.category === 'official' ? (
            <>
              <Sparkles size={9} />
              官方
            </>
          ) : (
            <>
              <Grid3X3 size={9} />
              社区
            </>
          )}
        </span>
      </div>

      {/* Preview area */}
      <div
        className="h-[180px] border-b border-neutral-100 relative"
        style={{ background: meta.bg || '#fff' }}
      >
        <PreviewComp />
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-neutral-900/0 hover:bg-neutral-900/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-md shadow text-xs font-medium text-neutral-800">
            <Eye size={13} />
            预览效果
          </div>
        </div>
      </div>

      {/* Info area */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-neutral-900 truncate">
              {meta.zhLabel} · {template.name.replace(/^(标准文档|博客|产品官网|团队 Wiki|API 参考)\s*/, '')}
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5 line-clamp-2 leading-snug">
              {meta.description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-3 text-xs text-neutral-400">
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded-full bg-neutral-100 inline-flex items-center justify-center text-[9px] text-neutral-500">
              {meta.author.slice(0, 1)}
            </span>
            {meta.author}
          </span>
          <span className="flex items-center gap-0.5">
            <Star size={11} className="text-amber-400 fill-amber-400" />
            {meta.stars.toLocaleString()}
          </span>
        </div>

        {/* Bottom actions */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-neutral-100 relative">
          <button
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition ${
              favorite
                ? 'bg-amber-50 text-amber-600'
                : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite(template.id)
            }}
          >
            <Star
              size={12}
              className={favorite ? 'fill-amber-400 text-amber-400' : ''}
            />
            {favorite ? '已收藏' : '收藏'}
          </button>

          {/* Group: hover reveals "发布" button */}
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
              onClick={(e) => {
                e.stopPropagation()
                onOpen(template)
              }}
            >
              应用到…
              <ArrowRight size={13} />
            </button>
            {/* Hover reveal "发布" btn-primary */}
            <button
              className="inline-flex items-center gap-1 text-xs opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 btn-primary !py-1 !px-2.5 !text-[11px]"
              onClick={(e) => {
                e.stopPropagation()
                onPublish(template)
              }}
            >
              <Rocket size={11} />
              发布
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preview Modal
// ---------------------------------------------------------------------------

function PreviewModal({ template, projects, html, onClose, onApply, loading }) {
  const meta = TEMPLATE_META[template?.id] || {}
  const [primaryColor, setPrimaryColor] = useState(meta.accent || '#2ca894')
  const [sidebarRight, setSidebarRight] = useState(false)
  const [showCopyToast, setShowCopyToast] = useState(false)

  const colorPresets = ['#2ca894', '#0ea5e9', '#f43f5e', '#8b5cf6', '#f59e0b', '#14b8a6']

  const copyHtml = () => {
    navigator.clipboard?.writeText(html || '')
    setShowCopyToast(true)
    setTimeout(() => setShowCopyToast(false), 1500)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[88vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <div>
            <div className="flex items-center gap-2 text-xs text-neutral-500 mb-0.5">
              <Palette size={13} className="text-primary-600" />
              模板预览
            </div>
            <h2 className="font-display text-lg font-bold text-neutral-900">
              {meta.zhLabel} · {template?.name}
            </h2>
          </div>
          <button
            className="btn-ghost !px-2 !py-1.5 text-neutral-500"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_280px] min-h-0">
          <div className="bg-neutral-100 p-6 overflow-auto min-h-[360px]">
            <div
              className="bg-white rounded-lg shadow-md overflow-hidden mx-auto max-w-[680px]"
              style={{
                borderLeft: sidebarRight ? undefined : `3px solid ${primaryColor}`,
                borderRight: sidebarRight ? `3px solid ${primaryColor}` : undefined,
              }}
            >
              <div className="h-8 bg-neutral-50 border-b border-neutral-200 flex items-center gap-2 px-3">
                <div className="flex gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                </div>
                <div className="flex-1 h-4 rounded bg-white border border-neutral-200 flex items-center px-2 text-[10px] text-neutral-400">
                  https://docs.your-company.io/architecture/overview
                </div>
              </div>

              {loading ? (
                <div className="p-10 space-y-2">
                  <div className="skeleton h-6 w-3/4" />
                  <div className="skeleton h-3 w-full" />
                  <div className="skeleton h-3 w-5/6" />
                  <div className="skeleton h-3 w-4/5" />
                  <div className="skeleton h-20 w-full mt-3 rounded" />
                </div>
              ) : (
                <div
                  className={`prose-doc p-8 ${meta.bodyFont || ''}`}
                  dangerouslySetInnerHTML={{
                    __html: html || '<p class="text-neutral-400 text-sm">暂无预览内容</p>',
                  }}
                />
              )}
            </div>
          </div>

          <div className="border-l border-neutral-200 bg-neutral-50/40 overflow-auto">
            <div className="p-5 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 mb-3 flex items-center gap-1.5">
                  <Palette size={14} className="text-primary-600" />
                  外观定制
                </h3>

                <label className="block text-xs text-neutral-500 mb-2">主色调</label>
                <div className="flex items-center gap-1.5 mb-2">
                  {colorPresets.map((c) => (
                    <button
                      key={c}
                      onClick={() => setPrimaryColor(c)}
                      className={`w-6 h-6 rounded-md border-2 transition ${
                        primaryColor === c
                          ? 'border-neutral-900 scale-110'
                          : 'border-white'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`选择颜色 ${c}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-7 h-7 rounded border border-neutral-200 cursor-pointer bg-white"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="input !py-1 !text-xs !w-24 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-neutral-500 mb-2">侧边栏位置</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'left', label: '左侧', icon: '⬅' },
                    { key: 'right', label: '右侧', icon: '➡' },
                  ].map((o) => (
                    <button
                      key={o.key}
                      onClick={() => setSidebarRight(o.key === 'right')}
                      className={`py-1.5 rounded-md text-xs font-medium border transition ${
                        (o.key === 'right' ? sidebarRight : !sidebarRight)
                          ? 'border-primary-400 bg-primary-50 text-primary-700'
                          : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-neutral-500 mb-2">
                  应用到已有项目
                </label>
                <div className="relative">
                  <select className="input appearance-none pr-7">
                    <option value="">— 选择项目 —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
                  />
                </div>
              </div>

              <div className="rounded-md border border-primary-100 bg-primary-50/50 p-3 text-xs text-primary-800">
                <div className="flex items-start gap-1.5">
                  <Sparkles size={13} className="mt-0.5 flex-shrink-0" />
                  <p>应用模板后，你的文档会以全新的视觉形态呈现，原 Markdown 内容不会被修改。</p>
                </div>
              </div>

              <button
                onClick={copyHtml}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-md border border-neutral-200 bg-white text-xs text-neutral-600 hover:bg-neutral-50"
              >
                {showCopyToast ? (
                  <>
                    <Check size={13} className="text-emerald-500" />
                    已复制预览 HTML
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    复制预览 HTML
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-200 bg-white">
          <button className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={onApply}>
            <Rocket size={15} />
            应用此模板
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HERO icons
// ---------------------------------------------------------------------------

const HERO_ICONS = [Palette, BookOpen, Layout, LifeBuoy, FileCode, Grid3X3]

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Themes() {
  const [activeTab, setActiveTab] = useState('ui') // 'ui' | 'publishing'
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState([])
  const [projects, setProjects] = useState([])

  const [activeUiTheme, setActiveUiTheme] = useState('fresh-emerald')
  const [favorites, setFavorites] = useState(['t-docs'])
  const [categoryTab, setCategoryTab] = useState('all')

  const [openTemplate, setOpenTemplate] = useState(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [toast, setToast] = useState({ show: false, msg: '' })

  useEffect(() => {
    ;(async () => {
      const [ts, ps] = await Promise.all([fetchTemplates(), fetchProjects()])
      setTemplates(ts)
      setProjects(ps)
      setLoading(false)
    })()
  }, [])

  const showToast = (msg) => {
    setToast({ show: true, msg })
    setTimeout(() => setToast({ show: false, msg: '' }), 1800)
  }

  // UI theme apply
  const handleApplyUiTheme = (id) => {
    if (id === activeUiTheme) return
    setActiveUiTheme(id)
    showToast('主题已应用')
  }

  // Publishing template filter
  const filteredTemplates = templates.filter((t) => {
    const meta = TEMPLATE_META[t.id] || { category: 'community' }
    if (categoryTab === 'all') return true
    if (categoryTab === 'official') return meta.category === 'official'
    if (categoryTab === 'community') return meta.category === 'community'
    if (categoryTab === 'favorites') return favorites.includes(t.id)
    return true
  })

  const openPreview = async (tpl) => {
    setOpenTemplate(tpl)
    setPreviewLoading(true)
    const html = await renderPreview('d-101', tpl.id)
    setPreviewHtml(html)
    setPreviewLoading(false)
  }

  const toggleFavorite = (id) => {
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const handleApplyPublishing = () => {
    showToast('模板已应用成功 ✨')
    setOpenTemplate(null)
  }

  const handlePublish = (tpl) => {
    showToast(`正在使用「${TEMPLATE_META[tpl.id]?.zhLabel || tpl.name}」发布...`)
  }

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-6">
      {/* Page Header */}
      <section className="animate-fade-up">
        <div className="card p-6 bg-gradient-to-br from-primary-50 via-white to-white border-primary-100 relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-40 h-40 opacity-[0.08] pointer-events-none">
            <div className="grid grid-cols-3 gap-3">
              {HERO_ICONS.map((I, i) => (
                <I key={i} size={28} className="text-primary-700" />
              ))}
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 relative">
            <div>
              <div className="flex items-center gap-2 text-primary-600 text-xs font-medium mb-1">
                <Palette size={14} />
                Theme & Template Center
              </div>
              <h1 className="font-display text-2xl font-bold text-neutral-900">
                主题与模板
              </h1>
              <p className="text-sm text-neutral-500 mt-1 max-w-lg">
                管理 DocVault 界面外观 + 选择合适的发布模板，让你的文档库以不同形态呈现。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Main tabs: UI vs Publishing */}
      <section
        className="animate-fade-up"
        style={{ animationDelay: '60ms' }}
      >
        <div className="inline-flex items-center gap-1 p-1 bg-neutral-100 rounded-full shadow-inner">
          <button
            type="button"
            onClick={() => setActiveTab('ui')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
              activeTab === 'ui'
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            <Palette size={15} />
            管理视图主题
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('publishing')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
              activeTab === 'publishing'
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            <Rocket size={15} />
            发布网站主题
          </button>
        </div>
      </section>

      {/* Tab content */}
      {activeTab === 'ui' ? (
        /* =============== UI THEMES =============== */
        <section
          className="animate-fade-up"
          style={{ animationDelay: '100ms' }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-neutral-800">
                管理视图主题
              </span>
              <span className="text-xs text-neutral-400">· 控制 DocVault 界面本身的配色与密度</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {UI_THEMES.map((t, i) => (
              <UiThemeCard
                key={t.id}
                theme={t}
                isActive={activeUiTheme === t.id}
                onApply={handleApplyUiTheme}
                delayMs={i * 60}
              />
            ))}
          </div>
        </section>
      ) : (
        /* =============== PUBLISHING THEMES =============== */
        <section
          className="animate-fade-up"
          style={{ animationDelay: '100ms' }}
        >
          {/* Sub-category filter pills */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setCategoryTab(tab.key)}
                className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  categoryTab === tab.key
                    ? 'bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200'
                    : 'text-neutral-500 hover:text-neutral-700 bg-neutral-50'
                }`}
              >
                {tab.label}
                {tab.key === 'favorites' && favorites.length > 0 && (
                  <span className="ml-1 text-amber-500">· {favorites.length}</span>
                )}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="card overflow-hidden">
                  <div className="h-[180px] skeleton" />
                  <div className="p-4 space-y-3">
                    <div className="skeleton h-4 w-3/5" />
                    <div className="skeleton h-3 w-full" />
                    <div className="skeleton h-3 w-2/3" />
                    <div className="flex justify-between pt-2">
                      <div className="skeleton h-4 w-14" />
                      <div className="skeleton h-4 w-16" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="card p-12 text-center text-neutral-400">
              该分类下暂无模板
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredTemplates.map((tpl, i) => (
                <PublishingTemplateCard
                  key={tpl.id}
                  template={tpl}
                  index={i}
                  onOpen={openPreview}
                  onToggleFavorite={toggleFavorite}
                  favorite={favorites.includes(tpl.id)}
                  onPublish={handlePublish}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Preview Modal (only for publishing tab) */}
      {openTemplate && activeTab === 'publishing' && (
        <PreviewModal
          template={openTemplate}
          projects={projects}
          html={previewHtml}
          loading={previewLoading}
          onClose={() => setOpenTemplate(null)}
          onApply={handleApplyPublishing}
        />
      )}

      {/* Toast */}
      {toast.show && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] animate-fade-up">
          <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-neutral-900 text-white text-sm shadow-lg">
            <Check size={15} className="text-emerald-400" />
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  )
}
