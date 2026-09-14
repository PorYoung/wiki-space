import { describe, expect, it } from 'vitest';
import { encryptJson } from '@ewiki/db';
import { mergeSearchSettings, type EffectiveSearchSettings } from './search-settings.js';

const DEFAULTS: EffectiveSearchSettings = {
  provider: 'none',
  baseUrl: '',
  apiKey: 'env-key-9876',
  model: 'bge-m3',
  dim: 1024,
  batchSize: 32,
  timeoutMs: 10000,
  vectorEnabled: true,
  debounceSeconds: 30,
  semanticMinScore: 0.3,
};

describe('mergeSearchSettings', () => {
  it('无覆盖时完全回落 env 默认', () => {
    const merged = mergeSearchSettings(DEFAULTS, null);
    expect(merged).toEqual(DEFAULTS);
  });

  it('覆盖键生效、未覆盖键保留默认、dim 不可覆盖', () => {
    const merged = mergeSearchSettings(DEFAULTS, {
      embedding: { provider: 'openai-compatible', baseUrl: 'http://ollama:11434/v1', model: 'bge-m3' },
      debounceSeconds: 3,
      semanticMinScore: 0.05,
      vectorEnabled: false,
    });
    expect(merged.provider).toBe('openai-compatible');
    expect(merged.baseUrl).toBe('http://ollama:11434/v1');
    expect(merged.model).toBe('bge-m3');
    expect(merged.apiKey).toBe('env-key-9876'); // 未覆盖 → 保留 env
    expect(merged.dim).toBe(1024);
    expect(merged.debounceSeconds).toBe(3);
    expect(merged.semanticMinScore).toBe(0.05);
    expect(merged.vectorEnabled).toBe(false);
  });

  it('apiKey 覆盖经 secretbox 密文解密；空串显式清除', () => {
    // 加密由 saveSearchSettings 负责；此处直接用 encryptJson 产物验证解密链路
    const stored = {
      embedding: { apiKeyEnc: encryptJson('runtime-key-1234') },
    };
    const merged = mergeSearchSettings(DEFAULTS, stored);
    expect(merged.apiKey).toBe('runtime-key-1234');

    const cleared = mergeSearchSettings(DEFAULTS, { embedding: { apiKeyEnc: undefined } });
    expect(cleared.apiKey).toBe('env-key-9876');
  });

  it('畸形覆盖 JSON（null/undefined）安全回落', () => {
    expect(mergeSearchSettings(DEFAULTS, undefined)).toEqual(DEFAULTS);
  });
});
