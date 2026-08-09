CREATE TYPE "public"."knowledge_domain" AS ENUM('identity', 'offerings', 'market', 'execution', 'growth', 'governance', 'capability', 'wisdom');--> statement-breakpoint
CREATE TYPE "public"."knowledge_item_status" AS ENUM('draft', 'archived');--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"domain" "knowledge_domain" NOT NULL,
	"classification" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" "knowledge_item_status" DEFAULT 'draft' NOT NULL,
	"author_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_items_org_status_idx" ON "knowledge_items" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_items_org_workspace_idx" ON "knowledge_items" USING btree ("organization_id","workspace_id");--> statement-breakpoint
CREATE INDEX "knowledge_items_org_domain_idx" ON "knowledge_items" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE INDEX "knowledge_items_org_created_idx" ON "knowledge_items" USING btree ("organization_id","created_at");