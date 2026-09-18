import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// 约定（SDD 3.2）：所有表含 id/created_at/updated_at；软删除仅 projects/documents。
// 领域枚举用 text + CHECK 表达（Drizzle 侧由 packages/shared 枚举守卫）。

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---- 检索扩展类型（SEARCH-VECTOR-DESIGN §5.1） ----
/** tsvector（全文检索生成列驱动类型） */
const tsvector = customType<{ data: string; driverData: string }>({ dataType: () => 'tsvector' });
/** pgvector 定长向量；pg 驱动序列化为 '[1,2,3]' 字面量 */
const vectorCol = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector(1024)', // 维度固定 1024（bge-m3 等）；换模型/维度 = vector-rebuild 全量重建（开放问题 Q1）
  toDriver: (v) => `[${v.join(',')}]`,
});

/** 知识库检索开关 + 向量构建参数（§5.1/§15）：fts 随写自动增量（生成列）；
 *  vector 按库显式开启；chunk 参数变更后需重建方生效（与 index_builds.params 比对提示） */
export interface ProjectSearchConfig {
  fts: boolean;
  vector: boolean;
  chunkTokens: number;
  overlapTokens: number;
}

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

// ---- 团队（TEAM-PERMISSIONS-DESIGN §3.1，类 GitLab Group，不含嵌套子团队） ----
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(), // 展示用短标识，缺省 t-<6hex>，可改
    description: text('description'),
    visibility: text('visibility').notNull().default('private'), // private | internal（v1 仅设置页暴露）
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id), // 团队主 owner（与 team_members.role='owner' 冗余，便于兜底查询）
    archived: boolean('archived').notNull().default(false), // 归档：团队只读，不可再建库/加成员
    // ---- 开放 API 团队令牌策略（OPEN-API-MCP-DESIGN §6.4，决议 3：企业组织规范钩子）----
    // source 预留：组织架构接入后可整体切换为从组织系统同步（本地校验逻辑不变）
    tokenPolicy: jsonb('token_policy')
      .notNull()
      .default({ allowTokens: true, maxScope: 'write', ipAllowlist: [], source: 'local' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [check('teams_visibility_check', sql`${t.visibility} IN ('private','internal')`)],
);

export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull().default('member'), // owner | maintainer | member
    invitedBy: uuid('invited_by').references(() => users.id),
    status: text('status').notNull().default('active'), // active | pending（v1 只写 active，为邮件邀请留口）
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('team_members_team_user_uq').on(t.teamId, t.userId),
    check('team_members_role_check', sql`${t.role} IN ('owner','maintainer','member')`),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color'),
    visibility: text('visibility').notNull().default('private'), // private | team-read | team-write | public-read | public-write（TEAM-PERMISSIONS §3.2）
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
      .references(() => users.id), // 语义收敛为「创建人/责任人」：owner_type='team' 时权限主体走团队（owner_team_id）
    ownerType: text('owner_type').notNull().default('user'), // user | team
    ownerTeamId: uuid('owner_team_id').references(() => teams.id), // 仅 owner_type='team' 时非空
    archived: boolean('archived').notNull().default(false),
    // 检索开关（SEARCH-VECTOR-DESIGN §5.1）：{fts:true,vector:false} 缺省；vector 开启触发自动全量构建
    searchConfig: jsonb('search_config')
      .$type<ProjectSearchConfig>()
      .notNull()
      .default({ fts: true, vector: false, chunkTokens: 512, overlapTokens: 50 }),
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
    check('projects_visibility_check', sql`${t.visibility} IN ('private','team-read','team-write','public-read','public-write')`),
    check('projects_owner_check', sql`(${t.ownerType} = 'user') = (${t.ownerTeamId} IS NULL)`),
    check(
      'projects_team_scope_check',
      sql`${t.visibility} NOT IN ('team-read','team-write') OR ${t.ownerType} = 'team'`,
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
    kind: text('kind').notNull().default('text'), // text | binary（文件管理重构 P0）
    ext: text('ext'), // 小写无点扩展名，存量 md 回填（P0）
    mime: text('mime'),
    size: bigint('size', { mode: 'number' }).notNull().default(0), // 字节；text=字符字节数，binary=blob 大小
    storageRef: text('storage_ref'), // 二进制内容寻址引用（P2 落 blob，一期始终 NULL）
    status: text('status').notNull().default('untracked'), // untracked | synced | modified | conflict
    tags: text('tags').array().notNull().default([]), // 文档标签（PLAN 3.4 标签三维 / 5.2.1）
    wordCount: integer('word_count').notNull().default(0),
    updatedBy: uuid('updated_by').references(() => users.id),
    // 全文索引生成列（ADR-S1）：title 权重 A / content 权重 B，随写自动更新 = 天然增量零管道。
    // 分词配置 chinese_zh 由迁移 0008 保证存在（zhparser 可用则中文分词，否则 COPY simple 兜底）。
    searchVector: tsvector('search_vector').generatedAlwaysAs(sql`
      setweight(coalesce(to_tsvector('chinese_zh', coalesce(title, '')), ''::tsvector), 'A') ||
      setweight(coalesce(to_tsvector('chinese_zh', coalesce(content, '')), ''::tsvector), 'B')
    `),
    deletedAt: ts('deleted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('documents_project_path_uq').on(t.projectId, t.path),
    index('documents_search_vector_gin').using('gin', t.searchVector),
    index('documents_title_trgm_gin').using('gin', sql`${t.title} gin_trgm_ops`),
    check('documents_kind_check', sql`${t.kind} IN ('text','binary')`),
    check(
      'documents_storage_ref_check',
      sql`(${t.kind} = 'binary') = (${t.storageRef} IS NOT NULL)`,
    ),
  ],
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
  storageRef: text('storage_ref'), // 二进制版本快照引用（P2）；text 版本始终 NULL
  size: bigint('size', { mode: 'number' }).notNull().default(0),
  changedSummary: jsonb('changed_summary'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ---- Git 提交聚合（GIT-COMMIT-COALESCING-DESIGN §5）：待提交操作台账 ----
// 写路径只记台账 + 防抖入队，worker『git-flush』队列在窗口关闭时折叠为一个提交。
// 窗口起点/最后活动由未消费行的 created_at 推导，无需独立窗口表；
// checkpoint 行承载「立即提交」意图与备注，不产生文件变更。台账型流水表，无 updated_at。
export const gitPendingOps = pgTable(
  'git_pending_ops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'number' }).notNull(), // 批量插入同 createdAt 时保序，折叠定序用
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    documentId: uuid('document_id').references(() => documents.id),
    path: text('path').notNull(), // checkpoint 行为空串
    op: text('op').notNull(), // upsert | delete | move | checkpoint
    fromPath: text('from_path'), // move 专用
    kind: text('kind').notNull().default('text'), // text | binary（binary 不入 git，仅 NAS 镜像）
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    actorName: text('actor_name').notNull(), // 冗余，提交信息组装免 join
    actorEmail: text('actor_email').notNull().default(''), // Co-authored-by trailer 用
    message: text('message'), // 用户备注（窗口注解，flush 时进提交 body）
    commitHash: text('commit_hash'), // 消费后回填
    consumedAt: ts('consumed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('git_pending_ops_op_check', sql`${t.op} IN ('upsert','delete','move','checkpoint')`),
    index('git_pending_ops_pending_idx').on(t.projectId, t.seq).where(sql`consumed_at IS NULL`),
    index('git_pending_ops_document_idx').on(t.documentId).where(sql`consumed_at IS NULL`),
  ],
);

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

// ---- 整库导出（设计文档 §4.1-F18）：tar.gz 归档到 NAS exports 目录，7 天过期清理 ----
export const exportJobs = pgTable('export_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  status: text('status').notNull().default('queued'), // queued | running | done | failed
  format: text('format').notNull().default('tar.gz'),
  path: text('path'),          // NAS 导出相对路径：exports/<projectSlug>-<id8>-<timestamp>.tar.gz
  size: bigint('size', { mode: 'number' }), // 字节
  error: text('error'),
  createdBy: uuid('created_by').references(() => users.id),
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

// ---------------------------------------------------------------------------
// 向量索引（SEARCH-VECTOR-DESIGN §5.1 / ADR-S2、ADR-S3）
//   chunk 级语义检索：markdown 感知切分（shared chunkMarkdown），检索按文档聚合取最大分。
//   content_hash 支撑增量去重（未变 chunk 不重复 embedding）；embedding 可空 =
//   「待嵌入」（构建中断/模型切换），由 search-reconcile 对账补齐，无需额外状态表。
// ---------------------------------------------------------------------------

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    // 冗余 project_id：权限预过滤直接落在 chunk 表，不 join documents（ADR-S4）
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chunkNo: integer('chunk_no').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(), // sha256(content)；增量去重键
    headingPath: text('heading_path'), // 所在标题链（"部署/回滚"），进 snippet 上下文
    embedding: vectorCol('embedding'), // 1024 维；NULL=待嵌入
    embeddingModel: text('embedding_model'), // 产出模型；换模型重建的判定键（R6）
    tokenCount: integer('token_count').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('document_chunks_doc_no_uq').on(t.documentId, t.chunkNo),
    index('document_chunks_project_idx').on(t.projectId, t.documentId),
    index('document_chunks_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

// ---------------------------------------------------------------------------
// 构建台账（§6.3 自动构建）：仿 ai_classify_runs；cursor_doc 断点续跑游标。
// ---------------------------------------------------------------------------

export const indexBuilds = pgTable(
  'index_builds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('vector'), // vector | vector-rebuild
    status: text('status').notNull().default('pending'), // pending | running | done | failed | canceled
    // 构建时参数快照（{chunkTokens,overlapTokens,model}）：与当前项目配置比对 → "配置已变更需重建"提示
    params: jsonb('params').notNull().default({}),
    totalDocs: integer('total_docs').notNull().default(0),
    doneDocs: integer('done_docs').notNull().default(0),
    failedDocs: integer('failed_docs').notNull().default(0),
    cursorDoc: uuid('cursor_doc'), // 续跑游标（按 id 排序的下一个起点）
    error: text('error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    check('index_builds_kind_check', sql`${t.kind} IN ('vector','vector-rebuild')`),
    check('index_builds_status_check', sql`${t.status} IN ('pending','running','done','failed','canceled')`),
  ],
);

// ---------------------------------------------------------------------------
// 开放 API 机器身份与治理（OPEN-API-MCP-DESIGN §6，2026-09-15 评审决议 1/3/8）
// ---------------------------------------------------------------------------

/** PAT（Personal Access Token）：act-as-user 机器凭据。
 *  明文 `ewk_<base64url(32B)>` 仅签发响应出现一次；库内只存 sha256 + 前 12 字符前缀。 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenPrefix: text('token_prefix').notNull(), // 前 12 字符：列表展示/定位，不构成可还原信息
    tokenHash: text('token_hash').notNull(), // sha256(token) hex；认证按哈希等值查
    scopes: text('scopes').array().notNull(), // 'search' | 'read' | 'write' 的子集
    expiresAt: ts('expires_at'), // NULL = 永不过期（UI 引导 1 年）
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    lastIp: text('last_ip'), // 最近使用来源（审计辅助）
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('api_tokens_hash_uq').on(t.tokenHash)],
);

/** per-token 用量日汇总（决议 8：健全管理与审计）：开放面每请求 UPSERT 累加；
 *  限流拒绝计 rejectedCount。管理端「开放接口」页签与设置页消费。 */
export const apiTokenUsage = pgTable(
  'api_token_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    day: text('day').notNull(), // UTC 日期 YYYY-MM-DD
    searchCount: integer('search_count').notNull().default(0),
    readCount: integer('read_count').notNull().default(0),
    writeCount: integer('write_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('api_token_usage_token_day_uq').on(t.tokenId, t.day)],
);

/** 跨副本精确限流（OPEN-API-MCP-DESIGN ADR-O7 增补：server×2 硬配额）：
 *  固定窗口计数（bucket_key × window_start 唯一）；单语句原子 check-and-increment（CAS 语义
 *  的 CASE UPDATE），限额 = 读取 returned count ≤ limit。窗口粒度 1 分钟，历史窗口概率性清理。 */
export const apiRateWindows = pgTable(
  'api_rate_windows',
  {
    bucketKey: text('bucket_key').notNull(), // 't:search:<tokenId>' | 'ip:<addr>'
    windowStart: ts('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucketKey, t.windowStart] })],
);

/** 写接口幂等键（评审决议 6 落地）：Idempotency-Key × token 唯一；仅存 2xx 响应快照，
 *  重放返回原响应（Idempotency-Replayed 头），method/path 不一致 → 409 IDEMPOTENCY_CONFLICT。 */
export const apiIdempotencyKeys = pgTable(
  'api_idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    idemKey: text('idem_key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    status: integer('status').notNull(),
    responseBody: text('response_body').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('api_idempotency_uq').on(t.tokenId, t.idemKey)],
);
