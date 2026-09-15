// 项目/团队级权限（唯一事实源；TEAM-PERMISSIONS-DESIGN §3.4 / §3.6）：
//   有效权限 = 显式成员角色 ∪ 团队隐式档位 ∪ 公开档位（并集/max 语义，与 GitLab 一致）
//   不变式：管理/删除以可读为前提（不存在"看不见却能改"的资源）
//   私有档严格隔离：团队 owner/maintainer 对"私有"团队库亦不可见不可管（兜底 = 全局 admin）
//   team-read/team-write 档位的隐式授权仅对 status='active' 的团队成员生效
import { and, eq, isNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/client.js';
import { projectMembers, projects, teamMembers, teams } from '../db/schema.js';

export type ProjectRow = typeof projects.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;
export type MemberRole = 'owner' | 'maintainer' | 'editor' | 'guest';
export type TeamRole = 'owner' | 'maintainer' | 'member';

export const WRITE_ROLES: MemberRole[] = ['owner', 'maintainer', 'editor'];
export const MANAGE_ROLES: MemberRole[] = ['owner', 'maintainer'];
export const TEAM_GOVERN_ROLES: TeamRole[] = ['owner', 'maintainer'];

export interface ProjectAccess {
  project: ProjectRow;
  /** project_members.role（显式成员；null = 非成员） */
  explicitRole: MemberRole | null;
  /** team_members.role（仅 owner_type='team' 且为成员时非空） */
  teamRole: TeamRole | null;
  /** 兼容字段：显式角色（旧前端据此推导 UI 入口；= null 表示非成员） */
  role: MemberRole | null;
  canRead: boolean;
  canWrite: boolean;
  canManage: boolean;
  canDelete: boolean;
}

/** 纯函数：由三维输入计算有效权限（单测 U1 全组合锁定；projectAccess 与本函数共用同一规则） */
export function computeAccess(input: {
  visibility: string;
  explicitRole: MemberRole | null;
  teamRole: TeamRole | null;
  isAdmin: boolean;
}): { canRead: boolean; canWrite: boolean; canManage: boolean; canDelete: boolean } {
  const { visibility: vis, explicitRole, teamRole, isAdmin } = input;
  if (isAdmin) return { canRead: true, canWrite: true, canManage: true, canDelete: true };

  const isTeamMember = teamRole !== null;
  const canRead =
    explicitRole !== null ||
    (isTeamMember && (vis === 'team-read' || vis === 'team-write')) ||
    vis === 'public-read' ||
    vis === 'public-write';
  const canWrite =
    (explicitRole !== null && WRITE_ROLES.includes(explicitRole)) ||
    (isTeamMember && vis === 'team-write') ||
    vis === 'public-write';
  // 管理/删除以可读为前提（不变式）
  const canManage =
    canRead &&
    ((explicitRole !== null && MANAGE_ROLES.includes(explicitRole)) ||
      (teamRole !== null && TEAM_GOVERN_ROLES.includes(teamRole)));
  const canDelete = canRead && (explicitRole === 'owner' || teamRole === 'owner');
  return { canRead, canWrite, canManage, canDelete };
}

export async function projectAccess(
  projectId: string,
  userId: string,
  globalRole: string,
): Promise<ProjectAccess> {
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
  const explicitRole = (member?.role ?? null) as MemberRole | null;

  let teamRole: TeamRole | null = null;
  if (project.ownerType === 'team' && project.ownerTeamId) {
    const [tm] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, project.ownerTeamId),
          eq(teamMembers.userId, userId),
          eq(teamMembers.status, 'active'),
        ),
      )
      .limit(1);
    teamRole = (tm?.role ?? null) as TeamRole | null;
  }

  const caps = computeAccess({
    visibility: project.visibility,
    explicitRole,
    teamRole,
    isAdmin: globalRole === 'admin',
  });
  return { project, explicitRole, teamRole, role: explicitRole, ...caps };
}

/**
 * 「我可读的全部项目 id」子查询 —— 所有列表/搜索/动态流的可见性过滤必须复用本函数，
 * 禁止再手写 visibility 条件（历史三处手写 SQL 即漂移根源：routes.ts 旧 353/782/990）。
 */
export function readableProjectIdsSql(uid: string) {
  return sql`(select p.id from projects p where p.deleted_at is null and (
    exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = ${uid})
    or p.visibility in ('public-read','public-write')
    or (p.owner_type = 'team' and p.visibility in ('team-read','team-write') and exists (
          select 1 from team_members tm
           where tm.team_id = p.owner_team_id and tm.user_id = ${uid} and tm.status = 'active'))
  ))`;
}

/** 「我可读的全部项目 id」物化为数组：检索（GET /api/v1/search）等需要把可读集合
 *  作为白名单参数下推的场景（SEARCH-VECTOR-DESIGN §7.1）。与 readableProjectIdsSql
 *  同一口径 —— 本函数只是该子查询的执行形态，禁止另行手写可见性条件。 */
export async function readableProjectIds(uid: string): Promise<string[]> {
  const rows = (await db.execute(
    sql`select id from ${readableProjectIdsSql(uid)} as t(id)`,
  )) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

// ---- 匿名可读集合（OPEN-API-MCP-DESIGN §6.2，D1 平台公开面专用）----
// uid=null 的退化口径：仅 public-* 档且未删除。是既有单口径的参数退化，不是平行实现。
// 站点维度（/sites/:slug/search）不走本函数：发布本身已是显式公开动作，范围 = 发布清单。

export function anonymousReadableProjectIdsSql() {
  return sql`(select p.id from projects p where p.deleted_at is null and p.visibility in ('public-read','public-write'))`;
}

export async function anonymousReadableProjectIds(): Promise<string[]> {
  const rows = (await db.execute(
    sql`select id from ${anonymousReadableProjectIdsSql()} as t(id)`,
  )) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// 团队访问（TEAM-PERMISSIONS-DESIGN §3.6）
// ---------------------------------------------------------------------------

export interface TeamAccess {
  team: TeamRow;
  /** 当前用户在团队内的角色（null = 非成员） */
  role: TeamRole | null;
  isMember: boolean;
  /** 管理成员（owner/maintainer）/ 管理团队设置（owner，含归档） */
  canManageMembers: boolean;
  canManageTeam: boolean;
  isAdmin: boolean;
}

export async function teamAccess(teamId: string, userId: string, globalRole: string): Promise<TeamAccess> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new HTTPException(404, { message: 'NOT_FOUND' });

  const [member] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId), eq(teamMembers.status, 'active')))
    .limit(1);
  const role = (member?.role ?? null) as TeamRole | null;
  const isAdmin = globalRole === 'admin';

  return {
    team,
    role,
    isMember: role !== null,
    canManageMembers: isAdmin || role === 'owner' || role === 'maintainer',
    canManageTeam: isAdmin || role === 'owner',
    isAdmin,
  };
}

// ---------------------------------------------------------------------------
// 归属转移前置条件（TEAM-PERMISSIONS-DESIGN §5.2 P3' 转移规则表）
// ---------------------------------------------------------------------------

export interface TransferCheckParams {
  project: Pick<ProjectRow, 'ownerType' | 'ownerTeamId' | 'visibility'>;
  access: Pick<ProjectAccess, 'canDelete' | 'teamRole'>;
  targetType: 'user' | 'team';
  /** 目标团队（targetType='team' 时必填）：archived 与操作者在目标团队中的角色 */
  targetTeam?: { id: string; archived: boolean; myRole: TeamRole | null } | null;
}

export function checkProjectTransfer(p: TransferCheckParams): { ok: boolean; code?: string; message?: string } {
  if (!p.access.canDelete) {
    return { ok: false, code: 'FORBIDDEN', message: '需要库 owner 或团队 owner 权限' };
  }
  if (p.targetType === 'team') {
    if (p.project.ownerType === 'team') {
      return { ok: false, code: 'ALREADY_TEAM_OWNED', message: '团队库暂不支持直接转移到其他团队' };
    }
    if (!p.targetTeam) {
      return { ok: false, code: 'TARGET_TEAM_NOT_FOUND', message: '目标团队不存在' };
    }
    if (p.targetTeam.archived) {
      return { ok: false, code: 'TEAM_ARCHIVED', message: '目标团队已归档，不可接收文档库' };
    }
    // 防普通成员把库塞进团队：操作者必须是目标团队 owner/maintainer
    if (p.targetTeam.myRole !== 'owner' && p.targetTeam.myRole !== 'maintainer') {
      return { ok: false, code: 'FORBIDDEN_TEAM_ROLE', message: '需要目标团队 owner/maintainer 权限才能接收文档库' };
    }
    return { ok: true };
  }

  // targetType === 'user'
  if (p.project.ownerType !== 'team') {
    return { ok: false, code: 'ALREADY_PERSONAL', message: '该库已是个人库' };
  }
  // 团队资产转出：仅团队 owner（防成员转走团队资产；显式库 owner 不豁免，可改走团队 owner 操作）
  if (p.access.teamRole !== 'owner') {
    return { ok: false, code: 'FORBIDDEN_TEAM_OWNER', message: '团队库转回个人仅团队 owner 可操作' };
  }
  if (p.project.visibility.startsWith('team-')) {
    return { ok: false, code: 'TRANSFER_VISIBILITY_CONFLICT', message: '团队档位与个人归属冲突：请先将可见性调整为 私有/公开，再转移' };
  }
  return { ok: true };
}

export function denyIfNot(cond: boolean, message = 'FORBIDDEN'): void {
  if (!cond) throw new HTTPException(403, { message });
}
