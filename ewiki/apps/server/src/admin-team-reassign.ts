import 'dotenv/config';
import { and, eq, isNull } from 'drizzle-orm';
import { loadConfig } from './config.js';
import { db } from './db/client.js';
import { projects, teams, users } from './db/schema.js';

/**
 * admin 团队归位脚本（TEAM-PERMISSIONS-DESIGN §9 B2）
 *
 * 把仍归属个人的文档库批量指派给指定团队并（可选）调整可见性档位。
 * 这是「存量库收敛到团队」的治理入口，解决 ADR-T4 目标：让团队真正接管存量库。
 *
 * 幂等：已归位（owner_type='team'）的库自然跳过；重复执行安全。
 *
 * 用法（在 apps/server 下）：
 *   pnpm --filter @ewiki/server run admin:team-reassign -- --team <teamId> [--user <email>] [--visibility <档位>] [--dry-run]
 *
 * 参数：
 *   --team <teamId>      目标团队 id（必填；团队需存在且未归档）
 *   --user <email>       限定只归位该用户拥有的个人库（缺省 = 全部用户）
 *   --visibility <档位>   归位后的可见性（缺省 team-read；可传 private/team-read/team-write/public-read/public-write）
 *   --dry-run            只统计预告影响范围，不实际写入
 *
 * 退出码：0 = 成功；1 = 参数/前置校验失败
 */

function parseArgs(argv: string[]): { teamId?: string; email?: string; visibility?: string; dryRun: boolean } {
  const out: { teamId?: string; email?: string; visibility?: string; dryRun: boolean } = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string | undefined => argv[i + 1];
    if (a === '--team') out.teamId = next();
    else if (a === '--user') out.email = next();
    else if (a === '--visibility') out.visibility = next();
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await loadConfig(); // 确保环境就绪（配置缺失会在此抛错）

  if (!args.teamId) {
    console.error('[admin-reassign] 缺参数: --team <teamId>（目标团队）');
    process.exit(1);
  }

  const [team] = await db.select().from(teams).where(eq(teams.id, args.teamId)).limit(1);
  if (!team) {
    console.error(`[admin-reassign] 团队不存在: ${args.teamId}`);
    process.exit(1);
  }
  if (team.archived) {
    console.error(`[admin-reassign] 目标团队已归档，不可接收文档库: ${team.name}`);
    process.exit(1);
  }

  const vis = args.visibility ?? 'team-read';
  const validVis = ['private', 'team-read', 'team-write', 'public-read', 'public-write'];
  if (!validVis.includes(vis)) {
    console.error(`[admin-reassign] 非法可见性档位: ${vis}（可选：${validVis.join(' / ')}）`);
    process.exit(1);
  }

  // 目标：仍归属个人（owner_type='user' 或历史空值）且未删除的库
  let ownerUserId: string | null = null;
  if (args.email) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, args.email)).limit(1);
    if (!u) {
      console.error(`[admin-reassign] 用户不存在: ${args.email}`);
      process.exit(1);
    }
    ownerUserId = u.id;
  }

  const cond = and(
    isNull(projects.deletedAt),
    eq(projects.ownerType, 'user'),
    ownerUserId ? eq(projects.ownerId, ownerUserId) : undefined,
  );
  const rows = await db
    .select({ id: projects.id, name: projects.name, ownerId: projects.ownerId, visibility: projects.visibility })
    .from(projects)
    .where(cond)
    .orderBy(projects.name);

  console.log(`\n[admin-reassign] 目标团队: ${team.name} (${team.id})`);
  console.log(`[admin-reassign] 可见性档位: ${vis}（dry-run=${args.dryRun}）`);
  if (ownerUserId) console.log(`[admin-reassign] 限定用户: ${args.email}`);
  console.log(`[admin-reassign] 命中待归位个人库: ${rows.length}\n`);

  if (rows.length === 0) {
    console.log('[admin-reassign] 无符合条件库，退出。');
    return;
  }

  for (const r of rows) {
    const line = `  · ${r.name}（可见性 ${r.visibility}）`;
    if (args.dryRun) {
      console.log(`[DRY-RUN] 将归位 → ${team.name}，调档 → ${vis}${line}`);
      continue;
    }
    await db
      .update(projects)
      .set({ ownerType: 'team', ownerTeamId: team.id, visibility: vis })
      .where(eq(projects.id, r.id));
    console.log(`[已归位] ${line} → team:${team.name}, vis:${vis}`);
  }

  console.log(`\n[admin-reassign] 完成：${args.dryRun ? `模拟 ${rows.length} 个` : `已归位 ${rows.length} 个`}。`);
}

main().catch((err) => {
  console.error('[admin-reassign] 执行失败:', err);
  process.exit(1);
});