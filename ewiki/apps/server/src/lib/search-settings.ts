// 检索运行时配置（SEARCH-VECTOR-DESIGN §15 管理与运营）：
//   env 提供默认值，platform_settings.key='search.admin_config' 提供管理员运行时覆盖；
//   读侧 10s TTL 缓存（跨进程最终一致，管理端保存即审计）；apiKey 经 secretbox AES-256-GCM 加密落库。
//   server（查询侧语义开关/嵌入）与 worker（索引侧嵌入/防抖）经同一入口解析 —— 修改无需重启。
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingSettings,
} from '@ewiki/shared';
import { decryptJson, encryptJson, platformSettings, schema } from '@ewiki/db';

export const SEARCH_SETTINGS_KEY = 'search.admin_config';

/** 运行时生效配置（env 默认 ⊕ 管理员覆盖） */
export interface EffectiveSearchSettings extends EmbeddingSettings {
  /** 全局向量总开关：false = 暂停索引更新与语义检索（已有向量保留，重开后由对账补齐） */
  vectorEnabled: boolean;
  debounceSeconds: number;
  semanticMinScore: number;
}

/** 管理端可写的覆盖面（相对默认值的 delta）；apiKey 落库为 secretbox 密文 */
export interface SearchSettingsOverrides {
  embedding?: Partial<Pick<EmbeddingSettings, 'provider' | 'baseUrl' | 'apiKey' | 'model' | 'batchSize' | 'timeoutMs'>>;
  vectorEnabled?: boolean;
  debounceSeconds?: number;
  semanticMinScore?: number;
}

interface StoredOverrides {
  embedding?: Partial<Omit<EmbeddingSettings, 'dim'>> & { apiKeyEnc?: string };
  vectorEnabled?: boolean;
  debounceSeconds?: number;
  semanticMinScore?: number;
}

/** 纯函数：默认值 ⊕ 覆盖（apiKey 密文解密在读取层完成，便于单测） */
export function mergeSearchSettings(
  defaults: EffectiveSearchSettings,
  overrides: StoredOverrides | null | undefined,
): EffectiveSearchSettings {
  const apiKey = overrides?.embedding?.apiKeyEnc ? decryptJson<string>(overrides.embedding.apiKeyEnc) : defaults.apiKey;
  return {
    provider: overrides?.embedding?.provider ?? defaults.provider,
    baseUrl: overrides?.embedding?.baseUrl ?? defaults.baseUrl,
    apiKey,
    model: overrides?.embedding?.model ?? defaults.model,
    dim: defaults.dim, // 维度由向量列固定（1024），不可运行时修改
    batchSize: overrides?.embedding?.batchSize ?? defaults.batchSize,
    timeoutMs: overrides?.embedding?.timeoutMs ?? defaults.timeoutMs,
    vectorEnabled: overrides?.vectorEnabled ?? defaults.vectorEnabled,
    debounceSeconds: overrides?.debounceSeconds ?? defaults.debounceSeconds,
    semanticMinScore: overrides?.semanticMinScore ?? defaults.semanticMinScore,
  };
}

function envDefaults(env: NodeJS.ProcessEnv): EffectiveSearchSettings {
  return {
    provider: env.EMBEDDING_PROVIDER?.trim() || 'none',
    baseUrl: (env.EMBEDDING_BASE_URL?.trim() || '').replace(/\/+$/, ''),
    apiKey: env.EMBEDDING_API_KEY?.trim() || '',
    model: env.EMBEDDING_MODEL?.trim() || 'bge-m3',
    dim: Math.max(1, Math.floor(Number(env.EMBEDDING_DIM ?? '1024') || 1024)),
    batchSize: Math.max(1, Math.floor(Number(env.EMBEDDING_BATCH_SIZE ?? '32') || 32)),
    timeoutMs: Math.max(1000, Math.floor(Number(env.EMBEDDING_TIMEOUT_MS ?? '10000') || 10000)),
    vectorEnabled: true,
    debounceSeconds: Math.max(0, Math.floor(Number(env.SEARCH_INDEX_DEBOUNCE_SECONDS ?? '30') || 30)),
    semanticMinScore: Math.max(0, Math.min(0.95, Number(env.SEARCH_SEMANTIC_MIN_SCORE ?? '0.3') || 0.3)),
  };
}

interface CacheEntry {
  at: number;
  settings: EffectiveSearchSettings;
}

const cacheTtlMs = 10_000;
const cacheByDb = new WeakMap<object, CacheEntry>();

async function readOverrides(db: PostgresJsDatabase<typeof schema>): Promise<StoredOverrides | null> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, SEARCH_SETTINGS_KEY))
    .limit(1);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as StoredOverrides;
  } catch {
    return null;
  }
}

/** 读取生效配置（10s TTL 缓存；管理端保存后调用 bustSearchSettingsCache 立即生效） */
export async function getSearchSettings(
  db: PostgresJsDatabase<typeof schema>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EffectiveSearchSettings> {
  const key = db as unknown as object;
  const cached = cacheByDb.get(key);
  if (cached && Date.now() - cached.at < cacheTtlMs) return cached.settings;
  const overrides = await readOverrides(db);
  const settings = mergeSearchSettings(envDefaults(env), overrides);
  cacheByDb.set(key, { at: Date.now(), settings });
  return settings;
}

/** 使指定 db 连接的设置缓存失效（保存路径调用，10s TTL 缓存立即刷新） */
export function bustSearchSettingsCacheFor(db: PostgresJsDatabase<typeof schema>): void {
  cacheByDb.delete(db as unknown as object);
}

/** 保存管理员覆盖（合并写；apiKey 缺省 = 保留现值，显式空串 = 清除） */
export async function saveSearchSettings(
  db: PostgresJsDatabase<typeof schema>,
  env: NodeJS.ProcessEnv,
  patch: SearchSettingsOverrides,
): Promise<EffectiveSearchSettings> {
  const defaults = envDefaults(env);
  const current = await readOverrides(db);
  const next: StoredOverrides = {
    embedding: { ...current?.embedding },
    vectorEnabled: patch.vectorEnabled ?? current?.vectorEnabled,
    debounceSeconds: patch.debounceSeconds ?? current?.debounceSeconds,
    semanticMinScore: patch.semanticMinScore ?? current?.semanticMinScore,
  };
  const embPatch = patch.embedding ?? {};
  const emb: StoredOverrides['embedding'] = { ...next.embedding };
  if (embPatch.provider !== undefined) emb.provider = embPatch.provider || undefined;
  if (embPatch.baseUrl !== undefined) emb.baseUrl = embPatch.baseUrl.trim().replace(/\/+$/, '') || undefined;
  if (embPatch.model !== undefined) emb.model = embPatch.model.trim() || undefined;
  if (embPatch.batchSize !== undefined) emb.batchSize = Math.max(1, Math.floor(embPatch.batchSize));
  if (embPatch.timeoutMs !== undefined) emb.timeoutMs = Math.max(1000, Math.floor(embPatch.timeoutMs));
  if (embPatch.apiKey !== undefined) {
    emb.apiKeyEnc = embPatch.apiKey ? encryptJson(embPatch.apiKey) : undefined;
  }
  // 无覆盖价值的键清掉，回落 env 默认
  for (const k of ['provider', 'baseUrl', 'model', 'batchSize', 'timeoutMs', 'apiKeyEnc'] as const) {
    if (emb[k] === undefined) delete emb[k];
  }
  next.embedding = Object.keys(emb).length ? emb : undefined;

  const value = JSON.stringify(next);
  await db
    .insert(platformSettings)
    .values({ key: SEARCH_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value } });
  bustSearchSettingsCacheFor(db);
  return mergeSearchSettings(defaults, next);
}

/** 解析当前嵌入 Provider（按生效配置即时构建；Provider 对象无连接，构建廉价） */
export function resolveEmbeddings(settings: EffectiveSearchSettings): EmbeddingProvider | null {
  return createEmbeddingProvider(settings);
}
