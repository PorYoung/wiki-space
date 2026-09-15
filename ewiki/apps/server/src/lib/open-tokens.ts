// ---------------------------------------------------------------------------
// 开放 API 机器身份（OPEN-API-MCP-DESIGN ADR-O2/O3 + 评审决议 3）
//   PAT = act-as-user：认证后权限解析与登录态完全同源（readableProjectIds 等），
//   token 本身不产生任何额外权限；scope 三级 search/read/write 仅作端点门。
//   团队 token 策略 = 企业组织规范钩子（teams.token_policy）：签发时最严封顶，
//   请求时 IP 白名单（union 口径，配置了才启用）；source 字段预留组织架构同步。
// ---------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createDb } from '@ewiki/db';
import { apiTokens, teamMembers, teams } from '../db/schema.js';

export type Db = ReturnType<typeof createDb>['db'];

export type TokenScope = 'search' | 'read' | 'write';
export const TOKEN_SCOPES: TokenScope[] = ['search', 'read', 'write'];
const SCOPE_RANK: Record<TokenScope, number> = { search: 1, read: 2, write: 3 };

export function isTokenScope(v: unknown): v is TokenScope {
  return typeof v === 'string' && (TOKEN_SCOPES as string[]).includes(v);
}

export interface TokenPolicy {
  allowTokens: boolean;
  maxScope: TokenScope;
  ipAllowlist: string[];
  /** local = teams 表本地维护；org = 组织系统同步（预留，本期恒 local） */
  source?: 'local' | 'org';
}

export const DEFAULT_TOKEN_POLICY: TokenPolicy = {
  allowTokens: true,
  maxScope: 'write',
  ipAllowlist: [],
  source: 'local',
};

/** 防御性解析（脏数据兜底：非法字段回落默认，maxScope 越界回落 write） */
export function parseTokenPolicy(raw: unknown): TokenPolicy {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TOKEN_POLICY };
  const r = raw as Record<string, unknown>;
  const maxScope = isTokenScope(r.maxScope) ? r.maxScope : 'write';
  const ipAllowlist = Array.isArray(r.ipAllowlist)
    ? r.ipAllowlist.filter((s): s is string => typeof s === 'string')
    : [];
  return {
    allowTokens: r.allowTokens !== false,
    maxScope,
    ipAllowlist,
    source: r.source === 'org' ? 'org' : 'local',
  };
}

/**
 * 用户生效策略 = 其所属（active、未归档）团队策略的最严合并：
 *   allowTokens 取 AND（任一团队禁用即禁用）；maxScope 取最低档；ipAllowlist 取并集
 *   （union 口径：任一团队白名单命中即放行——交集口径在多团队下必然为空集，见 spec §13.1）。
 * 无团队 = 默认全放开。
 */
export async function effectiveTokenPolicyFor(db: Db, userId: string): Promise<TokenPolicy> {
  const rows = await db
    .select({ policy: teams.tokenPolicy })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(eq(teamMembers.userId, userId), eq(teamMembers.status, 'active'), eq(teams.archived, false)),
    );
  if (rows.length === 0) return { ...DEFAULT_TOKEN_POLICY };

  let allowTokens = true;
  let maxScope: TokenScope = 'write';
  const ipAllowlist = new Set<string>();
  for (const row of rows) {
    const p = parseTokenPolicy(row.policy);
    allowTokens = allowTokens && p.allowTokens;
    if (SCOPE_RANK[p.maxScope] < SCOPE_RANK[maxScope]) maxScope = p.maxScope;
    for (const cidr of p.ipAllowlist) ipAllowlist.add(cidr);
  }
  return { allowTokens, maxScope, ipAllowlist: [...ipAllowlist], source: 'local' };
}

/** 签发策略校验：返回拒绝原因码（null = 放行） */
export function checkIssuePolicy(
  policy: TokenPolicy,
  scopes: TokenScope[],
): 'TOKENS_DISABLED' | 'SCOPE_EXCEEDS_POLICY' | null {
  if (!policy.allowTokens) return 'TOKENS_DISABLED';
  const granted = scopes.reduce((m, s) => Math.max(m, SCOPE_RANK[s]), 0);
  if (granted > SCOPE_RANK[policy.maxScope]) return 'SCOPE_EXCEEDS_POLICY';
  return null;
}

// ---- PAT 形态：ewk_<base64url(32B)>；库内仅存 sha256 hex + 前 12 字符前缀 ----

export function generateApiToken(): { plaintext: string; prefix: string; hash: string } {
  const plaintext = `ewk_${randomBytes(32).toString('base64url')}`;
  return { plaintext, prefix: plaintext.slice(0, 12), hash: hashApiToken(plaintext) };
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 请求 IP 是否命中白名单（精确 IP 或 IPv4 CIDR a.b.c.d/p；IPv6 仅精确匹配） */
export function ipInAllowlist(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const norm = ip.trim();
  for (const entry of allowlist) {
    const e = entry.trim();
    if (!e) continue;
    if (e === norm) return true;
    const m = e.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
    if (m && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(norm)) {
      const base = ipToInt(m[1]!);
      const bits = Number(m[2]);
      if (base === null || !(bits >= 0 && bits <= 32)) continue;
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
      if (((ipToInt(norm)! & mask) >>> 0) === ((base & mask) >>> 0)) return true;
    }
  }
  return false;
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export type ApiTokenRow = typeof apiTokens.$inferSelect;
