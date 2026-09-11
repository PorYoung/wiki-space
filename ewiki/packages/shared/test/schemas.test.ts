import { describe, expect, it } from 'vitest';
import { ProjectSchema, PublishSiteSchema } from '../src/schemas/index.js';

describe('ProjectSchema', () => {
  it('接受合法项目', () => {
    const p = ProjectSchema.parse({
      id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      name: 'EdgeAgent',
      description: null,
      color: null,
      visibility: 'team',
      template: null,
      docCount: 12,
      createdAt: '2026-09-06T00:00:00.000Z',
    });
    expect(p.visibility).toBe('team');
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
