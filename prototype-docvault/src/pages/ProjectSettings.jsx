import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Settings,
  FolderKanban,
  ExternalLink,
  RefreshCw,
  ChevronRight,
  Save,
  X,
  Sparkles,
  Download,
  RefreshCcw,
  ArrowRight,
} from 'lucide-react'
import { fetchProject, runAIClassify, fetchAIClassifyRuns, runImport, fetchImportJobs } from '../api/stubs.js'

// ---- helpers ----------------------------------------------------------

const SOURCE_TYPE_LABEL = {
  git: 'Git 仓库',
  local: '本地文件夹',
  database: '数据库',
  'repo-docs': '仓库 /docs',
}

const TEMPLATE_LABEL = {
  docs: '标准文档 Docs',
  wiki: '团队 Wiki',
  blog: '博客 Blog',
  'product-site': '产品官网',
  'api-ref': 'API 参考',
  custom: '自定义',
}

// ---- main page --------------------------------------------------------

export default function ProjectSettings() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState(null)
  const [activeSection, setActiveSection] = useState('general')
  const [savedToast, setSavedToast] = useState(false)

  // 本地表单状态（编辑用）
  const [form, setForm] = useState({
    name: '',
    description: '',
    visibility: 'private',
    template: 'docs',
  })

  // AI 自动分类相关
  const [aiAutoClassify, setAiAutoClassify] = useState(true)
  const [aiAutoTag, setAiAutoTag] = useState(true)
  const [aiScope, setAiScope] = useState('inbox') // 'all' | 'inbox'
  const [classifying, setClassifying] = useState(false)
  const [classifyRuns, setClassifyRuns] = useState([])

  // 导入器相关
  const [importJobs, setImportJobs] = useState([])
  const [importing, setImporting] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importForm, setImportForm] = useState({
    importer: 'web-crawler',
    sourceUrl: '',
    title: '',
  })

  useEffect(() => {
    ;(async () => {
      const proj = await fetchProject(id)
      setProject(proj)
      if (proj) {
        setForm({
          name: proj.name,
          description: proj.description || '',
          visibility: proj.visibility || 'private',
          template: proj.template || 'docs',
        })
      }
      const [runs, jobs] = await Promise.all([
        fetchAIClassifyRuns(id),
        fetchImportJobs(id),
      ])
      setClassifyRuns(runs || [])
      setImportJobs(jobs || [])
      setLoading(false)
    })()
  }, [id])

  useEffect(() => {
    if (!savedToast) return
    const t = setTimeout(() => setSavedToast(false), 2000)
    return () => clearTimeout(t)
  }, [savedToast])

  function handleSave() {
    setProject((prev) => ({ ...prev, ...form }))
    setSavedToast(true)
  }

  if (loading) {
    return (
      <div className="p-6 animate-fade-up">
        <div className="skeleton h-8 w-48 mb-6" />
        <div className="grid grid-cols-[200px_1fr] gap-6">
          <div className="space-y-2">
            {[1,2,3,4,5].map((i) => (
              <div key={i} className="skeleton h-9 w-full rounded-md" />
            ))}
          </div>
          <div className="card p-6 space-y-4">
            <div className="skeleton h-6 w-40" />
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="p-10 text-center text-neutral-500">
        未找到项目
      </div>
    )
  }

  const sections = [
    { key: 'general', label: '基本信息', icon: Settings },
    { key: 'source', label: '数据源配置', icon: ExternalLink },
    { key: 'sync', label: '同步设置', icon: RefreshCw },
    { key: 'ai', label: 'AI 智能整理', icon: Sparkles },
    { key: 'import', label: '外部导入', icon: Download },
    { key: 'danger', label: '危险操作', icon: X },
  ]

  return (
    <div className="p-6 max-w-[1440px] mx-auto animate-fade-up">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-primary-600 text-xs font-medium mb-1">
          <Settings size={14} />
          <span>Project Settings</span>
        </div>
        <h1 className="font-display text-2xl font-bold text-neutral-900">
          项目设置
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          管理「{project.name}」的基本信息、数据源与同步行为
        </p>
      </div>

      <div className="grid grid-cols-[200px_1fr] gap-6">
        {/* Side nav */}
        <aside className="space-y-1">
          {sections.map((section) => {
            const Icon = section.icon
            const isActive = activeSection === section.key
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                  isActive
                    ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-100'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800'
                }`}
              >
                <Icon size={15} />
                {section.label}
              </button>
            )
          })}
        </aside>

        {/* Content panel */}
        <section>
          {activeSection === 'general' && (
            <div className="card p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-neutral-900">基本信息</h2>
                  <p className="text-xs text-neutral-500 mt-0.5">项目名称、描述与可见性</p>
                </div>
                <button onClick={handleSave} className="btn-primary !py-1.5 !text-sm">
                  <Save size={14} />
                  保存修改
                </button>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                    项目名称
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                    项目描述
                  </label>
                  <textarea
                    rows={3}
                    className="input resize-none"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    可见性
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { v: 'private', t: '私有', d: '仅 Owner 和 Maintainer 可见' },
                      { v: 'team',    t: '团队', d: '团队内所有成员可见' },
                      { v: 'public',  t: '公开', d: '互联网可访问（只读）' },
                    ].map((opt) => {
                      const selected = form.visibility === opt.v
                      return (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, visibility: opt.v }))}
                          className={`text-left p-3 rounded-lg border transition ${
                            selected
                              ? 'border-primary-400 bg-primary-50/60 ring-1 ring-primary-100'
                              : 'border-neutral-200 hover:border-neutral-300'
                          }`}
                        >
                          <div className="text-sm font-semibold text-neutral-800">{opt.t}</div>
                          <div className="text-[11px] text-neutral-500 mt-0.5">{opt.d}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    模板
                  </label>
                  <select
                    className="input"
                    value={form.template}
                    onChange={(e) => setForm((f) => ({ ...f, template: e.target.value }))}
                  >
                    {Object.entries(TEMPLATE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'source' && (
            <div className="card p-6 space-y-6">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">数据源</h2>
                <p className="text-xs text-neutral-500 mt-0.5">当前项目绑定的数据源配置</p>
              </div>

              <div className="rounded-lg border border-neutral-200 divide-y divide-neutral-100">
                {/* Source type + URL */}
                <div className="grid grid-cols-[140px_1fr] items-center px-4 py-3">
                  <div className="text-sm font-medium text-neutral-700">源类型</div>
                  <div className="flex items-center gap-2">
                    <FolderKanban size={14} className="text-primary-500" />
                    <span className="text-sm text-neutral-800 font-medium">
                      {SOURCE_TYPE_LABEL[project.sourceType] || project.sourceType}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-[140px_1fr] items-center px-4 py-3">
                  <div className="text-sm font-medium text-neutral-700">仓库地址</div>
                  <code className="font-mono text-xs text-neutral-600 break-all">
                    {project.sourceUrl}
                  </code>
                </div>
                <div className="grid grid-cols-[140px_1fr] items-center px-4 py-3">
                  <div className="text-sm font-medium text-neutral-700">最后同步</div>
                  <div className="text-sm text-neutral-600">
                    {project.lastSynced
                      ? new Date(project.lastSynced).toLocaleString('zh-CN')
                      : '从未同步'}
                  </div>
                </div>
              </div>

              <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
                <div className="text-sm text-neutral-700 mb-2">
                  💡 需要更详细的数据源配置（认证 Token、子目录、同步间隔等）？
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/sources')}
                  className="btn-secondary !py-1.5 !text-xs inline-flex items-center gap-1"
                >
                  前往全局数据源管理
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}

          {activeSection === 'sync' && (
            <div className="card p-6 space-y-6">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">同步设置</h2>
                <p className="text-xs text-neutral-500 mt-0.5">控制文档的自动同步行为</p>
              </div>

              <div className="space-y-4">
                <label className="flex items-center justify-between cursor-pointer p-4 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors">
                  <div>
                    <div className="text-sm font-medium text-neutral-800">启用自动同步</div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      根据设定的间隔自动拉取最新内容并重建索引
                    </div>
                  </div>
                  <span className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors bg-primary-500">
                    <span className="inline-block h-4 w-4 transform rounded-full bg-white translate-x-4 shadow-sm" />
                  </span>
                </label>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    同步间隔
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { k: '30m', t: '30 分钟' },
                      { k: '1h',  t: '1 小时' },
                      { k: '6h',  t: '6 小时' },
                      { k: '24h', t: '每天' },
                    ].map((o, i) => (
                      <button
                        key={o.k}
                        type="button"
                        className={`py-2 rounded-md text-xs font-medium border transition ${
                          i === 2
                            ? 'border-primary-400 bg-primary-50 text-primary-700'
                            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {o.t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2">
                  <button className="btn-primary">
                    <RefreshCw size={14} />
                    立即同步一次
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===== AI 智能整理区块 ===== */}
          {activeSection === 'ai' && (
            <div className="card p-6 space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
                    <Sparkles size={16} className="text-violet-500" />
                    AI 智能整理
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    开启后，DocVault 会自动分析你的文档内容，创建合适的目录结构并打上标签
                  </p>
                </div>
                <span className="tag-primary !text-[10px]">个人知识库推荐开启</span>
              </div>

              {/* 开关 */}
              <div className="space-y-3">
                <label className="flex items-center justify-between cursor-pointer p-4 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors">
                  <div>
                    <div className="text-sm font-medium text-neutral-800">自动分类目录</div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      当新文档进入时，自动归类到语义最匹配的目录下
                    </div>
                  </div>
                  <span
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      aiAutoClassify ? 'bg-primary-500' : 'bg-neutral-300'
                    }`}
                    onClick={() => setAiAutoClassify((v) => !v)}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
                        aiAutoClassify ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                </label>

                <label className="flex items-center justify-between cursor-pointer p-4 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors">
                  <div>
                    <div className="text-sm font-medium text-neutral-800">自动打标</div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      基于内容语义为每篇文档自动生成 3–5 个层级标签（如 AI/提示词、方法论/PIM）
                    </div>
                  </div>
                  <span
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      aiAutoTag ? 'bg-primary-500' : 'bg-neutral-300'
                    }`}
                    onClick={() => setAiAutoTag((v) => !v)}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
                        aiAutoTag ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                </label>
              </div>

              {/* 作用范围 */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  作用范围
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { k: 'all',   t: '全部文档', d: '对所有现有与新文档执行' },
                    { k: 'inbox', t: '仅收件箱', d: '只处理新进入收件箱的文档' },
                  ].map((o) => {
                    const active = aiScope === o.k
                    return (
                      <button
                        key={o.k}
                        type="button"
                        onClick={() => setAiScope(o.k)}
                        className={`text-left p-3 rounded-lg border transition ${
                          active
                            ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-100'
                            : 'border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        <div className="text-sm font-semibold text-neutral-800">{o.t}</div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">{o.d}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 立即执行按钮 + 结果 */}
              <div className="flex items-center gap-3 pt-2 border-t border-neutral-100">
                <button
                  type="button"
                  className="btn-primary disabled:opacity-50"
                  disabled={classifying}
                  onClick={async () => {
                    setClassifying(true)
                    const run = await runAIClassify(id, {
                      scope: aiScope,
                      foldersAuto: aiAutoClassify,
                      tagsAuto: aiAutoTag,
                    })
                    setClassifyRuns((prev) => [run, ...prev])
                    setClassifying(false)
                  }}
                >
                  {classifying ? (
                    <>
                      <RefreshCcw size={14} className="animate-spin" />
                      AI 分析中…
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} />
                      立即执行一次
                    </>
                  )}
                </button>
                <span className="text-[11px] text-neutral-400">
                  使用 AI 分类器 v2.3 · 大约 30 秒
                </span>
              </div>

              {/* 最近运行历史 */}
              {classifyRuns.length > 0 && (
                <div className="pt-2 border-t border-neutral-100">
                  <div className="text-xs font-semibold text-neutral-700 mb-2">
                    最近运行
                  </div>
                  <div className="space-y-2">
                    {classifyRuns.slice(0, 4).map((r) => (
                      <div key={r.id} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 border border-neutral-100 text-xs">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium text-neutral-800">
                              {r.scope === 'all' ? '全部文档' : r.scope === 'inbox' ? '仅收件箱' : r.scope}
                              {' · '}
                              <span className="text-primary-600">扫描 {r.stats.scanned} 篇</span>
                            </div>
                            <div className="text-neutral-500 mt-0.5">
                              创建 {r.stats.foldersCreated} 个目录 · 移动 {r.stats.docsRelocated} 篇 · 新增 {r.stats.tagsAdded} 个标签
                            </div>
                          </div>
                        </div>
                        <div className="text-neutral-400 flex-shrink-0 ml-3">
                          {new Date(r.startedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          {' · '}{r.durationSec}s
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== 外部导入区块 ===== */}
          {activeSection === 'import' && (
            <div className="card p-6 space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
                    <Download size={16} className="text-emerald-500" />
                    外部导入
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    通过支持的导入器，把外部内容（网页、Notion、Obsidian）一键迁入当前知识库
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary !py-1.5 !text-xs"
                  onClick={() => {
                    setShowImportModal(true)
                    setImportForm({ importer: 'web-crawler', sourceUrl: '', title: '' })
                  }}
                >
                  <Download size={13} />
                  新建导入任务
                </button>
              </div>

              {/* 支持的导入器类型 */}
              <div>
                <div className="text-xs font-semibold text-neutral-700 mb-2">
                  支持的导入器
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { k: 'web-crawler', t: '网页爬取', d: 'URL 抓取', icon: '🌐' },
                    { k: 'notion',      t: 'Notion',    d: '导出文件', icon: '📝' },
                    { k: 'obsidian',    t: 'Obsidian',  d: '文件夹',   icon: '🗂️' },
                    { k: 'folder',      t: '本地文件夹', d: '批量',    icon: '📁' },
                  ].map((o) => (
                    <div
                      key={o.k}
                      className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200 bg-neutral-50/60"
                    >
                      <div className="text-xl">{o.icon}</div>
                      <div>
                        <div className="text-sm font-semibold text-neutral-800">{o.t}</div>
                        <div className="text-[11px] text-neutral-500">{o.d}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 导入历史 */}
              {importJobs.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold text-neutral-700 mb-2">
                    导入历史
                  </div>
                  <div className="space-y-2">
                    {importJobs.map((job) => {
                      const isRunning = job.status === 'running'
                      const pct = Math.round((job.stats.pagesImported / Math.max(1, job.stats.pagesFetched)) * 100) || (isRunning ? 60 : 100)
                      return (
                        <div key={job.id} className="p-3 rounded-lg border border-neutral-200 bg-white">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  job.importer === 'web-crawler' ? 'bg-sky-50 text-sky-700' :
                                  job.importer === 'notion' ? 'bg-neutral-100 text-neutral-700' :
                                  'bg-emerald-50 text-emerald-700'
                                }`}>
                                  {job.importer === 'web-crawler' ? '网页爬取' : job.importer === 'notion' ? 'Notion' : '文件夹'}
                                </span>
                                <span className="text-xs font-medium text-neutral-800 truncate">
                                  {job.title}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  isRunning ? 'bg-primary-50 text-primary-700 animate-pulse' :
                                  'bg-emerald-50 text-emerald-700'
                                }`}>
                                  {isRunning ? '进行中' : '已完成'}
                                </span>
                              </div>
                              <div className="text-[11px] text-neutral-500 mt-1 font-mono truncate">
                                {job.sourceUrl}
                              </div>
                              {/* 进度条（仅运行中显示） */}
                              {isRunning && (
                                <div className="mt-2">
                                  <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-primary-500 rounded-full transition-all duration-500"
                                      style={{ width: `${Math.min(95, pct)}%` }}
                                    />
                                  </div>
                                  <div className="text-[10px] text-neutral-400 mt-1">
                                    已抓取 {job.stats.pagesFetched} · 已导入 {job.stats.pagesImported}
                                  </div>
                                </div>
                              )}
                              {!isRunning && (
                                <div className="text-[11px] text-neutral-400 mt-1">
                                  抓取 {job.stats.pagesFetched} · 导入 {job.stats.pagesImported} · 跳过 {job.stats.skipped}
                                </div>
                              )}
                            </div>
                            <div className="text-[10px] text-neutral-400 flex-shrink-0">
                              {new Date(job.startedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-neutral-200 p-6 text-center">
                  <Download size={24} className="mx-auto text-neutral-300 mb-2" />
                  <div className="text-xs text-neutral-500">暂无导入历史，点击右上按钮开始第一次导入</div>
                </div>
              )}
            </div>
          )}

          {activeSection === 'danger' && (
            <div className="card p-6 space-y-5 border-red-200">
              <div>
                <h2 className="text-base font-semibold text-red-700">危险操作</h2>
                <p className="text-xs text-neutral-500 mt-0.5">以下操作不可恢复，请谨慎执行</p>
              </div>

              <div className="rounded-lg border border-red-200 bg-red-50/60 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-red-800">删除项目</div>
                    <div className="text-xs text-red-600/80 mt-1">
                      删除后该项目的所有文档、设置与成员关联将被清除，且无法恢复。
                    </div>
                  </div>
                  <button className="btn-danger !py-1.5 !text-xs whitespace-nowrap">
                    删除项目
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Toast */}
      {savedToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] animate-fade-up">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-neutral-200 shadow-lg text-sm font-medium text-neutral-800">
            <span className="text-emerald-500">✓</span>
            设置已保存
          </div>
        </div>
      )}

      {/* ===== 新建导入任务 Modal ===== */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up p-4"
          onClick={() => setShowImportModal(false)}
        >
          <div
            className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-neutral-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Download size={18} />
                </div>
                <div>
                  <h3 className="font-semibold text-neutral-900">新建导入任务</h3>
                  <p className="text-xs text-neutral-500">选择导入器并填写目标地址</p>
                </div>
              </div>
              <button className="btn-ghost !p-2" onClick={() => setShowImportModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (!importForm.sourceUrl.trim()) return
                setImporting(true)
                const job = await runImport(id, {
                  importer: importForm.importer,
                  sourceUrl: importForm.sourceUrl.trim(),
                  title: importForm.title.trim() || importForm.sourceUrl,
                })
                setImportJobs((prev) => [job, ...prev])
                setImporting(false)
                setShowImportModal(false)
              }}
              className="p-5 space-y-5"
            >
              {/* Importer type */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  导入器类型
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { k: 'web-crawler', t: '网页爬取', icon: '🌐' },
                    { k: 'notion',      t: 'Notion',    icon: '📝' },
                    { k: 'obsidian',    t: 'Obsidian',  icon: '🗂️' },
                    { k: 'folder',      t: '本地文件夹', icon: '📁' },
                  ].map((o) => {
                    const active = importForm.importer === o.k
                    return (
                      <button
                        key={o.k}
                        type="button"
                        onClick={() => setImportForm({ ...importForm, importer: o.k })}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          active
                            ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-100'
                            : 'border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        <div className="text-lg">{o.icon}</div>
                        <div className="text-[11px] mt-1 text-neutral-700">{o.t}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Source URL / path */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  {importForm.importer === 'folder' ? '文件夹路径' : importForm.importer === 'web-crawler' ? '网页 URL' : '来源地址'}
                  <span className="text-danger"> *</span>
                </label>
                <input
                  type={importForm.importer === 'folder' ? 'text' : 'url'}
                  className="input font-mono"
                  placeholder={
                    importForm.importer === 'web-crawler'
                      ? 'https://docs.example.com'
                      : importForm.importer === 'folder'
                      ? 'C:/Users/xxx/NotionExport'
                      : 'https://notion.so/your-page'
                  }
                  value={importForm.sourceUrl}
                  onChange={(e) => setImportForm({ ...importForm, sourceUrl: e.target.value })}
                  required
                />
              </div>

              {/* Title (optional) */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  任务名称 <span className="text-neutral-400 font-normal">(可选，用于历史标识)</span>
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="例如：Rust Book 导入"
                  value={importForm.title}
                  onChange={(e) => setImportForm({ ...importForm, title: e.target.value })}
                />
              </div>

              {/* Tip */}
              {importForm.importer === 'web-crawler' && (
                <div className="rounded-lg border border-neutral-200 p-3 bg-neutral-50 text-[11px] text-neutral-500 leading-relaxed">
                  💡 输入站点根 URL 或 sitemap，DocVault 会自动递归抓取子页面并转为 Markdown。
                  <br />
                  目前支持最大 3 层、500 页以内。
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
                <button type="button" className="btn-secondary" onClick={() => setShowImportModal(false)}>
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-primary disabled:opacity-50"
                  disabled={importing || !importForm.sourceUrl.trim()}
                >
                  {importing ? (
                    <>
                      <RefreshCcw size={14} className="animate-spin" />
                      启动中…
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      开始导入
                      <ArrowRight size={13} />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
