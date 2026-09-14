// 权限矩阵单测（TEAM-PERMISSIONS-DESIGN §8.1 U1/U4）
// - U1a：5 可见性 × 5 显式角色 × 4 团队角色 × 2 admin = 200 组合全量锁定
// - U1b：规范 §3.5/§3.6 矩阵字面抽查（独立于实现的期望值）
// - U4：转移前置条件矩阵
// 注：匿名（未登录）不在此建模——由路由层 Bearer 守卫 401 拦截（routes.ts 全局中间件）。
import { describe, expect, it } from 'vitest';
import {
  MANAGE_ROLES,
  WRITE_ROLES,
  checkProjectTransfer,
  computeAccess,
  type MemberRole,
  type TeamRole,
} from './permissions.js';

const VIS = ['private', 'team-read', 'team-write', 'public-read', 'public-write'] as const;
const EXPLICIT: Array<MemberRole | null> = [null, 'guest', 'editor', 'maintainer', 'owner'];
const TEAM: Array<TeamRole | null> = [null, 'member', 'maintainer', 'owner'];

// ---- 独立期望（以"允许集"表述，与实现措辞不同） ----
const READ_ALWAYS = new Set<string>(['public-read', 'public-write']); // 登录即读
const READ_TEAM = new Set<string>(['team-read', 'team-write', 'public-read', 'public-write']); // 团队成员读集

function expected(vis: string, e: MemberRole | null, t: TeamRole | null, admin: boolean) {
  if (admin) return { canRead: true, canWrite: true, canManage: true, canDelete: true };
  const canRead = e !== null ? true : t !== null ? READ_TEAM.has(vis) : READ_ALWAYS.has(vis);
  // 写的三条来源取并集：显式写角色 / 团队成员+team-write / public-write（人人可写）
  const canWrite =
    (e !== null && WRITE_ROLES.includes(e)) || (t !== null && vis === 'team-write') || vis === 'public-write';
  const canManage = canRead && ((e !== null && MANAGE_ROLES.includes(e)) || t === 'owner' || t === 'maintainer');
  const canDelete = canRead && (e === 'owner' || t === 'owner');
  return { canRead, canWrite, canManage, canDelete };
}

describe('U1a computeAccess 全组合矩阵（200 组）', () => {
  it('每组合法与独立期望一致', () => {
    let n = 0;
    for (const vis of VIS) {
      for (const e of EXPLICIT) {
        for (const t of TEAM) {
          for (const admin of [false, true]) {
            const got = computeAccess({ visibility: vis, explicitRole: e, teamRole: t, isAdmin: admin });
            const want = expected(vis, e, t, admin);
            expect(got, `vis=${vis} e=${e} t=${t} admin=${admin}`).toEqual(want);
            n++;
          }
        }
      }
    }
    expect(n).toBe(200);
  });
});

describe('U1b 规范矩阵字面抽查（§3.5/§3.6）', () => {
  const probe = (vis: string, e: MemberRole | null, t: TeamRole | null) =>
    computeAccess({ visibility: vis, explicitRole: e, teamRole: t, isAdmin: false });

  it('R2 登录·无关用户：public-read 可读不可写；public-write 可读可写', () => {
    expect(probe('public-read', null, null)).toEqual({ canRead: true, canWrite: false, canManage: false, canDelete: false });
    expect(probe('public-write', null, null)).toEqual({ canRead: true, canWrite: true, canManage: false, canDelete: false });
    expect(probe('team-read', null, null)).toEqual({ canRead: false, canWrite: false, canManage: false, canDelete: false });
  });

  it('R3 团队成员·member：private 不可读；team-read 只读；team-write 可写', () => {
    expect(probe('private', null, 'member').canRead).toBe(false);
    expect(probe('team-read', null, 'member')).toEqual({ canRead: true, canWrite: false, canManage: false, canDelete: false });
    expect(probe('team-write', null, 'member').canWrite).toBe(true);
  });

  it('R4/R5 团队治理者：私有档严格隔离（不可读不可管）；非私有档可管理；删除仅团队 owner', () => {
    expect(probe('private', null, 'maintainer')).toEqual({ canRead: false, canWrite: false, canManage: false, canDelete: false });
    expect(probe('private', null, 'owner')).toEqual({ canRead: false, canWrite: false, canManage: false, canDelete: false });
    expect(probe('team-read', null, 'maintainer').canManage).toBe(true);
    expect(probe('team-read', null, 'maintainer').canDelete).toBe(false);
    expect(probe('team-read', null, 'owner').canDelete).toBe(true);
    expect(probe('public-read', null, 'owner').canDelete).toBe(true);
  });

  it('R6 显式 guest（非团队成员）：保底可读；写能力仅来自 team-write 团队成员身份或 public-write', () => {
    expect(probe('private', 'guest', null)).toEqual({ canRead: true, canWrite: false, canManage: false, canDelete: false });
    // 非团队成员时：team-write 档不授予写（该档面向团队成员）
    expect(probe('team-write', 'guest', null).canWrite).toBe(false);
    // public-write 档面向所有登录用户 → 可写
    expect(probe('public-write', 'guest', null).canWrite).toBe(true);
    expect(probe('team-read', 'guest', null).canWrite).toBe(false);
    // 并集语义：guest 同时是团队成员时，team-write 档位授予的写能力叠加
    expect(probe('team-write', 'guest', 'member').canWrite).toBe(true);
    expect(probe('team-write', 'guest', 'member').canRead).toBe(true);
  });

  it('R7 显式 editor：可写不可管理；R8 显式 owner/maintainer 管理边界', () => {
    expect(probe('private', 'editor', null)).toEqual({ canRead: true, canWrite: true, canManage: false, canDelete: false });
    expect(probe('private', 'maintainer', null)).toEqual({ canRead: true, canWrite: true, canManage: true, canDelete: false });
    expect(probe('private', 'owner', null)).toEqual({ canRead: true, canWrite: true, canManage: true, canDelete: true });
  });

  it('管理员全开', () => {
    expect(computeAccess({ visibility: 'private', explicitRole: null, teamRole: null, isAdmin: true })).toEqual({
      canRead: true, canWrite: true, canManage: true, canDelete: true,
    });
  });
});

describe('U4 归属转移前置条件矩阵', () => {
  const base = {
    project: { ownerType: 'user', ownerTeamId: null, visibility: 'private' },
    access: { canDelete: true, teamRole: null },
  } as const;

  it('个人 → 团队：操作者需目标团队 owner/maintainer', () => {
    expect(checkProjectTransfer({ ...base, targetType: 'team', targetTeam: { id: 't1', archived: false, myRole: 'owner' } }).ok).toBe(true);
    expect(checkProjectTransfer({ ...base, targetType: 'team', targetTeam: { id: 't1', archived: false, myRole: 'maintainer' } }).ok).toBe(true);
    expect(checkProjectTransfer({ ...base, targetType: 'team', targetTeam: { id: 't1', archived: false, myRole: 'member' } }).code).toBe('FORBIDDEN_TEAM_ROLE');
    expect(checkProjectTransfer({ ...base, targetType: 'team', targetTeam: null }).code).toBe('TARGET_TEAM_NOT_FOUND');
    expect(checkProjectTransfer({ ...base, targetType: 'team', targetTeam: { id: 't1', archived: true, myRole: 'owner' } }).code).toBe('TEAM_ARCHIVED');
  });

  it('团队 → 个人：仅团队 owner；team-* 档位需先调档', () => {
    const teamProj = { ownerType: 'team', ownerTeamId: 't1', visibility: 'private' } as const;
    expect(checkProjectTransfer({ project: teamProj, access: { canDelete: true, teamRole: 'owner' }, targetType: 'user' }).ok).toBe(true);
    expect(checkProjectTransfer({ project: teamProj, access: { canDelete: true, teamRole: 'maintainer' }, targetType: 'user' }).code).toBe('FORBIDDEN_TEAM_OWNER');
    expect(
      checkProjectTransfer({ project: { ...teamProj, visibility: 'team-read' }, access: { canDelete: true, teamRole: 'owner' }, targetType: 'user' }).code,
    ).toBe('TRANSFER_VISIBILITY_CONFLICT');
  });

  it('无 canDelete / 已是团队库转团队 / 已是个人库转个人：拒绝', () => {
    expect(checkProjectTransfer({ ...base, access: { canDelete: false, teamRole: null }, targetType: 'team', targetTeam: { id: 't1', archived: false, myRole: 'owner' } }).code).toBe('FORBIDDEN');
    expect(
      checkProjectTransfer({
        project: { ownerType: 'team', ownerTeamId: 't1', visibility: 'private' },
        access: { canDelete: true, teamRole: 'owner' },
        targetType: 'team',
        targetTeam: { id: 't2', archived: false, myRole: 'owner' },
      }).code,
    ).toBe('ALREADY_TEAM_OWNED');
    expect(checkProjectTransfer({ ...base, targetType: 'user' }).code).toBe('ALREADY_PERSONAL');
  });
});
