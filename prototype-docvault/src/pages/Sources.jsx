import { useState, useEffect } from 'react'
import {
  Database,
  Plus,
  GitFork,
  GitMerge,
  FolderOpen,
  Code2,
  Globe,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Settings,
  Trash2,
  Link2,
  ExternalLink,
  X,
} from 'lucide-react'
import { fetchSources, syncSource } from '../api/stubs.js'

// ---- helpers ----------------------------------------------------------

function relativeTime(iso) {
  if (!iso) return '刚刚'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} 小时前`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  return `${months} 个月前`
}

// mock 字段是 lastSync，stub 更新用了 lastSyncedAt —— 做一个兼容读取
function readLastSync(source) {
  return source.lastSync || source.lastSyncedAt || null
}

// source type → 图标 / 标签文字 / tag class 映射
const SOURCE_TYPE_META = {
  github: { icon: GitFork, label: 'GitHub', tagClass: 'tag-primary' },
  gitlab: { icon: GitMerge, label: 'GitLab', tagClass: 'tag-primary' },
  'local-folder': { icon: FolderOpen, label: '本地文件夹', tagClass: 'tag-neutral' },
  'code-repo': { icon: Code2, label: '代码仓库 /docs', tagClass: 'tag-primary' },
  'web-link': { icon: Globe, label: '网页链接', tagClass: 'tag-neutral' },
}

// 类型分类展示（按任务描述顺序）
const SOURCE_TYPE_CATEGORIES = [
  { type: 'github', icon: GitFork, label: 'GitHub' },
  { type: 'gitlab', icon: GitMerge, label: 'GitLab' },
  { type: 'local-folder', icon: FolderOpen, label: '本地文件夹' },
  { type: 'code-repo', icon: Code2, label: '代码仓库 /docs' },
  { type: 'web-link', icon: Globe, label: '网页链接' },
]

// ---- main page --------------------------------------------------------

export default function Sources() {
  const [loading, setLoading] = useState(true)
  const [sources, setSources] = useState([])
  const [syncingIds, setSyncingIds] = useState(new Set())
  const [showAddModal, setShowAddModal] = useState(false)
  const [addType, setAddType] = useState('github')

  useEffect(() => {
    ;(async () => {
      const list = await fetchSources()
      // 拷贝一份，避免直接引用 mock 被后续 syncSource 原地修改影响 React 渲染
      setSources(list.map((s) => ({ ...s })))
      setLoading(false)
    })()
  }, [])

  // 手动触发同步 —— 模拟 syncSource stub 的 1.2s 异步流程
  const handleSync = async (id) => {
    if (syncingIds.has(id)) return
    // 立即切到 syncing 状态
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'syncing' } : s)))
    setSyncingIds((prev) => new Set(prev).add(id))
    try {
      const result = await syncSource(id)
      if (result) {
        // stub 返回的对象 status 是 'synced'，页面统一显示 'connected'
        setSources((prev) =>
          prev.map((s) =>
            s.id === id
              ? { ...s, status: 'connected', lastSync: new Date().toISOString() }
              : s,
          ),
        )
      }
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleDelete = (id) => {
    setSources((prev) => prev.filter((s) => s.id !== id))
  }

  const handleAddSource = (form) => {
    const newId = `s-${Date.now()}`
    const now = new Date().toISOString()
    const newSource = {
      id: newId,
      name: form.name || `${SOURCE_TYPE_META[addType]?.label || '新源'} · ${form.url || newId}`,
      type: addType,
      url: form.url || '',
      status: 'connected',
      lastSync: now,
      branch: form.branch || null,
    }
    setSources((prev) => [...prev, newSource])
    setShowAddModal(false)
  }

  const connectedCount = sources.filter((s) => s.status === 'connected').length

  // ---------- render ----------
  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-6">
      {/* Page header */}
      <section className="animate-fade-up">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-primary-600 text-xs font-medium mb-1">
              <Database size={14} />
              <span>Sources</span>
            </div>
            <h1 className="font-display text-2xl font-bold text-neutral-900">
              数据源管理
            </h1>
            <p className="text-sm text-neutral-500 mt-1">
              连接外部文档源，DocVault 会自动同步并纳入你的知识资产
              <span className="ml-2 text-neutral-400">·</span>
              <span className="ml-2 text-neutral-500">
                已连接 <span className="font-semibold text-primary-600">{connectedCount}</span> / {sources.length}
              </span>
            </p>
          </div>
          <button className="btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} />
            添加数据源
          </button>
        </div>
      </section>

      {/* Source type categories */}
      <section
        className="animate-fade-up"
        style={{ animationDelay: '60ms' }}
      >
        <h2 className="text-sm font-semibold text-neutral-900 mb-3 flex items-center gap-2">
          <Link2 size={14} className="text-primary-600" />
          支持的数据源类型
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
          {SOURCE_TYPE_CATEGORIES.map((cat) => {
            const Icon = cat.icon
            return (
              <button
                key={cat.type}
                onClick={() => {
                  setAddType(cat.type)
                  setShowAddModal(true)
                }}
                className="group card p-4 min-w-[160px] flex-shrink-0 text-left hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="flex items-start justify-between">
                  <div className="h-10 w-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
                    <Icon size={20} />
                  </div>
                  <span className="btn-ghost !p-1.5 !text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    连接
                    <Plus size={12} />
                  </span>
                </div>
                <div className="mt-3 font-medium text-neutral-800 text-sm">
                  {cat.label}
                </div>
                <div className="text-xs text-neutral-400 mt-0.5">
                  点击连接一个新源
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Connected sources list */}
      <section
        className="animate-fade-up"
        style={{ animationDelay: '120ms' }}
      >
        {loading ? (
          <SourcesListSkeleton />
        ) : sources.length === 0 ? (
          <EmptyState onAdd={() => setShowAddModal(true)} />
        ) : (
          <div className="card overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[1.4fr_120px_1.4fr_140px_140px_160px] gap-4 px-5 py-3 bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
              <span>名称</span>
              <span>类型</span>
              <span>URL / 路径</span>
              <span>状态</span>
              <span>最后同步</span>
              <span className="text-right">操作</span>
            </div>
            {/* Rows */}
            <ul>
              {sources.map((source) => (
                <li
                  key={source.id}
                  className="grid grid-cols-[1.4fr_120px_1.4fr_140px_140px_160px] gap-4 px-5 py-4 items-center border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60 transition-colors"
                >
                  {/* Name + type icon */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <SourceTypeBadge type={source.type} />
                    <div className="min-w-0">
                      <div className="font-semibold text-neutral-900 truncate">
                        {source.name}
                      </div>
                      {source.branch && (
                        <div className="text-xs text-neutral-400 truncate">
                          分支：{source.branch}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Source type tag */}
                  <div>
                    <span className={SOURCE_TYPE_META[source.type]?.tagClass || 'tag-neutral'}>
                      {SOURCE_TYPE_META[source.type]?.label || source.type}
                    </span>
                  </div>

                  {/* URL / path */}
                  <div className="min-w-0">
                    <code className="text-xs font-mono text-neutral-600 truncate block">
                      {source.url}
                    </code>
                  </div>

                  {/* Status */}
                  <div>
                    <StatusTag
                      status={source.status}
                      syncing={syncingIds.has(source.id)}
                    />
                  </div>

                  {/* Last synced */}
                  <div className="text-xs text-neutral-500">
                    {relativeTime(readLastSync(source))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      className="btn-ghost !p-2"
                      title="立即同步"
                      onClick={() => handleSync(source.id)}
                      disabled={syncingIds.has(source.id)}
                    >
                      <RefreshCw
                        size={15}
                        className={syncingIds.has(source.id) ? 'animate-spin text-primary-500' : ''}
                      />
                    </button>
                    <button
                      className="btn-ghost !p-2"
                      title="设置"
                    >
                      <Settings size={15} />
                    </button>
                    <button
                      className="btn-danger !p-2"
                      title="删除"
                      onClick={() => handleDelete(source.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Add source modal */}
      {showAddModal && (
        <AddSourceModal
          initialType={addType}
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAddSource}
        />
      )}
    </div>
  )
}

// ---- sub-components ----------------------------------------------------

function SourceTypeBadge({ type }) {
  const meta = SOURCE_TYPE_META[type]
  if (!meta) {
    return (
      <div className="h-8 w-8 rounded-md bg-neutral-100 text-neutral-600 flex items-center justify-center flex-shrink-0">
        <FolderOpen size={16} />
      </div>
    )
  }
  const Icon = meta.icon
  return (
    <div className="h-8 w-8 rounded-md bg-primary-50 text-primary-600 flex items-center justify-center flex-shrink-0">
      <Icon size={16} />
    </div>
  )
}

function StatusTag({ status, syncing }) {
  // syncing 覆盖态（手动触发时优先显示）
  if (syncing) {
    return (
      <span className="tag-primary inline-flex items-center gap-1">
        <RefreshCw size={12} className="animate-spin" />
        同步中
      </span>
    )
  }
  switch (status) {
    case 'connected':
    case 'synced':
      return (
        <span className="tag-success inline-flex items-center gap-1">
          <CheckCircle2 size={12} />
          已连接
        </span>
      )
    case 'syncing':
      return (
        <span className="tag-primary inline-flex items-center gap-1">
          <RefreshCw size={12} className="animate-spin" />
          同步中
        </span>
      )
    case 'error':
      return (
        <span className="tag-danger inline-flex items-center gap-1">
          <AlertTriangle size={12} />
          连接错误
        </span>
      )
    default:
      return (
        <span className="tag-neutral inline-flex items-center gap-1">
          <XCircle size={12} />
          未知
        </span>
      )
  }
}

function SourcesListSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1.4fr_120px_1.4fr_140px_140px_160px] gap-4 px-5 py-3 bg-neutral-50 border-b border-neutral-200">
        <div className="skeleton h-3 w-16" />
        <div className="skeleton h-3 w-10" />
        <div className="skeleton h-3 w-12" />
        <div className="skeleton h-3 w-10" />
        <div className="skeleton h-3 w-14" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[1.4fr_120px_1.4fr_140px_140px_160px] gap-4 px-5 py-4 items-center border-b border-neutral-100 last:border-0"
        >
          <div className="flex items-center gap-2.5">
            <div className="skeleton h-8 w-8 rounded-md" />
            <div className="space-y-1.5">
              <div className="skeleton h-4 w-32" />
              <div className="skeleton h-3 w-20" />
            </div>
          </div>
          <div className="skeleton h-5 w-16 rounded-md" />
          <div className="skeleton h-4 w-40" />
          <div className="skeleton h-5 w-14 rounded-md" />
          <div className="skeleton h-4 w-16" />
          <div className="flex justify-end gap-1.5">
            <div className="skeleton h-8 w-8 rounded-md" />
            <div className="skeleton h-8 w-8 rounded-md" />
            <div className="skeleton h-8 w-8 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ onAdd }) {
  return (
    <div className="card p-12 flex flex-col items-center text-center">
      <div className="h-14 w-14 rounded-full bg-primary-50 text-primary-500 flex items-center justify-center mb-4">
        <Database size={28} />
      </div>
      <h3 className="font-semibold text-neutral-900">还没有连接任何数据源</h3>
      <p className="text-sm text-neutral-500 mt-1 max-w-sm">
        先从 GitHub、GitLab、本地文件夹或代码仓库 /docs 目录连接一个源，
        DocVault 就会帮你自动索引并纳入知识资产。
      </p>
      <button className="btn-primary mt-5" onClick={onAdd}>
        <Plus size={16} />
        添加第一个源
      </button>
    </div>
  )
}

function AddSourceModal({ initialType, onClose, onSubmit }) {
  const [type, setType] = useState(initialType)
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [autoSync, setAutoSync] = useState(true)

  // 点击遮罩关闭
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit({ type, url, branch, autoSync })
  }

  const showBranch = type !== 'local-folder' && type !== 'web-link'
  const meta = SOURCE_TYPE_META[type]
  const TypeIcon = meta?.icon || Database

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg bg-white rounded-xl shadow-xl border border-neutral-200 overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
              <TypeIcon size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900">添加数据源</h3>
              <p className="text-xs text-neutral-500">
                选择要连接的源类型并填写连接信息
              </p>
            </div>
          </div>
          <button
            className="btn-ghost !p-2"
            onClick={onClose}
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Type selector */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              数据源类型
            </label>
            <div className="grid grid-cols-5 gap-2">
              {SOURCE_TYPE_CATEGORIES.map((cat) => {
                const Icon = cat.icon
                const active = type === cat.type
                return (
                  <button
                    type="button"
                    key={cat.type}
                    onClick={() => setType(cat.type)}
                    className={`p-2.5 rounded-lg border text-center transition-all ${
                      active
                        ? 'border-primary-400 bg-primary-50 text-primary-700 ring-2 ring-primary-100'
                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <Icon size={18} className="mx-auto" />
                    <div className="text-[11px] mt-1 truncate">{cat.label}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* URL input */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">
              {type === 'local-folder' ? '文件夹路径' : type === 'web-link' ? '网页地址' : '仓库地址'}
              <span className="text-danger ml-0.5">*</span>
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
                <ExternalLink size={14} />
              </div>
              <input
                type="text"
                className="input pl-9 font-mono"
                placeholder={
                  type === 'local-folder'
                    ? 'C:/Users/poryo/Documents/MyVault'
                    : type === 'web-link'
                    ? 'https://docs.example.com'
                    : 'https://github.com/user/repo.git'
                }
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Branch input */}
          {showBranch && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                分支
              </label>
              <input
                type="text"
                className="input"
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
          )}

          {/* Auto sync toggle */}
          <label className="flex items-center justify-between cursor-pointer p-3 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors">
            <div>
              <div className="text-sm font-medium text-neutral-800">自动同步</div>
              <div className="text-xs text-neutral-500">
                每 6 小时自动拉取最新内容并重建索引
              </div>
            </div>
            <span
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                autoSync ? 'bg-primary-500' : 'bg-neutral-300'
              }`}
              onClick={() => setAutoSync((v) => !v)}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
                  autoSync ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </span>
          </label>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn-primary">
              <Plus size={15} />
              连接并添加
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
