import { z } from 'zod';

// ---- 枚举（与 SDD 3.2 CHECK 约束一致） ----
export const Visibility = z.enum(['private', 'team', 'public']);
export type Visibility = z.infer<typeof Visibility>;

export const ProjectRole = z.enum(['owner', 'maintainer', 'editor', 'guest']);
export type ProjectRole = z.infer<typeof ProjectRole>;

export const GlobalRole = z.enum(['admin', 'user']);
export type GlobalRole = z.infer<typeof GlobalRole>;

export const SourceType = z.enum(['git', 'local', 'web', 'database']);
export type SourceType = z.infer<typeof SourceType>;

export const SourceStatus = z.enum(['connected', 'synced', 'syncing', 'error']);
export type SourceStatus = z.infer<typeof SourceStatus>;

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
  template: z.string().nullable(),
  docCount: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceId: z.string().uuid().nullable(),
  path: z.string().min(1),
  title: z.string().nullable(),
  status: DocumentStatus,
  contentHash: z.string().nullable(),
  wordCount: z.number().int().nonnegative().default(0),
  updatedAt: z.string().datetime(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const SourceSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: SourceType,
  name: z.string(),
  configPublic: z.record(z.unknown()).default({}),
  defaultBranch: z.string().nullable(),
  autoSync: z.boolean(),
  intervalSeconds: SyncInterval,
  status: SourceStatus,
  lastSyncedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});
export type Source = z.infer<typeof SourceSchema>;

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
