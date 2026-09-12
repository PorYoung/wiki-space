ALTER TABLE "document_versions" ADD COLUMN "storage_ref" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "size" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "ext" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "mime" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "size" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "storage_ref" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_kind_check" CHECK ("documents"."kind" IN ('text','binary'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_storage_ref_check" CHECK (("documents"."kind" = 'binary') = ("documents"."storage_ref" IS NOT NULL));--> statement-breakpoint
-- 文件管理重构 P0：存量文档全部为仓库内 markdown 文本，回填类型元数据。
UPDATE "documents"
SET "ext" = 'md',
    "mime" = 'text/markdown',
    "size" = COALESCE(octet_length("content"), 0)
WHERE "ext" IS NULL;