// ---------------------------------------------------------------------------
// 开放 API 运行时设置（OPEN-API-MCP-DESIGN §6.3）：platform_settings.key='openapi.config'
//   代码默认 ⊕ 管理员 KV 覆盖，10s TTL 缓存（仿 search-settings 模式）。
//   总开关 OPENAPI_ENABLED 走 env（进程级 kill switch，气隙可整体关）；
//   公开检索开关与限流配额走 KV（管理端「开放接口」页签可调，无需重启）。
// ---------------------------------------------------------------------------

import { eq } from 'drizzle-orm';
import { platformSettings } from '../db/schema.js';
import type { Db } from './open-tokens.js';

export const OPENAPI_SETTINGS_KEY = 'openapi.config';

export interface OpenApiSettings {
  /** D1 公开检索总开关（站点 + 平台公开面共用；默认关） */
  publicSearchEnabled: boolean;
  /** 匿名 IP 限流（次/分/IP） */
  publicPerIpPerMin: number;
  /** token 配额（次/分）：search / read / write 三维 */
  searchPerMin: number;
  readPerMin: number;
  writePerMin: number;
}

export const OPENAPI_DEFAULTS: OpenApiSettings = {
  publicSearchEnabled: false,
  publicPerIpPerMin: 10,
  searchPerMin: 60,
  readPerMin: 120,
  writePerMin: 30,
};

/** 纯函数：默认 ⊕ 覆盖（非法值忽略回落默认，便于单测）；env 抬升最后应用（只可强制开启） */
export function mergeOpenSettings(overrides: unknown, envPublicEnabled?: boolean): OpenApiSettings {
  const out = { ...OPENAPI_DEFAULTS };
  if (overrides && typeof overrides === 'object') {
    const o = overrides as Record<string, unknown>;
    if (typeof o.publicSearchEnabled === 'boolean') out.publicSearchEnabled = o.publicSearchEnabled;
    for (const k of ['publicPerIpPerMin', 'searchPerMin', 'readPerMin', 'writePerMin'] as const) {
      const v = o[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100_000) {
        out[k] = Math.floor(v);
      }
    }
  }
  if (envPublicEnabled !== undefined) out.publicSearchEnabled = envPublicEnabled || out.publicSearchEnabled;
  return out;
}

const TTL_MS = 10_000;
const cache = new WeakMap<object, { value: OpenApiSettings; expireAt: number }>();

/** 读侧带 TTL 缓存；db 实例为缓存键（同 worker 复用 server lib 的 WeakMap 模式）。
 *  env OPENAPI_PUBLIC_SEARCH=true 可在进程级强制抬升公开开关（KV 仍可单独关闭）。 */
export async function getOpenSettings(db: Db): Promise<OpenApiSettings> {
  const envPublic = process.env.OPENAPI_PUBLIC_SEARCH === 'true' ? true : undefined;
  const cached = cache.get(db as object);
  const now = Date.now();
  if (cached && cached.expireAt > now) {
    return envPublic === undefined
      ? cached.value
      : { ...cached.value, publicSearchEnabled: envPublic || cached.value.publicSearchEnabled };
  }
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, OPENAPI_SETTINGS_KEY)).limit(1);
  let overrides: unknown = null;
  if (row?.value) {
    try {
      overrides = JSON.parse(row.value);
    } catch {
      overrides = null;
    }
  }
  const value = mergeOpenSettings(overrides, envPublic);
  cache.set(db as object, { value, expireAt: now + TTL_MS });
  return value;
}

/** 保存后即刻失效本进程缓存（跨进程靠 TTL 最终一致，同 search-settings 语义） */
export function bustOpenSettingsCache(db: Db): void {
  cache.delete(db as object);
}

export async function saveOpenSettings(db: Db, next: Partial<OpenApiSettings>, updatedBy: string): Promise<OpenApiSettings> {
  const current = await getOpenSettings(db);
  const merged = mergeOpenSettings({ ...current, ...next });
  await db
    .insert(platformSettings)
    .values({ key: OPENAPI_SETTINGS_KEY, value: JSON.stringify(merged), updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value: JSON.stringify(merged), updatedBy, updatedAt: new Date() },
    });
  bustOpenSettingsCache(db);
  return merged;
}
