// Async API stub layer for DocVault prototype.
// No real network calls — every function returns a mock result after simulated latency.
// Swap to real fetch() later: each stub is tagged with // TODO: replace with real API
// including intended HTTP method + path + request/response shape so backend handoff
// is mechanical.

import { DB, pushActivity, pushVersion } from '../mock/data.js'

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
