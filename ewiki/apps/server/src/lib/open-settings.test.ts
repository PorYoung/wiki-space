import { describe, expect, it } from 'vitest';
import { mergeOpenSettings, OPENAPI_DEFAULTS } from './open-settings.js';

describe('开放面运行时设置（OPEN-API-MCP-DESIGN §6.3）', () => {
  it('无覆盖 = 代码默认（公开检索默认关）', () => {
    expect(mergeOpenSettings(null)).toEqual(OPENAPI_DEFAULTS);
    expect(OPENAPI_DEFAULTS.publicSearchEnabled).toBe(false);
  });

  it('合法覆盖生效', () => {
    const s = mergeOpenSettings({ publicSearchEnabled: true, searchPerMin: 120, readPerMin: 5 });
    expect(s.publicSearchEnabled).toBe(true);
    expect(s.searchPerMin).toBe(120);
    expect(s.readPerMin).toBe(5);
    expect(s.writePerMin).toBe(OPENAPI_DEFAULTS.writePerMin); // 未覆盖保持默认
  });

  it('非法覆盖忽略回落默认；env 抬升优先于覆盖', () => {
    const s = mergeOpenSettings({ publicSearchEnabled: 'yes', searchPerMin: -5, writePerMin: 'x', publicPerIpPerMin: 1e9 });
    expect(s.publicSearchEnabled).toBe(false);
    expect(s.searchPerMin).toBe(OPENAPI_DEFAULTS.searchPerMin);
    expect(s.writePerMin).toBe(OPENAPI_DEFAULTS.writePerMin);
    expect(s.publicPerIpPerMin).toBe(OPENAPI_DEFAULTS.publicPerIpPerMin);

    const env = mergeOpenSettings({ publicSearchEnabled: false }, true);
    expect(env.publicSearchEnabled).toBe(true);
  });
});
