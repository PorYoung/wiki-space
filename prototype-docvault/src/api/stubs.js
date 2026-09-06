// Async API stub layer for DocVault prototype.
// No real network calls — every function returns a mock result after simulated latency.
// Swap to real fetch() later: each stub is tagged with // TODO: replace with real API
// including intended HTTP method + path + request/response shape so backend handoff
// is mechanical.

import { DB, pushActivity, pushVersion } from '../mock/data.js'
import { starterPacks, graphData, importJobs, aiClassifyRuns } from '../mock/data.js'

/**
 * Wait for `ms` milliseconds. Useful to simulate network latency in prototypes.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

// TODO: replace with real API
// GET /api/projects
// Response: { projects: Project[] }
export async function fetchProjects() {
  await delay(300)
  return DB.projects
}

// TODO: replace with real API
// GET /api/projects/:id
// Response: Project
export async function fetchProject(id) {
  await delay(300)
  return DB.projects.find((p) => p.id === id) || null
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

// TODO: replace with real API
// GET /api/documents?projectId=&status=&q=
// Request query: { projectId?: string, status?: string, q?: string }
// Response: { documents: Document[] }
export async function fetchDocuments({ projectId, status, q } = {}) {
  await delay(300)
  let list = DB.documents
  if (projectId) list = list.filter((d) => d.projectId === projectId)
  if (status) list = list.filter((d) => d.status === status)
  if (q) {
    const needle = q.toLowerCase()
    list = list.filter((d) => d.title.toLowerCase().includes(needle))
  }
  return list
}

// TODO: replace with real API
// GET /api/documents/:id
// Response: Document (includes content, unlike list endpoint)
export async function fetchDocument(id) {
  await delay(400)
  return DB.documents.find((d) => d.id === id) || null
}

// TODO: replace with real API
// PATCH /api/documents/:id
// Request body: Partial<Document> (patch, merged server-side)
// Response: Document (updated; version bumped, activity appended)
export async function saveDocument(id, patch) {
  await delay(500)
  const doc = DB.documents.find((d) => d.id === id)
  if (!doc) return null
  Object.assign(doc, patch, {
    version: doc.version + 1,
    updatedAt: new Date().toISOString(),
  })
  pushVersion(id, patch.summary || '未命名修改')
  pushActivity({ actor: doc.owner, action: 'edited', target: id, at: new Date().toISOString() })
  return doc
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

// TODO: replace with real API
// GET /api/documents/:docId/versions
// Response: { versions: Version[] }
export async function fetchVersions(docId) {
  await delay(250)
  return DB.versions.filter((v) => v.docId === docId)
}

// ---------------------------------------------------------------------------
// Team / Workspace
// ---------------------------------------------------------------------------

// TODO: replace with real API
// GET /api/team
// Response: { members: Member[] }
export async function fetchTeam() {
  await delay(200)
  return DB.team
}

// TODO: replace with real API
// GET /api/templates
// Response: { templates: Template[] }
export async function fetchTemplates() {
  await delay(150)
  return DB.templates
}

// ---------------------------------------------------------------------------
// Sources / Sync
// ---------------------------------------------------------------------------

// TODO: replace with real API
// GET /api/sources
// Response: { sources: Source[] }
export async function fetchSources() {
  await delay(250)
  return DB.sources
}

// TODO: replace with real API
// POST /api/sources
// Request body: Source （git 或 database）
// Response: Source（新创建的数据源，含 id/status）
export async function createSource(payload) {
  await delay(500)
  const id = `s-${Date.now().toString().slice(-5)}`
  const status = 'connected'
  const now = new Date().toISOString()

  let source
  if (payload.type === 'git') {
    source = {
      id,
      name: payload.name || 'Git 仓库',
      type: 'git',
      url: payload.url,
      branch: payload.branch || 'main',
      authType: payload.authType || 'ssh',
      username: payload.username || null,
      // token/password 不在前端 mock 中持久化（真实场景走加密存储）
      status,
      lastSync: now,
      description: payload.description || null,
    }
  } else if (payload.type === 'database') {
    source = {
      id,
      name: payload.name || `${payload.dbType || 'database'} 连接`,
      type: 'database',
      dbType: payload.dbType || 'mysql',
      host: payload.host,
      port: payload.port || null,
      database: payload.database,
      table: payload.table || null,
      username: payload.username || null,
      status,
      lastSync: now,
      description: payload.description || null,
    }
  } else {
    source = {
      id,
      name: payload.name || '数据源',
      type: payload.type || 'web-link',
      status,
      lastSync: now,
      ...payload,
    }
  }

  DB.sources.push(source)
  return source
}

// TODO: replace with real API
// POST /api/sources/:id/sync
// Response: Source (status transitions idle -> syncing -> synced/idle)
export async function syncSource(id) {
  const source = DB.sources.find((s) => s.id === id)
  if (!source) return null
  source.status = 'syncing'
  await delay(1200)
  source.status = 'synced'
  source.lastSyncedAt = new Date().toISOString()
  return source
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

// TODO: replace with real API
// GET /api/activities
// Response: { activities: Activity[] }
export async function fetchActivities() {
  await delay(200)
  return DB.activities
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

// TODO: replace with real API
// POST /api/preview
// Request body: { docId: string, templateId?: string }
// Response: { html: string }
export async function renderPreview(docId, templateId) {
  await delay(600)
  const doc = DB.documents.find((d) => d.id === docId)
  if (!doc) return ''
  // Very light mock "renderer" — turn markdown-ish headings into <h2>.
  const body = (doc.content || '')
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return `<h2>${line.slice(2)}</h2>`
      return `<p>${line}</p>`
    })
    .join('')
  return `
    <div class="prose-doc" data-doc-id="${docId}" data-template-id="${templateId || 't-plain'}">
      <h1>${doc.title}</h1>
      ${body}
    </div>
  `.trim()
}

// ---------------------------------------------------------------------------
// Realtime hook placeholder
// ---------------------------------------------------------------------------

// TODO: replace with real API — subscribe via WebSocket / SSE to collaboration events
// Signature intentionally mirrors a future EventSource-style subscription so swapping
// is mechanical: subscribe(fn) => unsubscribeFn.
export function subscribe(fn) {
  // eslint-disable-next-line no-console
  console.log('[stubs.subscribe] placeholder called; fn =', typeof fn === 'function' ? fn.name : fn)
  return () => { /* unsubscribe placeholder */ }
}

// ---------------------------------------------------------------------------
// Starter Packs（项目模板种子包）
// ---------------------------------------------------------------------------

// TODO: replace with real API
// GET /api/starter-packs
// Response: { starterPacks: StarterPack[] }
export async function fetchStarterPacks() {
  await delay(200)
  return starterPacks
}

// TODO: replace with real API
// POST /api/projects/init-from-starter
// Request body: { name, starterPackId, visibility, description?, sourceBackend?, sourceId?, localFolderPath? }
// Response: Project (新建项目 + 初始化好的目录骨架)
export async function initProjectFromStarter({
  name, starterPackId, visibility = 'private', description = '',
  sourceBackend = 'local', sourceId = null, localFolderPath = null,
}) {
  await delay(900)
  const pack = starterPacks.find((p) => p.id === starterPackId)
  const id = `p-${Date.now().toString().slice(-5)}`
  const colors = ['bg-violet-100', 'bg-sky-100', 'bg-emerald-100', 'bg-amber-100', 'bg-rose-100', 'bg-teal-100']
  const color = colors[Math.floor(Math.random() * colors.length)]

  // 根据 sourceBackend 确定 sourceType 和 sourceUrl
  let sourceType = 'local'
  const basePath = (localFolderPath || 'C:/Users/poryo/Documents/DocVault/').replace(/[\\/]+$/, '')
  let sourceUrl = `${basePath}/${name}`

  if (sourceBackend === 'git') {
    const src = DB.sources.find((s) => s.id === sourceId)
    sourceType = 'git'
    sourceUrl = src?.url || 'https://github.com/example/' + name + '.git'
  } else if (sourceBackend === 'database') {
    const src = DB.sources.find((s) => s.id === sourceId)
    sourceType = 'database'
    if (src) {
      sourceUrl = `${src.dbType || 'db'}://${src.host || ''}${src.port ? ':' + src.port : ''}/${src.database || ''}`
    }
  }

  return {
    id,
    name,
    description: description || pack?.description || '基于模板创建',
    icon: 'folder-kanban',
    sourceType,
    sourceUrl,
    sourceId: sourceId || null,
    lastSynced: new Date().toISOString(),
    docCount: pack?.docCount || 0,
    template: 'wiki',
    visibility,
    color,
    members: [1],
    starterPackId,
    initialized: true,
  }
}

// ---------------------------------------------------------------------------
// 知识图谱
// ---------------------------------------------------------------------------

// TODO: replace with real API
// GET /api/projects/:id/graph
// Query: { view?: 'explore' | 'orphans' | 'hubs' }
// Response: { nodes, edges, clusters, orphans, hubs, brokenEdges }
export async function fetchProjectGraph(projectId, view = 'explore') {
  await delay(400)
  const data = graphData[projectId] || { nodes: [], edges: [], clusters: [], orphans: [], hubs: [] }
  if (view === 'orphans') {
    return {
      ...data,
      nodes: data.nodes.filter((n) => data.orphans.includes(n.id)),
      edges: [],
    }
  }
  if (view === 'hubs') {
    return {
      ...data,
      nodes: data.nodes.filter((n) => data.hubs.includes(n.id)),
      edges: data.edges.filter((e) => data.hubs.includes(e.from) || data.hubs.includes(e.to)),
    }
  }
  return data
}

// ---------------------------------------------------------------------------
// AI 自动分类
// ---------------------------------------------------------------------------

// TODO: replace with real API
// GET /api/projects/:id/ai-classify/runs
// Response: { runs: AIClassifyRun[] }
export async function fetchAIClassifyRuns(projectId) {
  await delay(200)
  return aiClassifyRuns.filter((r) => r.projectId === projectId)
}

// TODO: replace with real API
// POST /api/projects/:id/ai-classify/run
// Request body: { scope: 'all' | 'inbox' | 'folders[]', tagsAuto, foldersAuto }
// Response: AIClassifyRun (任务立即返回，后续通过轮询或 SSE 通知进度)
export async function runAIClassify(projectId, options = {}) {
  await delay(1400)
  const run = {
    id: `ac-${Date.now()}`,
    projectId,
    scope: options.scope || 'all',
    classifierVersion: 'v2.3',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationSec: 12 + Math.floor(Math.random() * 30),
    stats: {
      scanned: 30 + Math.floor(Math.random() * 20),
      foldersCreated: Math.floor(Math.random() * 4),
      docsRelocated: 5 + Math.floor(Math.random() * 15),
      tagsAdded: 10 + Math.floor(Math.random() * 30),
    },
    status: 'completed',
    by: 'system',
  }
  aiClassifyRuns.unshift(run)
  return run
}

// ---------------------------------------------------------------------------
// 导入器（外部内容导入）
// ---------------------------------------------------------------------------

// TODO: replace with real API
// GET /api/projects/:id/imports
// Response: { jobs: ImportJob[] }
export async function fetchImportJobs(projectId) {
  await delay(200)
  return importJobs.filter((j) => j.projectId === projectId)
}

// TODO: replace with real API
// POST /api/projects/:id/imports/run
// Request body: { importer: 'web-crawler' | 'notion' | 'obsidian' | 'folder', sourceUrl, options? }
// Response: ImportJob (立即返回，后续异步推进)
export async function runImport(projectId, { importer, sourceUrl, title }) {
  const job = {
    id: `ij-${Date.now()}`,
    projectId,
    importer,
    sourceUrl,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    stats: { pagesFetched: 0, pagesImported: 0, skipped: 0, newDocs: 0 },
    title: title || sourceUrl,
  }
  importJobs.unshift(job)

  // 模拟异步完成
  const totalPages = importer === 'web-crawler' ? 30 + Math.floor(Math.random() * 60) : 60 + Math.floor(Math.random() * 80)
  let elapsed = 0
  const tick = 300
  const steps = 6
  const interval = setInterval(async () => {
    elapsed += tick
    const progress = Math.min(1, elapsed / (tick * steps))
    job.stats.pagesFetched = Math.round(totalPages * progress)
    job.stats.pagesImported = Math.round(totalPages * progress * 0.9)
    job.stats.newDocs = job.stats.pagesImported
    if (progress >= 1) {
      clearInterval(interval)
      job.status = 'completed'
      job.finishedAt = new Date().toISOString()
    }
  }, tick)

  return job
}
