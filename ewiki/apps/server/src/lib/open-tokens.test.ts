import { describe, expect, it } from 'vitest';
import {
  checkIssuePolicy,
  DEFAULT_TOKEN_POLICY,
  generateApiToken,
  hashApiToken,
  ipInAllowlist,
  isTokenScope,
  parseTokenPolicy,
  type TokenPolicy,
} from './open-tokens.js';

describe('PAT 形态（OPEN-API-MCP-DESIGN §6.1）', () => {
  it('明文 ewk_ 前缀；哈希可复现；前缀 12 字符', () => {
    const t = generateApiToken();
    expect(t.plaintext.startsWith('ewk_')).toBe(true);
    expect(t.plaintext.length).toBeGreaterThan(40);
    expect(t.prefix).toBe(t.plaintext.slice(0, 12));
    expect(t.prefix).not.toContain(t.plaintext.slice(12)); // 前缀不泄露余体
    expect(hashApiToken(t.plaintext)).toBe(hashApiToken(t.plaintext));
    expect(hashApiToken(t.plaintext)).not.toBe(t.plaintext);
    const t2 = generateApiToken();
    expect(t2.plaintext).not.toBe(t.plaintext); // 随机性
  });
});

describe('scope 基本门（ADR-O2）', () => {
  it('枚举校验', () => {
    expect(isTokenScope('search')).toBe(true);
    expect(isTokenScope('read')).toBe(true);
    expect(isTokenScope('write')).toBe(true);
    expect(isTokenScope('admin')).toBe(false);
    expect(isTokenScope(42)).toBe(false);
  });
});

describe('团队令牌策略（评审决议 3：企业组织规范钩子）', () => {
  it('脏数据防御性解析回落默认', () => {
    expect(parseTokenPolicy(null)).toEqual(DEFAULT_TOKEN_POLICY);
    expect(parseTokenPolicy({ maxScope: 'admin', ipAllowlist: 'x', allowTokens: 1 })).toEqual({
      allowTokens: true, // 非严格 false 均视为允许
      maxScope: 'write',
      ipAllowlist: [],
      source: 'local',
    });
    expect(parseTokenPolicy({ allowTokens: false, maxScope: 'search', ipAllowlist: ['10.0.0.0/8'] })).toEqual({
      allowTokens: false,
      maxScope: 'search',
      ipAllowlist: ['10.0.0.0/8'],
      source: 'local',
    });
  });

  function policyOf(p: Partial<TokenPolicy>): TokenPolicy {
    return { ...DEFAULT_TOKEN_POLICY, ...p };
  }

  it('checkIssuePolicy：禁用开关与 scope 封顶', () => {
    expect(checkIssuePolicy(policyOf({ allowTokens: false }), ['search'])).toBe('TOKENS_DISABLED');
    expect(checkIssuePolicy(policyOf({ maxScope: 'read' }), ['search', 'read'])).toBeNull();
    expect(checkIssuePolicy(policyOf({ maxScope: 'read' }), ['search', 'read', 'write'])).toBe('SCOPE_EXCEEDS_POLICY');
    expect(checkIssuePolicy(policyOf({}), ['search', 'read', 'write'])).toBeNull();
  });

  it('ipInAllowlist：精确与 IPv4 CIDR；空白名单恒放行', () => {
    expect(ipInAllowlist('10.1.2.3', [])).toBe(true); // 未配置 = 不启用
    expect(ipInAllowlist('10.1.2.3', ['10.1.2.3'])).toBe(true);
    expect(ipInAllowlist('10.1.2.4', ['10.1.2.3'])).toBe(false);
    expect(ipInAllowlist('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ipInAllowlist('11.1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(ipInAllowlist('192.168.1.66', ['192.168.1.64/26'])).toBe(true);
    expect(ipInAllowlist('192.168.1.1', ['192.168.1.64/26'])).toBe(false);
    expect(ipInAllowlist('2001:db8::1', ['10.0.0.0/8'])).toBe(false); // IPv6 仅精确匹配
    expect(ipInAllowlist('2001:db8::1', ['2001:db8::1'])).toBe(true);
  });
});
