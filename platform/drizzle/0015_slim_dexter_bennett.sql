CREATE TYPE "public"."access_actor_type" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TABLE "access_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_user_id" uuid,
	"actor_type" "access_actor_type" NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"domain" "knowledge_domain",
	"workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_log_entries" ADD CONSTRAINT "access_log_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log_entries" ADD CONSTRAINT "access_log_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_entries_org_created_idx" ON "access_log_entries" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "access_log_entries_org_actor_idx" ON "access_log_entries" USING btree ("organization_id","actor_user_id");