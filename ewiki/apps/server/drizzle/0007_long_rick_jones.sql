CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"invited_by" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_user_uq" UNIQUE("team_id","user_id"),
	CONSTRAINT "team_members_role_check" CHECK ("team_members"."role" IN ('owner','maintainer','member'))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"owner_id" uuid NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug"),
	CONSTRAINT "teams_visibility_check" CHECK ("teams"."visibility" IN ('private','internal'))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_team_id" uuid;--> statement-breakpoint
-- 存量可见性等价映射（TEAM-PERMISSIONS-DESIGN §4 / ADR-T4）：
--   旧 team 的真实语义 = 全平台登录可读（permissions.ts 旧实现 canRead = visibility !== 'private'），
--   与旧 public 完全相同 → 两者统一映射为 public-read（信息无损、读者无感知）。
--   新档位 team-read/team-write 不自动授予任何存量库（需显式指派团队归属后再调档）。
UPDATE "projects" SET "visibility" = 'public-read' WHERE "visibility" IN ('team','public');--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_team_id_teams_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_visibility_check" CHECK ("projects"."visibility" IN ('private','team-read','team-write','public-read','public-write'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_check" CHECK (("projects"."owner_type" = 'user') = ("projects"."owner_team_id" IS NULL));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_scope_check" CHECK ("projects"."visibility" NOT IN ('team-read','team-write') OR "projects"."owner_type" = 'team');