-- 0003: 移除 sources / push_tokens，存储后端下沉到 projects；sync_jobs 改挂 project_id。
-- 一次性破坏性迁移：预检 + 回填 + 结构变更全部在单个 DO 块（单事务）内完成，任一断言失败整体回滚。
DO $$
BEGIN
  -- ---- 预检 1：存在 web/database 等不受支持的有效源则中止 ----
  IF EXISTS (
    SELECT 1 FROM sources
    WHERE deleted_at IS NULL AND type NOT IN ('git', 'local')
  ) THEN
    RAISE EXCEPTION '0003 abort: 存在 type 非 git/local 的有效 sources 行，需人工清洗后重跑';
  END IF;

  -- ---- 预检 2：契约假设每个有效项目至多 1 个未删除源 ----
  IF EXISTS (
    SELECT project_id FROM sources
    WHERE deleted_at IS NULL
    GROUP BY project_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '0003 abort: 存在项目持有多个有效 sources 行，需人工清洗后重跑';
  END IF;

  -- ---- 预检 3：sync_jobs 必须能全部映射回项目（sources 仅软删除，行仍在） ----
  IF EXISTS (
    SELECT 1 FROM sync_jobs j
    LEFT JOIN sources s ON s.id = j.source_id
    WHERE s.id IS NULL
  ) THEN
    RAISE EXCEPTION '0003 abort: 存在无法映射 sources 的 sync_jobs 行，需人工处理后重跑';
  END IF;

  -- ---- 1. projects 新增存储列（先全部可加，回填后再补约束） ----
  EXECUTE 'ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "storage_kind" text DEFAULT ''local'' NOT NULL';
  EXECUTE 'ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "storage_connection_id" uuid';
  EXECUTE 'ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "storage_config" jsonb DEFAULT ''{}''::jsonb NOT NULL';
  EXECUTE 'ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "default_branch" text';
  EXECUTE 'ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "auto_sync" boolean DEFAULT false NOT NULL';
  EXECUTE 'ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "interval_seconds" integer DEFAULT 0 NOT NULL';
  EXECUTE 'ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "storage_status" text DEFAULT ''connected'' NOT NULL';
  EXECUTE 'ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp with time zone';
  EXECUTE 'ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "last_error" text';

  -- ---- 2. sync_jobs 新增可空 project_id，回填后再置 NOT NULL ----
  EXECUTE 'ALTER TABLE "sync_jobs" ADD COLUMN IF NOT EXISTS "project_id" uuid';

  -- ---- 3. 回填 Git 项目存储列（凭据引用 config_public.connectionId，令牌不复制） ----
  UPDATE projects p SET
    storage_kind = 'git',
    storage_connection_id = (s.config_public ->> 'connectionId')::uuid,
    storage_config = s.config_public,
    default_branch = s.default_branch,
    auto_sync = s.auto_sync,
    interval_seconds = s.interval_seconds,
    storage_status = s.status,
    last_synced_at = s.last_synced_at,
    last_error = s.last_error
  FROM sources s
  WHERE s.project_id = p.id
    AND s.deleted_at IS NULL
    AND s.type = 'git';

  -- Git 项目必须解析出存储源引用，否则中止（避免出现无凭据的 git 后端）
  IF EXISTS (
    SELECT 1 FROM projects WHERE storage_kind = 'git' AND storage_connection_id IS NULL
  ) THEN
    RAISE EXCEPTION '0003 abort: Git 项目回填后 storage_connection_id 为空（config_public.connectionId 缺失或非法）';
  END IF;

  -- ---- 4. 回填 Local 项目存储列（connection 保持 NULL；path 在 config_public 中透传） ----
  UPDATE projects p SET
    storage_kind = 'local',
    storage_config = s.config_public,
    default_branch = s.default_branch,
    auto_sync = s.auto_sync,
    interval_seconds = s.interval_seconds,
    storage_status = s.status,
    last_synced_at = s.last_synced_at,
    last_error = s.last_error
  FROM sources s
  WHERE s.project_id = p.id
    AND s.deleted_at IS NULL
    AND s.type = 'local';

  -- ---- 5. 回填 sync_jobs.project_id ----
  UPDATE sync_jobs j
  SET project_id = s.project_id
  FROM sources s
  WHERE j.source_id = s.id;

  -- ---- 6. 结构收口：旧约束/列删除，新约束/外键/索引建立 ----
  EXECUTE 'ALTER TABLE "sync_jobs" DROP CONSTRAINT IF EXISTS "sync_jobs_idempotency_key_unique"';
  EXECUTE 'ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_source_id_sources_id_fk"';
  EXECUTE 'ALTER TABLE "sync_jobs" DROP CONSTRAINT IF EXISTS "sync_jobs_source_id_sources_id_fk"';
  EXECUTE 'ALTER TABLE "documents" DROP COLUMN IF EXISTS "source_id"';
  EXECUTE 'ALTER TABLE "sync_jobs" DROP COLUMN "source_id"';
  EXECUTE 'ALTER TABLE "sync_jobs" ALTER COLUMN "project_id" SET NOT NULL';
  EXECUTE 'ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action';
  EXECUTE 'ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_project_commit_uq" UNIQUE ("project_id","commit_hash")';

  EXECUTE 'ALTER TABLE "projects" ADD CONSTRAINT "projects_storage_connection_id_storage_connections_id_fk" FOREIGN KEY ("storage_connection_id") REFERENCES "public"."storage_connections"("id") ON DELETE no action ON UPDATE no action';
  EXECUTE 'ALTER TABLE "projects" ADD CONSTRAINT "projects_storage_kind_check" CHECK ("projects"."storage_kind" IN (''git'',''local''))';
  EXECUTE 'ALTER TABLE "projects" ADD CONSTRAINT "projects_storage_status_check" CHECK ("projects"."storage_status" IN (''connected'',''synced'',''syncing'',''error''))';
  EXECUTE 'ALTER TABLE "projects" ADD CONSTRAINT "projects_storage_connection_check" CHECK (("projects"."storage_kind" = ''local'') = ("projects"."storage_connection_id" IS NULL))';

  -- ---- 7. 删除旧表（push_tokens 无任何消费者；sources 数据已下沉，不保留视图/别名） ----
  EXECUTE 'DROP TABLE IF EXISTS "push_tokens"';
  EXECUTE 'DROP TABLE IF EXISTS "sources"';
END $$;
