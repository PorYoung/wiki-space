ALTER TABLE "documents" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_sites" ADD COLUMN "template_id" text;