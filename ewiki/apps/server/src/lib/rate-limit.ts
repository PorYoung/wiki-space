// ---------------------------------------------------------------------------
// 内存滑窗限流（OPEN-API-MCP-DESIGN ADR-O7）
//   生产路径为 PG 固定窗口计数器（rate-limit-pg.ts，跨副本精确）；本内存实现作为
//   ① DB 异常时的 fail-open 回退口径 ② 单测载体。单进程语义精确，×副本放宽。
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** 距窗口重置的毫秒数（Retry-After 换算用，向上取整秒） */
  resetMs: number;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  /** 测试辅助：清空全部桶 */
  reset(): void;
}

const SWEEP_INTERVAL_MS = 300_000;
/** 全量清扫时时间戳的保留上限（≥ 业务最大窗口 1min 即可，取 1h 余量） */
const RETAIN_MS = 3_600_000;

export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, number[]>();
  let lastSweep = now();

  return {
    async hit(key, limit, windowMs) {
      const t = now();
      const arr = (buckets.get(key) ?? []).filter((ts) => t - ts < windowMs);
      const allowed = arr.length < limit;
      if (allowed) arr.push(t);
      buckets.set(key, arr);

      if (t - lastSweep > SWEEP_INTERVAL_MS) {
        lastSweep = t;
        // 极端打爆内存时整表丢弃（限流短暂退化为放行），优于在请求路径上做全量重扫
        if (buckets.size > 100_000) {
          buckets.clear();
        } else {
          for (const [k, arr2] of buckets) {
            const live = arr2.filter((ts) => t - ts < RETAIN_MS);
            if (live.length === 0) buckets.delete(k);
            else buckets.set(k, live);
          }
        }
      }

      const oldest = arr[0] ?? t;
      return {
        allowed,
        limit,
        remaining: Math.max(0, limit - arr.length),
        resetMs: Math.max(0, windowMs - (t - oldest)),
      };
    },
    reset() {
      buckets.clear();
    },
  };
}
