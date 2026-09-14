import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

// ---------------------------------------------------------------------------
// 项目内角色/权限共享 hook（TEAM-PERMISSIONS §5.2 P4'）
//
// 数据来源：GET /api/v1/projects/:id/members 响应中的服务端权威能力位：
//   myRole      显式成员角色（null = 非成员；team/public 档位的隐式读者）
//   explicitRole/teamRole  两层角色（显式成员 / 团队成员）
//   canWrite / canManage / canDelete  服务端 projectAccess 计算结果（唯一事实源）
// 与 ProjectLayout / MembersPage 共用 ['project-members', projectId] queryKey，命中同一份缓存。
//
// 加载中默认 false（§11-7 收敛）：宁可晚 100ms 显示按钮，也不给只读用户短暂闪现管理入口；
// 后端对写接口均有 403 兜底，此处只影响 UI 入口。
// ---------------------------------------------------------------------------

export interface ProjectRoleInfo {
  /** 当前用户在项目内的显式角色；null = 非成员（隐式读者） */
  myRole: string | null;
  /** 团队成员角色（仅团队库非空） */
  teamRole: string | null;
  /** 库归属：user=个人库 / team=团队库 */
  ownerType: string;
  ownerTeamId: string | null;
  /** 可编辑文档/创建文档/触发同步 */
  canWrite: boolean;
  /** 可管理：改库设置/成员/发布配置 */
  canManage: boolean;
  /** 可删除/转移归属（库 owner ∪ 团队 owner） */
  canDelete: boolean;
}

interface MembersResp {
  items: unknown[];
  total: number;
  myRole?: string | null;
  explicitRole?: string | null;
  teamRole?: string | null;
  canWrite?: boolean;
  canManage?: boolean;
  canDelete?: boolean;
  ownerType?: string;
  ownerTeamId?: string | null;
  visibility?: string;
}

export function useProjectRole(projectId: string | undefined): ProjectRoleInfo {
  const { data } = useQuery<MembersResp>({
    queryKey: ['project-members', projectId],
    queryFn: () => apiFetch<MembersResp>(`/api/v1/projects/${projectId}/members`),
    enabled: !!projectId,
    // 角色是权限判定的次要数据，失败时不阻塞页面（后端 403 兜底）
    retry: false,
  });

  return {
    myRole: data ? (data.myRole ?? null) : null,
    teamRole: data ? (data.teamRole ?? null) : null,
    ownerType: data?.ownerType ?? 'user',
    ownerTeamId: data?.ownerTeamId ?? null,
    canWrite: data?.canWrite ?? false,
    canManage: data?.canManage ?? false,
    canDelete: data?.canDelete ?? false,
  };
}
