DROP INDEX "brain_permission_grants_org_scoped_active_unique";--> statement-breakpoint
DROP INDEX "brain_permission_grants_workspace_scoped_active_unique";--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ALTER COLUMN "grantee_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_type" "access_actor_type";--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ADD COLUMN "grantee_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ADD COLUMN "grantee_type" "access_actor_type" DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD COLUMN "created_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD COLUMN "created_by_type" "access_actor_type";--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "author_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "author_type" "access_actor_type";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ADD CONSTRAINT "brain_permission_grants_grantee_agent_org_fk" FOREIGN KEY ("grantee_agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_author_agent_org_fk" FOREIGN KEY ("author_agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_actor_agent_id_idx" ON "audit_logs" USING btree ("actor_agent_id");--> statement-breakpoint
CREATE INDEX "brain_permission_grants_org_grantee_agent_active_idx" ON "brain_permission_grants" USING btree ("organization_id","grantee_agent_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_permission_grants_org_scoped_active_unique" ON "brain_permission_grants" USING btree ("organization_id","domain","grantee_user_id","grantee_agent_id","capability") WHERE "brain_permission_grants"."workspace_id" IS NULL AND "brain_permission_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brain_permission_grants_workspace_scoped_active_unique" ON "brain_permission_grants" USING btree ("organization_id","domain","workspace_id","grantee_user_id","grantee_agent_id","capability") WHERE "brain_permission_grants"."workspace_id" IS NOT NULL AND "brain_permission_grants"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_at_most_one_actor_check" CHECK (NOT ("audit_logs"."actor_user_id" IS NOT NULL AND "audit_logs"."actor_agent_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ADD CONSTRAINT "brain_permission_grants_exactly_one_grantee_check" CHECK ((("brain_permission_grants"."grantee_user_id" IS NOT NULL)::int + ("brain_permission_grants"."grantee_agent_id" IS NOT NULL)::int) = 1);--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_at_most_one_creator_check" CHECK (NOT ("knowledge_item_versions"."created_by_user_id" IS NOT NULL AND "knowledge_item_versions"."created_by_agent_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_at_most_one_author_check" CHECK (NOT ("knowledge_items"."author_user_id" IS NOT NULL AND "knowledge_items"."author_agent_id" IS NOT NULL));