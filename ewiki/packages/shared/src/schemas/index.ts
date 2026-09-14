import { z } from 'zod';

// ---- 枚举（与 SDD 3.2 CHECK 约束一致） ----
// 可见性五态（TEAM-PERMISSIONS-DESIGN §3.3 ADR-T1）：
//   private      私有：仅库成员（团队治理者亦不穿透，严格隔离）
//   team-read    团队·只读：团队成员可查看
//   team-write   团队·可写：团队成员可查看并编辑
//   public-read  公开·只读：所有登录用户可查看
//   public-write 公开·可写：所有登录用户可查看并编辑
//   team-* 档位要求库归属团队（owner_type='team'，DB CHECK 兜底）
export const Visibility = z.enum(['private', 'team-read', 'team-write', 'public-read', 'public-write']);
export type Visibility = z.infer<typeof Visibility>;

/** 团队内角色（组织层治理，不放大为库内角色；TEAM-PERMISSIONS-DESIGN §3.6） */
export const TeamRole = z.enum(['owner', 'maintainer', 'member']);
export type TeamRole = z.infer<typeof TeamRole>;

/** 库归属主体：user=个人库 / team=团队库 */
export const ProjectOwnerType = z.enum(['user', 'team']);
export type ProjectOwnerType = z.infer<typeof ProjectOwnerType>;

/** 团队自身可见性（v1 仅设置页暴露；目录发现留后续） */
export const TeamVisibility = z.enum(['private', 'internal']);
export type TeamVisibility = z.infer<typeof TeamVisibility>;

export const ProjectRole = z.enum(['owner', 'maintainer', 'editor', 'guest']);
export type ProjectRole = z.infer<typeof ProjectRole>;

export const GlobalRole = z.enum(['admin', 'user']);
export type GlobalRole = z.infer<typeof GlobalRole>;

export const StorageBackendKind = z.enum(['git', 'local']);
export type StorageBackendKind = z.infer<typeof StorageBackendKind>;

export const StorageStatus = z.enum(['connected', 'synced', 'syncing', 'error']);
export type StorageStatus = z.infer<typeof StorageStatus>;

export const StorageConnectionKind = z.enum(['gitlab', 'gitea']);
export type StorageConnectionKind = z.infer<typeof StorageConnectionKind>;

export const DocumentStatus = z.enum(['untracked', 'synced', 'modified', 'conflict']);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const SyncInterval = z.union([
  z.literal(1800),
  z.literal(3600),
  z.literal(21600),
  z.literal(86400),
  z.literal(0),
]); // 30m/1h/6h/24h/manual
export type SyncInterval = z.infer<typeof SyncInterval>;

export const ActivityVerb = z.enum(['comment', 'sync', 'publish', 'edit', 'delete', 'create']);
export type ActivityVerb = z.infer<typeof ActivityVerb>;

export const AddressMode = z.enum(['subdomain', 'subpath']);
export type AddressMode = z.infer<typeof AddressMode>;

export const PublishSchedule = z.enum(['git-push', 'daily', 'manual']);
export type PublishSchedule = z.infer<typeof PublishSchedule>;

export const Importer = z.enum(['web-crawler', 'notion', 'obsidian', 'folder']);
export type Importer = z.infer<typeof Importer>;

// ---- 用户（A4 / 团队 M1 只读） ----
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  globalRole: GlobalRole,
  avatarUrl: z.string().nullable().optional(),
});
export type User = z.infer<typeof UserSchema>;

// ---- 核心实体 ----
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  color: z.string().nullable(),
  visibility: Visibility,
  ownerType: ProjectOwnerType.default('user'),
  ownerTeamId: z.string().uuid().nullable().default(null),
  template: z.string().nullable(),
  storageKind: StorageBackendKind,
  storageConnectionId: z.string().uuid().nullable(),
  storageConfig: z.record(z.unknown()),
  defaultBranch: z.string().nullable(),
  autoSync: z.boolean(),
  intervalSeconds: z.number().int().nonnegative(),
  storageStatus: StorageStatus,
  lastSyncedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  docCount: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

// ---- 文档库存储后端：新建/更新请求体 ----
export const ProjectStorageInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('git'),
    connectionId: z.string().uuid(),
    repoName: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    defaultBranch: z.string().min(1).optional(),
    autoInit: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('local'),
    path: z.string().min(1).optional(),
  }),
]);
export type ProjectStorageInput = z.infer<typeof ProjectStorageInputSchema>;

export const CreateProjectSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    visibility: Visibility.optional(),
    template: z.string().nullable().optional(),
    storage: ProjectStorageInputSchema.optional(),
    /** 归属：默认个人库；team 时 ownerTeamId 必填（TEAM-PERMISSIONS-DESIGN §5.2 P1'） */
    ownerType: ProjectOwnerType.optional(),
    ownerTeamId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    const type = v.ownerType ?? 'user';
    if (type === 'team' && !v.ownerTeamId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ownerTeamId'], message: '归属团队时必须提供 ownerTeamId' });
    }
    if (type === 'user' && v.ownerTeamId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ownerTeamId'], message: '个人库不可携带 ownerTeamId' });
    }
    if (type === 'user' && v.visibility && v.visibility.startsWith('team-')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['visibility'], message: '个人库不支持团队档位（需先归属团队）' });
    }
  });
export type CreateProjectBody = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    visibility: Visibility.optional(),
    autoSync: z.boolean().optional(),
    intervalSeconds: SyncInterval.optional(),
    defaultBranch: z.string().min(1).nullable().optional(),
  })
  .strict();
export type UpdateProjectBody = z.infer<typeof UpdateProjectSchema>;

/** 检索配置（SEARCH-VECTOR-DESIGN §5.1 / §15）：knowledge-base 粒度开关 + 构建参数；
 *   fts 默认开（生成列零管道）；vector 默认关（embedding 按需外呼）；
 *   chunkTokens/overlapTokens 为向量构建参数，变更后需重建方生效（index_builds.params 比对提示）。 */
export const SearchConfigSchema = z.object({
  fts: z.boolean().default(true),
  vector: z.boolean().default(false),
  chunkTokens: z.number().int().min(128).max(2048).default(512),
  overlapTokens: z.number().int().min(0).max(256).default(50),
});
export type SearchConfig = z.infer<typeof SearchConfigSchema>;

export const UpdateSearchConfigSchema = z
  .object({
    vector: z.boolean().optional(),
    chunkTokens: z.number().int().min(128).max(2048).optional(),
    overlapTokens: z.number().int().min(0).max(256).optional(),
  })
  .strict()
  .refine((v) => v.vector !== undefined || v.chunkTokens !== undefined || v.overlapTokens !== undefined, {
    message: '至少提供一个字段',
  })
  .refine(
    (v) =>
      v.overlapTokens === undefined ||
      v.chunkTokens === undefined ||
      v.overlapTokens < (v.chunkTokens ?? Infinity),
    { message: 'overlapTokens 需小于 chunkTokens' },
  );
export type UpdateSearchConfigBody = z.infer<typeof UpdateSearchConfigSchema>;

/** 归属转移（TEAM-PERMISSIONS-DESIGN §5.2 P3'）：个人 → 团队 / 团队 → 个人（本人） */
export const TransferProjectSchema = z
  .object({
    targetType: ProjectOwnerType,
    targetTeamId: z.string().uuid().optional(),
    confirmed: z.literal(true), // 两步确认契约：前端必须显式确认
  })
  .superRefine((v, ctx) => {
    if (v.targetType === 'team' && !v.targetTeamId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetTeamId'], message: '转移到团队时必须提供 targetTeamId' });
    }
  });
export type TransferProjectBody = z.infer<typeof TransferProjectSchema>;

// ---- 团队（TEAM-PERMISSIONS-DESIGN §3.1 / §5.1） ----
export const CreateTeamSchema = z.object({
  name: z.string().min(1).max(60),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,39}$/)
    .optional(),
  description: z.string().max(300).nullable().optional(),
  visibility: TeamVisibility.optional(),
});
export type CreateTeamBody = z.infer<typeof CreateTeamSchema>;

export const UpdateTeamSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,39}$/)
      .optional(),
    description: z.string().max(300).nullable().optional(),
    visibility: TeamVisibility.optional(),
  })
  .strict();
export type UpdateTeamBody = z.infer<typeof UpdateTeamSchema>;

export const AddTeamMemberSchema = z.object({
  email: z.string().email(),
  role: TeamRole.optional(), // 默认 member；owner 授予仅 owner 可操作（路由层校验）
});
export type AddTeamMemberBody = z.infer<typeof AddTeamMemberSchema>;

export const UpdateTeamMemberSchema = z
  .object({
    role: TeamRole.optional(),
    remove: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.role && !v.remove) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'role 或 remove 至少提供一个' });
    }
  });
export type UpdateTeamMemberBody = z.infer<typeof UpdateTeamMemberSchema>;

export const TeamSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  visibility: TeamVisibility,
  archived: z.boolean(),
  ownerId: z.string().uuid(),
  memberCount: z.number().int().nonnegative().optional(),
  projectCount: z.number().int().nonnegative().optional(),
  myRole: TeamRole.nullable().optional(),
  createdAt: z.string().datetime(),
});
export type Team = z.infer<typeof TeamSchema>;

// FileKind 类型权威定义在 filetypes.ts（同包桶导出），此处仅提供 zod 校验器。
export const FileKindSchema = z.enum(['text', 'binary']);

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  path: z.string().min(1),
  title: z.string().nullable(),
  kind: FileKindSchema.default('text'),
  /** 小写无点扩展名；无扩展名文件为 '' */
  ext: z.string().default(''),
  mime: z.string().nullable(),
  /** 字节大小：text=字符字节数，binary=blob 大小 */
  size: z.number().int().nonnegative().default(0),
  status: DocumentStatus,
  contentHash: z.string().nullable(),
  wordCount: z.number().int().nonnegative().default(0),
  updatedAt: z.string().datetime(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const ActivitySchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  actorName: z.string().nullable(),
  verb: ActivityVerb,
  targetType: z.string(),
  targetId: z.string().uuid().nullable(),
  targetTitle: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const PublishSiteSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  mode: z.enum(['hosted', 'custom']),
  slug: z.string().regex(/^[a-z0-9-]+$/).nullable(),
  addressMode: AddressMode.nullable(),
  customDomain: z.string().nullable(),
  customServer: z.string().nullable(),
  schedule: PublishSchedule,
  autoSync: z.boolean(),
  currentVersion: z.number().int().nullable(),
});
export type PublishSite = z.infer<typeof PublishSiteSchema>;

// ---- API 通用信封（SDD 4.1） ----
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ---- WS 事件信封（SDD 4.4） ----
export const WsEventName = z.enum([
  'activity.created',
  'document.updated',
  'sync.status_changed',
  'publish.finished',
  'notification.new',
  'presence.updated',
]);
export type WsEventName = z.infer<typeof WsEventName>;

export interface WsEvent<N extends WsEventName = WsEventName> {
  event: N;
  room: string;
  payload: unknown;
  at: string;
}

// ---- StarterPack（种子数据，F10） ----
export const StarterPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  docCount: z.number().int().nonnegative(),
  tree: z.array(z.string()),
  sampleTags: z.array(z.string()),
});
export type StarterPack = z.infer<typeof StarterPackSchema>;
