import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText,
  Save,
  Sparkles,
  GitBranch,
  Share2,
  MoreHorizontal,
  ChevronDown,
  Bold,
  Italic,
  Heading1,
  List,
  Code,
  Quote,
  Link as LinkIcon,
  Image,
  Undo2,
  Redo2,
  Eye,
  PenTool,
  Users,
  MessageCircle,
  Plus,
  Wand2,
} from 'lucide-react'
import { fetchDocument, fetchVersions, fetchTeam } from '../api/stubs.js'
import { editorOpenDocId } from '../mock/data.js'

/* ---------- 轻量 Markdown → HTML 转换 ---------- */
function markdownToHtml(md) {
  const lines = md.split('\n')
  const html = []
  let i = 0

  const inline = (text) => {
    // code spans
    let t = text.replace(/`([^`]+)`/g, '<code>$1</code>')
    // bold
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // links [text](url)
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    return t
  }

  while (i < lines.length) {
    const line = lines[i]

    // 代码块
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      html.push(
        `<pre><code${lang ? ` class="language-${lang}"` : ''}>`
      )
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        html.push(lines[i])
        i++
      }
      html.push('</code></pre>')
      i++
      continue
    }

    // 一级标题（文档标题，直接当 h1）
    if (line.startsWith('# ')) {
      html.push(`<h1>${inline(line.slice(2))}</h1>`)
      i++
      continue
    }
    if (line.startsWith('## ')) {
      html.push(`<h2>${inline(line.slice(3))}</h2>`)
      i++
      continue
    }
    if (line.startsWith('### ')) {
      html.push(`<h3>${inline(line.slice(4))}</h3>`)
      i++
      continue
    }

    // 引用
    if (line.startsWith('> ')) {
      const quoteLines = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2))
        i++
      }
      html.push(`<blockquote>${inline(quoteLines.join(' '))}</blockquote>`)
      continue
    }

    // 无序列表
    if (/^[-*] /.test(line)) {
      html.push('<ul>')
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        html.push(`<li>${inline(lines[i].slice(2))}</li>`)
        i++
      }
      html.push('</ul>')
      continue
    }

    // 有序列表
    if (/^\d+\. /.test(line)) {
      html.push('<ol>')
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        html.push(`<li>${inline(lines[i].replace(/^\d+\. /, ''))}</li>`)
        i++
      }
      html.push('</ol>')
      continue
    }

    // 空行
    if (line.trim() === '') {
      i++
      continue
    }

    // 表格（简单处理）
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const headerCells = line.split('|').map((c) => c.trim()).filter(Boolean)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(lines[i].split('|').map((c) => c.trim()).filter(Boolean))
        i++
      }
      html.push('<table><thead><tr>')
      headerCells.forEach((c) => html.push(`<th>${inline(c)}</th>`))
      html.push('</tr></thead><tbody>')
      rows.forEach((row) => {
        html.push('<tr>')
        row.forEach((c) => html.push(`<td>${inline(c)}</td>`))
        html.push('</tr>')
      })
      html.push('</tbody></table>')
      continue
    }

    // 段落
    html.push(`<p>${inline(line)}</p>`)
    i++
  }

  return html.join('\n')
}

/* ---------- 从 Markdown 提取大纲 ---------- */
function extractOutline(md) {
  const headings = []
  const lines = md.split('\n')
  lines.forEach((line) => {
    if (line.startsWith('## ')) {
      headings.push({ level: 2, text: line.slice(3).trim() })
    } else if (line.startsWith('### ')) {
      headings.push({ level: 3, text: line.slice(4).trim() })
    }
  })
  return headings
}

/* ---------- 协作评论 Mock ---------- */
const mockComments = [
  {
    id: 'c-1',
    author: { name: '林川', color: '#0ea5e9' },
    text: '这里 mTLS 的配置路径是不是应该放在 operations 目录？和部署指引放一起可能更清晰。',
    time: '2 小时前',
  },
  {
    id: 'c-2',
    author: { name: '赵一鸣', color: '#f59e0b' },
    text: 'MQTT QoS 1 的消息重复问题，要不要在数据面加一个幂等键？',
    time: '昨天',
  },
  {
    id: 'c-3',
    author: { name: '苏筱', color: '#ec4899' },
    text: '整体结构很清晰 👍 控制面/数据面分离的图可以考虑补一张。',
    time: '3 天前',
  },
]

/* ---------- Skeleton ---------- */
function EditorSkeleton() {
  return (
    <div className="flex h-full">
      {/* Outline skeleton */}
      <aside className="w-[200px] border-r border-neutral-200 bg-white flex flex-col p-4 gap-3">
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
        <div className="mt-4 space-y-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="skeleton h-3" style={{ width: `${80 - n * 8}%` }} />
          ))}
        </div>
      </aside>

      {/* Center skeleton */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-11 border-b border-neutral-200 bg-neutral-50 flex items-center gap-3 px-4">
          <div className="skeleton h-6 w-40" />
        </div>
        <div className="flex-1 p-8 space-y-3">
          <div className="skeleton h-8 w-2/3" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-11/12" />
          <div className="skeleton h-4 w-4/5" />
          <div className="skeleton h-24 w-full mt-4" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-3/4" />
        </div>
      </div>

      {/* Right panel skeleton */}
      <aside className="w-[320px] border-l border-neutral-200 bg-white flex flex-col p-4 gap-3">
        <div className="skeleton h-6 w-1/2" />
        <div className="skeleton h-24 w-full" />
      </aside>
    </div>
  )
}

/* ---------- 主页面 ---------- */
export default function Editor() {
  const [loading, setLoading] = useState(true)
  const [doc, setDoc] = useState(null)
  const [versions, setVersions] = useState([])
  const [team, setTeam] = useState([])

  // 编辑/预览切换
  const [viewMode, setViewMode] = useState('preview') // 'preview' | 'edit'
  // 右侧面板 tab
  const [rightTab, setRightTab] = useState('ai') // 'ai' | 'comments' | 'history'
  // AI 输入
  const [aiInput, setAiInput] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [d, v, t] = await Promise.all([
        fetchDocument(editorOpenDocId),
        fetchVersions(editorOpenDocId),
        fetchTeam(),
      ])
      if (cancelled) return
      setDoc(d)
      setVersions(v)
      setTeam(t)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const outline = useMemo(() => (doc ? extractOutline(doc.content) : []), [doc])

  const htmlContent = useMemo(() => (doc ? markdownToHtml(doc.content) : ''), [doc])

  // 协作者
  const collaborators = useMemo(() => {
    if (!doc || !team.length) return []
    return (doc.collaborators || [1, 2, 3])
      .map((id) => team.find((m) => m.id === id))
      .filter(Boolean)
  }, [doc, team])

  if (loading || !doc) return <EditorSkeleton />

  const projectName =
    doc.projectId === 'p-002' ? 'EdgeAgent Platform' :
    doc.projectId === 'p-001' ? '个人知识库' :
    doc.projectId === 'p-003' ? 'DeepWiki Blog' :
    doc.projectId === 'p-004' ? 'Harness Specs' :
    doc.projectId === 'p-005' ? 'Nova 前端仓库 /docs' :
    doc.projectId === 'p-006' ? 'DataHub Wiki' :
    doc.projectId === 'p-007' ? 'OpenCloud 官网' :
    doc.projectId === 'p-008' ? 'Weekly Engineering Notes' : '未命名项目'

  const statusPill = {
    synced: { label: '已同步', cls: 'tag-success' },
    modified: { label: '本地修改', cls: 'tag-warning' },
    conflict: { label: '冲突', cls: 'tag-danger' },
    untracked: { label: '未追踪', cls: 'tag-neutral' },
  }[doc.status] || { label: doc.status, cls: 'tag-neutral' }

  return (
    <div className="flex h-full animate-fade-up">
      {/* ================ Pane 1 — Outline ================ */}
      <aside className="w-[200px] border-r border-neutral-200 bg-white flex flex-col shrink-0">
        {/* 顶部面包屑 */}
        <div className="sticky top-0 bg-white px-4 pt-4 pb-3 border-b border-neutral-100">
          <Link
            to="/library"
            className="text-xs text-primary-600 hover:text-primary-700 hover:underline inline-flex items-center gap-1 mb-2"
          >
            ← 返回文档库
          </Link>
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 truncate">
            <FileText size={12} />
            <span className="truncate">{projectName}</span>
          </div>
          <div className="text-[11px] text-neutral-400 truncate mt-0.5">
            {doc.path}
          </div>
        </div>

        {/* Outline 列表 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-neutral-400 mb-2">
            Outline
          </div>
          {outline.length === 0 ? (
            <div className="text-xs text-neutral-400">暂无标题</div>
          ) : (
            <ul className="space-y-0.5">
              {outline.map((item, idx) => (
                <li key={idx}>
                  <a
                    href={`#h-${idx}`}
                    className={`block text-sm text-neutral-600 hover:text-primary-600 hover:bg-primary-50 rounded px-2 py-1 truncate transition ${
                      item.level === 3 ? 'pl-5 text-xs' : ''
                    }`}
                  >
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 底部 git 状态 */}
        <div className="px-4 py-3 border-t border-neutral-100">
          <div className={`tag ${statusPill.cls} w-full justify-center mb-2`}>
            {statusPill.label}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
            <GitBranch size={11} />
            <span className="truncate">main</span>
          </div>
          <div className="text-[11px] text-neutral-400 mt-1">
            v{doc.version} · {doc.wordCount} 字
          </div>
        </div>
      </aside>

      {/* ================ Pane 2 — Center Editor ================ */}
      <section className="flex-1 min-w-0 flex flex-col bg-surface-subtle">
        {/* Toolbar */}
        <div className="h-11 bg-neutral-50 border-b border-neutral-200 flex items-center gap-2 px-3 shrink-0">
          {/* 图标按钮组 */}
          <div className="flex items-center gap-0.5">
            {[Bold, Italic, Heading1, List, Code, Quote, LinkIcon, Image].map(
              (Icon, i) => (
                <button
                  key={i}
                  type="button"
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-neutral-200 text-neutral-600 hover:text-neutral-800 transition"
                >
                  <Icon size={15} />
                </button>
              )
            )}
            <div className="w-px h-4 bg-neutral-200 mx-1" />
            <button
              type="button"
              disabled
              className="w-7 h-7 flex items-center justify-center rounded text-neutral-300 cursor-not-allowed"
              title="撤销"
            >
              <Undo2 size={15} />
            </button>
            <button
              type="button"
              disabled
              className="w-7 h-7 flex items-center justify-center rounded text-neutral-300 cursor-not-allowed"
              title="重做"
            >
              <Redo2 size={15} />
            </button>
          </div>

          {/* 中心 tab 切换 */}
          <div className="flex-1 flex items-center justify-center">
            <div className="inline-flex items-center bg-white border border-neutral-200 rounded-md p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('edit')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition ${
                  viewMode === 'edit'
                    ? 'bg-neutral-900 text-white shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <PenTool size={13} />
                编辑
              </button>
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition ${
                  viewMode === 'preview'
                    ? 'bg-neutral-900 text-white shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <Eye size={13} />
                预览
              </button>
            </div>
          </div>

          {/* 右侧操作 */}
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn-primary">
              <Save size={14} />
              保存
            </button>
            <button type="button" className="btn-secondary">
              <GitBranch size={14} />
              分支
              <ChevronDown size={12} />
            </button>
            <button type="button" className="btn-ghost">
              <Share2 size={14} />
            </button>
            <button type="button" className="btn-ghost !px-2">
              <MoreHorizontal size={15} />
            </button>
          </div>
        </div>

        {/* 文档内容 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="max-w-[760px] mx-auto py-8 px-10">
            {viewMode === 'edit' ? (
              <pre className="font-mono text-[13px] leading-6 text-neutral-800 whitespace-pre-wrap break-words">
                {doc.content}
              </pre>
            ) : (
              <article
                className="prose-doc"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            )}
          </div>
        </div>

        {/* 底部协作栏 */}
        <div className="h-10 border-t border-neutral-200 bg-white flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5">
              {collaborators.slice(0, 5).map((m) => (
                <div
                  key={m.id}
                  className="relative w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-semibold text-white"
                  style={{ background: m.avatarColor }}
                  title={m.name}
                >
                  {m.name.slice(-1)}
                  {m.online && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-white" />
                  )}
                </div>
              ))}
              {collaborators.length > 5 && (
                <div className="w-6 h-6 rounded-full border-2 border-white bg-neutral-200 flex items-center justify-center text-[10px] font-semibold text-neutral-600">
                  +{collaborators.length - 5}
                </div>
              )}
            </div>
            <Users size={13} className="text-neutral-400" />
            <span className="text-xs text-neutral-500">{collaborators.length} 人协作</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
            <MessageCircle size={13} />
            <span>{mockComments.length} 条评论</span>
          </div>
        </div>
      </section>

      {/* ================ Pane 3 — AI / Collaborative Right ================ */}
      <aside className="w-[320px] border-l border-neutral-200 bg-white flex flex-col shrink-0">
        {/* Tabs */}
        <div className="flex border-b border-neutral-200">
          {[
            { key: 'ai', label: 'AI 助手', icon: Sparkles },
            { key: 'comments', label: '评论', icon: MessageCircle },
            { key: 'history', label: '历史', icon: GitBranch },
          ].map((t) => {
            const Icon = t.icon
            const active = rightTab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setRightTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition relative ${
                  active
                    ? 'text-primary-700'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <Icon size={14} />
                {t.label}
                {active && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary-500 rounded-t" />
                )}
              </button>
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* AI Tab */}
          {rightTab === 'ai' && (
            <div className="p-4 space-y-4">
              {/* Header */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-400 to-primary-500 flex items-center justify-center">
                  <Sparkles size={14} className="text-white" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-neutral-800">DocVault AI</div>
                  <div className="text-[11px] text-neutral-400">基于当前文档上下文</div>
                </div>
              </div>

              {/* 输入 */}
              <div className="card p-2 focus-within:border-primary-400 transition">
                <textarea
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder="让 AI 帮你写一段..."
                  rows={3}
                  className="w-full text-sm text-neutral-800 placeholder:text-neutral-400 resize-none outline-none bg-transparent p-1"
                />
                <div className="flex items-center justify-between pt-1 border-t border-neutral-100">
                  <span className="text-[11px] text-neutral-400">⌘/ 唤起命令</span>
                  <button
                    type="button"
                    className="w-7 h-7 rounded-md bg-primary-500 text-white flex items-center justify-center hover:bg-primary-600 transition disabled:opacity-40"
                    disabled={!aiInput.trim()}
                  >
                    <Wand2 size={13} />
                  </button>
                </div>
              </div>

              {/* 预设建议 */}
              <div>
                <div className="text-[11px] font-semibold tracking-wider uppercase text-neutral-400 mb-2">
                  快速操作
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['总结文档', '优化段落', '翻译为英文'].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setAiInput(chip)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-neutral-100 hover:bg-primary-50 hover:text-primary-700 text-xs text-neutral-600 transition"
                    >
                      <Plus size={10} />
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI mock 回复 */}
              <div className="bg-gradient-to-br from-violet-50 to-sky-50 border border-neutral-200 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles size={12} className="text-primary-500" />
                  <span className="text-[11px] font-semibold text-neutral-700">AI 回复</span>
                </div>
                <p className="text-xs text-neutral-700 leading-relaxed">
                  根据当前文档，我总结了三个核心要点：
                </p>
                <ul className="mt-1.5 space-y-1 text-xs text-neutral-700">
                  <li>
                    <span className="text-primary-600 font-medium">·</span>{' '}
                    EdgeAgent 采用控制面 / 数据面分离架构，控制面负责策略与同步
                  </li>
                  <li>
                    <span className="text-primary-600 font-medium">·</span>{' '}
                    数据面运行在边缘节点，基于 MQTT QoS 1 通信
                  </li>
                  <li>
                    <span className="text-primary-600 font-medium">·</span>{' '}
                    核心组件：controller + agent + mqtt broker
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* Comments Tab */}
          {rightTab === 'comments' && (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-semibold tracking-wider uppercase text-neutral-400">
                  {mockComments.length} 条评论
                </div>
                <button type="button" className="btn-ghost !px-2 !py-1 text-[11px]">
                  <Plus size={12} />
                  新建
                </button>
              </div>
              {mockComments.map((c) => (
                <div key={c.id} className="card p-3">
                  <div className="flex items-start gap-2.5">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
                      style={{ background: c.author.color }}
                    >
                      {c.author.name.slice(-1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-neutral-800">
                          {c.author.name}
                        </span>
                        <span className="text-[11px] text-neutral-400">{c.time}</span>
                      </div>
                      <p className="text-xs text-neutral-600 leading-relaxed mt-1">
                        {c.text}
                      </p>
                      <button
                        type="button"
                        className="mt-2 text-[11px] text-neutral-400 hover:text-primary-600 transition"
                      >
                        回复
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* History Tab */}
          {rightTab === 'history' && (
            <div className="p-4 space-y-0.5">
              <div className="text-[11px] font-semibold tracking-wider uppercase text-neutral-400 mb-2">
                版本历史
              </div>
              {versions.length === 0 ? (
                <div className="text-xs text-neutral-400">暂无历史记录</div>
              ) : (
                versions.map((v, i) => (
                  <button
                    key={v.id}
                    type="button"
                    className="w-full text-left px-2 py-2 rounded-md hover:bg-neutral-50 transition group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-neutral-400 group-hover:text-primary-600">
                        {v.commitHash}
                      </span>
                      {i === 0 && (
                        <span className="tag tag-primary !py-0 !px-1.5">最新</span>
                      )}
                      {v.branch !== 'main' && (
                        <span className="tag tag-neutral !py-0 !px-1.5">{v.branch}</span>
                      )}
                    </div>
                    <div className="text-xs text-neutral-700 mt-0.5 truncate">
                      {v.message}
                    </div>
                    <div className="text-[11px] text-neutral-400 mt-0.5">
                      {v.author} · {new Date(v.timestamp).toLocaleDateString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                      })}
                      {' '}
                      · <span className="text-emerald-600">+{v.additions}</span>{' '}
                      <span className="text-red-500">-{v.deletions}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
