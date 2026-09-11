import { describe, expect, it } from 'vitest';
import {
  generateRefreshToken,
  hashPassword,
  hashToken,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from './utils.js';

describe('auth/utils', () => {
  it('密码哈希可验证，错误密码被拒绝', () => {
    const stored = hashPassword('s3cret-密码');
    expect(verifyPassword('s3cret-密码', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('非法存储格式不抛异常直接拒绝', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
  });

  it('访问令牌签发后可验证且负载一致', async () => {
    const secret = 'test-secret-at-least-16-bytes';
    const token = await signAccessToken(secret, { sub: 'u-1', globalRole: 'admin' });
    const payload = await verifyAccessToken(secret, token);
    expect(payload.sub).toBe('u-1');
    expect(payload.globalRole).toBe('admin');
  });

  it('篡改的令牌验证失败', async () => {
    const token = await signAccessToken('secret-16-bytes-ok', { sub: 'u', globalRole: 'user' });
    await expect(verifyAccessToken('another-secret-16byte', token)).rejects.toThrow();
  });

  it('刷新令牌落库哈希与明文一一对应', () => {
    const rt = generateRefreshToken();
    expect(rt).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(rt)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(rt)).not.toBe(rt);
  });
});
