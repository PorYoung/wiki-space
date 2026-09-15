// ---------------------------------------------------------------------------
// PG 固定窗口限流（OPEN-API-MCP-DESIGN ADR-O7 增补：server×2 副本硬配额）
//   单语句原子 check-and-increment：INSERT … ON CONFLICT DO UPDATE SET count =
//   CASE WHEN count < limit THEN count+1 ELSE count END RETURNING count ——
//   行锁保证跨副本精确（固定窗口边界突发最多 2×limit，配额语义可接受）。
//   DB 异常 fail-open：回退内存口径（防故障时全量拒绝），与用量记账同策略。
//   历史窗口概率性清理（2% 请求捎带，删 15 分钟前窗口）。
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { apiRateWindows } from '../db/schema.js';
import { createRateLimiter, type RateLimitResult, type RateLimiter } from './rate-limit.js';
import type { Db } from './open-tokens.js';

const CLEANUP_PROBABILITY = 0.02;
const RETAIN_WINDOWS_MS = 15 * 60_000;

/** 窗口对齐（固定窗口起点；纯函数供单测） */
export function windowStartFloor(epochMs: number, windowMs: number): Date {
  return new Date(Math.floor(epochMs / windowMs) * windowMs);
}

/** 限额判定（纯函数供单测）：count 已含本次 CAS 后的值 */
export function decideLimit(count: number, limit: number): { allowed: boolean; remaining: number } {
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export function createPgRateLimiter(db: Db, now: () => number = Date.now): RateLimiter {
  const memoryFallback = createRateLimiter(now);
  return {
    async hit(key, limit, windowMs): Promise<RateLimitResult> {
      const t = now();
      const windowStart = windowStartFloor(t, windowMs);
      try {
        const rows = (await db.execute(sql`
          INSERT INTO ${apiRateWindows} (bucket_key, window_start, count)
          VALUES (${key}, ${windowStart}, 1)
          ON CONFLICT (bucket_key, window_start)
          DO UPDATE SET count = CASE WHEN ${apiRateWindows.count} < ${limit}
            THEN ${apiRateWindows.count} + 1 ELSE ${apiRateWindows.count} END
          RETURNING ${apiRateWindows.count}
        `)) as unknown as Array<{ count: number }>;
        const count = Number(rows[0]?.count ?? 1);
        const d = decideLimit(count, limit);
        if (Math.random() < CLEANUP_PROBABILITY) {
          void db
            .execute(sql`DELETE FROM ${apiRateWindows} WHERE window_start < ${new Date(t - RETAIN_WINDOWS_MS)}`)
            .catch(() => {});
        }
        return {
          allowed: d.allowed,
          limit,
          remaining: d.remaining,
          resetMs: Math.max(0, windowStart.getTime() + windowMs - t),
        };
      } catch {
        return memoryFallback.hit(key, limit, windowMs);
      }
    },
    reset() {
      memoryFallback.reset();
    },
  };
}
