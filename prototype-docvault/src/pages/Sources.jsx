import { useState, useEffect } from 'react'
import {
  Database,
  Plus,
  GitBranch,
  FolderOpen,
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
  KeyRound,
  FolderTree,
  Lock,
  Unlock,
  Eye,
  EyeOff,
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

function readLastSync(source) {
  return source.lastSync || source.lastSyncedAt || null
}

// ---- source type meta -------------------------------------------------
// 统一类型：git（含原 github/gitlab/code-repo）、local-folder、web-link、database
const SOURCE_TYPE_META = {
  git: { icon: GitBranch, label: 'Git 仓库', tagClass: 'tag-primary' },
  'local-folder': { icon: FolderOpen, label: '本地文件夹', tagClass: 'tag-neutral' },
  'web-link': { icon: Globe, label: '网页链接', tagClass: 'tag-neutral' },
  database: { icon: Database, label: '数据库', tagClass: 'tag-success' },
}

// 类型分类卡片（添加源时选择）
const SOURCE_TYPE_CATEGORIES = [
  { type: 'git', icon: GitBranch, label: 'Git 仓库', desc: 'GitHub / GitLab / Gitee 等' },
  { type: 'database', icon: Database, label: '数据库', desc: 'MySQL / PostgreSQL / MongoDB' },
  { type: 'local-folder', icon: FolderOpen, label: '本地文件夹', desc: '本地磁盘目录' },
  { type: 'web-link', icon: Globe, label: '网页链接', desc: '抓取在线文档页面' },
]

// Git 认证方式
const GIT_AUTH_METHODS = [
  { key: 'token',  label: 'Access Token',  desc: '个人访问令牌，最常用' },
  { key: 'ssh',    label: 'SSH Key',       desc: '密钥对认证，免密' },
  { key: 'oauth',  label: 'OAuth / App',   desc: 'GitHub App / GitLab App' },
]

// 数据库类型选项
const DATABASE_TYPES = [
  { key: 'mysql',      label: 'MySQL',     defaultPort: 3306 },
  { key: 'postgresql', label: 'PostgreSQL', defaultPort: 5432 },
  { key: 'mongodb',    label: 'MongoDB',    defaultPort: 27017 },
  { key: 'sqlite',     label: 'SQLite',     defaultPort: null },
]

// ---- main page --------------------------------------------------------

export default function Sources() {
  const [loading, setLoading] = useState(true)
  const [sources, setSources] = useState([])
  const [syncingIds, setSyncingIds] = useState(new Set())
  const [showAddModal, setShowAddModal] = useState(false)
  const [addType, setAddType] = useState('git')
  const [showSettingsFor, setShowSettingsFor] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    ;(async () => {
      const list = await fetchSources()
      setSources(list.map((s) => ({ ...s })))
      setLoading(false)
    })()
  }, [])

  const handleSync = async (id) => {
    if (syncingIds.has(id)) return
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'syncing' } : s)))
    setSyncingIds((prev) => new Set(prev).add(id))
    try {
      const result = await syncSource(id)
      if (result) {
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
    setToast('数据源已删除')
    setTimeout(() => setToast(null), 2000)
  }

  const handleAddSource = (form) => {
    const newId = `s-${Date.now()}`
    const now = new Date().toISOString()
    const typeMeta = SOURCE_TYPE_META[addType] || { label: '新源' }
    const newSource = {
      id: newId,
      name: form.name || `${typeMeta.label} · ${form.url || form.host || newId}`,
      type: addType,
      // Git
      url: form.url || '',
      branch: form.branch || 'main',
      authMethod: form.authMethod || 'token',
      token: form.token || '',
      subdirectories: form.subdirectories || [],
      // Database
      dbType: form.dbType || 'mysql',
      host: form.host || '',
      port: form.port || '',
      database: form.database || '',
      table: form.table || '',
      username: form.username || '',
      // Common
      status: 'connected',
      lastSync: now,
    }
    setSources((prev) => [...prev, newSource])
    setShowAddModal(false)
    setToast('数据源已添加')
    setTimeout(() => setToast(null), 2000)
  }

  const handleSaveSource = (updatedSource) => {
    setSources((prev) => prev.map((s) => (s.id === updatedSource.id ? updatedSource : s)))
    setShowSettingsFor(null)
    setToast('数据源设置已更新')
    setTimeout(() => setToast(null), 2000)
  }

  const connectedCount = sources.filter((s) => s.status === 'connected').length

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
      <section className="animate-fade-up" style={{ animationDelay: '60ms' }}>
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
                onClick={() => { setAddType(cat.type); setShowAddModal(true) }}
                className="group card p-4 min-w-[180px] flex-shrink-0 text-left hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
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
                <div className="mt-3 font-medium text-neutral-800 text-sm">{cat.label}</div>
                <div className="text-xs text-neutral-400 mt-0.5">{cat.desc}</div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Connected sources list */}
      <section className="animate-fade-up" style={{ animationDelay: '120ms' }}>
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
                      <div className="font-semibold text-neutral-900 truncate">{source.name}</div>
                      {source.branch && (
                        <div className="text-xs text-neutral-400 truncate">分支：{source.branch}</div>
                      )}
                      {source.subdirectories?.length > 0 && (
                        <div className="text-xs text-neutral-400 truncate">
                          子目录：{source.subdirectories.slice(0, 2).join(', ')}{source.subdirectories.length > 2 ? '...' : ''}
                        </div>
                      )}
                      {source.dbType && (
                        <div className="text-xs text-neutral-400 truncate">
                          {source.dbType}://{source.host}{source.database ? `/${source.database}` : ''}
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
                      {source.url || (source.host ? `${source.host}${source.port ? ':' + source.port : ''}` : '—')}
                    </code>
                  </div>

                  {/* Status */}
                  <div>
                    <StatusTag status={source.status} syncing={syncingIds.has(source.id)} />
                  </div>

                  {/* Last synced */}
                  <div className="text-xs text-neutral-500">
                    {relativeTime(readLastSync(source))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1.5">
                    <button className="btn-ghost !p-2" title="立即同步"
                      onClick={() => handleSync(source.id)}
                      disabled={syncingIds.has(source.id)}>
                      <RefreshCw size={15} className={syncingIds.has(source.id) ? 'animate-spin text-primary-500' : ''} />
                    </button>
                    <button className="btn-ghost !p-2" title="设置"
                      onClick={() => setShowSettingsFor(source)}>
                      <Settings size={15} />
                    </button>
                    <button className="btn-danger !p-2" title="删除"
                      onClick={() => handleDelete(source.id)}>
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

      {/* Source settings modal */}
      {showSettingsFor && (
        <SourceSettingsModal
          source={showSettingsFor}
          onClose={() => setShowSettingsFor(null)}
          onSave={handleSaveSource}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] animate-fade-up">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-neutral-200 shadow-lg text-sm font-medium text-neutral-800">
            <span className="text-emerald-500">✓</span>
            {toast}
          </div>
        </div>
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
  const bgColor = type === 'database' ? 'bg-success/10 text-emerald-600' : 'bg-primary-50 text-primary-600'
  return (
    <div className={`h-8 w-8 rounded-md ${bgColor} flex items-center justify-center flex-shrink-0`}>
      <Icon size={16} />
    </div>
  )
}

function StatusTag({ status, syncing }) {
  if (syncing) {
    return <span className="tag-primary inline-flex items-center gap-1"><RefreshCw size={12} className="animate-spin" />同步中</span>
  }
  switch (status) {
    case 'connected':
    case 'synced':
      return <span className="tag-success inline-flex items-center gap-1"><CheckCircle2 size={12} />已连接</span>
    case 'syncing':
      return <span className="tag-primary inline-flex items-center gap-1"><RefreshCw size={12} className="animate-spin" />同步中</span>
    case 'error':
      return <span className="tag-danger inline-flex items-center gap-1"><AlertTriangle size={12} />连接错误</span>
    default:
      return <span className="tag-neutral inline-flex items-center gap-1"><XCircle size={12} />未知</span>
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
        <div key={i} className="grid grid-cols-[1.4fr_120px_1.4fr_140px_140px_160px] gap-4 px-5 py-4 items-center border-b border-neutral-100 last:border-0">
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
        从 Git 仓库、数据库、本地文件夹或网页链接连接一个源，DocVault 就会帮你自动索引并纳入知识资产。
      </p>
      <button className="btn-primary mt-5" onClick={onAdd}>
        <Plus size={16} />
        添加第一个源
      </button>
    </div>
  )
}

// ========================================================================
// Add Source Modal
// ========================================================================

function AddSourceModal({ initialType, onClose, onSubmit }) {
  const [type, setType] = useState(initialType)

  // Common
  const [name, setName] = useState('')
  const [autoSync, setAutoSync] = useState(true)

  // Git
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [authMethod, setAuthMethod] = useState('token')
  const [token, setToken] = useState('')
  const [sshKey, setSshKey] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [subdirectories, setSubdirectories] = useState('')

  // Database
  const [dbType, setDbType] = useState('mysql')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [database, setDatabase] = useState('')
  const [table, setTable] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const form = {
      name,
      url,
      branch,
      authMethod,
      token,
      sshKey,
      subdirectories: subdirectories
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      dbType,
      host,
      port,
      database,
      table,
      username,
      password,
      autoSync,
    }
    onSubmit(form)
  }

  const meta = SOURCE_TYPE_META[type]
  const TypeIcon = meta?.icon || Database

  const isGit = type === 'git'
  const isDB = type === 'database'
  const isLocal = type === 'local-folder'
  const isWeb = type === 'web-link'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-xl border border-neutral-200">
        {/* Modal header */}
        <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b border-neutral-200 bg-white z-10">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
              <TypeIcon size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900">添加数据源</h3>
              <p className="text-xs text-neutral-500">选择类型并填写连接信息</p>
            </div>
          </div>
          <button className="btn-ghost !p-2" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Type selector */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">数据源类型</label>
            <div className="grid grid-cols-4 gap-2">
              {SOURCE_TYPE_CATEGORIES.map((cat) => {
                const Icon = cat.icon
                const active = type === cat.type
                return (
                  <button
                    type="button"
                    key={cat.type}
                    onClick={() => setType(cat.type)}
                    className={`p-3 rounded-lg border text-center transition-all ${
                      active
                        ? 'border-primary-400 bg-primary-50 text-primary-700 ring-2 ring-primary-100'
                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <Icon size={20} className="mx-auto" />
                    <div className="text-[11px] mt-1">{cat.label}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Name (optional) */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">
              数据源名称 <span className="text-neutral-400 font-normal">(可选，自动生成)</span>
            </label>
            <input
              type="text"
              className="input"
              placeholder="例如：公司官方文档仓库"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* ===== Git 仓库专属字段 ===== */}
          {isGit && (
            <div className="space-y-4 pt-2 border-t border-neutral-100">
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide flex items-center gap-1.5">
                <GitBranch size={12} />
                Git 仓库配置
              </div>

              {/* URL */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  仓库地址 <span className="text-danger">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
                    <ExternalLink size={14} />
                  </div>
                  <input
                    type="text"
                    className="input pl-9 font-mono"
                    placeholder="https://github.com/user/repo.git 或 git@github.com:user/repo.git"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Branch */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">分支</label>
                <input
                  type="text"
                  className="input"
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>

              {/* Auth method */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  认证方式 <span className="text-danger">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {GIT_AUTH_METHODS.map((m) => {
                    const active = authMethod === m.key
                    return (
                      <button
                        type="button"
                        key={m.key}
                        onClick={() => setAuthMethod(m.key)}
                        className={`p-2.5 rounded-lg border text-left transition-all ${
                          active
                            ? 'border-primary-400 bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                          {active ? <Lock size={12} /> : <Unlock size={12} className="text-neutral-400" />}
                          {m.label}
                        </div>
                        <div className="text-[10px] text-neutral-400 mt-0.5 leading-tight">{m.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Token field */}
              {authMethod === 'token' && (
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                    Access Token <span className="text-danger">*</span>
                  </label>
                  <div className="relative">
                    <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input
                      type={showToken ? 'text' : 'password'}
                      className="input pl-9 pr-10 font-mono"
                      placeholder="ghp_xxx 或 glpat-xxx"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600"
                    >
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <div className="text-[11px] text-neutral-400 mt-1">
                    推荐使用最小权限的 read-only token
                  </div>
                </div>
              )}

              {/* SSH key field */}
              {authMethod === 'ssh' && (
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                    私钥内容 <span className="text-danger">*</span>
                  </label>
                  <textarea
                    rows={4}
                    className="input resize-none font-mono text-xs"
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY----- ..."
                    value={sshKey}
                    onChange={(e) => setSshKey(e.target.value)}
                    required
                  />
                </div>
              )}

              {/* Subdirectories */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5 flex items-center gap-1.5">
                  <FolderTree size={13} />
                  子目录 <span className="text-neutral-400 font-normal">(可选，逗号分隔)</span>
                </label>
                <input
                  type="text"
                  className="input font-mono"
                  placeholder="docs, packages/api/docs, internal/guide"
                  value={subdirectories}
                  onChange={(e) => setSubdirectories(e.target.value)}
                />
                <div className="text-[11px] text-neutral-400 mt-1">
                  留空则索引整个仓库；填写后仅同步指定子目录下的 Markdown 文档
                </div>
              </div>
            </div>
          )}

          {/* ===== 数据库专属字段 ===== */}
          {isDB && (
            <div className="space-y-4 pt-2 border-t border-neutral-100">
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide flex items-center gap-1.5">
                <Database size={12} />
                数据库连接配置
              </div>

              {/* DB Type */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  数据库类型 <span className="text-danger">*</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {DATABASE_TYPES.map((db) => {
                    const active = dbType === db.key
                    return (
                      <button
                        type="button"
                        key={db.key}
                        onClick={() => { setDbType(db.key); setPort(db.defaultPort || '') }}
                        className={`p-2.5 rounded-lg border text-center transition-all text-xs font-medium ${
                          active
                            ? 'border-success bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {db.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Host + Port (not sqlite) */}
              {dbType !== 'sqlite' && (
                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                      主机 <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="db.example.com 或 127.0.0.1"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1.5">端口</label>
                    <input
                      type="number"
                      className="input"
                      placeholder={DATABASE_TYPES.find((d) => d.key === dbType)?.defaultPort}
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Database name */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  {dbType === 'sqlite' ? '文件路径' : '数据库名'} <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="input font-mono"
                  placeholder={dbType === 'sqlite' ? '/path/to/docs.db' : 'knowledge_db'}
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  required
                />
              </div>

              {/* Username + Password (not sqlite) */}
              {dbType !== 'sqlite' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1.5">用户名</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="db_user"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1.5">密码</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="input pr-10"
                        placeholder="••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600"
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Table / Collection */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  {dbType === 'mongodb' ? 'Collection' : '数据表'}
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="documents（留空自动检测包含 markdown 字段的表）"
                  value={table}
                  onChange={(e) => setTable(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* ===== Local folder ===== */}
          {isLocal && (
            <div className="space-y-4 pt-2 border-t border-neutral-100">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  文件夹路径 <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="input font-mono"
                  placeholder="C:/Users/xxx/Documents/MyVault"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {/* ===== Web link ===== */}
          {isWeb && (
            <div className="space-y-4 pt-2 border-t border-neutral-100">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  网页地址 <span className="text-danger">*</span>
                </label>
                <input
                  type="url"
                  className="input font-mono"
                  placeholder="https://docs.example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {/* Auto sync toggle */}
          <label className="flex items-center justify-between cursor-pointer p-3 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors">
            <div>
              <div className="text-sm font-medium text-neutral-800">自动同步</div>
              <div className="text-xs text-neutral-500">每 6 小时自动拉取最新内容并重建索引</div>
            </div>
            <span
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoSync ? 'bg-primary-500' : 'bg-neutral-300'}`}
              onClick={() => setAutoSync((v) => !v)}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${autoSync ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </span>
          </label>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
            <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
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

// ========================================================================
// Source Settings Modal
// ========================================================================

function SourceSettingsModal({ source, onClose, onSave }) {
  const meta = SOURCE_TYPE_META[source.type] || { label: source.type }
  const TypeIcon = meta.icon || Database

  const [form, setForm] = useState({
    ...source,
    // normalize subdirectories for textarea
    subdirectoriesText: (source.subdirectories || []).join(', '),
    showToken: false,
    showPassword: false,
    newToken: '',
  })

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const updated = {
      ...form,
      subdirectories: form.subdirectoriesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      // 如果输入了新 token 就替换
      token: form.newToken ? form.newToken : form.token,
    }
    delete updated.subdirectoriesText
    delete updated.showToken
    delete updated.showPassword
    delete updated.newToken
    onSave(updated)
  }

  const isGit = source.type === 'git'
  const isDB = source.type === 'database'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-xl border border-neutral-200">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b border-neutral-200 bg-white z-10">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
              <TypeIcon size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900">数据源设置</h3>
              <p className="text-xs text-neutral-500">{meta.label} · {source.id}</p>
            </div>
          </div>
          <button className="btn-ghost !p-2" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">数据源名称</label>
            <input
              type="text"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          {/* ===== Git settings ===== */}
          {isGit && (
            <div className="space-y-4 pt-2 border-t border-neutral-100">
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide flex items-center gap-1.5">
                <GitBranch size={12} /> Git 仓库配置
              </div>

              {/* URL - editable */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  仓库地址 <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="input font-mono"
                  value={form.url || ''}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </div>

              {/* Branch */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">分支</label>
                <input
                  type="text"
                  className="input"
                  value={form.branch || 'main'}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                />
              </div>

              {/* Auth method */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">认证方式</label>
                <div className="grid grid-cols-3 gap-2">
                  {GIT_AUTH_METHODS.map((m) => {
                    const active = form.authMethod === m.key
                    return (
                      <button
                        type="button"
                        key={m.key}
                        onClick={() => setForm({ ...form, authMethod: m.key })}
                        className={`p-2.5 rounded-lg border text-left transition-all ${
                          active
                            ? 'border-primary-400 bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-semibold">{m.label}</div>
                        <div className="text-[10px] text-neutral-400 mt-0.5 leading-tight">{m.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Token field */}
              {form.authMethod === 'token' && (
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                    Access Token <span className="text-neutral-400 font-normal">(留空则保留当前值)</span>
                  </label>
                  <div className="relative">
                    <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input
                      type={form.showToken ? 'text' : 'password'}
                      className="input pl-9 pr-10 font-mono"
                      placeholder={form.token ? '•••••• 已配置' : '输入新的 Access Token'}
                      value={form.newToken}
                      onChange={(e) => setForm({ ...form, newToken: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, showToken: !form.showToken })}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600"
                    >
                      {form.showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              )}

              {/* SSH key */}
              {form.authMethod === 'ssh' && (
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">私钥内容</label>
                  <textarea
                    rows={4}
                    className="input resize-none font-mono text-xs"
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    value={form.sshKey || ''}
                    onChange={(e) => setForm({ ...form, sshKey: e.target.value })}
                  />
                </div>
              )}

              {/* Subdirectories */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5 flex items-center gap-1.5">
                  <FolderTree size={13} /> 子目录配置
                </label>
                <input
                  type="text"
                  className="input font-mono"
                  placeholder="docs, packages/api/docs"
                  value={form.subdirectoriesText}
                  onChange={(e) => setForm({ ...form, subdirectoriesText: e.target.value })}
                />
                <div className="text-[11px] text-neutral-400 mt-1">
                  逗号分隔，支持单个或多个子目录路径；留空表示同步整个仓库
                </div>
              </div>
            </div>
          )}

          {/* ===== Database settings ===== */}
          {isDB && (
            <div className="space-y-4 pt-2 border-t border-neutral-100">
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide flex items-center gap-1.5">
                <Database size={12} /> 数据库连接配置
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">数据库类型</label>
                <div className="grid grid-cols-4 gap-2">
                  {DATABASE_TYPES.map((db) => {
                    const active = form.dbType === db.key
                    return (
                      <button
                        type="button"
                        key={db.key}
                        onClick={() => setForm({ ...form, dbType: db.key })}
                        className={`p-2.5 rounded-lg border text-center transition-all text-xs font-medium ${
                          active
                            ? 'border-success bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {db.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {form.dbType !== 'sqlite' && (
                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1.5">主机</label>
                    <input
                      type="text"
                      className="input"
                      value={form.host || ''}
                      onChange={(e) => setForm({ ...form, host: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1.5">端口</label>
                    <input
                      type="number"
                      className="input"
                      value={form.port || ''}
                      onChange={(e) => setForm({ ...form, port: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  {form.dbType === 'sqlite' ? '文件路径' : '数据库名'}
                </label>
                <input
                  type="text"
                  className="input font-mono"
                  value={form.database || ''}
                  onChange={(e) => setForm({ ...form, database: e.target.value })}
                />
              </div>

              {form.dbType !== 'sqlite' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1.5">用户名</label>
                    <input
                      type="text"
                      className="input"
                      value={form.username || ''}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1.5">密码</label>
                    <div className="relative">
                      <input
                        type={form.showPassword ? 'text' : 'password'}
                        className="input pr-10"
                        placeholder="•••••• (留空保留当前值)"
                        value={form.password || ''}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, showPassword: !form.showPassword })}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600"
                      >
                        {form.showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  {form.dbType === 'mongodb' ? 'Collection' : '数据表'}
                </label>
                <input
                  type="text"
                  className="input"
                  value={form.table || ''}
                  onChange={(e) => setForm({ ...form, table: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* Sync interval */}
          <div className="pt-2 border-t border-neutral-100">
            <label className="block text-sm font-medium text-neutral-700 mb-2">自动同步间隔</label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { k: '30m', t: '30 分钟' },
                { k: '1h',  t: '1 小时' },
                { k: '6h',  t: '6 小时' },
                { k: 'manual', t: '手动' },
              ].map((o) => {
                const active = form.syncInterval === o.k || (!form.syncInterval && o.k === '6h')
                return (
                  <button
                    type="button"
                    key={o.k}
                    onClick={() => setForm({ ...form, syncInterval: o.k })}
                    className={`py-1.5 rounded-md text-xs font-medium border transition ${
                      active
                        ? 'border-primary-400 bg-primary-50 text-primary-700'
                        : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                    }`}
                  >
                    {o.t}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
            <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
            <button type="submit" className="btn-primary"><SaveIcon /> 保存设置</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// tiny Save icon alias
function SaveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
  )
}
