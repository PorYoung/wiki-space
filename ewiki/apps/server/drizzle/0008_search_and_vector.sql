-- SEARCH-VECTOR-DESIGN §5.1：检索扩展 + 全文生成列 + 向量 chunk 表 + 构建台账
-- 前置：扩展与中文分词配置。chinese_zh 保证存在 —— zhparser 可用则中文分词（n/v/a/i/e/l 词性映射），
-- 否则 COPY simple 兜底（可用性优先，分词质量降级；配置名恒定使查询侧无需分支）。
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese_zh') THEN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'zhparser') THEN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS zhparser';
      EXECUTE 'CREATE TEXT SEARCH CONFIGURATION chinese_zh (PARSER = zhparser)';
      EXECUTE 'ALTER TEXT SEARCH CONFIGURATION chinese_zh ADD MAPPING FOR n,v,a,i,e,l WITH simple';
    ELSE
      EXECUTE 'CREATE TEXT SEARCH CONFIGURATION chinese_zh (COPY = pg_catalog.simple)';
    END IF;
  END IF;
  -- 短词复合切分：提升中文检索召回（自定义 GUC，扩展缺席时为占位设置，无害）
  EXECUTE 'ALTER DATABASE ' || quote_ident(current_database()) || ' SET zhparser.multi_short = on';
END
$$;--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"chunk_no" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"heading_path" text,
	"embedding" vector(1024),
	"embedding_model" text,
	"token_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_doc_no_uq" UNIQUE("document_id","chunk_no")
);
--> statement-breakpoint
CREATE TABLE "index_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text DEFAULT 'vector' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_docs" integer DEFAULT 0 NOT NULL,
	"done_docs" integer DEFAULT 0 NOT NULL,
	"failed_docs" integer DEFAULT 0 NOT NULL,
	"cursor_doc" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "index_builds_kind_check" CHECK ("index_builds"."kind" IN ('vector','vector-rebuild')),
	CONSTRAINT "index_builds_status_check" CHECK ("index_builds"."status" IN ('pending','running','done','failed','canceled'))
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(coalesce(to_tsvector('chinese_zh', coalesce(title, '')), ''::tsvector), 'A') ||
      setweight(coalesce(to_tsvector('chinese_zh', coalesce(content, '')), ''::tsvector), 'B')
    ) STORED;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "search_config" jsonb DEFAULT '{"fts":true,"vector":false}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_builds" ADD CONSTRAINT "index_builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_chunks_project_idx" ON "document_chunks" USING btree ("project_id","document_id");--> statement-breakpoint
CREATE INDEX "document_chunks_embedding_hnsw" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "documents_search_vector_gin" ON "documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "documents_title_trgm_gin" ON "documents" USING gin ("title" gin_trgm_ops);