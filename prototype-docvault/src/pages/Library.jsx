import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import {
  FolderOpen,
  FileText,
  Search,
  Filter,
  Grid3X3,
  List,
  MoreHorizontal,
  Plus,
  GitBranch,
  HardDrive,
  Database,
  ExternalLink,
  Clock,
  Tag,
  ChevronRight,
  LayoutGrid,
  FolderKanban,
  ArrowRight,
  X,
  Globe,
  Lock,
  Users,
  Eye,
  EyeOff,
  SlidersHorizontal,
  RotateCcw,
  Sparkles,
  Wand2,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react'
import { fetchProjects, fetchDocuments, fetchStarterPacks, initProjectFromStarter, fetchSources, createSource } from '../api/stubs.js'
import { authors as authorsData } from '../mock/data.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_MAP = {
  synced: { label: '已同步', cls: 'tag-success' },
  modified: { label: '本地修改', cls: 'tag-warning' },
  conflict: { label: '冲突', cls: 'tag-danger' },
  untracked: { label: '未跟踪', cls: 'tag-primary' },
}

// ========================================================================
// 辅助：从 packForm 构造新建数据源请求，调 createSource stub
// ========================================================================

async function createSourceFromPackForm(form, packName) {
  if (form.sourceBackend === 'git') {
    return createSource({
      type: 'git',
      name: `${form.name} · Git 仓库`,
      url: form.newGitUrl.trim(),
      branch: form.newGitBranch || 'main',
      authType: form.newGitAuth,
      username: form.newGitAuth === 'https' ? form.newGitUsername : '',
      token: form.newGitAuth === 'https' ? form.newGitToken : '',
      description: `「${form.name}」知识库的 Git 仓库数据源（${packName} 模板）`,
    })
  } else if (form.sourceBackend === 'database') {
    return createSource({
      type: 'database',
      name: `${form.name} · ${form.newDbType}`,
      dbType: form.newDbType,
      host: form.newDbHost.trim(),
      port: form.newDbPort ? Number(form.newDbPort) : null,
      database: form.newDbDatabase.trim(),
      table: form.newDbTable.trim() || null,
      username: form.newDbUsername.trim(),
      password: form.newDbPassword,
      description: `「${form.name}」知识库的数据库数据源`,
    })
  }
  return null
}

const SOURCE_ICON = {
  git: GitBranch,
  local: HardDrive,
  database: Database,
  web: ExternalLink,
}

const SOURCE_LABEL = {
  git: 'Git',
  local: '本地',
  database: '数据库',
  web: '网页',
}

// 存储后端类型（新建知识库时可选）
const STORAGE_BACKEND_TYPES = [
  { key: 'local',    icon: HardDrive,  label: '本地文件夹',   desc: '存储在本地磁盘，适合个人使用', color: 'bg-violet-50 text-violet-600 border-violet-100' },
  { key: 'git',      icon: GitBranch,  label: 'Git 仓库',     desc: '绑定 GitHub/GitLab 仓库，支持版本追踪', color: 'bg-sky-50 text-sky-600 border-sky-100' },
  { key: 'database', icon: Database,    label: '数据库',       desc: '存储到对象数据库 / 关系型数据库', color: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
]

const TEMPLATE_LABEL = {
  docs: '标准文档',
  blog: '博客',
  wiki: '团队 Wiki',
  'product-site': '产品官网',
  'api-ref': 'API 参考',
  custom: '自定义',
}

const VISIBILITY_META = {
  private: { label: '私有', icon: Lock, cls: 'bg-neutral-100 text-neutral-600' },
  team:    { label: '团队', icon: Users, cls: 'bg-primary-50 text-primary-600' },
  public:  { label: '公开', icon: Globe, cls: 'bg-emerald-50 text-emerald-600' },
}

function relativeTime(isoString) {
  const now = new Date('2026-09-05T10:30:00+08:00')
  const date = new Date(isoString)
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  if (diffHours < 24) return `${diffHours} 小时前`
  if (diffDays < 7) return `${diffDays} 天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`
  return `${Math.floor(diffDays / 30)} 个月前`
}

function extractPreview(content) {
  if (!content) return ''
  const lines = content
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').replace(/[`*_>-]/g, '').trim())
    .filter(Boolean)
  return lines.slice(0, 3).join(' ')
}

function getAuthorName(authorId) {
  const found = authorsData.find((a) => a.id === authorId)
  return found ? found.name : authorId
}

function avatarColor(authorId) {
  const palette = [
    'bg-violet-500',
    'bg-sky-500',
    'bg-rose-500',
    'bg-amber-500',
    'bg-emerald-500',
    'bg-indigo-500',
    'bg-teal-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-lime-500',
    'bg-cyan-500',
    'bg-fuchsia-500',
  ]
  const idx = authorId
    .split('')
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % palette.length
  return palette[idx]
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function LibrarySkeleton() {
  return (
    <>
      <div className="animate-fade-up flex items-start justify-between mb-6">
        <div>
          <div className="skeleton h-7 w-28 mb-2" />
          <div className="skeleton h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <div className="skeleton h-9 w-24" />
          <div className="skeleton h-9 w-24" />
        </div>
      </div>

      <div className="skeleton h-8 w-full mb-5" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="card p-4 space-y-3"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="flex justify-between">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-5 w-14" />
            </div>
            <div className="skeleton h-5 w-32" />
            <div className="space-y-2">
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-3/4" />
            </div>
            <div className="flex gap-2 pt-2">
              <div className="skeleton h-6 w-6 rounded-full" />
              <div className="skeleton h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Filter chip
// ---------------------------------------------------------------------------

function FilterChip({ label, active, onClick, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
        active
          ? 'bg-primary-50 border-primary-200 text-primary-700 shadow-sm'
          : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:text-neutral-800'
      }`}
    >
      {label}
      {count != null && (
        <span className={`text-[10px] ${active ? 'text-primary-500' : 'text-neutral-400'}`}>
          {count}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Document card
// ---------------------------------------------------------------------------

function DocumentCard({ doc, projects, delayMs = 0 }) {
  const status = STATUS_MAP[doc.status] || STATUS_MAP.synced
  const authorName = getAuthorName(doc.modifiedBy)
  const project = projects.find((p) => p.id === doc.projectId)
  const parentFolder = doc.path.includes('/')
    ? doc.path.split('/').slice(0, -1).join('/')
    : '根目录'
  const fileName = doc.path.includes('/')
    ? doc.path.split('/').pop()
    : doc.path

  return (
    <Link
      to={`/project/${doc.projectId}/browse?doc=${doc.id}`}
      className="card-hover animate-fade-up block relative group"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[11px] text-neutral-400 truncate flex items-center gap-1">
            {project && (
              <>
                <span className="text-primary-600 font-medium">{project.name}</span>
                <ChevronRight size={12} className="text-neutral-300 shrink-0" />
              </>
            )}
            <span>{parentFolder}</span>
            <ChevronRight size={12} className="text-neutral-300 shrink-0" />
            <span className="text-neutral-500">{fileName}</span>
          </div>
          <span className={`shrink-0 ${status.cls}`}>{status.label}</span>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-base font-semibold text-neutral-900 leading-tight line-clamp-1">
            {doc.title}
          </h3>
          <p
            className="text-xs text-neutral-500 leading-relaxed line-clamp-2"
            dangerouslySetInnerHTML={{ __html: extractPreview(doc.content) }}
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-neutral-500 pt-1 border-t border-neutral-100">
          <div
            className={`w-6 h-6 rounded-full ${avatarColor(
              doc.modifiedBy,
            )} flex items-center justify-center text-white text-[10px] font-semibold shrink-0`}
          >
            {authorName.slice(0, 1).toUpperCase()}
          </div>
          <span className="text-neutral-600 truncate">{authorName}</span>
          <span className="text-neutral-300">·</span>
          <span className="flex items-center gap-1 shrink-0">
            <Clock size={11} />
            {relativeTime(doc.lastModified)}
          </span>
        </div>

        {doc.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {doc.tags.slice(0, 3).map((t) => (
              <span key={t} className="tag-neutral">
                <Tag size={10} />
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="absolute bottom-3 right-3 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150">
          <span className="btn-ghost !px-2 !py-1 text-xs">
            打开编辑器
            <ChevronRight size={12} />
          </span>
        </div>
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Document list row (for list view)
// ---------------------------------------------------------------------------

function DocumentListRow({ doc, projects, delayMs = 0 }) {
  const status = STATUS_MAP[doc.status] || STATUS_MAP.synced
  const authorName = getAuthorName(doc.modifiedBy)
  const project = projects.find((p) => p.id === doc.projectId)

  return (
    <Link
      to={`/project/${doc.projectId}/browse?doc=${doc.id}`}
      className="animate-fade-up block group"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex items-center gap-4 px-4 py-3 border-b border-neutral-100 hover:bg-neutral-50/80 transition-colors">
        {/* File icon */}
        <div className="w-8 h-8 rounded-md bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">
          <FileText size={16} />
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-neutral-900 truncate group-hover:text-primary-600 transition-colors">
              {doc.title}
            </h4>
            <span className={`shrink-0 text-[10px] ${status.cls}`}>{status.label}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-neutral-500 mt-0.5 font-mono">
            {project && (
              <span className="text-primary-600 truncate">{project.name}</span>
            )}
            <ChevronRight size={10} className="text-neutral-300 shrink-0" />
            <span className="truncate">{doc.path}</span>
          </div>
        </div>

        {/* Tags */}
        {doc.tags?.length > 0 && (
          <div className="hidden md:flex items-center gap-1 shrink-0">
            {doc.tags.slice(0, 2).map((t) => (
              <span key={t} className="tag-neutral !text-[10px] !py-0">
                <Tag size={9} />
                {t}
              </span>
            ))}
            {doc.tags.length > 2 && (
              <span className="text-[10px] text-neutral-400">+{doc.tags.length - 2}</span>
            )}
          </div>
        )}

        {/* Author + time */}
        <div className="hidden sm:flex items-center gap-2 shrink-0 text-[11px] text-neutral-500 w-[160px]">
          <div
            className={`w-5 h-5 rounded-full ${avatarColor(
              doc.modifiedBy,
            )} flex items-center justify-center text-white text-[9px] font-semibold shrink-0`}
          >
            {authorName.slice(0, 1).toUpperCase()}
          </div>
          <span className="truncate">{authorName}</span>
        </div>
        <div className="hidden lg:flex items-center gap-1 shrink-0 text-[11px] text-neutral-400 w-[90px] justify-end">
          <Clock size={10} />
          <span>{relativeTime(doc.lastModified)}</span>
        </div>
      </div>
    </Link>
  )
}

function DocumentListView({ docs, projects }) {
  return (
    <div className="card p-0 overflow-hidden divide-y divide-neutral-100">
      {/* Header row */}
      <div className="flex items-center gap-4 px-4 py-2 bg-neutral-50/60 border-b border-neutral-200 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
        <div className="w-8 shrink-0" />
        <div className="flex-1">文档</div>
        <div className="hidden md:block shrink-0">标签</div>
        <div className="hidden sm:block shrink-0 w-[160px]">作者</div>
        <div className="hidden lg:block shrink-0 w-[90px] text-right">更新时间</div>
      </div>
      {docs.map((doc, i) => (
        <DocumentListRow key={doc.id} doc={doc} projects={projects} delayMs={i * 30} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project card (for "按项目" view)
// ---------------------------------------------------------------------------

function ProjectCard({ project, docCount, onOpenWebsite, delayMs = 0 }) {
  const Icon = SOURCE_ICON[project.sourceType] || HardDrive
  const iconTextCls = project.color
    .replace('bg-', 'text-')
    .replace('-100', '-600')
  const visibility = VISIBILITY_META[project.visibility] || VISIBILITY_META.private
  const VisIcon = visibility.icon

  return (
    <div
      className="card-hover animate-fade-up block relative group overflow-hidden"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <Link to={`/project/${project.id}`} className="p-5 space-y-4 block">
        {/* Top row: icon + source tag */}
        <div className="flex items-start justify-between gap-3">
          <div
            className={`w-12 h-12 rounded-xl ${project.color} flex items-center justify-center shrink-0`}
          >
            <Icon size={22} className={iconTextCls} />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="tag-neutral !text-[10px] !px-1.5 !py-0">
              {SOURCE_LABEL[project.sourceType] || project.sourceType}
            </span>
            <span className="text-[11px] text-neutral-400 flex items-center gap-0.5">
              <Clock size={10} />
              {relativeTime(project.lastSynced)}
            </span>
          </div>
        </div>

        {/* Name + description */}
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-neutral-900 leading-tight line-clamp-1">
            {project.name}
          </h3>
          <p className="text-xs text-neutral-500 leading-relaxed line-clamp-2">
            {project.description}
          </p>
        </div>

        {/* Doc count + visibility */}
        <div className="flex items-center gap-2 pt-2 border-t border-neutral-100">
          <div className="flex items-center gap-1.5 text-xs text-neutral-600">
            <FileText size={13} className="text-neutral-400" />
            <span className="font-semibold text-neutral-800">{docCount}</span>
            <span className="text-neutral-500">篇文档</span>
          </div>
          <span className={`ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${visibility.cls}`}>
            <VisIcon size={10} />
            {visibility.label}
          </span>
        </div>
      </Link>

      {/* Hover reveal buttons */}
      <div className="absolute bottom-4 right-4 flex items-center gap-2 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150">
        {project.isPublished && project.websiteUrl && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpenWebsite?.(project.websiteUrl)
            }}
            className="btn-ghost !px-2.5 !py-1.5 text-xs inline-flex items-center gap-1 text-emerald-600 hover:bg-emerald-50 border border-emerald-100"
            title="打开已发布网站"
          >
            <Globe size={13} />
            访问网站
          </button>
        )}
        <Link
          to={`/project/${project.id}`}
          className="btn-primary !px-3 !py-1.5 text-xs inline-flex items-center gap-1"
        >
          进入
          <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project selector — chips when few, dropdown search when many
// ---------------------------------------------------------------------------

function ProjectSelector({ projects, selected, onSelect, docCounts, threshold = 6 }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const totalCount = projects.reduce((s, p) => s + (docCounts[p.id] || 0), 0)
  const selectedProject = selected ? projects.find((p) => p.id === selected) : null

  // Few items → show chips inline
  if (projects.length <= threshold) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition border ${
            selected === null
              ? 'bg-primary-50 !text-primary-700 border-primary-200'
              : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300 hover:text-neutral-800'
          }`}
        >
          <FolderOpen size={11} />
          全部
          <span className={`text-[10px] ${selected === null ? 'text-primary-500' : 'text-neutral-400'}`}>
            {totalCount}
          </span>
        </button>
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition border ${
              selected === p.id
                ? 'bg-primary-50 !text-primary-700 border-primary-200'
                : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300 hover:text-neutral-800'
            }`}
          >
            {p.name}
            <span className={`text-[10px] ${selected === p.id ? 'text-primary-500' : 'text-neutral-400'}`}>
              {docCounts[p.id] || 0}
            </span>
          </button>
        ))}
      </div>
    )
  }

  // Many items → dropdown with search (Portal-mounted to avoid stacking context issues)
  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  )

  // For Portal positioning
  const triggerRef = useRef(null)
  const [panelPos, setPanelPos] = useState(null)

  const openDropdown = () => {
    setOpen(true)
    setQuery('')
    // Calculate absolute position relative to viewport
    setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) {
        setPanelPos({ top: rect.bottom + 4, left: rect.left })
      }
    }, 0)
  }

  // Close on outside click / ESC / scroll
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition border whitespace-nowrap ${
          selected
            ? 'bg-primary-50 !text-primary-700 border-primary-200'
            : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300 hover:text-neutral-800'
        }`}
      >
        {selectedProject ? (
          <>
            <FolderOpen size={11} />
            {selectedProject.name}
            <span className="text-[10px] text-primary-500">{docCounts[selected] || 0}</span>
          </>
        ) : (
          <>
            <FolderOpen size={11} />
            全部项目
            <span className="text-[10px] text-neutral-400">{totalCount}</span>
          </>
        )}
        <ChevronRight
          size={12}
          className={`text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && panelPos && createPortal(
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed z-50 w-72 bg-white rounded-lg border border-neutral-200 shadow-xl overflow-hidden animate-fade-up"
            style={{ top: panelPos.top, left: panelPos.left }}
          >
            {/* Search */}
            <div className="p-2 border-b border-neutral-100">
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索项目..."
                  className="input !pl-7 !h-8 !text-xs"
                  autoFocus
                />
              </div>
            </div>
            {/* Options */}
            <div className="max-h-64 overflow-y-auto scrollbar-thin py-1">
              <button
                type="button"
                onClick={() => { onSelect(null); setOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition ${
                  selected === null
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <FolderOpen size={12} className="shrink-0" />
                <span className="flex-1 text-left">全部项目</span>
                <span className={`text-[10px] ${selected === null ? 'text-primary-500' : 'text-neutral-400'}`}>
                  {totalCount}
                </span>
              </button>
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onSelect(p.id); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition ${
                    selected === p.id
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  <FolderOpen size={12} className="shrink-0" />
                  <span className="flex-1 text-left truncate">{p.name}</span>
                  <span className={`text-[10px] ${selected === p.id ? 'text-primary-500' : 'text-neutral-400'}`}>
                    {docCounts[p.id] || 0}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-neutral-400">
                  未找到匹配的项目
                </div>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filter Drawer
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { key: 'synced', label: '已同步',    cls: 'bg-emerald-500' },
  { key: 'modified', label: '本地修改', cls: 'bg-amber-500' },
  { key: 'conflict', label: '冲突',     cls: 'bg-red-500' },
  { key: 'untracked', label: '未跟踪',   cls: 'bg-primary-500' },
]

const TIME_RANGES = [
  { key: 'any',      label: '任意时间' },
  { key: '1d',       label: '今天' },
  { key: '3d',       label: '近 3 天' },
  { key: '7d',       label: '近一周' },
  { key: '30d',      label: '近一个月' },
]

function FilterDrawer({ open, onClose, filters, setFilters, allTags }) {
  if (!open) return null

  const toggleStatus = (key) => {
    setFilters((f) => ({
      ...f,
      status: f.status.includes(key)
        ? f.status.filter((s) => s !== key)
        : [...f.status, key],
    }))
  }
  const toggleTemplate = (key) => {
    setFilters((f) => ({
      ...f,
      template: f.template === key ? null : key,
    }))
  }
  const toggleVisibility = (key) => {
    setFilters((f) => ({
      ...f,
      visibility: f.visibility === key ? null : key,
    }))
  }
  const toggleTag = (key) => {
    setFilters((f) => ({
      ...f,
      tags: f.tags.includes(key)
        ? f.tags.filter((t) => t !== key)
        : [...f.tags, key],
    }))
  }

  const resetAll = () => {
    setFilters({
      status: [],
      template: null,
      visibility: null,
      timeRange: 'any',
      tags: [],
    })
  }

  const activeCount =
    filters.status.length +
    (filters.template ? 1 : 0) +
    (filters.visibility ? 1 : 0) +
    (filters.timeRange !== 'any' ? 1 : 0) +
    filters.tags.length

  return (
    <>
      <div className="fixed inset-0 z-40 bg-neutral-900/30 animate-fade-up" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 w-[340px] bg-white border-l border-neutral-200 shadow-xl z-50 animate-slide-in overflow-y-auto scrollbar-thin">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-primary-600" />
            <span className="font-semibold text-neutral-900">筛选条件</span>
            {activeCount > 0 && (
              <span className="text-xs bg-primary-50 text-primary-600 rounded-full px-2 py-0.5 font-medium">
                {activeCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {activeCount > 0 && (
              <button
                type="button"
                onClick={resetAll}
                className="text-xs text-neutral-500 hover:text-neutral-700 inline-flex items-center gap-1 px-2 py-1 hover:bg-neutral-50 rounded transition"
              >
                <RotateCcw size={12} />
                重置
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-ghost !p-1.5">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-6">
          {/* 状态 */}
          <div>
            <div className="text-xs font-semibold text-neutral-700 mb-2">文档状态</div>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => {
                const active = filters.status.includes(opt.key)
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => toggleStatus(opt.key)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition ${
                      active
                        ? 'bg-neutral-900 text-white border-neutral-900'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${opt.cls}`} />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 模板 */}
          <div>
            <div className="text-xs font-semibold text-neutral-700 mb-2">文档库模板</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(TEMPLATE_LABEL).map(([key, label]) => {
                const active = filters.template === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleTemplate(key)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition ${
                      active
                        ? 'bg-neutral-900 text-white border-neutral-900'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 可见性 */}
          <div>
            <div className="text-xs font-semibold text-neutral-700 mb-2">可见性</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(VISIBILITY_META).map(([key, meta]) => {
                const Icon = meta.icon
                const active = filters.visibility === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleVisibility(key)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition ${
                      active
                        ? 'bg-neutral-900 text-white border-neutral-900'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    <Icon size={12} />
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 更新时间 */}
          <div>
            <div className="text-xs font-semibold text-neutral-700 mb-2">更新时间</div>
            <div className="flex flex-wrap gap-2">
              {TIME_RANGES.map((opt) => {
                const active = filters.timeRange === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, timeRange: opt.key }))}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition ${
                      active
                        ? 'bg-neutral-900 text-white border-neutral-900'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 标签 */}
          <div>
            <div className="text-xs font-semibold text-neutral-700 mb-2 flex items-center gap-1">
              <Tag size={12} />
              标签
              {filters.tags.length > 0 && (
                <span className="text-[10px] text-neutral-400 font-normal">
                  已选 {filters.tags.length}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const active = filters.tags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border transition ${
                      active
                        ? 'bg-primary-100 text-primary-700 border-primary-200'
                        : 'bg-neutral-50 text-neutral-600 border-neutral-100 hover:border-neutral-200'
                    }`}
                  >
                    #{tag}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Library() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState([])
  const [documents, setDocuments] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [viewMode, setViewMode] = useState('grid')
  const [keyword, setKeyword] = useState('')
  const [browseMode, setBrowseMode] = useState('flat')
  const [scope, setScope] = useState('mine') // 'mine' | 'explore'
  const [filterOpen, setFilterOpen] = useState(false)
  const [websiteUrl, setWebsiteUrl] = useState(null)
  const [starterModalOpen, setStarterModalOpen] = useState(false)
  const [starterPacks, setStarterPacks] = useState([])
  const [selectedPack, setSelectedPack] = useState(null)
  const [wizardStep, setWizardStep] = useState(1) // 1: 选模板  2: 预览  3: 完成
  const [packForm, setPackForm] = useState({
    name: '',
    description: '',
    visibility: 'private',
    sourceBackend: 'local',       // 'local' | 'git' | 'database'
    // 通用：选已有 vs 新建
    sourceMode: 'select',         // 'select' | 'create'
    sourceId: null,               // 选中的已有数据源 ID
    localFolderPath: 'C:/Users/poryo/Documents/DocVault/', // 本地存储基础路径
    // === 内嵌创建新 Git 数据源 ===
    newGitUrl: '',
    newGitBranch: 'main',
    newGitAuth: 'ssh',            // 'ssh' | 'https'
    newGitUsername: '',
    newGitToken: '',
    // === 内嵌创建新数据库数据源 ===
    newDbType: 'mysql',           // 复用 Sources.jsx DATABASE_TYPES 的 key
    newDbHost: '',
    newDbPort: '',
    newDbDatabase: '',
    newDbTable: '',
    newDbUsername: '',
    newDbPassword: '',
    newDbShowPassword: false,
  })
  const [sources, setSources] = useState([]) // 已配置的数据源列表
  const [creating, setCreating] = useState(false)
  const [createdProject, setCreatedProject] = useState(null)
  const [filters, setFilters] = useState({
    status: [],
    template: null,
    visibility: null,
    timeRange: 'any',
    tags: [],
  })

  useEffect(() => {
    let active = true
    const run = async () => {
      const [ps, ds, sps, srcs] = await Promise.all([
        fetchProjects(),
        fetchDocuments(),
        fetchStarterPacks(),
        fetchSources(),
      ])
      if (!active) return
      setProjects(ps)
      setDocuments(ds)
      setStarterPacks(sps || [])
      setSources(srcs || [])
      setTimeout(() => setLoading(false), 400)
    }
    run()
    return () => { active = false }
  }, [])

  const docCounts = useMemo(() => {
    const c = {}
    documents.forEach((d) => {
      c[d.projectId] = (c[d.projectId] || 0) + 1
    })
    return c
  }, [documents])

  // All unique tags from docs
  const allTags = useMemo(() => {
    const s = new Set()
    documents.forEach((d) => (d.tags || []).forEach((t) => s.add(t)))
    return Array.from(s).sort()
  }, [documents])

  // Time range filter helper
  const timeRangeMs = (range) => {
    switch (range) {
      case '1d': return 86400000
      case '3d': return 3 * 86400000
      case '7d': return 7 * 86400000
      case '30d': return 30 * 86400000
      default: return Infinity
    }
  }

  // ---------- Filtered data ----------
  const scopeProjects = useMemo(() => {
    if (scope === 'explore') {
      // 公开探索：只看公开项目
      return projects.filter((p) => p.visibility === 'public')
    }
    return projects
  }, [projects, scope])

  const filteredDocs = useMemo(() => {
    let list = documents.filter((d) => {
      // Scope: explore 模式下只看公开项目的文档
      if (scope === 'explore') {
        const proj = projects.find((p) => p.id === d.projectId)
        if (!proj || proj.visibility !== 'public') return false
      }
      // Project chip filter
      if (selectedProject && d.projectId !== selectedProject) return false
      // Status filter
      if (filters.status.length > 0 && !filters.status.includes(d.status)) return false
      // Tag filter (AND logic: must have all selected tags)
      if (filters.tags.length > 0 && !filters.tags.every((t) => (d.tags || []).includes(t))) return false
      // Time range
      if (filters.timeRange !== 'any') {
        const cutoff = Date.now() - timeRangeMs(filters.timeRange)
        if (new Date(d.lastModified).getTime() < cutoff) return false
      }
      return true
    })

    if (keyword.trim()) {
      const needle = keyword.trim().toLowerCase()
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(needle) ||
          d.path.toLowerCase().includes(needle) ||
          (d.tags || []).some((t) => t.toLowerCase().includes(needle)),
      )
    }
    return [...list].sort(
      (a, b) => new Date(b.lastModified) - new Date(a.lastModified),
    )
  }, [documents, projects, scope, selectedProject, filters, keyword])

  const filteredProjects = useMemo(() => {
    return scopeProjects.filter((p) => {
      // Template filter
      if (filters.template && p.template !== filters.template) return false
      // Visibility filter
      if (filters.visibility && p.visibility !== filters.visibility) return false
      // Time range (lastSynced)
      if (filters.timeRange !== 'any') {
        const cutoff = Date.now() - timeRangeMs(filters.timeRange)
        if (new Date(p.lastSynced).getTime() < cutoff) return false
      }
      return true
    }).sort((a, b) => new Date(b.lastSynced) - new Date(a.lastSynced))
  }, [scopeProjects, filters])

  const activeFilterCount =
    filters.status.length +
    (filters.template ? 1 : 0) +
    (filters.visibility ? 1 : 0) +
    (filters.timeRange !== 'any' ? 1 : 0) +
    filters.tags.length

  const publishedPublicProjects = useMemo(() => {
    return projects.filter((p) => p.visibility === 'public' && p.isPublished)
  }, [projects])

  // ---------- render ----------
  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto">
      {loading ? (
        <LibrarySkeleton />
      ) : (
        <>
          {/* 1. Page header — compact single row */}
          <header className="animate-fade-up flex items-center gap-3 mb-5">
            <h1 className="text-lg font-bold text-neutral-900 flex items-center gap-2 shrink-0">
              <FolderOpen size={20} className="text-primary-600" />
              文档库
            </h1>

            {/* Scope + BrowseMode combined pill group */}
            <div className="inline-flex items-center bg-neutral-100 rounded-md p-0.5 text-[12px] shrink-0">
              <button
                type="button"
                onClick={() => { setScope('mine'); setSelectedProject(null) }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded transition ${
                  scope === 'mine'
                    ? 'bg-white text-neutral-900 shadow-sm font-medium'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <EyeOff size={12} />
                我的
                <span className={`text-[10px] ${scope === 'mine' ? 'text-neutral-400' : 'text-neutral-400'}`}>
                  {projects.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => { setScope('explore'); setSelectedProject(null) }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded transition ${
                  scope === 'explore'
                    ? 'bg-white text-emerald-700 shadow-sm font-medium'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <Globe size={12} />
                公开
                <span className={`text-[10px] ${scope === 'explore' ? 'text-emerald-500' : 'text-neutral-400'}`}>
                  {publishedPublicProjects.length}
                </span>
              </button>
              <div className="w-px h-4 bg-neutral-200 mx-0.5" />
              <button
                type="button"
                onClick={() => setBrowseMode('flat')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded transition ${
                  browseMode === 'flat'
                    ? 'bg-white text-neutral-900 shadow-sm font-medium'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <LayoutGrid size={12} />
                平铺
              </button>
              <button
                type="button"
                onClick={() => setBrowseMode('project')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded transition ${
                  browseMode === 'project'
                    ? 'bg-white text-neutral-900 shadow-sm font-medium'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <FolderKanban size={12} />
                按项目
              </button>
            </div>

            <div className="flex-1" />

            {scope === 'mine' && (
              <>
                <button type="button" className="btn-secondary !h-8 !text-xs" onClick={() => navigate('/sources')}>
                  <ExternalLink size={14} />
                  导入源
                </button>
                <button type="button" className="btn-primary !h-8 !text-xs" onClick={() => {
                  setStarterModalOpen(true)
                  setWizardStep(1)
                  setSelectedPack(null)
                  setPackForm({ name: '', description: '', visibility: 'private' })
                  setCreatedProject(null)
                }}>
                  <Wand2 size={14} />
                  新建库
                </button>
              </>
            )}
          </header>

          {/* Explore banner */}
          {scope === 'explore' && publishedPublicProjects.length > 0 && (
            <div
              className="animate-fade-up mb-5 p-4 rounded-xl bg-gradient-to-r from-emerald-50 via-teal-50 to-sky-50 border border-emerald-100 flex items-center gap-4"
              style={{ animationDelay: '60ms' }}
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center shrink-0">
                <Globe size={20} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-neutral-900">
                  已发布的网站
                </div>
                <div className="text-xs text-neutral-600 mt-0.5">
                  以下 {publishedPublicProjects.length} 个文档库已作为网站发布，点击卡片上的「访问网站」可直接预览线上效果
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {publishedPublicProjects.slice(0, 3).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setWebsiteUrl(p.websiteUrl)}
                    className="btn-ghost !px-2 !py-1.5 text-[11px] inline-flex items-center gap-1 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                    title={p.websiteUrl}
                  >
                    <ExternalLink size={11} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 2. Search + toolbar */}
          <div
            className="animate-fade-up flex flex-wrap items-center gap-2.5 mb-4"
            style={{ animationDelay: '40ms' }}
          >
            <div className="relative min-w-[220px] w-[300px]">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={
                  scope === 'explore'
                    ? '搜索公开文档库、博客、官网...'
                    : '按标题、路径或标签搜索...'
                }
                className="input !pl-9 !h-8 !text-xs"
              />
            </div>

            {/* Quick filter chips */}
            {scope === 'mine' && (
              <>
                <FilterChip
                  label="冲突"
                  count={documents.filter((d) => d.status === 'conflict').length}
                  active={filters.status.includes('conflict')}
                  onClick={() => {
                    setFilters((f) => ({
                      ...f,
                      status: f.status.includes('conflict')
                        ? f.status.filter((s) => s !== 'conflict')
                        : [...f.status, 'conflict'],
                    }))
                  }}
                />
                <FilterChip
                  label="本地修改"
                  count={documents.filter((d) => d.status === 'modified').length}
                  active={filters.status.includes('modified')}
                  onClick={() => {
                    setFilters((f) => ({
                      ...f,
                      status: f.status.includes('modified')
                        ? f.status.filter((s) => s !== 'modified')
                        : [...f.status, 'modified'],
                    }))
                  }}
                />
              </>
            )}
            {scope === 'explore' && (
              <FilterChip
                label="已发布网站"
                count={publishedPublicProjects.length}
                active={filters.visibility === 'public'}
                onClick={() => {
                  setFilters((f) => ({
                    ...f,
                    visibility: f.visibility === 'public' ? null : 'public',
                    template: null,
                  }))
                }}
              />
            )}

            <div className="flex items-center gap-1.5 ml-auto">
              {browseMode === 'flat' && scope === 'mine' && (
                <ProjectSelector
                  projects={scopeProjects}
                  selected={selectedProject}
                  onSelect={setSelectedProject}
                  docCounts={docCounts}
                />
              )}

              <div className="inline-flex items-center bg-neutral-100 rounded-md p-0.5 ml-1">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded transition ${
                    viewMode === 'grid'
                      ? 'bg-white text-primary-600 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                  aria-label="网格视图"
                >
                  <Grid3X3 size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded transition ${
                    viewMode === 'list'
                      ? 'bg-white text-primary-600 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                  aria-label="列表视图"
                >
                  <List size={15} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                className={`relative p-1.5 rounded-md border transition ml-1 ${
                  activeFilterCount > 0
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                }`}
                aria-label="筛选"
                title="筛选"
              >
                <Filter size={15} />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 text-[9px] bg-primary-500 text-white rounded-full w-4 h-4 flex items-center justify-center font-medium leading-none">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 3. Content area */}
          {browseMode === 'flat' ? (
            filteredDocs.length === 0 ? (
              <div
                className="animate-fade-up card p-12 text-center"
                style={{ animationDelay: '120ms' }}
              >
                <FileText size={48} className="mx-auto text-neutral-300 mb-4" />
                <div className="text-sm font-medium text-neutral-700 mb-1">
                  {scope === 'explore' ? '没有匹配的公开文档' : '没有找到匹配的文档'}
                </div>
                <div className="text-xs text-neutral-400">
                  {scope === 'explore'
                    ? '尝试调整筛选条件或稍后再来看看新发布的内容'
                    : '尝试切换项目筛选条件或清空搜索关键词'}
                </div>
              </div>
            ) : viewMode === 'list' ? (
              <div className="animate-fade-up" style={{ animationDelay: '60ms' }}>
                <DocumentListView docs={filteredDocs} projects={projects} />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                {filteredDocs.map((doc, i) => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    projects={projects}
                    delayMs={60 + i * 50}
                  />
                ))}
              </div>
            )
          ) : (
            filteredProjects.length === 0 ? (
              <div
                className="animate-fade-up card p-12 text-center"
                style={{ animationDelay: '120ms' }}
              >
                <FolderKanban size={48} className="mx-auto text-neutral-300 mb-4" />
                <div className="text-sm font-medium text-neutral-700 mb-1">
                  {scope === 'explore' ? '没有公开的文档库' : '没有匹配的项目'}
                </div>
                <div className="text-xs text-neutral-400">
                  {scope === 'explore'
                    ? '当前没有团队设置为公开的文档库'
                    : '尝试清除筛选条件'}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                {filteredProjects.map((p, i) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    docCount={docCounts[p.id] || 0}
                    onOpenWebsite={setWebsiteUrl}
                    delayMs={60 + i * 50}
                  />
                ))}
              </div>
            )
          )}
        </>
      )}

      {/* Filter Drawer */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        setFilters={setFilters}
        allTags={allTags}
      />

      {/* Website preview modal */}
      {websiteUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up p-4"
          onClick={() => setWebsiteUrl(null)}
        >
          <div
            className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-neutral-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Globe size={16} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-neutral-900">打开已发布网站</div>
                  <div className="text-[11px] text-neutral-500 font-mono truncate max-w-xs">{websiteUrl}</div>
                </div>
              </div>
              <button type="button" className="btn-ghost !p-2" onClick={() => setWebsiteUrl(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="p-6 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                <ExternalLink size={24} />
              </div>
              <p className="text-sm text-neutral-700 mb-4">
                此文档库已发布为公开网站，在实际环境中会直接打开浏览器跳转。
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setWebsiteUrl(null)}
                  className="btn-secondary"
                >
                  关闭
                </button>
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary inline-flex items-center gap-1.5"
                >
                  <ExternalLink size={14} />
                  立即访问
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Starter Pack 初始化向导 Modal ===== */}
      {starterModalOpen && (
        <StarterPackWizardModal
          packs={starterPacks}
          sources={sources}
          step={wizardStep}
          setStep={setWizardStep}
          selected={selectedPack}
          setSelected={setSelectedPack}
          form={packForm}
          setForm={setPackForm}
          open={starterModalOpen}
          onClose={() => {
            setStarterModalOpen(false)
            setCreatedProject(null)
          }}
          creating={creating}
          createdProject={createdProject}
          onCreate={async () => {
            if (!selectedPack || !packForm.name.trim()) return
            setCreating(true)

            // Step 1: 如果需要先新建数据源
            let finalSourceId = packForm.sourceId
            if (packForm.sourceBackend !== 'local' && packForm.sourceMode === 'create') {
              const newSource = await createSourceFromPackForm(packForm, selectedPack.name)
              finalSourceId = newSource.id
              setSources((prev) => [...prev, newSource])
            }

            // Step 2: 创建知识库项目
            const proj = await initProjectFromStarter({
              name: packForm.name.trim(),
              description: packForm.description.trim(),
              starterPackId: selectedPack.id,
              visibility: packForm.visibility,
              sourceBackend: packForm.sourceBackend,
              sourceId: finalSourceId,
              localFolderPath: packForm.localFolderPath,
            })
            setCreatedProject(proj)
            setCreating(false)
            setWizardStep(3)
          }}
          onGoProject={(proj) => {
            setStarterModalOpen(false)
            navigate(`/project/${proj.id}`)
          }}
          onGoSources={() => {
            setStarterModalOpen(false)
            navigate('/sources')
          }}
        />
      )}
    </div>
  )
}

// ========================================================================
// Starter Pack 初始化向导
// ========================================================================

function StarterPackWizardModal({
  packs, sources, step, setStep, selected, setSelected,
  form, setForm, onClose, creating, createdProject, onCreate, onGoProject, onGoSources,
}) {
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up p-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-xl border border-neutral-200">
        {/* Step header */}
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-neutral-200 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary-100 to-violet-100 flex items-center justify-center">
              <Sparkles size={18} className="text-primary-600" />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900">从模板初始化知识库</h3>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                Step {step} / 3 · {step === 1 ? '选择模板包' : step === 2 ? '预览并配置' : '创建完成'}
              </div>
            </div>
          </div>
          <button className="btn-ghost !p-2" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {/* Step 1: Pick pack */}
          {step === 1 && (
            <div>
              <div className="text-xs text-neutral-500 mb-4">
                选择一个最匹配你使用场景的种子包，它会帮你生成一套开箱即用的目录结构与示例文档
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {packs.map((p) => {
                  const active = selected?.id === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelected(p)}
                      className={`text-left card p-4 hover:shadow-md transition-all ${
                        active ? 'ring-2 ring-primary-400 border-primary-200' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`h-10 w-10 rounded-lg ${p.color} flex items-center justify-center text-xl flex-shrink-0`}>
                          {p.previewEmoji}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-neutral-900 truncate">{p.name}</div>
                          <div className="text-[11px] text-neutral-500 mt-0.5 line-clamp-2">{p.description}</div>
                          <div className="flex items-center gap-2 mt-2 text-[11px] text-neutral-400">
                            <FileText size={10} /> {p.docCount} 篇示例
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Step 2: Preview + Config */}
          {step === 2 && selected && (
            <div className="grid grid-cols-[1fr_320px] gap-6">
              {/* 目录树预览 */}
              <div>
                <div className="text-xs font-semibold text-neutral-700 mb-2 flex items-center gap-1.5">
                  <FolderKanban size={12} />
                  目录结构预览
                </div>
                <div className="card p-4 font-mono text-xs space-y-0.5 max-h-[380px] overflow-y-auto scrollbar-thin">
                  <div className="flex items-center gap-1 text-primary-600 font-semibold">
                    📁 {form.name || selected.name}/
                  </div>
                  {selected.tree.map((line, i) => {
                    const indent = (line.match(/^  /g) || []).length
                    const isFolder = line.endsWith('/')
                    const clean = line.trim()
                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-1 text-neutral-600 ${
                          isFolder ? 'font-medium text-neutral-700' : ''
                        }`}
                        style={{ paddingLeft: `${indent * 14 + 14}px` }}
                      >
                        {isFolder ? '📁' : '📄'} {clean}
                      </div>
                    )
                  })}
                </div>
                {selected.sampleTags?.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[11px] text-neutral-500 mb-1.5">示例标签</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.sampleTags.map((t) => (
                        <span key={t} className="tag-neutral !text-[10px]">#{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 右侧表单 */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                    知识库名称 <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="例如：EdgeAgent 架构笔记"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                    描述 <span className="text-neutral-400 font-normal">(可选)</span>
                  </label>
                  <textarea
                    rows={2}
                    className="input resize-none"
                    placeholder="一句话介绍这个知识库的用途"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">可见性</label>
                  <div className="space-y-2">
                    {[
                      { v: 'private', t: '私有', d: '仅自己可见', icon: Lock },
                      { v: 'team',    t: '团队', d: '团队内成员可见', icon: Users },
                      { v: 'public',  t: '公开', d: '互联网可访问', icon: Globe },
                    ].map((o) => {
                      const Icon = o.icon
                      const active = form.visibility === o.v
                      return (
                        <button
                          key={o.v}
                          type="button"
                          onClick={() => setForm({ ...form, visibility: o.v })}
                          className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border transition ${
                            active
                              ? 'border-primary-400 bg-primary-50/60 ring-1 ring-primary-100'
                              : 'border-neutral-200 hover:border-neutral-300'
                          }`}
                        >
                          <Icon size={14} className={active ? 'text-primary-600' : 'text-neutral-400'} />
                          <div>
                            <div className="text-sm font-medium text-neutral-800">{o.t}</div>
                            <div className="text-[11px] text-neutral-500">{o.d}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* ===== 存储后端选择 ===== */}
                <div className="pt-3 border-t border-neutral-100">
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    存储后端 <span className="text-neutral-400 font-normal">(默认本地)</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {STORAGE_BACKEND_TYPES.map((bt) => {
                      const BtIcon = bt.icon
                      const active = form.sourceBackend === bt.key
                      return (
                        <button
                          key={bt.key}
                          type="button"
                          onClick={() => setForm({
                            ...form,
                            sourceBackend: bt.key,
                            sourceId: null,
                            // 切换后端时默认回到「选择已有」
                            sourceMode: 'select',
                          })}
                          className={`p-2.5 rounded-lg border text-center transition-all ${
                            active
                              ? `${bt.color} ring-2 ring-primary-100`
                              : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                          }`}
                        >
                          <BtIcon size={18} className="mx-auto" />
                          <div className={`text-[11px] mt-1 font-medium ${active ? '' : 'text-neutral-600'}`}>{bt.label}</div>
                        </button>
                      )
                    })}
                  </div>

                  {/* ========== 本地：可编辑文件夹路径 ========== */}
                  {form.sourceBackend === 'local' && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-neutral-500 shrink-0">存储路径</label>
                        <div className="relative flex-1">
                          <input
                            type="text"
                            className="input font-mono pr-8"
                            value={form.localFolderPath}
                            onChange={(e) => setForm({ ...form, localFolderPath: e.target.value })}
                            placeholder="C:/Users/poryo/Documents/DocVault/"
                          />
                          <button
                            type="button"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600"
                            title="浏览文件夹"
                          >
                            <FolderOpen size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                        <div className="text-[10px] text-neutral-500 mb-0.5">最终路径预览</div>
                        <div className="text-[11px] font-mono text-neutral-700 truncate">
                          {form.localFolderPath.replace(/[\\/]+$/, '')}/{form.name || '知识库名称'}
                        </div>
                      </div>
                      <div className="text-[10px] text-neutral-400">
                        本地存储适合个人笔记和离线使用
                      </div>
                    </div>
                  )}

                  {/* ========== Git / 数据库：Tab 切换 ========== */}
                  {(form.sourceBackend === 'git' || form.sourceBackend === 'database') && (() => {
                    const backendType = form.sourceBackend
                    const matching = sources.filter((s) => s.type === backendType)
                    const label = backendType === 'git' ? 'Git 仓库' : '数据库'

                    return (
                      <div className="mt-3 space-y-2">
                        {/* Tab */}
                        <div className="inline-flex bg-neutral-100 rounded-md p-0.5">
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, sourceMode: 'select', sourceId: null })}
                            className={`px-2.5 py-1 text-[11px] font-medium rounded transition ${
                              form.sourceMode === 'select'
                                ? 'bg-white text-neutral-800 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                            }`}
                          >
                            选择已有数据源
                          </button>
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, sourceMode: 'create', sourceId: null })}
                            className={`px-2.5 py-1 text-[11px] font-medium rounded transition inline-flex items-center gap-1 ${
                              form.sourceMode === 'create'
                                ? 'bg-white text-neutral-800 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                            }`}
                          >
                            <Plus size={11} />
                            新建数据源
                          </button>
                        </div>

                        {/* --- Tab A: 选择已有 --- */}
                        {form.sourceMode === 'select' && (
                          matching.length > 0 ? (
                            <div className="space-y-1.5 max-h-[180px] overflow-y-auto scrollbar-thin">
                              {matching.map((s) => {
                                const isSelected = form.sourceId === s.id
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => setForm({
                                      ...form,
                                      sourceId: isSelected ? null : s.id,
                                    })}
                                    className={`w-full text-left px-2.5 py-2 rounded-md border transition flex items-center gap-2 ${
                                      isSelected
                                        ? 'border-primary-400 bg-primary-50'
                                        : 'border-neutral-200 hover:border-neutral-300'
                                    }`}
                                  >
                                    {s.type === 'database' ? (
                                      <Database size={14} className={isSelected ? 'text-emerald-600' : 'text-neutral-400'} />
                                    ) : (
                                      <GitBranch size={14} className={isSelected ? 'text-sky-600' : 'text-neutral-400'} />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <div className={`text-xs font-medium truncate ${isSelected ? 'text-neutral-800' : 'text-neutral-700'}`}>
                                        {s.name}
                                      </div>
                                      <div className="text-[10px] text-neutral-400 font-mono truncate">
                                        {s.dbType ? `${s.dbType}://` : ''}
                                        {s.url || `${s.host}${s.port ? ':' + s.port : ''}`}
                                      </div>
                                    </div>
                                    {isSelected && (
                                      <CheckCircle2 size={14} className="text-primary-600 shrink-0" />
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-neutral-200 p-3 text-center">
                              <div className="text-[11px] text-neutral-500 mb-2">
                                暂无可绑定的 {label} 数据源
                              </div>
                              <button
                                type="button"
                                onClick={() => setForm({ ...form, sourceMode: 'create' })}
                                className="btn-ghost !py-1 !px-2 !text-[11px] inline-flex items-center gap-1 text-primary-600 hover:bg-primary-50 border border-primary-100"
                              >
                                <Plus size={12} />
                                直接新建一个 {label}
                              </button>
                            </div>
                          )
                        )}

                        {/* --- Tab B: 内嵌创建新 Git 数据源 --- */}
                        {form.sourceMode === 'create' && form.sourceBackend === 'git' && (
                          <div className="rounded-lg border border-neutral-200 p-3 space-y-2.5 bg-sky-50/40">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-700">
                              <GitBranch size={12} />
                              新建 Git 仓库数据源
                            </div>

                            <div>
                              <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                                仓库地址 <span className="text-danger">*</span>
                              </label>
                              <input
                                type="text"
                                className="input font-mono !py-1.5 !text-xs"
                                placeholder="https://github.com/org/repo.git 或 git@github.com:org/repo.git"
                                value={form.newGitUrl}
                                onChange={(e) => setForm({ ...form, newGitUrl: e.target.value })}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[11px] font-medium text-neutral-600 mb-1">分支</label>
                                <input
                                  type="text"
                                  className="input font-mono !py-1.5 !text-xs"
                                  placeholder="main"
                                  value={form.newGitBranch}
                                  onChange={(e) => setForm({ ...form, newGitBranch: e.target.value })}
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-medium text-neutral-600 mb-1">认证方式</label>
                                <select
                                  className="input !py-1.5 !text-xs"
                                  value={form.newGitAuth}
                                  onChange={(e) => setForm({ ...form, newGitAuth: e.target.value })}
                                >
                                  <option value="ssh">SSH Key</option>
                                  <option value="https">HTTPS + Token</option>
                                </select>
                              </div>
                            </div>

                            {form.newGitAuth === 'https' && (
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">用户名</label>
                                  <input
                                    type="text"
                                    className="input !py-1.5 !text-xs"
                                    placeholder="git-user"
                                    value={form.newGitUsername}
                                    onChange={(e) => setForm({ ...form, newGitUsername: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">Personal Access Token</label>
                                  <input
                                    type="password"
                                    className="input !py-1.5 !text-xs font-mono"
                                    placeholder="ghp_xxx..."
                                    value={form.newGitToken}
                                    onChange={(e) => setForm({ ...form, newGitToken: e.target.value })}
                                  />
                                </div>
                              </div>
                            )}

                            <div className="text-[10px] text-neutral-400">
                              创建后数据源会自动保存，知识库将绑定到它
                            </div>
                          </div>
                        )}

                        {/* --- Tab B: 内嵌创建新数据库数据源 --- */}
                        {form.sourceMode === 'create' && form.sourceBackend === 'database' && (
                          <div className="rounded-lg border border-neutral-200 p-3 space-y-2.5 bg-emerald-50/40">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                              <Database size={12} />
                              新建数据库连接
                            </div>

                            <div>
                              <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                                数据库类型 <span className="text-danger">*</span>
                              </label>
                              <select
                                className="input !py-1.5 !text-xs"
                                value={form.newDbType}
                                onChange={(e) => setForm({ ...form, newDbType: e.target.value })}
                              >
                                {/* 关系型 */}
                                <optgroup label="— 关系型 —">
                                  <option value="mysql">🐬 MySQL</option>
                                  <option value="postgresql">🐘 PostgreSQL</option>
                                  <option value="sqlite">🗄️ SQLite（文件）</option>
                                  <option value="mariadb">MariaDB</option>
                                </optgroup>
                                {/* 对象型 */}
                                <optgroup label="— 文档 / 对象型 —">
                                  <option value="mongodb">🍃 MongoDB</option>
                                  <option value="couchdb">🛋️ CouchDB</option>
                                  <option value="cosmosdb">🌌 Cosmos DB</option>
                                  <option value="ravendb">🦅 RavenDB</option>
                                  <option value="elasticsearch">🔎 Elasticsearch</option>
                                </optgroup>
                              </select>
                            </div>

                            {/* SQLite 只显示文件路径 */}
                            {form.newDbType === 'sqlite' ? (
                              <div>
                                <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                                  SQLite 文件路径 <span className="text-danger">*</span>
                                </label>
                                <input
                                  type="text"
                                  className="input font-mono !py-1.5 !text-xs"
                                  placeholder="/path/to/docs.db"
                                  value={form.newDbHost}
                                  onChange={(e) => setForm({ ...form, newDbHost: e.target.value })}
                                />
                              </div>
                            ) : form.newDbType === 'cosmosdb' ? (
                              /* Cosmos DB: Endpoint + Primary Key */
                              <>
                                <div>
                                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                                    Endpoint <span className="text-danger">*</span>
                                  </label>
                                  <input
                                    type="text"
                                    className="input font-mono !py-1.5 !text-xs"
                                    placeholder="https://your-cosmos-account.documents.azure.com"
                                    value={form.newDbHost}
                                    onChange={(e) => setForm({ ...form, newDbHost: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                                    Primary Key <span className="text-danger">*</span>
                                  </label>
                                  <input
                                    type="password"
                                    className="input font-mono !py-1.5 !text-xs"
                                    placeholder="xxxxxxxxxxxxxxxxxxxxxx=="
                                    value={form.newDbPassword}
                                    onChange={(e) => setForm({ ...form, newDbPassword: e.target.value })}
                                  />
                                </div>
                              </>
                            ) : (
                              /* 通用：Host + Port */
                              <div className="grid grid-cols-[1fr_90px] gap-2">
                                <div>
                                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                                    主机 <span className="text-danger">*</span>
                                  </label>
                                  <input
                                    type="text"
                                    className="input !py-1.5 !text-xs"
                                    placeholder="db.example.com"
                                    value={form.newDbHost}
                                    onChange={(e) => setForm({ ...form, newDbHost: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">端口</label>
                                  <input
                                    type="number"
                                    className="input !py-1.5 !text-xs"
                                    placeholder="3306"
                                    value={form.newDbPort}
                                    onChange={(e) => setForm({ ...form, newDbPort: e.target.value })}
                                  />
                                </div>
                              </div>
                            )}

                            {/* 数据库名 */}
                            {form.newDbType !== 'sqlite' && (
                              <div>
                                <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                                  数据库名 <span className="text-danger">*</span>
                                </label>
                                <input
                                  type="text"
                                  className="input font-mono !py-1.5 !text-xs"
                                  placeholder="knowledge_db"
                                  value={form.newDbDatabase}
                                  onChange={(e) => setForm({ ...form, newDbDatabase: e.target.value })}
                                />
                              </div>
                            )}

                            {/* 用户名 + 密码（sqlite / cosmosdb 不显示） */}
                            {form.newDbType !== 'sqlite' && form.newDbType !== 'cosmosdb' && (
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">用户名</label>
                                  <input
                                    type="text"
                                    className="input !py-1.5 !text-xs"
                                    placeholder="db_user"
                                    value={form.newDbUsername}
                                    onChange={(e) => setForm({ ...form, newDbUsername: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">密码</label>
                                  <input
                                    type="password"
                                    className="input !py-1.5 !text-xs"
                                    placeholder="••••••"
                                    value={form.newDbPassword}
                                    onChange={(e) => setForm({ ...form, newDbPassword: e.target.value })}
                                  />
                                </div>
                              </div>
                            )}

                            {/* 数据表 / Collection（关系型 + MongoDB） */}
                            {(form.newDbType === 'mysql' || form.newDbType === 'postgresql' || form.newDbType === 'mariadb' || form.newDbType === 'sqlserver' || form.newDbType === 'mongodb') && (
                              <div>
                                <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                                  {form.newDbType === 'mongodb' ? 'Collection（可选）' : '数据表（可选）'}
                                </label>
                                <input
                                  type="text"
                                  className="input font-mono !py-1.5 !text-xs"
                                  placeholder="documents（留空自动检测）"
                                  value={form.newDbTable}
                                  onChange={(e) => setForm({ ...form, newDbTable: e.target.value })}
                                />
                              </div>
                            )}

                            <div className="text-[10px] text-neutral-400">
                              创建后数据源会自动保存，知识库将绑定到它
                            </div>
                          </div>
                        )}

                        {form.sourceMode === 'select' && (
                          <div className="text-[10px] text-neutral-400">
                            绑定后知识库会自动从此数据源同步内容
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>

                <div className="rounded-lg border border-neutral-200 p-3 bg-neutral-50 text-[11px] text-neutral-500 leading-relaxed">
                  💡 模板只负责初始化目录结构和示例文档，之后你可以随时修改、新增或删除文件，也可以切换到其他模板。
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && createdProject && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div className="text-lg font-semibold text-neutral-900">知识库已创建！</div>
              <div className="text-sm text-neutral-500 mt-1">
                「<span className="text-neutral-800 font-medium">{createdProject.name}</span>」
                已按 <span className="text-primary-600">{selected?.name}</span> 模板初始化，共 {selected?.docCount} 篇示例文档。
              </div>

              {/* 存储后端信息 */}
              {(() => {
                const backendMeta = STORAGE_BACKEND_TYPES.find((b) => b.key === form.sourceBackend)
                if (!backendMeta) return null
                return (
                  <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-100 text-xs text-neutral-700">
                    {(() => {
                      const BI = backendMeta.icon
                      return <BI size={13} className="text-primary-600" />
                    })()}
                    存储后端：<span className="font-medium">{backendMeta.label}</span>
                    {form.sourceId && (
                      <span className="text-neutral-400">
                        · 绑定「{sources.find((s) => s.id === form.sourceId)?.name || '数据源'}」
                      </span>
                    )}
                  </div>
                )
              })()}

              <div className="mt-5 flex items-center justify-center gap-3">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  留在文档库
                </button>
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-1.5"
                  onClick={() => onGoProject(createdProject)}
                >
                  进入知识库
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        {step < 3 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-200 bg-neutral-50/50">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
              disabled={creating}
            >
              {step > 1 && <ArrowLeft size={14} />}
              {step > 1 ? '上一步' : '取消'}
            </button>
            <div className="flex items-center gap-2">
              {step === 1 && (
                <button
                  type="button"
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!selected}
                  onClick={() => setStep(2)}
                >
                  下一步
                  <ArrowRight size={14} />
                </button>
              )}
              {step === 2 && (() => {
                // 校验逻辑
                let sourceValid = true
                if (form.sourceBackend === 'git') {
                  if (form.sourceMode === 'create') {
                    sourceValid = !!form.newGitUrl.trim()
                  } else {
                    sourceValid = !!form.sourceId
                  }
                } else if (form.sourceBackend === 'database') {
                  if (form.sourceMode === 'create') {
                    // 数据库：sqlite 需要路径，cosmosdb 需要 endpoint+key，其他需要 host+database
                    if (form.newDbType === 'sqlite') {
                      sourceValid = !!form.newDbHost.trim()
                    } else if (form.newDbType === 'cosmosdb') {
                      sourceValid = !!form.newDbHost.trim() && !!form.newDbPassword.trim()
                    } else {
                      sourceValid = !!form.newDbHost.trim() && !!form.newDbDatabase.trim()
                    }
                  } else {
                    sourceValid = !!form.sourceId
                  }
                }
                return (
                  <button
                    type="button"
                    className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={creating || !form.name.trim() || !sourceValid}
                    onClick={onCreate}
                  >
                    {creating ? (
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
                )
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
