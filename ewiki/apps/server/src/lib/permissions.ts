// 项目级权限校验（越权拦截）：
//   public  → 任何已登录用户可读；team → 已登录用户可读；private → 仅成员可读
//   写操作需成员角色 editor 及以上（owner/maintainer/editor）；guest 只读
import { and, eq, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/client.js';
import { projectMembers, projects } from '../db/schema.js';

export type ProjectRow = typeof projects.$inferSelect;
export type MemberRole = 'owner' | 'maintainer' | 'editor' | 'guest';

export const WRITE_ROLES: MemberRole[] = ['owner', 'maintainer', 'editor'];
export const MANAGE_ROLES: MemberRole[] = ['owner', 'maintainer'];

export interface ProjectAccess {
  project: ProjectRow;
  role: MemberRole | null;
  canRead: boolean;
  canWrite: boolean;
  canManage: boolean;
}

export async function projectAccess(projectId: string, userId: string, globalRole: string): Promise<ProjectAccess> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) throw new HTTPException(404, { message: 'NOT_FOUND' });

  const [member] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);

  const role = (member?.role ?? null) as MemberRole | null;
  if (globalRole === 'admin') {
    return { project, role: role ?? 'maintainer', canRead: true, canWrite: true, canManage: true };
  }
  const canRead = !!role || project.visibility !== 'private';
  const canWrite = !!role && (WRITE_ROLES as string[]).includes(role);
  const canManage = !!role && (MANAGE_ROLES as string[]).includes(role);
  return { project, role, canRead, canWrite, canManage };
}

export function denyIfNot(cond: boolean, message = 'FORBIDDEN'): void {
  if (!cond) throw new HTTPException(403, { message });
}
