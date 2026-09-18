CREATE TABLE "git_pending_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid,
	"path" text NOT NULL,
	"op" text NOT NULL,
	"from_path" text,
	"kind" text DEFAULT 'text' NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"actor_email" text DEFAULT '' NOT NULL,
	"message" text,
	"commit_hash" text,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "git_pending_ops_op_check" CHECK ("git_pending_ops"."op" IN ('upsert','delete','move','checkpoint'))
);
--> statement-breakpoint
ALTER TABLE "git_pending_ops" ADD CONSTRAINT "git_pending_ops_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_pending_ops" ADD CONSTRAINT "git_pending_ops_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_pending_ops" ADD CONSTRAINT "git_pending_ops_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "git_pending_ops_pending_idx" ON "git_pending_ops" USING btree ("project_id","seq") WHERE consumed_at IS NULL;--> statement-breakpoint
CREATE INDEX "git_pending_ops_document_idx" ON "git_pending_ops" USING btree ("document_id") WHERE consumed_at IS NULL;