import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import {
  GitBranch, GitCommit, Clock, ChevronRight, Star, ArrowLeftRight,
  Search, MessageSquare, FileText, Filter, Download,
  RefreshCw, User,
} from 'lucide-react'
import { fetchVersions, fetchDocuments, fetchTeam, fetchActivities } from '../api/stubs.js'

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

function avatarBgColor(name) {
  const palette = [
    'bg-violet-500', 'bg-sky-500', 'bg-rose-500', 'bg-amber-500',
    'bg-emerald-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500',
    'bg-fuchsia-500', 'bg-cyan-500',
  ]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

const DIFF_TEMPLATES = [
  [[' ', '## 架构设计', ''], ['+', '+ 新增章节', ''], ['-', '- 删除过时说明', '']],
  [['+', '+```yaml', ''], ['+', '+edgeagent:', ''], ['+', '+  transport: mqtt', ''], [' ', '```', '']],
  [['-', '-| port | int | 9090 |', ''], ['+', '+| port | int | 9090（v2） |', ''], ['+', '+| tls  | bool | TLS 开关 |', '']],
  [['+', '+1. 网络连通：`ping <device-ip>`', ''], ['+', '+2. 证书有效期检查', ''], ['-', '-2. Agent 日志', '']],
  [['+', "+ 新增 `virtualized` prop", ''], ['+', '+ 新增 `useMediaQuery` hook', ''], ['-', '- Patch: sourcemap 路径', '']],
  [[' ', '## 亮点', ''], ['+', '+🚀 2.0 发布', ''], ['+', '+🧪 DSL v2 灰度 10%', '']],
  [['+', '+const hash = randomHex(7)', ''], ['+', '+const version = `v${count + 1}`', ''], ['-', '-const version = `v${count}`', '']],
]

function mockDiffPreview(seed) {
  return DIFF_TEMPLATES[seed % DIFF_TEMPLATES.length]
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function VersionSkeleton() {
  return (
    <div className="space-y-4">
      <div className="animate-fade-up flex items-center gap-3 p-3 card" style={{ animationDelay: '60ms' }}>
        <div className="skeleton h-9 w-40 rounded-md" />
        <div className="skeleton h-9 flex-1 rounded-md" />
        <div className="skeleton h-9 w-24 rounded-md" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-fade-up card p-4 space-y-3" style={{ animationDelay: `${100 + i * 70}ms` }}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full skeleton shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <div className="skeleton h-4 w-28" />
                <div className="skeleton h-4 w-16" />
              </div>
              <div className="skeleton h-4 w-3/4" />
            </div>
          </div>
          <div className="skeleton h-14 w-full rounded-md" />
        </div>
      ))}
    </div>
  )
}

function FeedSkeleton() {
  return (
    <div className="space-y-3">
      <div className="animate-fade-up flex items-center gap-2 flex-wrap" style={{ animationDelay: '60ms' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-7 w-20 rounded-full" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-fade-up card p-4 space-y-2.5" style={{ animationDelay: `${100 + i * 70}ms` }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full skeleton shrink-0" />
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 w-32" />
          </div>
          <div className="skeleton h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Commit card (versions sub-tab)
// ---------------------------------------------------------------------------

function CommitCard({ commit, seed, delay = 0, docTitle }) {
  const [hover, setHover] = useState(false)
  const preview = mockDiffPreview(seed)
  const avatarCls = avatarBgColor(commit.author)

  return (
    <div
      className="card p-4 transition-all duration-200 animate-fade-up hover:shadow-md"
      style={{ animationDelay: `${delay}ms` }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
          <GitCommit className="w-4 h-4 text-neutral-400" />
        </div>

        <div className="flex-1 min-w-0">
          {docTitle && (
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-neutral-500">
              <FileText size={12} className="text-neutral-400" />
              {docTitle}
            </div>
          )}

          {/* meta row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-neutral-500 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {relativeTime(commit.timestamp)}
            </span>
            <span className="text-neutral-300">·</span>
            <div className="flex items-center gap-1">
              <span className={`w-5 h-5 rounded-full ${avatarCls} text-white text-[10px] flex items-center justify-center font-medium`}>
                {commit.author.slice(0, 1)}
              </span>
              <span className="text-sm text-neutral-600">{commit.author}</span>
            </div>
            {commit.branch && commit.branch !== 'main' && (
              <span className="inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full ml-1">
                <GitBranch className="w-3 h-3" />
                {commit.branch}
              </span>
            )}
          </div>

          {/* hash + message */}
          <div className="mt-1.5 flex items-start gap-2">
            <code className="shrink-0 font-mono text-xs bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full">
              {commit.commitHash.slice(0, 7)}
            </code>
            <span className="text-sm text-neutral-800 leading-6">{commit.message}</span>
          </div>

          {/* stats + hover actions */}
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span className="text-emerald-600 font-medium">+{commit.additions ?? 0}</span>
            <span className="text-red-500 font-medium">−{commit.deletions ?? 0}</span>
            {hover && (
              <span className="ml-auto flex items-center gap-1">
                <button className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-primary-600 transition-colors" title="查看完整 diff">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-primary-600 transition-colors" title="回滚到此版本">
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </button>
                <button className="p-1.5 rounded-md text-neutral-500 hover:bg-amber-50 hover:text-amber-500 transition-colors" title="设为星标">
                  <Star className="w-3.5 h-3.5" />
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* diff preview — light theme */}
      <div className="mt-3 rounded-md overflow-hidden bg-neutral-50">
        {preview.map((line, i) => {
          const [type, text] = line
          if (type === '+') {
            return (
              <div key={i} className="px-3 py-0.5 text-xs font-mono bg-emerald-50 text-emerald-700 leading-5">
                <span className="mr-2 text-emerald-500">+</span>{text}
              </div>
            )
          }
          if (type === '-') {
            return (
              <div key={i} className="px-3 py-0.5 text-xs font-mono bg-red-50 text-red-700 leading-5">
                <span className="mr-2 text-red-500">−</span>{text}
              </div>
            )
          }
          return (
            <div key={i} className="px-3 py-0.5 text-xs font-mono text-neutral-500 leading-5">
              <span className="mr-2 text-neutral-300"> </span>{text}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity feed card (feed sub-tab)
// ---------------------------------------------------------------------------

const FEED_FILTER_CHIPS = [
  { key: 'all', label: '全部' },
  { key: '评论', label: '评论' },
  { key: '同步', label: '同步' },
  { key: '发布', label: '发布' },
]

function activityToFilter(action) {
  // Map activity action verb to one of our filter chips
  if (!action) return 'all'
  if (action.includes('评论') || action.includes('留下评论')) return '评论'
  if (action.includes('同步')) return '同步'
  if (action.includes('发布')) return '发布'
  if (action.includes('合并') || action.includes('MR') || action.includes('PR')) return '发布' // publish-ish
  if (action.includes('解决')) return '编辑'
  if (action.includes('新增') || action.includes('编辑') || action.includes('更新') || action.includes('删除')) return '编辑'
  return 'all'
}

function FeedCard({ item, teamMap, delay = 0 }) {
  const member = teamMap.get(item.actor)
  const avatarStyle = member
    ? { backgroundColor: member.avatarColor }
    : undefined
  const avatarCls = !member ? avatarBgColor(item.actor) : undefined

  // Determine verb tone
  const verbColor = (() => {
    if (item.action.includes('发布') || item.action.includes('MR') || item.action.includes('PR')) return 'text-primary-600'
    if (item.action.includes('同步')) return 'text-emerald-600'
    if (item.action.includes('评论')) return 'text-amber-600'
    if (item.action.includes('删除')) return 'text-danger'
    return 'text-neutral-600'
  })()

  return (
    <div
      className="card p-4 flex items-start gap-3 animate-fade-up hover:border-neutral-300 transition"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 ring-2 ring-white shadow-sm ${avatarCls || ''}`}
        style={avatarStyle}
      >
        {(item.actor || '?').slice(0, 1)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm leading-6 text-neutral-800">
          <span className="font-semibold">{item.actor}</span>
          <span className={`ml-1 ${verbColor}`}>{item.action}</span>
          <span className="font-semibold text-neutral-800 ml-1">{item.target}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-400">
          <Clock className="w-3 h-3" />
          {relativeTime(item.timestamp)}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main — ProjectActivity
// ---------------------------------------------------------------------------

export default function ProjectActivity() {
  const { id } = useParams()
  const [subTab, setSubTab] = useState('versions') // 'versions' | 'feed'

  // shared loading state — both tabs pre-load their data on mount
  const [loading, setLoading] = useState(true)
  const [documents, setDocuments] = useState([])
  const [versions, setVersions] = useState([])
  const [activities, setActivities] = useState([])
  const [team, setTeam] = useState([])

  // versions state
  const [selectedDocId, setSelectedDocId] = useState('all')
  const [search, setSearch] = useState('')

  // feed state
  const [feedFilter, setFeedFilter] = useState('all')

  // Build team Map for avatar lookup
  const teamMap = useMemo(() => {
    const m = new Map()
    team.forEach((t) => m.set(t.name, t))
    return m
  }, [team])

  // --- initial fetch: all data ---
  useEffect(() => {
    let active = true
    const run = async () => {
      const [docs, allTeam, allActivities] = await Promise.all([
        fetchDocuments({ projectId: id }),
        fetchTeam(),
        fetchActivities(),
      ])
      if (!active) return
      setDocuments(docs)
      setTeam(allTeam || [])
      // Filter activities to current project
      setActivities(
        (allActivities || []).filter((a) => a.projectId === id),
      )

      // Aggregate versions for all project docs
      if (docs.length > 0) {
        const allVersions = []
        for (const d of docs) {
          const vs = await fetchVersions(d.id)
          vs.forEach((v) => { allVersions.push({ ...v, docTitle: d.title }) })
        }
        allVersions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        setVersions(allVersions)
      }
      setTimeout(() => { if (active) setLoading(false) }, 350)
    }
    run()
    return () => { active = false }
  }, [id])

  // --- versions filters ---
  const filteredVersions = useMemo(() => {
    let list = versions
    if (selectedDocId !== 'all') {
      list = versions.filter((v) => v.docId === selectedDocId)
    }
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      list = list.filter(
        (v) =>
          v.message.toLowerCase().includes(needle) ||
          v.author.toLowerCase().includes(needle),
      )
    }
    return list
  }, [versions, selectedDocId, search])

  // --- feed filters ---
  // 「编辑」chip 仅在数据中存在编辑类活动时出现
  const feedChips = useMemo(() => {
    const chips = [...FEED_FILTER_CHIPS]
    if (activities.some((a) => activityToFilter(a.action) === '编辑')) {
      chips.push({ key: '编辑', label: '编辑' })
    }
    return chips
  }, [activities])

  const filteredFeed = useMemo(() => {
    let list = activities
    if (feedFilter !== 'all') {
      list = list.filter((a) => activityToFilter(a.action) === feedFilter)
    }
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      list = list.filter(
        (a) =>
          (a.actor || '').toLowerCase().includes(needle) ||
          (a.action || '').toLowerCase().includes(needle) ||
          (a.target || '').toLowerCase().includes(needle),
      )
    }
    return list
  }, [activities, feedFilter, search])

  const handleExport = () => {
    const header = selectedDocId === 'all'
      ? '# Changelog — 本项目全部文档\n\n'
      : `# Changelog — ${documents.find((d) => d.id === selectedDocId)?.title || ''}\n\n`
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

  // --- doc change for versions ---
  const handleDocChange = async (docId) => {
    setSelectedDocId(docId)
    setLoading(true)
    let merged = versions // keep already-loaded aggregate
    if (docId !== 'all') {
      const vs = await fetchVersions(docId)
      const doc = documents.find((d) => d.id === docId)
      merged = vs.map((v) => ({ ...v, docTitle: doc?.title || '' }))
    } else {
      // re-aggregate
      const allVersions = []
      for (const d of documents) {
        const vs = await fetchVersions(d.id)
        vs.forEach((v) => { allVersions.push({ ...v, docTitle: d.title }) })
      }
      allVersions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      merged = allVersions
    }
    setVersions(merged)
    setTimeout(() => setLoading(false), 200)
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-[1100px] mx-auto px-6 pt-5 pb-10">
        {/* ===== 顶部工具栏：分段切换 + 搜索 + 各模式专属操作 ===== */}
        <div className="mb-5">
          <div className="flex items-center gap-3 flex-wrap">
            {/* 分段切换：版本历史 / 活动动态 */}
            <div
              className="inline-flex items-center p-1 bg-neutral-100 rounded-full animate-fade-up"
              style={{ animationDelay: '40ms' }}
            >
              <button
                type="button"
                onClick={() => setSubTab('versions')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                  subTab === 'versions'
                    ? 'bg-white shadow-sm text-primary-700'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <GitBranch size={14} />
                版本历史
              </button>
              <button
                type="button"
                onClick={() => setSubTab('feed')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                  subTab === 'feed'
                    ? 'bg-white shadow-sm text-primary-700'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <MessageSquare size={14} />
                活动动态
              </button>
            </div>

            {/* 版本历史：文档范围筛选 */}
            {subTab === 'versions' && (
              <div className="relative animate-fade-up" style={{ animationDelay: '60ms' }}>
                <select
                  value={selectedDocId}
                  onChange={(e) => handleDocChange(e.target.value)}
                  className="appearance-none text-sm bg-white border border-neutral-200 rounded-md pl-3 pr-8 py-2 text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400 min-w-[220px] !h-9"
                >
                  <option value="all">全部文档（合并时间线）</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
                <ChevronRight className="w-4 h-4 text-neutral-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90" />
              </div>
            )}

            <div className="flex-1" />

            {/* 搜索框：版本历史过滤提交信息/作者，活动动态过滤动态文本/参与者 */}
            <div className="relative w-64">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              />
              <input
                type="text"
                placeholder={subTab === 'versions' ? '搜索提交信息…' : '搜索动态…'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input !pl-9 !h-9 w-full"
              />
            </div>

            {/* 版本历史：导出 changelog */}
            {subTab === 'versions' && (
              <button
                type="button"
                onClick={handleExport}
                className="btn-secondary !h-9 text-xs"
              >
                <Download size={13} />
                导出 changelog
              </button>
            )}
          </div>

          {/* 活动动态：类型筛选 chips（工具栏第二行） */}
          {subTab === 'feed' && (
            <div
              className="flex items-center gap-2 flex-wrap mt-3 animate-fade-up"
              style={{ animationDelay: '80ms' }}
            >
              {feedChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setFeedFilter(chip.key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                    feedFilter === chip.key
                      ? 'bg-primary-50 text-primary-700 border-primary-200'
                      : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:text-neutral-800'
                  }`}
                >
                  {chip.key === 'all' && <Filter size={12} />}
                  {chip.label}
                </button>
              ))}
              <span className="ml-auto text-xs text-neutral-500 inline-flex items-center gap-1">
                <RefreshCw size={12} />
                {filteredFeed.length} 条活动
              </span>
            </div>
          )}
        </div>

        {/* ========= Sub-tab: Versions ========= */}
        {subTab === 'versions' && (
          <div className="animate-fade-up" key="versions">
            {loading ? (
              <VersionSkeleton />
            ) : filteredVersions.length === 0 ? (
              <div className="card p-12 text-center text-neutral-400">
                <GitCommit className="w-10 h-10 mx-auto mb-3 text-neutral-300" />
                <p className="text-sm">暂无版本记录</p>
              </div>
            ) : (
              <div className="relative">
                {/* vertical timeline line */}
                <div className="absolute left-[18px] top-0 bottom-0 w-px bg-neutral-200" />
                <div className="space-y-4 pl-2">
                  {filteredVersions.map((v, i) => (
                    <div key={v.id} className="relative">
                      {/* timeline dot */}
                      <div
                        className="absolute -left-[2px] top-5 w-[10px] h-[10px] rounded-full bg-white border-2 border-primary-500 z-10"
                      />
                      <CommitCard
                        commit={v}
                        seed={i + ((v.commitHash?.charCodeAt(0) || 0))}
                        delay={i * 55}
                        docTitle={selectedDocId === 'all' ? v.docTitle : null}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========= Sub-tab: Feed ========= */}
        {subTab === 'feed' && (
          <div className="animate-fade-up" key="feed">
            {loading ? (
              <FeedSkeleton />
            ) : filteredFeed.length === 0 ? (
              <div className="card p-12 text-center text-neutral-400">
                <User className="w-10 h-10 mx-auto mb-3 text-neutral-300" />
                <p className="text-sm">暂无活动记录</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredFeed.map((item, i) => (
                  <FeedCard
                    key={item.id}
                    item={item}
                    teamMap={teamMap}
                    delay={i * 55}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
