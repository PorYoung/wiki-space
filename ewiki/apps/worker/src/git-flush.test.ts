import { describe, expect, it } from 'vitest';
import { planFlush } from './git-flush.js';

const NOW = 1_000_000;
const DEBOUNCE = 300_000;
const MAX_WAIT = 1_800_000;

function row(op: string, ageMs: number) {
  return { op, createdAt: NOW - ageMs };
}

describe('planFlush（worker 窗口判定）', () => {
  it('仅 checkpoint（无文件操作）→ 立即 flush', () => {
    expect(planFlush([row('checkpoint', 0)], NOW, DEBOUNCE, MAX_WAIT)).toEqual({ action: 'flush' });
  });

  it('checkpoint 混在窗口内 → 绕过防抖立即 flush（立即提交语义）', () => {
    const rows = [row('upsert', 10_000), row('checkpoint', 0)];
    expect(planFlush(rows, NOW, DEBOUNCE, MAX_WAIT)).toEqual({ action: 'flush' });
  });

  it('窗口内静默未满 → rearm', () => {
    const rows = [row('upsert', 600_000), row('upsert', 100_000)];
    const d = planFlush(rows, NOW, DEBOUNCE, MAX_WAIT);
    expect(d).toEqual({ action: 'rearm', delayMs: 200_000 });
  });

  it('静默达到 debounce → flush', () => {
    expect(planFlush([row('upsert', 300_000)], NOW, DEBOUNCE, MAX_WAIT)).toEqual({ action: 'flush', delayMs: 0 });
  });

  it('持续编辑但距窗口起点达到 max-wait → flush', () => {
    const rows = [row('upsert', 1_800_000), row('upsert', 1_000)];
    expect(planFlush(rows, NOW, DEBOUNCE, MAX_WAIT)).toEqual({ action: 'flush', delayMs: 0 });
  });

  it('防抖时钟只看文件操作行，忽略 checkpoint 的「活动」属性', () => {
    // 文件操作已静默 300s → 本应 flush；若误把 checkpoint 计入活动时间则会 rearm
    const rows = [row('upsert', 300_000), row('checkpoint', 100)];
    expect(planFlush(rows, NOW, DEBOUNCE, MAX_WAIT)).toEqual({ action: 'flush' });
  });
});
