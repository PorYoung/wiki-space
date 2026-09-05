import { useState, useEffect } from 'react'
import {
  Settings as SettingsIcon, User, Bell, Palette, Database, Shield, Keyboard, HelpCircle,
  ChevronRight, Check, Moon, Sun, Monitor, Globe, Mail, FolderOpen,
  Clock, AlertTriangle, Trash2, Download, X, Sparkles, Lock, LogOut,
  Image as ImageIcon, ArrowUpDown, BookOpen
} from 'lucide-react'
import { fetchSources } from '../api/stubs.js'

// ----------------------------- Shared sub-components -----------------------------

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-primary-500' : 'bg-neutral-200'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
      {label && (
        <span className={`absolute inset-y-0 flex items-center text-[10px] font-semibold ${
          checked ? 'left-1.5 text-white' : 'right-1.5 text-neutral-400'
        }`}>
          {checked ? '' : ''}
        </span>
      )}
    </button>
  )
}

function SectionHeader({ title, desc }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      {desc && <p className="mt-1 text-sm text-neutral-500">{desc}</p>}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-neutral-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-neutral-400">{hint}</p>}
    </div>
  )
}

function RadioCard({ active, onClick, icon, title, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all ${
        active
          ? 'border-primary-400 bg-primary-50 ring-2 ring-primary-200'
          : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50'
      }`}
    >
      <div className="flex w-full items-center justify-between">
        <div className={`p-1.5 rounded-md ${active ? 'bg-primary-100 text-primary-600' : 'bg-neutral-100 text-neutral-500'}`}>
          {icon}
        </div>
        {active && <Check className="w-4 h-4 text-primary-600" />}
      </div>
      <div className={`text-sm font-medium ${active ? 'text-primary-800' : 'text-neutral-800'}`}>{title}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </button>
  )
}

// ----------------------------- Sections -----------------------------

function ProfileSection({ onSaved }) {
  const [name, setName] = useState('林可舟')
  const [email, setEmail] = useState('kezhou.lin@docvault.io')
  const [role] = useState('管理员')
  const [initial, setInitial] = useState('L')
  const [avatarColor, setAvatarColor] = useState('bg-gradient-to-br from-primary-400 to-primary-600')

  const handleSave = () => {
    setInitial(name.trim().charAt(0).toUpperCase() || 'U')
    onSaved()
  }

  return (
    <div className="animate-fade-up">
      <SectionHeader title="个人资料" desc="设置你的身份信息，用于协作通知与展示。" />

      <div className="card p-6 space-y-6">
        {/* Avatar */}
        <div className="flex items-center gap-5">
          <button className="group relative w-20 h-20 rounded-full overflow-hidden ring-2 ring-white shadow-md">
            <div className={`w-full h-full ${avatarColor} flex items-center justify-center text-white text-2xl font-bold`}>
              {initial}
            </div>
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center text-white text-[11px] gap-0.5">
              <ImageIcon className="w-4 h-4" />
              上传头像
            </div>
          </button>
          <div className="flex-1">
            <div className="text-sm font-medium text-neutral-800">点击头像进行上传</div>
            <div className="text-xs text-neutral-500">支持 JPG / PNG，推荐 256×256 像素，不超过 2MB。</div>
            <div className="mt-2 flex gap-1.5">
              {['bg-gradient-to-br from-primary-400 to-primary-600','bg-gradient-to-br from-rose-400 to-orange-500','bg-gradient-to-br from-indigo-400 to-violet-600','bg-gradient-to-br from-emerald-400 to-teal-600'].map((c) => (
                <button key={c} onClick={() => setAvatarColor(c)} className={`w-6 h-6 rounded-full ${c} ring-2 ring-white shadow-sm hover:scale-110 transition`} />
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-neutral-100" />

        {/* Form fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="显示名称" hint="这将显示在你的评论、活动流和团队列表中。">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="邮箱地址">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="角色">
            <div className="input flex items-center justify-between cursor-not-allowed bg-neutral-50 text-neutral-600">
              <span className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary-500" />
                {role}
              </span>
              <span className="text-xs text-neutral-400">由工作区管理员分配</span>
            </div>
          </Field>
          <Field label="个人主页">
            <div className="input flex items-center gap-2 text-neutral-500">
              <Globe className="w-4 h-4" />
              <span className="text-neutral-400">https://docvault.io/u/kezhou</span>
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-neutral-100">
          <button className="btn-secondary">取消</button>
          <button className="btn-primary" onClick={handleSave}>
            <Check className="w-4 h-4" /> 保存更改
          </button>
        </div>
      </div>
    </div>
  )
}

function AppearanceSection() {
  const [theme, setTheme] = useState('system')
  const [accent, setAccent] = useState('teal')
  const [fontSize, setFontSize] = useState(2) // 1 small, 2 default, 3 large
  const [lineHeight, setLineHeight] = useState(true)

  const accentColors = [
    { key: 'teal',   cls: 'bg-teal-500' },
    { key: 'coral',  cls: 'bg-rose-500' },
    { key: 'indigo', cls: 'bg-indigo-500' },
    { key: 'sage',   cls: 'bg-emerald-500' },
    { key: 'amber',  cls: 'bg-amber-500' },
  ]

  return (
    <div className="animate-fade-up">
      <SectionHeader title="外观与主题" desc="自定义 DocVault 的视觉风格，让它更趁手。" />

      {/* Theme */}
      <div className="card p-6 mb-5">
        <h3 className="text-sm font-semibold text-neutral-800 mb-1">主题模式</h3>
        <p className="text-xs text-neutral-500 mb-4">选择一个主题，或让 DocVault 自动跟随系统。</p>
        <div className="grid grid-cols-3 gap-3">
          <RadioCard
            active={theme === 'light'}
            onClick={() => setTheme('light')}
            icon={<Sun className="w-4 h-4" />}
            title="浅色"
            sub="干净明亮"
          />
          <RadioCard
            active={theme === 'dark'}
            onClick={() => setTheme('dark')}
            icon={<Moon className="w-4 h-4" />}
            title="深色"
            sub="护眼低疲劳"
          />
          <RadioCard
            active={theme === 'system'}
            onClick={() => setTheme('system')}
            icon={<Monitor className="w-4 h-4" />}
            title="跟随系统"
            sub="自动切换"
          />
        </div>
      </div>

      {/* Accent */}
      <div className="card p-6 mb-5">
        <h3 className="text-sm font-semibold text-neutral-800 mb-1">强调色</h3>
        <p className="text-xs text-neutral-500 mb-4">为按钮、链接与高亮选择一个主题色。</p>
        <div className="flex items-center gap-4">
          {accentColors.map((c) => (
            <button
              key={c.key}
              onClick={() => setAccent(c.key)}
              className={`w-9 h-9 rounded-full ${c.cls} transition-all hover:scale-110 ${
                accent === c.key ? 'ring-2 ring-offset-2 ring-neutral-400' : 'ring-2 ring-white shadow-sm'
              }`}
              aria-label={c.key}
            >
              {accent === c.key && <Check className="w-4 h-4 mx-auto text-white" />}
            </button>
          ))}
          <div className="ml-4 text-xs text-neutral-500">
            当前：<span className="font-medium text-neutral-700">{accent.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Font + Line height */}
      <div className="card p-6 space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-semibold text-neutral-800">正文字号</h3>
              <p className="text-xs text-neutral-500">影响文档正文和界面的基础字号。</p>
            </div>
            <span className="text-xs text-neutral-500">{['小', '默认', '大'][fontSize - 1]}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-500">小</span>
            <input
              type="range"
              min="1"
              max="3"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="flex-1 accent-primary-500"
            />
            <span className="text-xs text-neutral-500">大</span>
          </div>
          {/* Preview */}
          <div className="mt-3 p-3 rounded-md bg-neutral-50 border border-neutral-200">
            <div className={`text-neutral-700 ${fontSize === 1 ? 'text-xs' : fontSize === 2 ? 'text-sm' : 'text-base'}`}>
              预览：在 DocVault 中，每一个文档都是一次协作的开始。
            </div>
          </div>
        </div>

        <div className="border-t border-neutral-100" />

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-800">舒适行距</h3>
            <p className="text-xs text-neutral-500">在编辑器中使用更宽松的行高。</p>
          </div>
          <Toggle checked={lineHeight} onChange={setLineHeight} />
        </div>
      </div>
    </div>
  )
}

function NotificationsSection() {
  const [email, setEmail] = useState({ comments: true, merged: true, release: false, syncFail: true })
  const [inApp, setInApp] = useState({ comments: true, merged: false, release: true, syncFail: true })
  const [digest, setDigest] = useState('daily')

  const setE = (k) => (v) => setEmail((s) => ({ ...s, [k]: v }))
  const setA = (k) => (v) => setInApp((s) => ({ ...s, [k]: v }))

  const rows = [
    { key: 'comments',  title: '协作者评论我时',        hint: '当有人 @你 或评论你参与的文档' },
    { key: 'merged',    title: '文档被合并时',          hint: '你的草稿或分支被合并入主文档' },
    { key: 'release',   title: '版本发布时',            hint: '有人从版本历史发布一个稳定快照' },
    { key: 'syncFail',  title: '数据源同步失败时',      hint: 'Git / Notion / Confluence 等源的同步出错' },
  ]

  return (
    <div className="animate-fade-up">
      <SectionHeader title="通知" desc="选择你希望通过哪些渠道接收 DocVault 的事件提醒。" />

      {/* Email */}
      <div className="card p-6 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Mail className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-neutral-800">邮件通知</h3>
        </div>
        <p className="text-xs text-neutral-500 mb-4">我们会将重要事件发送到你注册的邮箱。</p>
        <div className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm text-neutral-800">{r.title}</div>
                <div className="text-xs text-neutral-500">{r.hint}</div>
              </div>
              <Toggle checked={email[r.key]} onChange={setE(r.key)} />
            </div>
          ))}
        </div>
      </div>

      {/* In-app */}
      <div className="card p-6 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-neutral-800">应用内通知</h3>
        </div>
        <p className="text-xs text-neutral-500 mb-4">在顶部通知中心显示即时提醒。</p>
        <div className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm text-neutral-800">{r.title}</div>
                <div className="text-xs text-neutral-500">{r.hint}</div>
              </div>
              <Toggle checked={inApp[r.key]} onChange={setA(r.key)} />
            </div>
          ))}
        </div>
      </div>

      {/* Digest */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-neutral-800">摘要频率</h3>
        </div>
        <p className="text-xs text-neutral-500 mb-4">将错过的事件打包成一封邮件。</p>
        <div className="grid grid-cols-3 gap-3">
          <RadioCard active={digest === 'daily'}  onClick={() => setDigest('daily')}  icon={<Sparkles className="w-4 h-4" />} title="每日"  sub="工作日早 9 点" />
          <RadioCard active={digest === 'weekly'} onClick={() => setDigest('weekly')} icon={<BookOpen className="w-4 h-4" />}    title="每周"  sub="周一早上" />
          <RadioCard active={digest === 'never'}  onClick={() => setDigest('never')}  icon={<X className="w-4 h-4" />}             title="从不"  sub="完全关闭" />
        </div>
      </div>
    </div>
  )
}

function SourcesSection() {
  const [branch, setBranch] = useState('main')
  const [interval, setInterval] = useState('1h')
  const [conflict, setConflict] = useState('mine')
  const [sources, setSources] = useState([])

  useEffect(() => {
    fetchSources().then(setSources)
  }, [])

  return (
    <div className="animate-fade-up">
      <SectionHeader title="数据源默认" desc="当创建新的数据源时，将使用以下默认值。" />

      {/* Branch */}
      <div className="card p-6 mb-5">
        <Field label="默认分支" hint="适用于 Git 类数据源。分支不存在时将自动创建。">
          <div className="flex items-center gap-2 mt-1">
            <FolderOpen className="w-4 h-4 text-neutral-400" />
            <select className="input flex-1" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="main">main</option>
              <option value="master">master</option>
              <option value="develop">develop</option>
              <option value="release">release</option>
            </select>
          </div>
        </Field>
      </div>

      {/* Sync interval */}
      <div className="card p-6 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-neutral-800">自动同步间隔</h3>
        </div>
        <p className="text-xs text-neutral-500 mb-4">DocVault 将按此间隔从数据源拉取最新内容。</p>
        <div className="grid grid-cols-4 gap-3">
          {[
            { k: '30m',  t: '30 分钟' },
            { k: '1h',   t: '1 小时' },
            { k: '6h',   t: '6 小时' },
            { k: 'manual', t: '手动' },
          ].map((o) => (
            <RadioCard
              key={o.k}
              active={interval === o.k}
              onClick={() => setInterval(o.k)}
              icon={<RefreshCwLikeIcon />}
              title={o.t}
              sub={o.k === 'manual' ? '仅手动触发' : '自动后台同步'}
            />
          ))}
        </div>
      </div>

      {/* Conflict resolution */}
      <div className="card p-6 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <ArrowUpDown className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-neutral-800">冲突解决策略</h3>
        </div>
        <p className="text-xs text-neutral-500 mb-4">当本地与远程同时修改同一文档时使用。</p>
        <div className="grid grid-cols-3 gap-3">
          <RadioCard active={conflict === 'mine'}    onClick={() => setConflict('mine')}    icon={<User className="w-4 h-4" />}   title="保留我的"   sub="总是覆盖远程" />
          <RadioCard active={conflict === 'remote'}  onClick={() => setConflict('remote')}  icon={<Database className="w-4 h-4" />} title="保留远程" sub="以数据源为准" />
          <RadioCard active={conflict === 'ask'}     onClick={() => setConflict('ask')}     icon={<AlertTriangle className="w-4 h-4" />} title="询问我" sub="弹出对比面板" />
        </div>
      </div>

      {/* Current sources preview */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-neutral-800 mb-3">已连接数据源</h3>
        {sources.length === 0 ? (
          <div className="text-xs text-neutral-500">加载中…</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {sources.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-neutral-100 flex items-center justify-center">
                    <Database className="w-4 h-4 text-neutral-500" />
                  </div>
                  <div>
                    <div className="text-sm text-neutral-800">{s.name}</div>
                    <div className="text-xs text-neutral-500">{s.type} · 分支 {s.branch}</div>
                  </div>
                </div>
                <div className={`tag ${s.status === 'synced' ? 'tag-success' : s.status === 'syncing' ? 'tag-primary' : 'tag-neutral'}`}>
                  {s.status === 'synced' ? '已同步' : s.status === 'syncing' ? '同步中' : '空闲'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Tiny inline icon so we don't need another import for the sync interval card
function RefreshCwLikeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}

function ShortcutsSection() {
  const shortcuts = [
    { action: '新建文档',       keys: ['⌘', 'N'] },
    { action: '保存',           keys: ['⌘', 'S'] },
    { action: '搜索文档',       keys: ['⌘', 'K'] },
    { action: '切换预览模式',   keys: ['⌘', 'P'] },
    { action: '打开命令面板',   keys: ['⌘', '⇧', 'P'] },
    { action: '切换侧边栏',     keys: ['⌘', 'B'] },
    { action: '聚焦编辑区',     keys: ['⌘', 'J'] },
    { action: '撤销',           keys: ['⌘', 'Z'] },
    { action: '重做',           keys: ['⌘', '⇧', 'Z'] },
    { action: '插入代码块',     keys: ['⌘', '⌥', 'C'] },
  ]

  return (
    <div className="animate-fade-up">
      <SectionHeader title="快捷键" desc="所有 DocVault 内置快捷键一览。可以在命令面板中自定义。" />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-6 py-3 font-medium">操作</th>
              <th className="text-right px-6 py-3 font-medium">按键</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shortcuts.map((s, i) => (
              <tr key={i} className="hover:bg-neutral-50/60">
                <td className="px-6 py-3 text-neutral-800">{s.action}</td>
                <td className="px-6 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    {s.keys.map((k, ki) => (
                      <span key={ki} className="inline-flex items-center">
                        <kbd className="px-2 py-0.5 rounded border border-neutral-200 bg-neutral-50 text-xs font-mono text-neutral-700 shadow-sm">
                          {k}
                        </kbd>
                        {ki < s.keys.length - 1 && <span className="text-neutral-400 mx-0.5">+</span>}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-neutral-500">
        快捷键目前为只读。自定义快捷键将于 <span className="text-primary-600 font-medium">v1.3</span> 版本开放。
      </p>
    </div>
  )
}

function AboutSection({ onDeleteRequest }) {
  return (
    <div className="animate-fade-up">
      <SectionHeader title="关于 / 帮助" desc="版本信息、数据导出与危险操作。" />

      {/* Version */}
      <div className="card p-6 mb-5 flex items-center gap-5">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white">
          <BookOpen className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <div className="text-sm text-neutral-500">DocVault</div>
          <div className="text-lg font-semibold text-neutral-900">v1.2.0 <span className="tag tag-primary ml-2">稳定</span></div>
          <div className="text-xs text-neutral-500 mt-1">构建于 2026-08-21 · 提交 a7f3d9e</div>
        </div>
        <button className="btn-secondary">
          查看发布说明
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Links */}
      <div className="card p-6 mb-5 grid grid-cols-2 gap-3">
        <a className="nav-item active">
          <Globe className="w-4 h-4" /> 帮助中心
          <ChevronRight className="w-4 h-4 ml-auto" />
        </a>
        <a className="nav-item active">
          <HelpCircle className="w-4 h-4" /> 联系支持
          <ChevronRight className="w-4 h-4 ml-auto" />
        </a>
        <a className="nav-item active">
          <Keyboard className="w-4 h-4" /> 更新日志
          <ChevronRight className="w-4 h-4 ml-auto" />
        </a>
        <a className="nav-item active">
          <Shield className="w-4 h-4" /> 隐私与条款
          <ChevronRight className="w-4 h-4 ml-auto" />
        </a>
      </div>

      {/* Export */}
      <div className="card p-6 mb-5 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-neutral-800">导出你的数据</h3>
          <p className="text-xs text-neutral-500 mt-1">生成一个包含所有文档、设置与数据源配置的 ZIP 备份。</p>
        </div>
        <button className="btn-secondary">
          <Download className="w-4 h-4" /> 导出数据
        </button>
      </div>

      {/* Danger zone */}
      <div className="rounded-lg border-2 border-red-200 bg-red-50/50 p-6">
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-red-800">危险操作</h3>
            <p className="text-xs text-red-700/80 mt-1">
              删除工作区将永久移除所有文档、数据源配置、团队成员与版本历史。此操作不可撤销。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-danger border-red-300 text-red-700 hover:bg-red-100 hover:border-red-400"
            onClick={onDeleteRequest}
          >
            <Trash2 className="w-4 h-4" /> 删除工作区
          </button>
          <button className="btn-danger border-red-300 text-red-700 hover:bg-red-100 hover:border-red-400">
            <LogOut className="w-4 h-4" /> 注销账号
          </button>
        </div>
      </div>
    </div>
  )
}

// ----------------------------- Confirm modal -----------------------------

function ConfirmModal({ open, title, desc, confirmText, onCancel, onConfirm }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-[440px] rounded-lg bg-white border border-neutral-200 shadow-xl animate-fade-up">
        <div className="p-6 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
            <p className="mt-1 text-sm text-neutral-600 leading-relaxed">{desc}</p>
          </div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-neutral-100 text-neutral-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 pb-5 pt-3 flex items-center justify-end gap-2 border-t border-neutral-100">
          <button className="btn-secondary" onClick={onCancel}>取消</button>
          <button
            className="bg-red-600 hover:bg-red-700 text-white inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium transition"
            onClick={onConfirm}
          >
            <Trash2 className="w-4 h-4" /> {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

// ----------------------------- Main page -----------------------------

const SECTIONS = [
  { key: 'profile',     label: '个人资料',       Icon: User },
  { key: 'appearance',  label: '外观与主题',     Icon: Palette },
  { key: 'notifications', label: '通知',         Icon: Bell },
  { key: 'sources',     label: '数据源默认',     Icon: Database },
  { key: 'shortcuts',   label: '快捷键',         Icon: Keyboard },
  { key: 'about',       label: '关于 / 帮助',    Icon: HelpCircle },
]

export default function Settings() {
  const [active, setActive] = useState('profile')
  const [toast, setToast] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleSaved = () => {
    setToast(true)
    setTimeout(() => setToast(false), 2000)
  }

  return (
    <div className="flex gap-0 h-full p-6">
      {/* Left nav */}
      <aside className="w-[240px] shrink-0 border-r border-neutral-200 bg-white/70 backdrop-blur-sm p-5 h-full overflow-y-auto scrollbar-thin">
        <div className="flex items-center gap-2 mb-6">
          <div className="p-1.5 rounded-lg bg-primary-50 text-primary-600">
            <SettingsIcon className="w-4 h-4" />
          </div>
          <h1 className="text-base font-semibold text-neutral-900">设置</h1>
        </div>

        <nav className="space-y-0.5">
          {SECTIONS.map(({ key, label, Icon }) => {
            const isActive = active === key
            return (
              <button
                key={key}
                onClick={() => setActive(key)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-primary-600' : 'text-neutral-400'}`} />
                <span className="flex-1 text-left">{label}</span>
                {isActive && <ChevronRight className="w-4 h-4 text-primary-600" />}
              </button>
            )
          })}
        </nav>

        <div className="mt-8 p-3 rounded-md bg-neutral-50 border border-neutral-200">
          <div className="flex items-center gap-2 text-xs text-neutral-600">
            <Lock className="w-3.5 h-3.5" />
            工作区：<span className="font-semibold text-neutral-800">产品设计部</span>
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 p-8 overflow-y-auto scrollbar-thin">
        {active === 'profile' && <ProfileSection onSaved={handleSaved} />}
        {active === 'appearance' && <AppearanceSection />}
        {active === 'notifications' && <NotificationsSection />}
        {active === 'sources' && <SourcesSection />}
        {active === 'shortcuts' && <ShortcutsSection />}
        {active === 'about' && <AboutSection onDeleteRequest={() => setConfirmOpen(true)} />}
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-md bg-neutral-900 text-white text-sm shadow-lg animate-fade-up">
          <Check className="w-4 h-4 text-emerald-400" />
          已保存更改
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmModal
        open={confirmOpen}
        title="确认删除工作区？"
        desc="此操作将永久删除「产品设计部」工作区下的全部文档、数据源、成员与历史记录。删除后无法恢复。请输入工作区名称以继续。"
        confirmText="我已了解风险，立即删除"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
      />
    </div>
  )
}
