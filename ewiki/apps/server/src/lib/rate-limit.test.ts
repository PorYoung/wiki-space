import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit.js';
import { decideLimit, windowStartFloor } from './rate-limit-pg.js';

describe('内存滑窗限流（fail-open 回退口径）', () => {
  it('窗口内达到上限后拒绝，窗口重置后放行', async () => {
    let t = 1_000_000;
    const rl = createRateLimiter(() => t);
    for (let i = 0; i < 3; i++) {
      expect((await rl.hit('k', 3, 60_000)).allowed).toBe(true);
    }
    const denied = await rl.hit('k', 3, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.limit).toBe(3);

    t += 60_001; // 窗口滑过
    const again = await rl.hit('k', 3, 60_000);
    expect(again.allowed).toBe(true);
  });

  it('不同 key 相互隔离（per-token / per-IP 维度）', async () => {
    const rl = createRateLimiter();
    expect((await rl.hit('t:search:a', 1, 60_000)).allowed).toBe(true);
    expect((await rl.hit('t:search:a', 1, 60_000)).allowed).toBe(false);
    expect((await rl.hit('t:search:b', 1, 60_000)).allowed).toBe(true);
    expect((await rl.hit('ip:1.2.3.4', 5, 60_000)).allowed).toBe(true);
  });

  it('remaining/resetMs 随命中递减', async () => {
    let t = 5_000_000;
    const rl = createRateLimiter(() => t);
    const r1 = await rl.hit('k', 5, 10_000);
    expect(r1.remaining).toBe(4);
    expect(r1.resetMs).toBe(10_000);
    t += 4_000;
    const r2 = await rl.hit('k', 5, 10_000);
    expect(r2.remaining).toBe(3);
    expect(r2.resetMs).toBe(6_000);
  });
});

describe('PG 固定窗口计数（跨副本硬配额，纯函数部分）', () => {
  it('窗口起点按 windowMs 向下对齐', () => {
    expect(windowStartFloor(1_234_567, 60_000).getTime()).toBe(1_200_000);
    expect(windowStartFloor(1_200_000, 60_000).getTime()).toBe(1_200_000);
    expect(windowStartFloor(0, 60_000).getTime()).toBe(0);
  });

  it('限额判定：CAS 后 count ≤ limit 放行；remaining 不为负', () => {
    expect(decideLimit(1, 3)).toEqual({ allowed: true, remaining: 2 });
    expect(decideLimit(3, 3)).toEqual({ allowed: true, remaining: 0 });
    expect(decideLimit(4, 3)).toEqual({ allowed: false, remaining: 0 });
  });
});
