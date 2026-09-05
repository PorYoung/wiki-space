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
} from 'lucide-react'
import { fetchProject } from '../api/stubs.js'

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
    </div>
  )
}
