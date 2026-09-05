import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
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
  Code2,
  ExternalLink,
  Clock,
  User,
  Tag,
  ChevronRight,
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
  'repo-docs': Code2,
  web: ExternalLink,
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
  // Strip markdown headings and code fences to get plain preview text
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
  // Deterministic hue by id so the same user always has the same color
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
      {/* Header skeleton */}
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

      {/* Filter strip skeleton */}
      <div className="skeleton h-8 w-full mb-5" />

      {/* Grid skeleton */}
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
// Document card
// ---------------------------------------------------------------------------

function DocumentCard({ doc, delayMs = 0 }) {
  const status = STATUS_MAP[doc.status] || STATUS_MAP.synced
  const authorName = getAuthorName(doc.modifiedBy)
  const parentFolder = doc.path.includes('/')
    ? doc.path.split('/').slice(0, -1).join('/')
    : '根目录'
  const fileName = doc.path.includes('/')
    ? doc.path.split('/').pop()
    : doc.path

  return (
    <Link
      to={`/editor?id=${doc.id}`}
      className="card-hover animate-fade-up block relative group"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="p-4 space-y-3">
        {/* Top row: path breadcrumb + status */}
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[11px] text-neutral-400 truncate flex items-center gap-1">
            <span>{parentFolder}</span>
            <ChevronRight size={12} className="text-neutral-300 shrink-0" />
            <span className="text-neutral-500">{fileName}</span>
          </div>
          <span className={`shrink-0 ${status.cls}`}>{status.label}</span>
        </div>

        {/* Title + preview */}
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold text-neutral-900 leading-tight line-clamp-1">
            {doc.title}
          </h3>
          <p
            className="text-xs text-neutral-500 leading-relaxed line-clamp-2"
            dangerouslySetInnerHTML={{ __html: extractPreview(doc.content) }}
          />
        </div>

        {/* Meta row */}
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

        {/* Tags */}
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

        {/* Hover reveal button */}
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
// Quick jump project tiles
// ---------------------------------------------------------------------------

function ProjectTiles({ projects, docCounts }) {
  return (
    <section className="animate-fade-up" style={{ animationDelay: '300ms' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-neutral-800">快速跳转</span>
        <span className="text-xs text-neutral-400">· 全部项目</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-3">
        {projects.map((p) => {
          const Icon = SOURCE_ICON[p.sourceType] || HardDrive
          return (
            <Link
              key={p.id}
              to={`/library?project=${p.id}`}
              className="card-hover p-3 flex items-center gap-3"
            >
              <div
                className={`w-10 h-10 rounded-lg ${p.color} flex items-center justify-center shrink-0`}
              >
                <Icon
                  size={18}
                  className={p.color.replace('bg-', 'text-').replace('-100', '-600')}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-neutral-900 truncate">
                  {p.name}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] text-neutral-500">
                    {docCounts[p.id] || 0} 篇文档
                  </span>
                  <span
                    className={`tag-neutral !px-1.5 !py-0 !text-[10px] ${
                      p.sourceType === 'git'
                        ? '!text-emerald-700 !bg-emerald-50'
                        : p.sourceType === 'local'
                        ? '!text-amber-700 !bg-amber-50'
                        : p.sourceType === 'repo-docs'
                        ? '!text-indigo-700 !bg-indigo-50'
                        : ''
                    }`}
                  >
                    {p.sourceType === 'git'
                      ? 'Git'
                      : p.sourceType === 'local'
                      ? '本地'
                      : p.sourceType === 'repo-docs'
                      ? '仓库 /docs'
                      : p.sourceType}
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Library() {
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState([])
  const [documents, setDocuments] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [viewMode, setViewMode] = useState('grid') // visual only
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    let active = true
    const run = async () => {
      const [ps, ds] = await Promise.all([fetchProjects(), fetchDocuments()])
      if (!active) return
      setProjects(ps)
      setDocuments(ds)
      // Show skeleton for a guaranteed 400ms on mount
      setTimeout(() => setLoading(false), 400)
    }
    run()
    return () => {
      active = false
    }
  }, [])

  // Doc counts per project
  const docCounts = useMemo(() => {
    const c = {}
    documents.forEach((d) => {
      c[d.projectId] = (c[d.projectId] || 0) + 1
    })
    return c
  }, [documents])

  // Filtered document list
  const filteredDocs = useMemo(() => {
    let list = documents
    if (selectedProject) list = list.filter((d) => d.projectId === selectedProject)
    if (keyword.trim()) {
      const needle = keyword.trim().toLowerCase()
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(needle) ||
          d.path.toLowerCase().includes(needle) ||
          (d.tags || []).some((t) => t.toLowerCase().includes(needle)),
      )
    }
    // Sort by lastModified desc
    return [...list].sort(
      (a, b) => new Date(b.lastModified) - new Date(a.lastModified),
    )
  }, [documents, selectedProject, keyword])

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
                管理所有项目、知识库和代码仓库中的文档
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary">
                <ExternalLink size={16} />
                导入源
              </button>
              <button type="button" className="btn-primary">
                <Plus size={16} />
                新建库
              </button>
            </div>
          </header>

          {/* 2. Search + toolbar */}
          <div
            className="animate-fade-up flex flex-wrap items-center gap-3 mb-5"
            style={{ animationDelay: '80ms' }}
          >
            {/* Search */}
            <div className="relative flex-1 min-w-[220px] max-w-[360px]">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="按标题、路径或标签搜索..."
                className="input !pl-9 !h-9"
              />
            </div>

            {/* Filter chips */}
            <ProjectChips
              projects={projects}
              selected={selectedProject}
              onSelect={setSelectedProject}
              docCounts={docCounts}
            />

            {/* View mode toggle (visual only) */}
            <div className="flex items-center ml-auto">
              <div className="inline-flex items-center bg-neutral-100 rounded-md p-0.5">
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
              <button type="button" className="btn-ghost !p-1.5 ml-1">
                <Filter size={16} className="text-neutral-500" />
              </button>
            </div>
          </div>

          {/* 3. Document grid */}
          {filteredDocs.length === 0 ? (
            <div
              className="animate-fade-up card p-12 text-center"
              style={{ animationDelay: '120ms' }}
            >
              <FileText size={48} className="mx-auto text-neutral-300 mb-4" />
              <div className="text-sm font-medium text-neutral-700 mb-1">
                没有找到匹配的文档
              </div>
              <div className="text-xs text-neutral-400">
                尝试切换项目筛选条件或清空搜索关键词
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {filteredDocs.map((doc, i) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  delayMs={120 + i * 60}
                />
              ))}
            </div>
          )}

          {/* 4. Project tiles — 快速跳转 */}
          <ProjectTiles projects={projects} docCounts={docCounts} />
        </>
      )}
    </div>
  )
}
