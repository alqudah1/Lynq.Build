CREATE TYPE "public"."brain_capability" AS ENUM('read', 'draft_write', 'edit_own_draft', 'edit_any_draft', 'approve', 'archive', 'purge', 'manage_permissions');--> statement-breakpoint
CREATE TABLE "brain_permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"domain" "knowledge_domain" NOT NULL,
	"workspace_id" uuid,
	"grantee_user_id" uuid NOT NULL,
	"capability" "brain_capability" NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"granted_by_user_id" uuid,
	"reason" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ADD CONSTRAINT "brain_permission_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ADD CONSTRAINT "brain_permission_grants_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ADD CONSTRAINT "brain_permission_grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ADD CONSTRAINT "brain_permission_grants_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ADD CONSTRAINT "brain_permission_grants_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ADD CONSTRAINT "brain_permission_grants_grantee_org_membership_fk" FOREIGN KEY ("grantee_user_id","organization_id") REFERENCES "public"."organization_memberships"("user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_permission_grants" ADD CONSTRAINT "brain_permission_grants_grantee_workspace_membership_fk" FOREIGN KEY ("grantee_user_id","workspace_id") REFERENCES "public"."workspace_memberships"("user_id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brain_permission_grants_org_scoped_active_unique" ON "brain_permission_grants" USING btree ("organization_id","domain","grantee_user_id","capability") WHERE "brain_permission_grants"."workspace_id" IS NULL AND "brain_permission_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brain_permission_grants_workspace_scoped_active_unique" ON "brain_permission_grants" USING btree ("organization_id","domain","workspace_id","grantee_user_id","capability") WHERE "brain_permission_grants"."workspace_id" IS NOT NULL AND "brain_permission_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "brain_permission_grants_org_grantee_active_idx" ON "brain_permission_grants" USING btree ("organization_id","grantee_user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "brain_permission_grants_org_domain_idx" ON "brain_permission_grants" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE INDEX "brain_permission_grants_workspace_idx" ON "brain_permission_grants" USING btree ("workspace_id");