import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Rocket, Globe, Palette, Check, ExternalLink, RefreshCw, Clock,
  FileText, Star, Copy, Play, X, FolderOpen, Settings, ChevronRight,
  CheckCircle2, AlertTriangle,
} from 'lucide-react'
import {
  fetchProject, fetchTemplates, fetchVersions, fetchDocuments, renderPreview,
} from '../api/stubs.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSlug(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function validateSlug(slug) {
  return /^[a-z0-9-]+$/.test(slug)
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function PublishSkeleton() {
  return (
    <div className="px-6 py-8 max-w-[860px] mx-auto space-y-5">
      {[1, 2, 3].map((n) => (
        <div key={n} className="animate-fade-up card p-5 space-y-4" style={{ animationDelay: `${n * 80}ms` }}>
          <div className="flex items-center gap-3">
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="skeleton h-5 w-40" />
          </div>
          <div className="skeleton h-10 w-full rounded-md" />
          <div className="skeleton h-20 w-full rounded-md" />
        </div>
      ))}
      <div className="animate-fade-up skeleton h-28 w-full rounded-lg" style={{ animationDelay: '360ms' }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProjectNotFound (inline — when project fetch fails)
// ---------------------------------------------------------------------------

function ProjectNotFound({ id }) {
  return (
    <div className="px-6 py-16 max-w-lg mx-auto animate-fade-up">
      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-10 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-neutral-100 flex items-center justify-center">
          <FolderOpen size={26} className="text-neutral-400" />
        </div>
        <h2 className="text-lg font-semibold text-neutral-900 mb-2">未找到项目</h2>
        <p className="text-sm text-neutral-500 mb-5">
          项目 <code className="font-mono bg-white border border-neutral-200 rounded px-1.5 py-0.5 text-xs">{id}</code> 不存在或已被删除。
        </p>
        <Link to="/library" className="btn-primary">
          返回全局文档库
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Content selection
// ---------------------------------------------------------------------------

function StepNumber({ n }) {
  return (
    <div className="w-8 h-8 shrink-0 rounded-full bg-primary-500 text-white flex items-center justify-center text-sm font-bold shadow-sm">
      {n}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Theme card (Step 2)
// ---------------------------------------------------------------------------

function ThemeCard({ theme, active, onClick, delay = 0 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`animate-fade-up card-hover text-left p-3 relative transition-all ${
        active ? 'ring-2 ring-primary-500 border-primary-500' : ''
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {active && (
        <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary-500 text-white flex items-center justify-center shadow-sm">
          <Check size={13} />
        </span>
      )}
      <div className={`w-12 h-12 rounded-lg ${theme.color || 'bg-primary-100'} flex items-center justify-center mb-2`}>
        <span className="text-xl">{theme.previewEmoji || '📄'}</span>
      </div>
      <div className="text-sm font-semibold text-neutral-800 leading-5">
        {theme.name}
      </div>
      <div className="text-[11px] text-neutral-500 mt-1 line-clamp-2 min-h-[28px]">
        {theme.description || ''}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-neutral-400">
        <Star size={11} className="text-amber-400 fill-amber-400" />
        <span>{theme.projectCount ?? 0} 个项目使用</span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Preview snippet (Step 2)
// ---------------------------------------------------------------------------

function PreviewSnippet({ html, templateName }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 overflow-hidden">
      {/* fake browser bar */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-white border-b border-neutral-200">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
        <span className="ml-3 text-[10px] text-neutral-400 font-mono">preview.docvault.dev</span>
        {templateName && (
          <span className="ml-auto text-[10px] text-primary-600 font-medium">
            {templateName}
          </span>
        )}
      </div>
      <div
        className="px-4 py-3 text-xs max-h-[120px] overflow-hidden text-neutral-700 leading-5"
        style={{ fontFamily: 'ui-sans-serif, system-ui' }}
        dangerouslySetInnerHTML={{
          __html: html || '<span class="text-neutral-400">预览加载中...</span>',
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Publish schedule radio cards (Step 3)
// ---------------------------------------------------------------------------

const SCHEDULE_OPTIONS = [
  { key: 'git-push', label: 'Git push 时自动发布', desc: '每次提交到 main 分支自动触发', Icon: RefreshCw },
  { key: 'daily', label: '每日凌晨 03:00', desc: '每日定时重新构建并发布', Icon: Clock },
  { key: 'manual', label: '手动触发', desc: '仅在点击“立即发布”时发布', Icon: Play },
]

function ScheduleCard({ option, selected, onChange }) {
  const Icon = option.Icon
  return (
    <button
      type="button"
      onClick={() => onChange(option.key)}
      className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-all ${
        selected
          ? 'border-primary-400 bg-primary-50 ring-2 ring-primary-100'
          : 'border-neutral-200 bg-white hover:border-neutral-300'
      }`}
    >
      <span
        className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
          selected ? 'border-primary-500' : 'border-neutral-300'
        }`}
      >
        {selected && <span className="w-2 h-2 rounded-full bg-primary-500" />}
      </span>
      <div className="w-8 h-8 rounded-md bg-white border border-neutral-200 flex items-center justify-center shrink-0">
        <Icon size={14} className="text-primary-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-neutral-800">{option.label}</div>
        <div className="text-[11px] text-neutral-500 mt-0.5">{option.desc}</div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main — ProjectPublish
// ---------------------------------------------------------------------------

export default function ProjectPublish() {
  const { id } = useParams()
  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState(null)
  const [templates, setTemplates] = useState([])
  const [documents, setDocuments] = useState([])
  const [versions, setVersions] = useState([])

  // Step 1 state
  const [versionScope, setVersionScope] = useState('current') // 'current' | 'published'
  const [selectedDocId, setSelectedDocId] = useState('')
  const [contentScope, setContentScope] = useState('single') // 'single' | 'whole'
  const [autoSync, setAutoSync] = useState(true)

  // Step 2 state
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  // Step 3 state
  const [slugInput, setSlugInput] = useState('')
  const [schedule, setSchedule] = useState('git-push')
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [publishedAt, setPublishedAt] = useState(null)
  const [copyLabel, setCopyLabel] = useState('复制')

  // --- initial fetch ---
  useEffect(() => {
    let active = true
    const run = async () => {
      const [p, tpls, docs] = await Promise.all([
        fetchProject(id),
        fetchTemplates(),
        fetchDocuments({ projectId: id }),
      ])
      if (!active) return
      setProject(p)
      setTemplates(tpls || [])
      setDocuments(docs || [])

      // default doc selection
      if (docs && docs.length > 0) {
        const home = docs.find((d) => d.title === '首页') || docs[0]
        setSelectedDocId(home.id)
        // pre-render preview for first doc
        setPreviewLoading(true)
        renderPreview(home.id).then((html) => {
          if (!active) return
          setPreviewHtml(html)
          setPreviewLoading(false)
        })
      }

      // default template: use project's current template or first in list
      const defaultTpl = (tpls || []).find((t) => t.type === p?.template) || (tpls || [])[0]
      if (defaultTpl) setSelectedTemplateId(defaultTpl.id)

      // default slug from project name
      setSlugInput(toSlug(p?.name))

      // fetch versions for "last published" indicator
      if (docs && docs.length > 0) {
        const firstDocVersions = await fetchVersions(docs[0].id)
        if (!active) return
        setVersions(firstDocVersions || [])
      }

      setTimeout(() => { if (active) setLoading(false) }, 350)
    }
    run()
    return () => { active = false }
  }, [id])

  // --- re-render preview on doc/template change ---
  useEffect(() => {
    if (!selectedDocId || !selectedTemplateId) return
    setPreviewLoading(true)
    let cancelled = false
    renderPreview(selectedDocId, selectedTemplateId).then((html) => {
      if (cancelled) return
      setPreviewHtml(html)
      setPreviewLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedDocId, selectedTemplateId])

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId),
    [templates, selectedTemplateId],
  )

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId),
    [documents, selectedDocId],
  )

  const slugValid = validateSlug(slugInput)

  const previewUrl = useMemo(() => {
    if (!slugInput || !slugValid) return ''
    return `https://${slugInput}.docvault.dev`
  }, [slugInput, slugValid])

  const handleCopy = async () => {
    if (!previewUrl) return
    try {
      await navigator.clipboard.writeText(previewUrl)
      setCopyLabel('已复制')
      setTimeout(() => setCopyLabel('复制'), 1500)
    } catch {
      setCopyLabel('复制失败')
      setTimeout(() => setCopyLabel('复制'), 1500)
    }
  }

  const PUBLISHED_SITE_URL = 'https://edgeagent.docvault.dev'

  const handlePublish = async () => {
    if (!slugValid || !selectedTemplate || !selectedDoc) return
    setPublishing(true)
    await new Promise((r) => setTimeout(r, 1000))
    setPublishing(false)
    setPublished(true)
    setPublishedAt(new Date())
  }

  const publishedAtText = publishedAt
    ? `${publishedAt.getFullYear()}-${String(publishedAt.getMonth() + 1).padStart(2, '0')}-${String(publishedAt.getDate()).padStart(2, '0')} ${String(publishedAt.getHours()).padStart(2, '0')}:${String(publishedAt.getMinutes()).padStart(2, '0')}`
    : ''

  if (loading) {
    return (
      <div className="h-full overflow-y-auto scrollbar-thin">
        <PublishSkeleton />
      </div>
    )
  }
  if (!project) {
    return (
      <div className="h-full overflow-y-auto scrollbar-thin">
        <ProjectNotFound id={id} />
      </div>
    )
  }

  const latestVersion = versions[0]

  return (
    <div className="h-full flex flex-col">
      {/* ===== 可滚动内容区 ===== */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-[880px] mx-auto px-6 pt-5 pb-16">
      {/* ========= Step 1 ========= */}
      <section className="animate-fade-up card p-5 mb-4" style={{ animationDelay: '80ms' }}>
        <div className="flex items-center gap-3 mb-4">
          <StepNumber n={1} />
          <h2 className="text-base font-semibold text-neutral-900">选择发布内容</h2>
          {/* inline version radio */}
          <div className="ml-auto inline-flex items-center p-0.5 bg-neutral-100 rounded-full">
            <button
              type="button"
              onClick={() => setVersionScope('current')}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition ${
                versionScope === 'current' ? 'bg-white text-primary-700 shadow-sm' : 'text-neutral-500'
              }`}
            >
              当前草稿
            </button>
            <button
              type="button"
              onClick={() => setVersionScope('published')}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition ${
                versionScope === 'published' ? 'bg-white text-primary-700 shadow-sm' : 'text-neutral-500'
              }`}
            >
              已发布版本
            </button>
          </div>
        </div>

        {/* Document selection */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">发布文档</label>
          <div className="relative">
            <select
              value={selectedDocId}
              onChange={(e) => setSelectedDocId(e.target.value)}
              className="appearance-none text-sm bg-white border border-neutral-200 rounded-md pl-3 pr-8 py-2 text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400 w-full"
            >
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}{d.title === '首页' ? '（默认首页）' : ''}
                </option>
              ))}
            </select>
            <ChevronRight className="w-4 h-4 text-neutral-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90" />
          </div>
        </div>

        {/* Content scope pills */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">内容范围</label>
          <div className="inline-flex items-center p-1 bg-neutral-100 rounded-full">
            <button
              type="button"
              onClick={() => setContentScope('single')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                contentScope === 'single'
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <FileText size={12} />
              单文档
            </button>
            <button
              type="button"
              onClick={() => setContentScope('whole')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                contentScope === 'whole'
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <Globe size={12} />
              整个知识库
            </button>
          </div>
        </div>

        {/* Advanced — auto-sync toggle */}
        <div className="pt-3 border-t border-neutral-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-neutral-700">自动同步</div>
            <div className="text-[11px] text-neutral-500">每次 Git push 自动重新发布</div>
          </div>
          <button
            type="button"
            onClick={() => setAutoSync((v) => !v)}
            className={`relative w-10 h-[22px] rounded-full transition-colors ${
              autoSync ? 'bg-primary-500' : 'bg-neutral-300'
            }`}
          >
            <span
              className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${
                autoSync ? 'translate-x-[20px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </section>

      {/* ========= Step 2 ========= */}
      <section className="animate-fade-up card p-5 mb-4" style={{ animationDelay: '160ms' }}>
        <div className="flex items-center gap-3 mb-4">
          <StepNumber n={2} />
          <h2 className="text-base font-semibold text-neutral-900">选择主题与预览</h2>
        </div>

        {/* Theme grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
          {templates.map((tpl, i) => (
            <ThemeCard
              key={tpl.id}
              theme={tpl}
              active={tpl.id === selectedTemplateId}
              onClick={() => setSelectedTemplateId(tpl.id)}
              delay={i * 50}
            />
          ))}
        </div>

        {/* Live preview snippet */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-neutral-700 flex items-center gap-1.5">
              <Globe size={12} className="text-primary-500" />
              实时预览
            </label>
            {selectedTemplate && (
              <span className="tag-neutral !py-0.5 !text-[11px]">
                <Palette size={11} />
                {selectedTemplate.name}
              </span>
            )}
          </div>
          {previewLoading ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 h-[120px] flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-neutral-400 animate-spin" />
            </div>
          ) : (
            <PreviewSnippet html={previewHtml} templateName={selectedTemplate?.name} />
          )}
        </div>
      </section>

      {/* ========= Step 3 ========= */}
      <section className="animate-fade-up card p-5 mb-4" style={{ animationDelay: '240ms' }}>
        <div className="flex items-center gap-3 mb-4">
          <StepNumber n={3} />
          <h2 className="text-base font-semibold text-neutral-900">发布配置</h2>
        </div>

        {/* Access URL */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">
            访问地址
            {!slugValid && (
              <span className="ml-1 text-danger inline-flex items-center gap-1">
                <AlertTriangle size={11} /> 仅支持小写字母、数字和连字符
              </span>
            )}
          </label>
          <div className="flex items-stretch rounded-md overflow-hidden border border-neutral-200 focus-within:ring-2 focus-within:ring-primary-200 focus-within:border-primary-400">
            <span className="inline-flex items-center px-3 bg-neutral-50 border-r border-neutral-200 text-xs text-neutral-500 font-mono shrink-0">
              *.docvault.dev/
            </span>
            <input
              type="text"
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              placeholder="your-project-slug"
              className="flex-1 px-3 py-2 text-sm text-neutral-800 font-mono bg-white placeholder:text-neutral-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopy}
              disabled={!previewUrl}
              className="inline-flex items-center gap-1 px-3 text-xs text-neutral-500 hover:text-primary-600 bg-white border-l border-neutral-200 disabled:opacity-40 transition-colors"
              title="复制完整地址"
            >
              <Copy size={12} />
              {copyLabel}
            </button>
          </div>
          {previewUrl && (
            <div className="mt-1.5 text-[11px] text-neutral-500 font-mono">
              预览地址：<span className="text-primary-600">{previewUrl}</span>
            </div>
          )}
        </div>

        {/* Schedule */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-neutral-700 mb-2">
            自动发布计划
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {SCHEDULE_OPTIONS.map((opt) => (
              <ScheduleCard
                key={opt.key}
                option={opt}
                selected={schedule === opt.key}
                onChange={setSchedule}
              />
            ))}
          </div>
        </div>

        {/* Publish button + success bar */}
        {!published ? (
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing || !slugValid || !selectedTemplate || !selectedDoc}
            className="w-full btn-primary justify-center !h-11 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishing ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                发布中…
              </>
            ) : (
              <>
                <Rocket size={15} />
                立即发布
              </>
            )}
          </button>
        ) : (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 animate-fade-up">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                <CheckCircle2 size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-emerald-700">发布成功！</div>
                <div className="text-xs text-emerald-600 mt-0.5">
                  发布时间：{publishedAtText}
                </div>
                <a
                  href={PUBLISHED_SITE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 mt-1 underline underline-offset-2"
                >
                  {PUBLISHED_SITE_URL}
                  <ExternalLink size={11} />
                </a>
              </div>
              <button
                type="button"
                onClick={() => setPublished(false)}
                className="text-emerald-500 hover:text-emerald-700"
                aria-label="关闭"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        {latestVersion && !published && (
          <div className="mt-3 text-[11px] text-neutral-500 inline-flex items-center gap-1.5">
            <Clock size={11} />
            上次发布 {Math.floor(Math.random() * 4 + 1)} 分钟前 · {latestVersion.commitHash?.slice(0, 7)}
          </div>
        )}
      </section>

      {/* ========= Summary card (always visible) ========= */}
      <section
        className={`animate-fade-up rounded-lg border p-4 ${
          published
            ? 'bg-primary-50 border-primary-200'
            : 'bg-neutral-50 border-neutral-200'
        }`}
        style={{ animationDelay: '320ms' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Settings size={14} className="text-primary-600" />
          <span className="text-sm font-semibold text-neutral-800">发布概览</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-[11px] text-neutral-500">项目</div>
            <div className="mt-0.5 font-medium text-neutral-800 truncate">{project?.name || '-'}</div>
          </div>
          <div>
            <div className="text-[11px] text-neutral-500">主题</div>
            <div className="mt-0.5 font-medium text-neutral-800 truncate">
              {selectedTemplate?.name || '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-neutral-500">当前版本</div>
            <div className="mt-0.5 font-medium text-neutral-800 font-mono">
              {latestVersion ? latestVersion.commitHash.slice(0, 7) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-neutral-500">下次发布</div>
            <div className="mt-0.5 font-medium text-neutral-800">
              {schedule === 'git-push' && 'Git push 时'}
              {schedule === 'daily' && '每天 03:00'}
              {schedule === 'manual' && '手动触发'}
            </div>
          </div>
        </div>
      </section>

        </div>
      </div>

      {/* ===== 底部固定操作栏（不随内容滚动） ===== */}
      <footer className="shrink-0 border-t border-neutral-200 bg-white px-6 py-3 flex items-center justify-between gap-3">
        <div className="text-xs text-neutral-500 truncate">
          当前草稿 · 主题：{selectedTemplate?.name || '—'}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={PUBLISHED_SITE_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary !h-9 text-xs"
          >
            <ExternalLink size={13} />
            预览网站
          </a>
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing || !slugValid || !selectedTemplate || !selectedDoc}
            className="btn-primary !h-9 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishing ? (
              <>
                <RefreshCw size={13} className="animate-spin" />
                发布中…
              </>
            ) : (
              <>
                <Rocket size={13} />
                立即发布
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  )
}
