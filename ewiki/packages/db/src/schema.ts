import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// 约定（SDD 3.2）：所有表含 id/created_at/updated_at；软删除仅 projects/documents。
// 领域枚举用 text + CHECK 表达（Drizzle 侧由 packages/shared 枚举守卫）。

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  globalRole: text('global_role').notNull().default('user'), // admin | user
  avatarUrl: text('avatar_url'),
  status: text('status').notNull().default('active'),
  ssoSubject: text('sso_subject'), // 企业 OA 对接预留（PRD 2.1）；LDAP 登录时落外部主体
  lastLoginAt: ts('last_login_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const userPrefs = pgTable('user_prefs', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  theme: text('theme').notNull().default('fresh-emerald'),
  appearance: text('appearance').notNull().default('system'),
  accent: text('accent').notNull().default('emerald'),
  fontSize: integer('font_size').notNull().default(2),
  prefs: jsonb('prefs').notNull().default({}),
});

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color'),
    visibility: text('visibility').notNull().default('private'), // private | team | public
    template: text('template'),
    // ---- 内嵌存储后端（git | local），1:1 从属于文档库，无独立 CRUD ----
    storageKind: text('storage_kind').notNull().default('local'), // git | local
    storageConnectionId: uuid('storage_connection_id').references(
      () => storageConnections.id,
    ),
    storageConfig: jsonb('storage_config').notNull().default({}), // git: {url,host,kind,namespace,repoName,autoCommit,path?}；local: {path?}
    defaultBranch: text('default_branch'),
    autoSync: boolean('auto_sync').notNull().default(false),
    intervalSeconds: integer('interval_seconds').notNull().default(0), // 1800/3600/21600/86400/0（仅持久化偏好，无调度器）
    storageStatus: text('storage_status').notNull().default('connected'), // connected | synced | syncing | error
    lastSyncedAt: ts('last_synced_at'),
    lastError: text('last_error'),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    archived: boolean('archived').notNull().default(false),
    deletedAt: ts('deleted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('projects_storage_kind_check', sql`${t.storageKind} IN ('git','local')`),
    check(
      'projects_storage_status_check',
      sql`${t.storageStatus} IN ('connected','synced','syncing','error')`,
    ),
    check(
      'projects_storage_connection_check',
      sql`(${t.storageKind} = 'local') = (${t.storageConnectionId} IS NULL)`,
    ),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull().default('guest'), // owner | maintainer | editor | guest
    invitedBy: uuid('invited_by').references(() => users.id),
    status: text('status').notNull().default('active'), // active | pending
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('project_members_project_user_uq').on(t.projectId, t.userId)],
);

export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    trigger: text('trigger').notNull(), // manual | schedule（预留，当前无调度器）| push
    commitHash: text('commit_hash'),
    status: text('status').notNull().default('queued'), // queued | running | succeeded | failed
    stats: jsonb('stats'),
    error: text('error'),
    idempotencyKey: text('idempotency_key'), // 历史保留列；投递幂等由 pg-boss singletonKey 承载，DB 不再设唯一约束
    createdAt: ts('created_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    path: text('path').notNull(),
    title: text('title'),
    content: text('content'),
    contentHash: text('content_hash'),
    status: text('status').notNull().default('untracked'), // untracked | synced | modified | conflict
    tags: text('tags').array().notNull().default([]), // 文档标签（PLAN 3.4 标签三维 / 5.2.1）
    wordCount: integer('word_count').notNull().default(0),
    updatedBy: uuid('updated_by').references(() => users.id),
    deletedAt: ts('deleted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('documents_project_path_uq').on(t.projectId, t.path)],
);

export const documentVersions = pgTable('document_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  versionNo: integer('version_no').notNull(),
  commitHash: text('commit_hash'),
  authorId: uuid('author_id').references(() => users.id),
  authorNames: text('author_names').array().notNull().default([]), // 协同会话参与者（SDD 5.3）
  message: text('message'),
  content: text('content').notNull(),
  changedSummary: jsonb('changed_summary'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const documentLinks = pgTable('document_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromDocumentId: uuid('from_document_id')
    .notNull()
    .references(() => documents.id),
  toDocumentId: uuid('to_document_id').references(() => documents.id),
  externalUrl: text('external_url'),
  broken: boolean('broken').notNull().default(false), // 图谱断链（PRD F32）
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('tags_project_name_uq').on(t.projectId, t.name)],
);

export const documentTags = pgTable(
  'document_tags',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (t) => [t.documentId, t.tagId],
);

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  body: text('body').notNull(),
  resolved: boolean('resolved').notNull().default(false),
  anchor: jsonb('anchor'), // 锚点结构：PRD 8.4-1 遗留
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const ydocSnapshots = pgTable('ydoc_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  state: text('state').notNull(), // Y.Doc 二进制快照（base64）
  stateVector: text('state_vector').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const publishSites = pgTable('publish_sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id),
  mode: text('mode').notNull().default('hosted'), // hosted | custom
  slug: text('slug').unique(), // hosted 必填（PRD F35）
  addressMode: text('address_mode'), // subdomain | subpath（PRD R4）
  customDomain: text('custom_domain').unique(),
  customServer: text('custom_server'),
  schedule: text('schedule').notNull().default('manual'), // git-push | daily | manual
  autoSync: boolean('auto_sync').notNull().default(false),
  templateId: text('template_id'), // 发布模板 id（t-docs 等，GET /publish-templates 为权威源；PLAN 3.5 / 5.2.1）
  currentVersion: integer('current_version'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const publishJobs = pgTable('publish_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => publishSites.id),
  versionNo: integer('version_no').notNull(),
  contentHash: text('content_hash').notNull(),
  status: text('status').notNull().default('queued'), // queued | building | uploading | published | failed
  commitHash: text('commit_hash'),
  artifactRef: text('artifact_ref'), // 存储版本目录（S3/NAS 由 StorageService 决定）
  error: text('error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
});

export const importJobs = pgTable('import_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  importer: text('importer').notNull(), // web-crawler | notion | obsidian | folder
  params: jsonb('params').notNull().default({}),
  status: text('status').notNull().default('queued'),
  progress: integer('progress').notNull().default(0),
  stats: jsonb('stats'),
  error: text('error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
});

export const aiClassifyRuns = pgTable('ai_classify_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  scope: text('scope').notNull().default('all'), // all | inbox
  status: text('status').notNull().default('queued'),
  stats: jsonb('stats'), // scanned/folders_created/docs_relocated/tags_added（F26）
  startedBy: uuid('started_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
});

export const activities = pgTable('activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id),
  actorId: uuid('actor_id').references(() => users.id),
  verb: text('verb').notNull(), // comment | sync | publish | edit | delete | create
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id'),
  targetTitle: text('target_title'),
  meta: jsonb('meta').notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ---- 平台设置（系统管理运行时配置，key-value；变更走审计） ----
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ---- 用户存储源连接配置（需求 6：GitLab 连接配置；kind 扩展 gitea 兼容演示） ----
export const storageConnections = pgTable('storage_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('gitlab'), // gitlab | gitea
  baseUrl: text('base_url').notNull(),
  tokenEncrypted: text('token_encrypted').notNull(), // AES-256-GCM（secretbox）
  defaultNamespace: text('default_namespace'),
  status: text('status').notNull().default('unverified'), // unverified | ok | error
  lastCheckAt: ts('last_check_at'),
  lastCheckMsg: text('last_check_msg'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: uuid('resource_id'),
  ip: text('ip'),
  meta: jsonb('meta').notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
});
