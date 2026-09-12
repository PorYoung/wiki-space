// 数据库方言边界（SDD ADR-11）：四个接口，Phase 1 由 apps/server/src/adapters/pg 提供
// PostgreSQL 实现；国产库触发时按方言新增实现（MySQL 系 = 自研 SKIP LOCKED 队列 +
// GET_LOCK + 事件表轮询 + FULLTEXT ngram；PG 系国产库直兼容）。

export type QueueName = 'sync' | 'publish' | 'ai-classify' | 'import' | 'export' | 'compensate';

export interface JobEnqueueOptions {
  /** 幂等键：同键任务去重（如 sync = projectId:commitHash，SDD 4.3 O1） */
  idempotencyKey?: string;
  delayMs?: number;
}

export interface Job {
  id: string;
  queue: QueueName;
  data: unknown;
}

export interface JobQueue {
  /** 入队；幂等键命中时返回 deduped=true */
  enqueue(queue: QueueName, data: unknown, opts?: JobEnqueueOptions): Promise<{ jobId: string; deduped: boolean }>;
  /** 消费注册（Worker 进程调用） */
  work(queue: QueueName, handler: (job: Job) => Promise<void>): Promise<void>;
  /** cron 调度（如发布每日 03:00，PRD F35） */
  scheduleCron(queue: QueueName, cron: string): Promise<void>;
}

/** 源级互斥（同一源不并发同步，PRD 6.2.4） */
export interface LockService {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export type EventChannel = 'activity' | 'sync' | 'publish' | 'notifications';

/** 跨副本广播（WS 实时网关订阅，SDD 4.4） */
export interface EventBus {
  publish(channel: EventChannel, payload: unknown): Promise<void>;
  subscribe(channel: EventChannel, handler: (payload: unknown) => void): Promise<void>;
}

export interface SearchDocument {
  id: string;
  projectId: string;
  title: string;
  content: string;
}

export interface SearchQueryOptions {
  projectId?: string;
  limit?: number;
}

export interface SearchHit {
  id: string;
  projectId: string;
  title: string;
  snippet: string;
}

/** 全文检索（F08/F44；替换实现 = Meilisearch 适配器，PRD Phase 2 路径） */
export interface SearchService {
  indexDocument(doc: SearchDocument): Promise<void>;
  removeDocument(id: string): Promise<void>;
  query(q: string, opts?: SearchQueryOptions): Promise<SearchHit[]>;
}

// ---------------------------------------------------------------------------
// 可扩展能力 Provider（EXT-PLATFORM-PLAN §3 / ADR-P1）
//   接口定义在 shared，实现在 worker 注册表，env 选择（编译期 Provider 模式）；
//   换实现 = 提供同接口适配器 + 改 env + 重启，不引入运行时插件框架。
// ---------------------------------------------------------------------------

/** AI 分类建议（生成-确认两段式的"生成"段：只建议，不直接改文档） */
export interface ClassifySuggestion {
  documentId: string;
  path: string;
  title: string;
  folder: string;
  tags: string[];
}

export interface ClassifyProvider {
  /** 'heuristic'（自研默认）| 未来 'llm-xx' */
  id: string;
  suggest(docs: Array<{ id: string; path: string; title: string }>): Promise<ClassifySuggestion[]>;
}

/** 导入单个文件的载荷：文本直接给 content；二进制给 Uint8Array + 字节大小 */
export type ImportDocPayload =
  | { kind: 'text'; content: string }
  | { kind: 'binary'; data: Uint8Array; size: number };

/** 导入进度/落库 sink（由 worker 提供，隔离 Provider 与 DB 细节） */
export interface ImportDocSink {
  upsertDoc(path: string, payload: ImportDocPayload): Promise<void>;
  onProgress(done: number): Promise<void>;
}

export interface ImportResult {
  docs: number;
  binary?: number;
}

export interface ImportProvider {
  /** 'folder' | 'basic-crawler'（自研默认）| 未来 'notion-oauth' 等 */
  id: string;
  supportedParams: string[];
  run(params: Record<string, unknown>, sink: ImportDocSink): Promise<ImportResult>;
}

// ---------------------------------------------------------------------------
// 通知（EXT-PLATFORM-PLAN ADR-P3：平台横切服务 + 渠道适配器）
//   站内收件箱为兜底渠道；邮件/webhook 是并行增装的适配器而非替换。
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'sync.error'
  | 'publish.finished'
  | 'import.finished'
  | 'import.failed'
  | 'team.invite';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  payload: { projectId?: string; title: string; message: string; link?: string };
}

export interface Notifier {
  /** 'inbox' | 'email' | 'webhook' … */
  channel: string;
  send(input: NotificationInput): Promise<void>;
}
