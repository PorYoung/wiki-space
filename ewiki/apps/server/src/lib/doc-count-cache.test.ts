// ---------------------------------------------------------------------------
// P5 补单测：server/lib/doc-count-cache — TTL 缓存 + invalidate
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __cacheSize,
  __resetDocCountCacheForTest,
  getCachedCount,
  invalidateDocCountCache,
} from './doc-count-cache.js';

beforeEach(() => {
  __resetDocCountCacheForTest(1_000); // 测试用 1s TTL，更快
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('doc-count-cache', () => {
  it('首次调用走 compute，结果写入缓存', async () => {
    let calls = 0;
    const count = await getCachedCount('k', async () => {
      calls++;
      return 42;
    });
    expect(count).toBe(42);
    expect(calls).toBe(1);
    expect(__cacheSize()).toBe(1);
  });

  it('TTL 内命中缓存，不再 compute', async () => {
    let calls = 0;
    const compute = async () => { calls++; return 99; };

    await getCachedCount('k', compute);
    await getCachedCount('k', compute);
    await getCachedCount('k', compute);

    expect(calls).toBe(1);
  });

  it('TTL 过期后重新 compute', async () => {
    let calls = 0;
    const compute = async () => { calls++; return 7; };

    await getCachedCount('k', compute);
    vi.advanceTimersByTime(1001);
    await getCachedCount('k', compute);

    expect(calls).toBe(2);
  });

  it('不同 key 独立缓存', async () => {
    let a = 0;
    let b = 0;
    await getCachedCount('a', async () => { a++; return 1; });
    await getCachedCount('b', async () => { b++; return 2; });
    await getCachedCount('a', async () => { a++; return 11; });
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(__cacheSize()).toBe(2);
  });

  it('invalidate 清空全部缓存', async () => {
    let calls = 0;
    const compute = async () => { calls++; return 5; };

    await getCachedCount('x', compute);
    await getCachedCount('y', compute);
    expect(__cacheSize()).toBe(2);

    invalidateDocCountCache();
    expect(__cacheSize()).toBe(0);

    await getCachedCount('x', compute);
    expect(calls).toBe(3); // 之前 2 次 + 这次
  });

  it('invalidate 后重新走 compute（返回新值）', async () => {
    let counter = 0;
    const compute = async () => { counter++; return counter; };

    const first = await getCachedCount('k', compute);
    invalidateDocCountCache();
    const second = await getCachedCount('k', compute);

    expect(first).toBe(1);
    expect(second).toBe(2);
  });
});
