import { useState, useEffect, useMemo } from 'react'
import {
  GitBranch,
  GitCommit,
  ChevronDown,
  Search,
  Clock,
  User,
  FileText,
  ArrowLeftRight,
  Download,
  Play,
  Star,
  GitFork,
} from 'lucide-react'
import { fetchVersions, fetchDocuments, fetchTeam } from '../api/stubs.js'
import { projects } from '../mock/data.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`
  return `${Math.floor(diffDays / 30)} 个月前`
}

function isToday(isoString) {
  const d = new Date(isoString)
  return d.toDateString() === now.toDateString()
}

function avatarColor(name) {
  const palette = [
    'bg-violet-500',
    'bg-sky-500',
    'bg-rose-500',
    'bg-amber-500',
    'bg-emerald-500',
    'bg-indigo-500',
    'bg-teal-500',
    'bg-orange-500',
    'bg-fuchsia-500',
    'bg-cyan-500',
  ]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

// 每个 commit 生成一段 mock diff 预览（3-5 行）
const DIFF_TEMPLATES = [
  [
    [' ', '## 架构设计', ''],
    ['+', '+ 新增章节「控制面 / 数据面分离」', ''],
    ['+', '+ 补充 MQTT 消息流示意图', ''],
    ['-', '- 删除过时的单体架构说明', ''],
  ],
  [
    ['+', '+```yaml', ''],
    ['+', '+edgeagent:', ''],
    ['+', '+  transport: mqtt://broker:1883', ''],
    [' ', '```', ''],
  ],
  [
    ['-', '-| port | int | 监听端口，默认 9090 |', ''],
    ['+', '+| port | int | 监听端口，默认 9090（v2） |', ''],
    ['+', '+| tls  | bool | 是否启用 TLS |', ''],
  ],
  [
    [' ', '按顺序检查：', ''],
    ['+', '+1. 网络连通：`ping <device-ip>`', ''],
    ['+', '+2. 证书有效期：`openssl x509 -in cert.pem -dates`', ''],
    ['-', '-2. Agent 日志：`journalctl -u edgeagent -f`', ''],
  ],
  [
    ['+', "+ 新增 `virtualized` prop（虚拟滚动）", ''],
    ['+', '+ 新增 `useMediaQuery` 组合式 hook', ''],
    ['-', '- Patch：修复构建产物中的 sourcemap 路径', ''],
  ],
  [
    ['+', '+- **v2.1**：新增 `needs` 显式依赖声明', ''],
    ['+', '+- **v2.0**：`target` 块取代顶层 `image` 字段', ''],
  ],
  [
    [' ', '## 亮点', ''],
    ['+', '+🚀 DocVault 2.0 发布，Rust 索引器落地', ''],
    ['+', '+🧪 Harness DSL v2 灰度 10%，零失败', ''],
  ],
  [
    ['+', '+const hash = randomHex(7)', ''],
    ['+', '+const version = `v${count + 1}`', ''],
    ['-', '-const version = `v${count}`', ''],
  ],
]

function mockDiffPreview(seed) {
  const base = DIFF_TEMPLATES[seed % DIFF_TEMPLATES.length]
  return base.map(([type, text]) => ({ type, text }))
}

function mockFullDiff(seed) {
  // 为 "完整 diff" 面板生成更长的 mock 数据
  return [
    ...mockDiffPreview(seed),
    ...mockDiffPreview(seed + 1),
    ...mockDiffPreview(seed + 2),
    ...mockDiffPreview(seed + 3),
  ]
}

// 分支 mock 数据
const BRANCHES_MOCK = [
  { name: 'main', active: true, ahead: 0, behind: 0, commitCount: 128, lastMessage: '同步最新接口变更' },
  { name: 'feat/edgeagent-docs', active: false, ahead: 12, behind: 3, commitCount: 47, lastMessage: '补充 mTLS 章节' },
  { name: 'fix/sync-conflict', active: false, ahead: 3, behind: 1, commitCount: 6, lastMessage: '修复并发写入冲突' },
  { name: 'dsl-v2-proposal', active: false, ahead: 8, behind: 0, commitCount: 14, lastMessage: 'v2 规范初稿' },
]

// ---------------------------------------------------------------------------
// Skeleton 组件
// ---------------------------------------------------------------------------

function CommitCardSkeleton({ delay = 0 }) {
  return (
    <div
      className="card p-4 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full skeleton shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-4 w-24 skeleton rounded" />
            <div className="h-4 w-20 skeleton rounded" />
          </div>
          <div className="h-4 w-3/4 skeleton rounded" />
          <div className="flex gap-1.5">
            <div className="h-5 w-14 skeleton rounded-full" />
            <div className="h-5 w-20 skeleton rounded-full" />
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full skeleton rounded" />
        <div className="h-3 w-11/12 skeleton rounded" />
        <div className="h-3 w-4/5 skeleton rounded" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommitCard
// ---------------------------------------------------------------------------

function CommitCard({ commit, seed, selected, onSelect, onRollback, onStar, starred, animationDelay = 0 }) {
  const [hover, setHover] = useState(false)
  const preview = useMemo(() => mockDiffPreview(seed), [seed])

  const additions = commit.additions ?? 0
  const deletions = commit.deletions ?? 0
  const authorColor = avatarColor(commit.author)

  return (
    <div
      className={`card p-4 transition-all duration-200 animate-fade-up ${
        selected ? 'ring-2 ring-primary-400' : ''
      }`}
      style={{ animationDelay: `${animationDelay}ms` }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* 头部：图标 + 时间 + 作者 */}
      <div className="flex items-start gap-3">
        {/* GitCommit 圆形图标 */}
        <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
          <GitCommit className="w-4 h-4 text-neutral-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-neutral-500 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {relativeTime(commit.timestamp)}
            </span>
            <span className="text-neutral-300">·</span>
            <span className="text-sm text-neutral-600 flex items-center gap-1">
              <span className={`w-5 h-5 rounded-full ${authorColor} text-white text-[10px] flex items-center justify-center font-medium`}>
                {commit.author.slice(0, 1)}
              </span>
              {commit.author}
            </span>
          </div>

          {/* commit hash + 消息 */}
          <div className="mt-1.5 flex items-start gap-2">
            <code className="shrink-0 font-mono text-xs bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full">
              {commit.commitHash}
            </code>
            <span className="text-sm text-neutral-800 leading-6">{commit.message}</span>
          </div>

          {/* 分支标签 */}
          {commit.branch && commit.branch !== 'main' && (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full">
                <GitBranch className="w-3 h-3" />
                {commit.branch}
              </span>
            </div>
          )}

          {/* 统计：增 / 删 */}
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span className="text-emerald-600 font-medium">+{additions}</span>
            <span className="text-red-500 font-medium">−{deletions}</span>
            {hover && (
              <span className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => onSelect(commit)}
                  className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-primary-600 transition-colors"
                  title="查看完整 diff"
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onRollback(commit)}
                  className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-primary-600 transition-colors"
                  title="回滚到此版本"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onStar(commit.id)}
                  className={`p-1.5 rounded-md transition-colors ${
                    starred
                      ? 'text-amber-500 hover:bg-amber-50'
                      : 'text-neutral-500 hover:bg-neutral-100 hover:text-amber-500'
                  }`}
                  title="设为星标"
                >
                  <Star className={`w-3.5 h-3.5 ${starred ? 'fill-amber-400' : ''}`} />
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* diff 预览 */}
      <div className="mt-3 rounded-md overflow-hidden bg-neutral-50">
        {preview.map((line, i) => {
          const { type, text } = line
          if (type === '+') {
            return (
              <div key={i} className="px-3 py-0.5 text-xs font-mono bg-emerald-50 text-emerald-700 leading-5">
                <span className="mr-2 text-emerald-500">+</span>
                {text}
              </div>
            )
          }
          if (type === '-') {
            return (
              <div key={i} className="px-3 py-0.5 text-xs font-mono bg-red-50 text-red-700 leading-5">
                <span className="mr-2 text-red-500">−</span>
                {text}
              </div>
            )
          }
          return (
            <div key={i} className="px-3 py-0.5 text-xs font-mono text-neutral-500 leading-5">
              <span className="mr-2 text-neutral-300"> </span>
              {text}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function Versions() {
  const [documents, setDocuments] = useState([])
  const [versions, setVersions] = useState([])
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)

  const [selectedDocId, setSelectedDocId] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [selectedCommit, setSelectedCommit] = useState(null)
  const [starredIds, setStarredIds] = useState(new Set())
  const [fullDiffMode, setFullDiffMode] = useState('unified') // 'unified' | 'side'

  // 初始加载
  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [docs, teamData] = await Promise.all([
        fetchDocuments(),
        fetchTeam(),
      ])
      setDocuments(docs)
      setTeam(teamData)
      if (docs.length > 0) {
        const firstDoc = docs[0]
        setSelectedDocId(firstDoc.id)
        setSelectedProjectId(firstDoc.projectId)
        const vs = await fetchVersions(firstDoc.id)
        setVersions(vs)
      }
      setLoading(false)
    })()
  }, [])

  // 项目切换 → 联动文档下拉 → 重新加载版本
  const filteredDocuments = useMemo(() => {
    let list = documents
    if (selectedProjectId) {
      list = list.filter((d) => d.projectId === selectedProjectId)
    }
    const needle = searchQuery.trim().toLowerCase()
    if (needle) {
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(needle) ||
          d.path.toLowerCase().includes(needle),
      )
    }
    return list
  }, [documents, selectedProjectId, searchQuery])

  // 切换文档 → 加载版本
  useEffect(() => {
    if (!selectedDocId) return
    ;(async () => {
      setLoading(true)
      const vs = await fetchVersions(selectedDocId)
      setVersions(vs)
      setSelectedCommit(null)
      setLoading(false)
    })()
  }, [selectedDocId])

  const totalCommits = versions.length
  const todayCommits = versions.filter((v) => isToday(v.timestamp)).length
  const activeDoc = documents.find((d) => d.id === selectedDocId)

  // 星标切换
  const toggleStar = (id) => {
    setStarredIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 回滚（原型里只是提示）
  const handleRollback = (commit) => {
    // eslint-disable-next-line no-alert
    alert(`已触发回滚操作 → ${commit.commitHash}\n\n原型演示：实际调用后端 PATCH /api/versions/:hash/rollback`)
  }

  // 导出 changelog
  const handleExportChangelog = () => {
    const header = selectedDoc
      ? `# Changelog — ${selectedDoc.title}\n\n`
      : `# Changelog — 全部文档\n\n`
    const body = versions
      .map((v) => `- \`${v.commitHash.slice(0, 7)}\` ${v.author}: ${v.message} (${relativeTime(v.timestamp)})`)
      .join('\n')
    const blob = new Blob([header + body], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'changelog.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  // branch sidebar 里展示的 branch（从 versions + mock 合并）
  const branchList = useMemo(() => {
    const branches = new Map()
    versions.forEach((v) => {
      const name = v.branch || 'main'
      if (!branches.has(name)) {
        branches.set(name, { name, commits: 0, lastMessage: v.message })
      }
      const b = branches.get(name)
      b.commits += 1
    })
    // 合并 mock 数据以保证 always 有 main
    return BRANCHES_MOCK.map((mock) => {
      const live = branches.get(mock.name)
      if (live) {
        return {
          ...mock,
          commitCount: live.commits,
          lastMessage: live.lastMessage,
        }
      }
      return mock
    })
  }, [versions])

  return (
    <div className="p-6 lg:p-8">
      {/* ---------- 页面头部 ---------- */}
      <header className="animate-fade-up flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 font-display tracking-tight flex items-center gap-2">
            <GitBranch className="w-6 h-6 text-primary-500" />
            版本管理
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Git 驱动的文档历史，随时回滚或对比任意两个版本
          </p>
          {activeDoc && (
            <p className="mt-2 text-xs text-neutral-400 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" />
              当前文档：<span className="text-neutral-600 font-medium">{activeDoc.title}</span>
              <span className="text-neutral-300">·</span>
              <code className="font-mono text-neutral-500">{activeDoc.path}</code>
            </p>
          )}
        </div>
        <button
          onClick={handleExportChangelog}
          className="btn-secondary flex items-center gap-1.5 shrink-0"
        >
          <Download className="w-4 h-4" />
          导出 changelog
        </button>
      </header>

      {/* ---------- 筛选栏 ---------- */}
      <div className="animate-fade-up flex flex-wrap items-center gap-3 mb-5 p-3 card" style={{ animationDelay: '80ms' }}>
        {/* 项目下拉 */}
        <div className="relative">
          <select
            value={selectedProjectId}
            onChange={(e) => {
              const v = e.target.value
              setSelectedProjectId(v)
              const docs = documents.filter((d) => !v || d.projectId === v)
              if (docs.length > 0 && docs[0].id !== selectedDocId) {
                setSelectedDocId(docs[0].id)
              }
            }}
            className="appearance-none text-sm bg-white border border-neutral-200 rounded-md pl-3 pr-8 py-2 text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400 min-w-[160px]"
          >
            <option value="">全部项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-neutral-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
        </div>

        {/* 文档下拉 */}
        <div className="relative">
          <select
            value={selectedDocId}
            onChange={(e) => setSelectedDocId(e.target.value)}
            className="appearance-none text-sm bg-white border border-neutral-200 rounded-md pl-3 pr-8 py-2 text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400 min-w-[200px]"
          >
            <option value="">选择文档</option>
            {filteredDocuments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-neutral-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
        </div>

        {/* 搜索 */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索提交信息或作者…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-sm bg-white border border-neutral-200 rounded-md pl-9 pr-3 py-2 text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400"
          />
        </div>

        {/* stat pills */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 text-primary-700 rounded-full text-xs font-medium">
            <GitCommit className="w-3.5 h-3.5" />
            共 {totalCommits} 次提交
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full text-xs font-medium">
            <Clock className="w-3.5 h-3.5" />
            今日 {todayCommits} 次
          </div>
        </div>
      </div>

      {/* ---------- 两栏主内容 ---------- */}
      <div className="animate-fade-up flex flex-col lg:flex-row gap-5" style={{ animationDelay: '160ms' }}>
        {/* 左：提交时间线 */}
        <div className="flex-1 min-w-0 space-y-3">
          {loading &&
            Array.from({ length: 4 }).map((_, i) => (
              <CommitCardSkeleton key={i} delay={i * 80} />
            ))}

          {!loading && versions.length === 0 && (
            <div className="card p-10 text-center text-neutral-400">
              <GitCommit className="w-10 h-10 mx-auto mb-3 text-neutral-300" />
              <p className="text-sm">该文档暂无提交记录</p>
            </div>
          )}

          {!loading &&
            versions.map((commit, i) => {
              // 搜索过滤（客户端）
              const needle = searchQuery.trim().toLowerCase()
              if (needle) {
                const inMessage = commit.message.toLowerCase().includes(needle)
                const inAuthor = commit.author.toLowerCase().includes(needle)
                if (!inMessage && !inAuthor) return null
              }
              return (
                <CommitCard
                  key={commit.id}
                  commit={commit}
                  seed={i + (commit.commitHash.charCodeAt(0) || 0)}
                  selected={selectedCommit?.id === commit.id}
                  onSelect={setSelectedCommit}
                  onRollback={handleRollback}
                  onStar={toggleStar}
                  starred={starredIds.has(commit.id)}
                  animationDelay={i * 60}
                />
              )
            })}
        </div>

        {/* 右：分支侧栏 */}
        <aside className="w-full lg:w-[320px] shrink-0">
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-neutral-800 flex items-center gap-2 mb-3">
              <GitFork className="w-4 h-4 text-primary-500" />
              分支状态
            </h2>

            <div className="space-y-2">
              {branchList.map((b) => (
                <div
                  key={b.name}
                  className={`rounded-lg px-3 py-2.5 border transition-colors ${
                    b.active
                      ? 'bg-primary-50 border-primary-200'
                      : 'bg-white border-neutral-100 hover:bg-neutral-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                        b.active
                          ? 'bg-primary-500 text-white'
                          : 'bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      {b.name}
                    </span>
                    {b.active && (
                      <span className="text-[10px] bg-primary-100 text-primary-700 rounded-full px-1.5 py-0.5 font-medium">
                        当前
                      </span>
                    )}
                    <span className="ml-auto text-xs text-neutral-400 font-mono">
                      {b.commitCount} 提交
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-neutral-500 line-clamp-1">
                    {b.lastMessage}
                  </p>
                  {b.ahead > 0 || b.behind > 0 ? (
                    <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                      {b.ahead > 0 && (
                        <span className="text-emerald-600 flex items-center gap-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          +{b.ahead} 领先
                        </span>
                      )}
                      {b.behind > 0 && (
                        <span className="text-red-500 flex items-center gap-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          −{b.behind} 落后
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* 团队成员小卡 */}
          <div className="card p-4 mt-4">
            <h2 className="text-sm font-semibold text-neutral-800 flex items-center gap-2 mb-3">
              <User className="w-4 h-4 text-primary-500" />
              协作成员
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {team.slice(0, 8).map((member) => (
                <span
                  key={member.id}
                  title={member.name}
                  className={`w-7 h-7 rounded-full text-white text-[11px] flex items-center justify-center font-medium ${avatarColor(member.name)}`}
                >
                  {member.name.slice(0, 1)}
                </span>
              ))}
              {team.length > 8 && (
                <span className="w-7 h-7 rounded-full bg-neutral-100 text-neutral-500 text-[11px] flex items-center justify-center font-medium">
                  +{team.length - 8}
                </span>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ---------- 选中 commit 的完整 diff ---------- */}
      {selectedCommit && (
        <div
          className="animate-fade-up mt-6"
          style={{ animationDelay: '200ms' }}
        >
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-neutral-800 flex items-center gap-2">
                  完整 Diff
                  <code className="font-mono text-xs bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full">
                    {selectedCommit.commitHash}
                  </code>
                </h3>
                <p className="mt-1 text-xs text-neutral-500">{selectedCommit.message}</p>
              </div>
              <div className="flex items-center rounded-md border border-neutral-200 overflow-hidden">
                <button
                  onClick={() => setFullDiffMode('unified')}
                  className={`text-xs px-3 py-1.5 transition-colors ${
                    fullDiffMode === 'unified'
                      ? 'bg-neutral-900 text-white'
                      : 'bg-white text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  Unified
                </button>
                <button
                  onClick={() => setFullDiffMode('side')}
                  className={`text-xs px-3 py-1.5 transition-colors ${
                    fullDiffMode === 'side'
                      ? 'bg-neutral-900 text-white'
                      : 'bg-white text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  Side-by-side
                </button>
              </div>
            </div>

            {fullDiffMode === 'unified' ? (
              <div className="rounded-md overflow-hidden bg-neutral-50">
                {mockFullDiff(selectedCommit.commitHash.charCodeAt(0) || 0).map((line, i) => {
                  const { type, text } = line
                  if (type === '+') {
                    return (
                      <div
                        key={i}
                        className="px-3 py-0.5 text-xs font-mono bg-emerald-50 text-emerald-700 leading-5"
                      >
                        <span className="mr-2 text-emerald-500 w-3 inline-block">+</span>
                        {text}
                      </div>
                    )
                  }
                  if (type === '-') {
                    return (
                      <div
                        key={i}
                        className="px-3 py-0.5 text-xs font-mono bg-red-50 text-red-700 leading-5"
                      >
                        <span className="mr-2 text-red-500 w-3 inline-block">−</span>
                        {text}
                      </div>
                    )
                  }
                  return (
                    <div
                      key={i}
                      className="px-3 py-0.5 text-xs font-mono text-neutral-500 leading-5"
                    >
                      <span className="mr-2 text-neutral-300 w-3 inline-block"> </span>
                      {text}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-neutral-400 font-medium mb-1.5">
                    Before
                  </div>
                  <div className="rounded-md overflow-hidden bg-neutral-50">
                    {mockFullDiff(selectedCommit.commitHash.charCodeAt(0) || 0)
                      .filter((l) => l.type !== '+')
                      .map((line, i) => {
                        const { type, text } = line
                        if (type === '-') {
                          return (
                            <div
                              key={i}
                              className="px-3 py-0.5 text-xs font-mono bg-red-50 text-red-700 leading-5"
                            >
                              <span className="mr-2 text-red-500 w-3 inline-block">−</span>
                              {text}
                            </div>
                          )
                        }
                        return (
                          <div
                            key={i}
                            className="px-3 py-0.5 text-xs font-mono text-neutral-500 leading-5"
                          >
                            <span className="mr-2 text-neutral-300 w-3 inline-block"> </span>
                            {text}
                          </div>
                        )
                      })}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-neutral-400 font-medium mb-1.5">
                    After
                  </div>
                  <div className="rounded-md overflow-hidden bg-neutral-50">
                    {mockFullDiff(selectedCommit.commitHash.charCodeAt(0) || 0)
                      .filter((l) => l.type !== '-')
                      .map((line, i) => {
                        const { type, text } = line
                        if (type === '+') {
                          return (
                            <div
                              key={i}
                              className="px-3 py-0.5 text-xs font-mono bg-emerald-50 text-emerald-700 leading-5"
                            >
                              <span className="mr-2 text-emerald-500 w-3 inline-block">+</span>
                              {text}
                            </div>
                          )
                        }
                        return (
                          <div
                            key={i}
                            className="px-3 py-0.5 text-xs font-mono text-neutral-500 leading-5"
                          >
                            <span className="mr-2 text-neutral-300 w-3 inline-block"> </span>
                            {text}
                          </div>
                        )
                      })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
