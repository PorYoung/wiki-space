// 可见性五态共享工具（TEAM-PERMISSIONS-DESIGN §3.3 ADR-T1 / §6.2）
// 文案与后端语义逐字对齐（历史问题：同一枚举在 4 处 UI 文案互相矛盾，本文件为前端唯一事实源）
export type Visibility = 'private' | 'team-read' | 'team-write' | 'public-read' | 'public-write';

export type VisibilityGroup = 'private' | 'team' | 'public';

export interface VisibilityMeta {
  key: Visibility;
  /** 完整名称（选择器标题用） */
  label: string;
  /** 短标签（徽章/筛选 pill 用） */
  short: string;
  /** 语义描述（与后端权限矩阵逐字一致） */
  desc: string;
  group: VisibilityGroup;
  /** 该档位是否授予"写"（面向其覆盖对象） */
  write: boolean;
}

export const VISIBILITY_META: Record<Visibility, VisibilityMeta> = {
  private: {
    key: 'private',
    label: '私有',
    short: '私有',
    desc: '仅你与库成员可见',
    group: 'private',
    write: false,
  },
  'team-read': {
    key: 'team-read',
    label: '团队 · 只读',
    short: '团队',
    desc: '团队成员可查看',
    group: 'team',
    write: false,
  },
  'team-write': {
    key: 'team-write',
    label: '团队 · 可写',
    short: '团队',
    desc: '团队成员可查看并编辑',
    group: 'team',
    write: true,
  },
  'public-read': {
    key: 'public-read',
    label: '公开 · 只读',
    short: '公开',
    desc: '所有登录用户可查看',
    group: 'public',
    write: false,
  },
  'public-write': {
    key: 'public-write',
    label: '公开 · 可写',
    short: '公开',
    desc: '所有登录用户可查看并编辑',
    group: 'public',
    write: true,
  },
};

export const VISIBILITY_ORDER: Visibility[] = ['private', 'team-read', 'team-write', 'public-read', 'public-write'];

/** 团队档位（需库归属团队；个人库禁用） */
export const isTeamScope = (v: string | null | undefined): boolean => !!v && v.startsWith('team-');

/** 公开档位 */
export const isPublicScope = (v: string | null | undefined): boolean => !!v && v.startsWith('public-');

export function visibilityMeta(v: string | null | undefined): VisibilityMeta {
  return VISIBILITY_META[(v as Visibility) ?? 'private'] ?? VISIBILITY_META.private;
}

/** 徽章/列表用短标签 */
export function visibilityLabel(v: string | null | undefined): string {
  return visibilityMeta(v).short;
}

/** 仅"公开"档才出现在 Explore 范围（公开·读写同样可浏览） */
export function isPubliclyReadable(v: string | null | undefined): boolean {
  return isPublicScope(v);
}
