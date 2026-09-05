import { useState, useEffect, useMemo } from 'react'
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
} from 'lucide-react'
import { fetchProjects, fetchDocuments } from '../api/stubs.js'
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
// Project chip
// ---------------------------------------------------------------------------

function ProjectChips({ projects, selected, onSelect, docCounts }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`tag-neutral cursor-pointer transition ${
          selected === null
            ? 'bg-primary-100 !text-primary-700 ring-1 ring-primary-200'
            : 'hover:bg-neutral-200'
        }`}
      >
        <FolderOpen size={12} />
        全部
        <span className="ml-1 text-neutral-400">
          ({projects.reduce((s, p) => s + (docCounts[p.id] || 0), 0)})
        </span>
      </button>
      {projects.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          className={`tag-neutral cursor-pointer transition ${
            selected === p.id
              ? 'bg-primary-100 !text-primary-700 ring-1 ring-primary-200'
              : 'hover:bg-neutral-200'
          }`}
        >
          {p.name}
          <span className="ml-1 text-neutral-400">
            ({docCounts[p.id] || 0})
          </span>
        </button>
      ))}
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
      const [ps, ds] = await Promise.all([fetchProjects(), fetchDocuments()])
      if (!active) return
      setProjects(ps)
      setDocuments(ds)
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
          {/* 1. Page header */}
          <header className="animate-fade-up flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
                <FolderOpen size={24} className="text-primary-600" />
                文档库
              </h1>
              <p className="text-sm text-neutral-500 mt-1">
                {scope === 'explore'
                  ? '发现社区公开的文档库和已发布网站'
                  : '管理所有项目、知识库和代码仓库中的文档'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* View-mode pill toggle: flat vs project */}
              <div className="inline-flex items-center bg-neutral-100 rounded-full p-0.5">
                <button
                  type="button"
                  onClick={() => setBrowseMode('flat')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    browseMode === 'flat'
                      ? 'bg-white text-neutral-900 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  <LayoutGrid size={13} />
                  平铺
                </button>
                <button
                  type="button"
                  onClick={() => setBrowseMode('project')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    browseMode === 'project'
                      ? 'bg-white text-neutral-900 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  <FolderKanban size={13} />
                  按项目
                </button>
              </div>

              {scope === 'mine' && (
                <>
                  <button type="button" className="btn-secondary" onClick={() => navigate('/sources')}>
                    <ExternalLink size={16} />
                    导入源
                  </button>
                  <button type="button" className="btn-primary" onClick={() => navigate('/sources')}>
                    <Plus size={16} />
                    新建库
                  </button>
                </>
              )}
            </div>
          </header>

          {/* 2. Scope tabs: mine vs explore */}
          <div className="animate-fade-up mb-5" style={{ animationDelay: '40ms' }}>
            <div className="inline-flex items-center bg-white border border-neutral-200 rounded-lg p-1 shadow-sm">
              <button
                type="button"
                onClick={() => { setScope('mine'); setSelectedProject(null) }}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition ${
                  scope === 'mine'
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <EyeOff size={14} />
                我的文档库
                <span className={`text-xs ${scope === 'mine' ? 'text-primary-500' : 'text-neutral-400'}`}>
                  {projects.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => { setScope('explore'); setSelectedProject(null) }}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition ${
                  scope === 'explore'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <Globe size={14} />
                公开探索
                <span className={`text-xs ${scope === 'explore' ? 'text-emerald-500' : 'text-neutral-400'}`}>
                  {publishedPublicProjects.length}
                </span>
              </button>
            </div>
          </div>

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

          {/* 3. Search + toolbar */}
          <div
            className="animate-fade-up flex flex-wrap items-center gap-3 mb-5"
            style={{ animationDelay: '80ms' }}
          >
            <div className="relative flex-1 min-w-[220px] max-w-[360px]">
              <Search
                size={16}
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
                className="input !pl-9 !h-9"
              />
            </div>

            {/* Filter chips — quick toggles */}
            {scope === 'mine' && (
              <>
                <FilterChip
                  label="有冲突"
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

            <div className="flex items-center ml-auto">
              {browseMode === 'flat' && scope === 'mine' && (
                <ProjectChips
                  projects={scopeProjects}
                  selected={selectedProject}
                  onSelect={setSelectedProject}
                  docCounts={docCounts}
                />
              )}

              <div className="inline-flex items-center bg-neutral-100 rounded-md p-0.5 ml-2">
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
                  <Grid3X3 size={16} />
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
                  <List size={16} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition ml-1 ${
                  activeFilterCount > 0
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <Filter size={14} />
                筛选
                {activeFilterCount > 0 && (
                  <span className="text-[10px] bg-white/20 px-1 rounded">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 4. Content area */}
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
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                {filteredDocs.map((doc, i) => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    projects={projects}
                    delayMs={120 + i * 60}
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
    </div>
  )
}
