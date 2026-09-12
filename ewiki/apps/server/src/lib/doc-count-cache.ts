// ---------------------------------------------------------------------------
// documents count 短 TTL 缓存（B5）——从 apps/server/src/http/routes.ts 提取
// 列表接口每次都跑 count(*)，万行级表上 PG 也慢。30s TTL 让用户看到近似准确计数，
// 编辑/创建/删除时主动清空缓存（下一次列表请求重新 COUNT）。
// P5 补单测（见同目录 doc-count-cache.test.ts）
// ---------------------------------------------------------------------------

interface CacheEntry {
  count: number;
  expireAt: number;
}

const docCountCache = new Map<string, CacheEntry>();
let DOC_COUNT_CACHE_TTL = 30_000;

/** 仅用于测试——重置全部状态 + 自定义 TTL */
export function __resetDocCountCacheForTest(ttl?: number): void {
  docCountCache.clear();
  if (ttl !== undefined) DOC_COUNT_CACHE_TTL = ttl;
}

export function getCachedCount(
  key: string,
  compute: () => Promise<number>,
): Promise<number> {
  const cached = docCountCache.get(key);
  if (cached && cached.expireAt > Date.now()) return Promise.resolve(cached.count);
  return compute().then((count) => {
    docCountCache.set(key, { count, expireAt: Date.now() + DOC_COUNT_CACHE_TTL });
    return count;
  });
}

/** 文档写操作（insert / update / delete）后调用，清空所有 count 缓存 */
export function invalidateDocCountCache(): void {
  docCountCache.clear();
}

/** 暴露内部状态（只读副本），便于测试 */
export function __cacheSize(): number {
  return docCountCache.size;
}
