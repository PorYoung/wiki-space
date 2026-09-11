import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

// ---------------------------------------------------------------------------
// 项目内角色/权限共享 hook
//
// 数据源：GET /api/v1/projects/:id/members 响应中的 myRole（后端 projectAccess 推导：
//   - owner/maintainer/editor/guest = project_members 显式成员
//   - null = 非成员的隐式只读读者（经 team/public 可见性访问）
//   - 全局 admin 兜底 maintainer）
// 与 ProjectLayout / MembersPage 共用 ['project-members', projectId] queryKey，
// 命中同一份 React Query 缓存，不会产生额外请求。
//
// 角色未返回（加载中）时按可写/可管理处理，避免有权限用户看到按钮闪烁；
// 与 MembersPage 的既有约定一致。后端对各写接口均有 403 兜底，此处只影响 UI 入口。
// ---------------------------------------------------------------------------

const WRITE_ROLES = new Set(['owner', 'maintainer', 'editor']);
const MANAGE_ROLES = new Set(['owner', 'maintainer']);

export interface ProjectRoleInfo {
  /** 当前用户在项目内的角色；null = 非成员（隐式只读读者） */
  myRole: string | null;
  /** 可编辑文档/创建文档/触发同步（owner/maintainer/editor） */
  canWrite: boolean;
  /** 可管理：重命名/删除项目、数据源配置、成员管理、发布配置（owner/maintainer） */
  canManage: boolean;
}

interface MembersResp {
  items: unknown[];
  total: number;
  myRole?: string | null;
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

  // 未加载完成时按可写/可管理处理（避免闪烁）；加载失败时同样放开 UI，由后端接口拦截
  const resolved = data ? (data.myRole ?? null) : 'owner';
  return {
    myRole: data ? (data.myRole ?? null) : null,
    canWrite: WRITE_ROLES.has(resolved ?? ''),
    canManage: MANAGE_ROLES.has(resolved ?? ''),
  };
}
