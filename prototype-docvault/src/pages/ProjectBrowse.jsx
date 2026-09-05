import { useState, useEffect, useMemo } from 'react'
import {
  useParams,
  useNavigate,
  useSearchParams,
  useOutletContext,
} from 'react-router-dom'
import {
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Clock,
  Search,
  Plus,
  LayoutGrid,
  TreePine,
  ArrowLeft,
  FolderKanban,
  GitBranch,
  Save,
  Eye,
  PenTool,
  Bold,
  Italic,
  Heading1,
  List,
  Code,
  Quote,
  Link2,
  Undo2,
  Redo2,
  Sparkles,
  Wand2,
  MessageSquare,
  History,
  Tag,
} from 'lucide-react'
import {
  fetchDocuments,
  fetchProject,
  fetchDocument,
  saveDocument,
  fetchVersions,
  fetchTeam,
} from '../api/stubs.js'
import { authors as authorsData } from '../mock/data.js'

// ---------------------------------------------------------------------------
// Helpers (ALL preserved per spec)
// ---------------------------------------------------------------------------

const STATUS_MAP = {
  synced: { label: '已同步', cls: 'tag-success', dot: 'bg-emerald-500' },
  modified: { label: '本地修改', cls: 'tag-warning', dot: 'bg-amber-500' },
  conflict: { label: '冲突', cls: 'tag-danger', dot: 'bg-red-500' },
  untracked: { label: '未跟踪', cls: 'tag-primary', dot: 'bg-primary-500' },
}

const now = new Date('2026-09-05T10:30:00+08:00')

function relativeTime(isoString) {
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

function avatarColor(nameOrId) {
  const palette = [
    'bg-violet-500', 'bg-sky-500', 'bg-rose-500', 'bg-amber-500',
    'bg-emerald-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500',
    'bg-pink-500', 'bg-lime-500', 'bg-cyan-500', 'bg-fuchsia-500',
  ]
  let h = 0
  for (let i = 0; i < nameOrId.length; i++) h = (h * 31 + nameOrId.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function avatarHex(nameOrId) {
  const palette = [
    '#8b5cf6', '#0ea5e9', '#f43f5e', '#f59e0b',
    '#10b981', '#6366f1', '#14b8a6', '#f97316',
    '#ec4899', '#84cc16', '#06b6d4', '#d946ef',
  ]
  let h = 0
  for (let i = 0; i < nameOrId.length; i++) h = (h * 31 + nameOrId.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function getAuthorName(authorId) {
  const found = authorsData.find((a) => a.id === authorId)
  return found ? found.name : authorId
}

/** Minimal markdown → prose-doc HTML converter */
function markdownToHtml(md) {
  if (!md) return ''
  let src = md.replace(/\r\n/g, '\n')

  src = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.trim().replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    return `<pre><code>${escaped}</code></pre>`
  })

  src = src.replace(/^(>\s*.+)$/gm, (_, line) => {
    const inner = line.replace(/^>\s*/, '')
    return `<blockquote>${inlineMd(inner)}</blockquote>`
  })

  src = src.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  src = src.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  src = src.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
  src = src.replace(/^---+$/gm, '<hr/>')

  const ulRegex = /((?:^[-*+]\s+.+\n?)+)/gm
  src = src.replace(ulRegex, (block) => {
    const items = block
      .split('\n')
      .filter((l) => /^[-*+]\s+/.test(l))
      .map((l) => `<li>${inlineMd(l.replace(/^[-*+]\s+/, ''))}</li>`)
      .join('')
    return `<ul>${items}</ul>`
  })

  const olRegex = /((?:^\d+\.\s+.+\n?)+)/gm
  src = src.replace(olRegex, (block) => {
    const items = block
      .split('\n')
      .filter((l) => /^\d+\.\s+/.test(l))
      .map((l) => `<li>${inlineMd(l.replace(/^\d+\.\s+/, ''))}</li>`)
      .join('')
    return `<ol>${items}</ol>`
  })

  src = src
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return ''
      if (/^<(h1|h2|h3|ul|ol|li|pre|blockquote|hr)/.test(trimmed)) return line
      return `<p>${inlineMd(trimmed)}</p>`
    })
    .join('')

  return src
}

function inlineMd(text) {
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  )
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
  return text
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

function buildTree(docs) {
  const root = { children: new Map(), docs: [] }
  docs.forEach((doc) => {
    const parts = doc.path.split('/')
    let node = root
    parts.slice(0, -1).forEach((part) => {
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, children: new Map(), docs: [] })
      }
      node = node.children.get(part)
    })
    node.docs.push(doc)
  })
  return root
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function GridSkeleton() {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="p-6 animate-fade-up">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4 space-y-3">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-5 w-32" />
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-3/4" />
              <div className="skeleton h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function FocusedSkeleton() {
  return (
    <div className="h-full flex animate-fade-up">
      <div className="skeleton w-[280px] shrink-0 rounded-none" />
      <div className="flex-1 p-6 space-y-3">
        <div className="skeleton h-4 w-1/3" />
        <div className="skeleton h-7 w-1/2" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-2/3" />
      </div>
      <div className="skeleton w-[300px] shrink-0 rounded-none" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Document card (click → navigate to ?doc=)
// ---------------------------------------------------------------------------

function DocumentCard({ doc, onOpen, delayMs = 0 }) {
  const status = STATUS_MAP[doc.status] || STATUS_MAP.synced
  const authorName = getAuthorName(doc.modifiedBy)
  const parentFolder = doc.path.includes('/')
    ? doc.path.split('/').slice(0, -1).join('/')
    : '根目录'
  const fileName = doc.path.includes('/')
    ? doc.path.split('/').pop()
    : doc.path

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(doc)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(doc)
      }}
      className="card-hover animate-fade-up block relative group"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[11px] text-neutral-400 truncate flex items-center gap-1">
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
          <p className="text-xs text-neutral-500 leading-relaxed line-clamp-2">
            {extractPreview(doc.content)}
          </p>
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
            打开
            <ChevronRight size={12} />
          </span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tree sidebar row (folder / leaf)
// ---------------------------------------------------------------------------

function TreeNode({
  node,
  path,
  level,
  expanded,
  onToggle,
  onSelect,
  activeDocId,
}) {
  const nodePath = path ? `${path}/${node.name}` : node.name
  const isExpanded = expanded.has(nodePath)

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(nodePath)}
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm text-neutral-700 hover:bg-neutral-100 transition ${
          level === 0 ? 'font-medium text-neutral-800' : ''
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {node.children.size > 0 || node.docs.length > 0 ? (
          isExpanded ? (
            <ChevronDown size={14} className="text-neutral-400 shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-neutral-400 shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <FolderOpen size={13} className="text-primary-500 shrink-0" />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto font-mono text-[10px] text-neutral-400">
          {node.docs.length}
        </span>
      </button>

      {isExpanded && (
        <>
          {Array.from(node.children.entries()).map(([name, child]) => (
            <TreeNode
              key={name}
              node={child}
              path={nodePath}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              activeDocId={activeDocId}
            />
          ))}
          {node.docs.map((doc) => {
            const isActive = activeDocId === doc.id
            const status = STATUS_MAP[doc.status] || STATUS_MAP.synced
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => onSelect(doc)}
                className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm transition ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
                style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }}
              >
                <span className="w-3.5 shrink-0" />
                <FileText size={13} className="text-neutral-400 shrink-0" />
                <span className="truncate">{doc.path.split('/').pop()}</span>
                <span
                  className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`}
                  title={status.label}
                />
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Focused mode: Tree sidebar (w-280, mini back row + collapsible tree)
// ---------------------------------------------------------------------------

function TreeSidebar({ docs, activeDocId, onSelect, onBack }) {
  const tree = useMemo(() => buildTree(docs), [docs])
  const [expanded, setExpanded] = useState(new Set(['']))

  const toggleExpand = (path) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <aside className="w-[280px] shrink-0 bg-white border-r border-neutral-200 flex flex-col">
      {/* Mini top row: back to grid */}
      <div className="h-11 px-3 border-b border-neutral-100 flex items-center shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-primary-600 transition-colors"
        >
          <ArrowLeft size={14} />
          文档库
        </button>
        <FolderKanban size={14} className="ml-auto text-neutral-300" />
      </div>

      {/* Tree area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-2 min-h-0">
        {tree.children.size === 0 && tree.docs.length === 0 ? (
          <div className="text-xs text-neutral-400 text-center py-6">暂无文档</div>
        ) : (
          <>
            {tree.docs.map((doc) => {
              const isActive = activeDocId === doc.id
              const status = STATUS_MAP[doc.status] || STATUS_MAP.synced
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onSelect(doc)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm transition ${
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                  style={{ paddingLeft: '8px' }}
                >
                  <FileText size={13} className="text-neutral-400 shrink-0" />
                  <span className="truncate font-mono text-[12px]">{doc.path}</span>
                  <span
                    className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`}
                    title={status.label}
                  />
                </button>
              )
            })}
            {Array.from(tree.children.entries()).map(([name, child]) => (
              <TreeNode
                key={name}
                node={child}
                path=""
                level={0}
                expanded={expanded}
                onToggle={toggleExpand}
                onSelect={onSelect}
                activeDocId={activeDocId}
              />
            ))}
          </>
        )}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Focused mode: Document area (context bar + format toolbar + content)
// ---------------------------------------------------------------------------

const FORMAT_TOOLS = [
  { icon: Bold, label: '加粗' },
  { icon: Italic, label: '斜体' },
  { icon: Heading1, label: '标题' },
  { icon: List, label: '列表' },
  { icon: Code, label: '代码' },
  { icon: Quote, label: '引用' },
  { icon: Link2, label: '链接' },
]

function DocumentEditor({ doc, editContent, onEditChange, view, setView, onSave, saving }) {
  if (!doc) return null

  const status = STATUS_MAP[doc.status] || STATUS_MAP.synced
  const pathParts = (doc.path || '').split('/').filter(Boolean)

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-white">
      {/* Doc context bar */}
      <div className="px-6 pt-4 pb-3 border-b border-neutral-200 shrink-0">
        {/* Line 1: path breadcrumb + status */}
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-xs text-neutral-400 flex items-center gap-1 min-w-0">
            {pathParts.map((part, i) => (
              <span key={`${part}-${i}`} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight size={11} className="text-neutral-300 shrink-0" />}
                <span className={i === pathParts.length - 1 ? 'text-neutral-500 truncate' : 'truncate'}>
                  {part}
                </span>
              </span>
            ))}
          </div>
          <span className={`shrink-0 ${status.cls}`}>{status.label}</span>
        </div>

        {/* Line 2: title + controls */}
        <div className="flex items-center justify-between gap-3 mt-1.5">
          <h1 className="text-xl font-bold text-neutral-900 truncate">{doc.title}</h1>

          <div className="flex items-center gap-2 shrink-0">
            {/* View mode pill */}
            <div className="bg-neutral-100 rounded-md p-0.5 inline-flex">
              <button
                type="button"
                onClick={() => setView('preview')}
                className={`inline-flex items-center gap-1 px-2.5 h-7 rounded text-xs font-medium transition ${
                  view === 'preview'
                    ? 'bg-white text-neutral-800 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <Eye size={13} />
                预览
              </button>
              <button
                type="button"
                onClick={() => setView('edit')}
                className={`inline-flex items-center gap-1 px-2.5 h-7 rounded text-xs font-medium transition ${
                  view === 'edit'
                    ? 'bg-white text-neutral-800 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <PenTool size={13} />
                编辑
              </button>
            </div>

            {/* Branch pill */}
            <button type="button" className="btn-secondary !h-8 !text-xs" title="分支">
              <GitBranch size={13} />
              <span className="font-mono">main</span>
              <span className="tag-neutral !px-1.5 !py-0 !text-[10px] !leading-4">+2</span>
            </button>

            {/* Save */}
            <button
              type="button"
              className="btn-primary !h-8 !text-xs disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={onSave}
              disabled={saving}
            >
              <Save size={13} />
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>

      {/* Format toolbar (edit mode only) */}
      {view === 'edit' && (
        <div className="h-10 px-4 flex items-center gap-1 bg-neutral-50 border-b border-neutral-200 text-neutral-500 shrink-0">
          {FORMAT_TOOLS.map(({ icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              title={label}
              className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-neutral-200 transition"
            >
              <Icon size={14} />
            </button>
          ))}
          <span className="w-px h-4 bg-neutral-200 mx-1.5" />
          <button
            type="button"
            title="撤销"
            disabled
            className="w-7 h-7 inline-flex items-center justify-center rounded opacity-40 cursor-not-allowed"
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            title="重做"
            disabled
            className="w-7 h-7 inline-flex items-center justify-center rounded opacity-40 cursor-not-allowed"
          >
            <Redo2 size={14} />
          </button>
        </div>
      )}

      {/* Content */}
      {view === 'preview' ? (
        <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
          <div
            className="max-w-3xl mx-auto px-8 py-8 prose-doc"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(doc.content) }}
          />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <textarea
            className="flex-1 w-full p-6 font-mono text-sm leading-7 outline-none resize-none text-neutral-800 placeholder:text-neutral-400"
            value={editContent}
            onChange={(e) => onEditChange(e.target.value)}
            spellCheck={false}
            placeholder="开始编写 Markdown 文档…"
          />
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Focused mode: Collaboration panel (AI / comments / history + presence)
// ---------------------------------------------------------------------------

function CollaborativePanel({ doc, team, versions }) {
  const [tab, setTab] = useState('ai')
  const [aiInput, setAiInput] = useState('')
  const [aiReply, setAiReply] = useState(null)

  const membersById = useMemo(() => {
    const m = {}
    team.forEach((t) => (m[t.id] = t))
    return m
  }, [team])

  const presenceMembers = team.slice(0, 3)

  const sendAI = (prompt) => {
    const q = prompt || aiInput.trim()
    if (!q) return
    setAiReply({
      question: q,
      answer: `我来帮你处理「${q}」。\n\n建议：聚焦文档的核心要点，保持每节 3-5 句话，代码块不要超过 15 行。当前文档共 ${
        doc?.wordCount || 0
      } 字，建议扩充到 500-800 字的完整段落。`,
    })
    setAiInput('')
  }

  const presetChips = ['总结文档', '优化段落', '翻译为英文']

  const mockComments = [
    {
      id: 'c-1',
      author: membersById[2] || { name: '林川', avatarColor: '#0ea5e9' },
      text: '架构概览里提到的 MQTT QoS 1 能否加一段说明？很多新同学对 QoS 级别不熟悉。',
      time: relativeTime(new Date(now.getTime() - 120 * 60000).toISOString()),
    },
    {
      id: 'c-2',
      author: membersById[4] || { name: '苏筱', avatarColor: '#ec4899' },
      text: '整体写得很清晰！建议在末尾加一个「相关文档」小节链接到部署指南和故障排查。',
      time: relativeTime(new Date(now.getTime() - 480 * 60000).toISOString()),
    },
  ]

  const tabs = [
    { id: 'ai', icon: Sparkles, label: 'AI助手' },
    { id: 'comments', icon: MessageSquare, label: '评论' },
    { id: 'history', icon: History, label: '历史' },
  ]

  return (
    <aside className="w-[300px] shrink-0 bg-white border-l border-neutral-200 flex flex-col">
      {/* Tabs header */}
      <div className="h-11 border-b border-neutral-200 flex shrink-0">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium transition border-b-2 ${
              tab === id
                ? 'text-primary-700 border-primary-500'
                : 'text-neutral-500 border-transparent hover:text-neutral-800'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 min-h-0">
        {tab === 'ai' && (
          <div className="space-y-3">
            <textarea
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendAI()
                }
              }}
              rows={3}
              placeholder="让 AI 帮你润色、总结、翻译…"
              className="input !text-xs !py-2 resize-none"
            />
            <button
              type="button"
              onClick={() => sendAI()}
              className="btn-primary w-full !h-8 !text-xs justify-center"
            >
              <Wand2 size={13} />
              发送
            </button>

            <div className="flex flex-wrap gap-1.5">
              {presetChips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => sendAI(chip)}
                  className="tag-neutral cursor-pointer hover:bg-primary-50 hover:!text-primary-700 transition"
                >
                  {chip}
                </button>
              ))}
            </div>

            {aiReply && (
              <div className="bg-primary-50 rounded-lg p-3 text-sm animate-fade-up">
                <p className="text-xs text-neutral-700 whitespace-pre-wrap leading-relaxed">
                  {aiReply.answer}
                </p>
              </div>
            )}
          </div>
        )}

        {tab === 'comments' && (
          <div className="space-y-4">
            {mockComments.map((c) => (
              <div key={c.id}>
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                    style={{ backgroundColor: c.author.avatarColor }}
                  >
                    {c.author.name.slice(0, 1).toUpperCase()}
                  </div>
                  <span className="text-xs font-semibold text-neutral-800">{c.author.name}</span>
                  <span className="ml-auto text-xs text-neutral-400">{c.time}</span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed pl-8">{c.text}</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-1">
            {versions.slice(0, 5).map((v) => (
              <div
                key={v.id}
                className="px-2 py-1.5 rounded-md hover:bg-neutral-50 cursor-pointer transition"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                    {(v.commitHash || '').slice(0, 7)}
                  </span>
                  <span className="ml-auto text-[10px] text-neutral-400">
                    {relativeTime(v.timestamp)}
                  </span>
                </div>
                <div className="text-xs text-neutral-700 truncate mt-1">{v.message}</div>
                <div className="text-[10px] text-neutral-400 mt-0.5">{v.author}</div>
              </div>
            ))}
            {versions.length === 0 && (
              <div className="text-xs text-neutral-400 text-center py-6">暂无版本记录</div>
            )}
          </div>
        )}
      </div>

      {/* Presence footer */}
      <div className="border-t border-neutral-200 p-3 flex items-center gap-2 shrink-0">
        <div className="flex items-center -space-x-1.5">
          {presenceMembers.map((m) => (
            <div
              key={m.id}
              className="relative w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold ring-2 ring-white"
              style={{ backgroundColor: m.avatarColor }}
              title={`${m.name} · 正在编辑`}
            >
              {m.name.slice(0, 1).toUpperCase()}
              <span className="absolute -bottom-0 -right-0 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-1 ring-white" />
            </div>
          ))}
        </div>
        <span className="text-xs text-neutral-500">+3 人正在编辑</span>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Main page — URL-driven (?doc= → focused mode), manages own full-height layout
// ---------------------------------------------------------------------------

export default function ProjectBrowse() {
  const { id: projectId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Outlet context: shell only provides showToast now (no isFocused / setSaveHandler)
  const outletCtx = useOutletContext() || {}
  const showToast = outletCtx.showToast || ((m) => console.log('[toast]', m))

  // Mode is derived purely from the URL
  const docParam = searchParams.get('doc') // null → grid mode, string → focused mode
  const isFocused = !!docParam

  // Data state
  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState(null)
  const [documents, setDocuments] = useState([])
  const [team, setTeam] = useState([])
  const [activeDoc, setActiveDoc] = useState(null) // full doc with content
  const [versions, setVersions] = useState([])
  const [focusedView, setFocusedView] = useState('preview')
  const [editContent, setEditContent] = useState('')
  const [focusedSaving, setFocusedSaving] = useState(false)

  // Grid-mode local UI state
  const [keyword, setKeyword] = useState('')
  const [gridView, setGridView] = useState('grid') // visual toggle only

  // ---- Mount: fetch project + documents + team ----
  useEffect(() => {
    let active = true
    const run = async () => {
      const [p, docs, members] = await Promise.all([
        fetchProject(projectId),
        fetchDocuments({ projectId }),
        fetchTeam(),
      ])
      if (!active) return
      setProject(p)
      setDocuments(docs)
      setTeam(members || [])
      setTimeout(() => setLoading(false), 400)
    }
    run()
    return () => {
      active = false
    }
  }, [projectId])

  // ---- When ?doc= param changes → fetch doc detail + versions ----
  useEffect(() => {
    if (!docParam || documents.length === 0) return
    let cancelled = false

    const loadDetail = async () => {
      // Resolve docId: use URL param if valid, else first doc
      const targetDoc = documents.find((d) => d.id === docParam)
      const effectiveId = targetDoc ? docParam : documents[0]?.id
      if (!effectiveId) return

      // If URL param was invalid, fix it
      if (!targetDoc && docParam !== effectiveId) {
        setSearchParams({ doc: effectiveId }, { replace: true })
      }

      const [detail, vs] = await Promise.all([
        fetchDocument(effectiveId),
        fetchVersions(effectiveId),
      ])
      if (cancelled) return
      setActiveDoc(detail || documents.find((d) => d.id === effectiveId) || null)
      setVersions(vs)
      setFocusedView('preview')
    }
    loadDetail()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docParam, documents.length])

  // ---- Sync editor buffer when the active document changes ----
  useEffect(() => {
    setEditContent(activeDoc?.content || '')
  }, [activeDoc?.id])

  // ---- Save (page-level, lives in the doc context bar) ----
  const handleSave = async () => {
    if (!activeDoc) return
    setFocusedSaving(true)
    try {
      const saved = await saveDocument(activeDoc.id, {
        content: editContent,
        summary: '在浏览聚焦模式中保存',
      })
      if (saved) {
        setActiveDoc(saved)
        setDocuments((prev) => prev.map((d) => (d.id === saved.id ? saved : d)))
        setEditContent(saved.content || editContent)
      }
      showToast('已保存 ✓')
    } finally {
      setFocusedSaving(false)
    }
  }

  // ---- Handlers ----
  const openDoc = (doc) => {
    navigate(`/project/${projectId}/browse?doc=${doc.id}`)
  }

  const selectDocInSidebar = (doc) => {
    setSearchParams({ doc: doc.id })
  }

  const backToGrid = () => {
    setSearchParams({})
  }

  const handleEditChange = (value) => {
    setEditContent(value)
    setActiveDoc((prev) => (prev ? { ...prev, content: value } : prev))
  }

  // ---- Grid docs: sorted by lastModified desc, filtered by keyword ----
  const visibleDocs = useMemo(() => {
    const sorted = [...documents].sort(
      (a, b) => new Date(b.lastModified) - new Date(a.lastModified),
    )
    const kw = keyword.trim().toLowerCase()
    if (!kw) return sorted
    return sorted.filter(
      (d) =>
        (d.title || '').toLowerCase().includes(kw) ||
        (d.path || '').toLowerCase().includes(kw),
    )
  }, [documents, keyword])

  // ---- Loading skeletons (~400ms) ----
  if (loading || !project) {
    return isFocused ? <FocusedSkeleton /> : <GridSkeleton />
  }

  // =======================================================================
  // GRID MODE — scrollable root, in-content toolbar + card grid
  // =======================================================================
  if (!isFocused) {
    return (
      <div className="h-full overflow-y-auto scrollbar-thin">
        <div className="p-6">
          {/* Toolbar row (not a card) */}
          <div className="flex items-center gap-3 mb-5">
            <div className="relative w-80">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
              />
              <input
                type="text"
                className="input !pl-9"
                placeholder="在本项目中搜索…"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>

            <div className="flex-1" />

            {/* View toggle (visual only) */}
            <div className="inline-flex items-center bg-neutral-100 rounded-md p-0.5">
              <button
                type="button"
                title="网格视图"
                onClick={() => setGridView('grid')}
                className={`inline-flex items-center justify-center w-7 h-7 rounded transition ${
                  gridView === 'grid'
                    ? 'bg-white text-primary-600 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                title="树状视图"
                onClick={() => setGridView('tree')}
                className={`inline-flex items-center justify-center w-7 h-7 rounded transition ${
                  gridView === 'tree'
                    ? 'bg-white text-primary-600 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <TreePine size={14} />
              </button>
            </div>

            <button
              type="button"
              className="btn-secondary !h-9 !text-xs"
              onClick={() => showToast('新文档功能演示')}
            >
              <Plus size={15} />
              新建文档
            </button>
          </div>

          {/* Cards / empty states */}
          {documents.length === 0 ? (
            <div className="card p-10 text-center text-neutral-400">
              <FileText size={40} className="mx-auto mb-3 text-neutral-300" />
              <p className="text-sm">该项目暂无文档</p>
            </div>
          ) : visibleDocs.length === 0 ? (
            <div className="card p-10 text-center text-neutral-400 max-w-md mx-auto mt-10">
              <Search size={32} className="mx-auto mb-3 text-neutral-300" />
              <p className="text-sm">没有找到匹配的文档</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleDocs.map((doc, i) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  onOpen={openDoc}
                  delayMs={i * 50}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // =======================================================================
  // FOCUSED MODE — full-height three-column flex, each column own overflow
  // =======================================================================
  return (
    <div className="h-full flex">
      <TreeSidebar
        docs={documents}
        activeDocId={activeDoc?.id}
        onSelect={selectDocInSidebar}
        onBack={backToGrid}
      />
      <DocumentEditor
        doc={activeDoc}
        editContent={editContent}
        onEditChange={handleEditChange}
        view={focusedView}
        setView={setFocusedView}
        onSave={handleSave}
        saving={focusedSaving}
      />
      <CollaborativePanel
        doc={activeDoc}
        team={team}
        versions={versions}
      />
    </div>
  )
}
