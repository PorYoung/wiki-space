import { describe, expect, it } from 'vitest';
import {
  CreateProjectSchema,
  CreateTeamSchema,
  ProjectSchema,
  PublishSiteSchema,
  TransferProjectSchema,
  UpdateTeamMemberSchema,
  Visibility,
} from '../src/schemas/index.js';

describe('Visibility 五态（TEAM-PERMISSIONS §3.3 ADR-T1）', () => {
  it('接受五态合法值', () => {
    for (const v of ['private', 'team-read', 'team-write', 'public-read', 'public-write']) {
      expect(Visibility.safeParse(v).success).toBe(true);
    }
  });

  it('拒绝旧三态遗留值（team/public）', () => {
    expect(Visibility.safeParse('team').success).toBe(false);
    expect(Visibility.safeParse('public').success).toBe(false);
  });
});

describe('ProjectSchema', () => {
  it('接受合法项目（含 owner_type 默认）', () => {
    const p = ProjectSchema.parse({
      id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      name: 'EdgeAgent',
      description: null,
      color: null,
      visibility: 'public-read',
      template: null,
      storageKind: 'local',
      storageConnectionId: null,
      storageConfig: {},
      defaultBranch: null,
      autoSync: false,
      intervalSeconds: 0,
      storageStatus: 'connected',
      lastSyncedAt: null,
      lastError: null,
      docCount: 12,
      createdAt: '2026-09-06T00:00:00.000Z',
    });
    expect(p.visibility).toBe('public-read');
    expect(p.ownerType).toBe('user');
    expect(p.ownerTeamId).toBeNull();
  });

  it('拒绝非法可见性', () => {
    expect(() =>
      ProjectSchema.parse({
        id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        name: 'x',
        visibility: 'everyone',
        createdAt: '2026-09-06T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

// U3（TEAM-PERMISSIONS-DESIGN §8.1）：创建/转移/团队校验器
describe('CreateProjectSchema 归属与可见性联动', () => {
  const base = { name: 'demo' };

  it('个人库 + 私有/公开档 → 通过', () => {
    expect(CreateProjectSchema.safeParse({ ...base, visibility: 'private' }).success).toBe(true);
    expect(CreateProjectSchema.safeParse({ ...base, visibility: 'public-write' }).success).toBe(true);
  });

  it('个人库 + team-* 档 → 拒（需先归属团队）', () => {
    const r = CreateProjectSchema.safeParse({ ...base, visibility: 'team-read' });
    expect(r.success).toBe(false);
  });

  it('团队归属缺 ownerTeamId → 拒；个人归属携带 ownerTeamId → 拒', () => {
    expect(CreateProjectSchema.safeParse({ ...base, ownerType: 'team' }).success).toBe(false);
    expect(
      CreateProjectSchema.safeParse({ ...base, ownerType: 'user', ownerTeamId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }).success,
    ).toBe(false);
  });

  it('团队归属 + team-* 档 → 通过', () => {
    const r = CreateProjectSchema.safeParse({
      ...base,
      ownerType: 'team',
      ownerTeamId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      visibility: 'team-write',
    });
    expect(r.success).toBe(true);
  });
});

describe('TransferProjectSchema 两步确认契约', () => {
  it('转移到团队需 targetTeamId + confirmed=true', () => {
    expect(TransferProjectSchema.safeParse({ targetType: 'team', confirmed: true }).success).toBe(false);
    expect(
      TransferProjectSchema.safeParse({
        targetType: 'team',
        targetTeamId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        confirmed: true,
      }).success,
    ).toBe(true);
    expect(TransferProjectSchema.safeParse({ targetType: 'team', targetTeamId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }).success).toBe(false);
  });
});

describe('CreateTeamSchema / UpdateTeamMemberSchema', () => {
  it('团队 slug 仅小写字母数字连字符；缺省允许自动生成', () => {
    expect(CreateTeamSchema.safeParse({ name: '产品团队' }).success).toBe(true);
    expect(CreateTeamSchema.safeParse({ name: 'x', slug: 'Product-Team' }).success).toBe(false);
    expect(CreateTeamSchema.safeParse({ name: 'x', slug: 'product-team' }).success).toBe(true);
  });

  it('团队成员变更需 role 或 remove 至少其一', () => {
    expect(UpdateTeamMemberSchema.safeParse({}).success).toBe(false);
    expect(UpdateTeamMemberSchema.safeParse({ role: 'maintainer' }).success).toBe(true);
    expect(UpdateTeamMemberSchema.safeParse({ remove: true }).success).toBe(true);
  });
});

describe('PublishSiteSchema', () => {
  it('slug 只允许小写字母数字连字符（PRD F35）', () => {
    expect(
      PublishSiteSchema.safeParse({
        id: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
        projectId: '3f2504e0-4f89-11d3-9a0c-0305e82c3303',
        mode: 'hosted',
        slug: 'EdgeAgent',
        schedule: 'manual',
        autoSync: false,
      }).success,
    ).toBe(false);
  });
});
