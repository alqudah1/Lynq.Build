CREATE TYPE "public"."founder_decision_status" AS ENUM('proposed', 'decided', 'superseded', 'archived');--> statement-breakpoint
CREATE TYPE "public"."founder_goal_status" AS ENUM('active', 'completed', 'missed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."founder_role" AS ENUM('founder_viewer', 'founder_executive', 'founder_admin');--> statement-breakpoint
CREATE TABLE "founder_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"title" text NOT NULL,
	"decision" text NOT NULL,
	"context_summary" text,
	"decision_owner_user_id" uuid NOT NULL,
	"decision_date" timestamp with time zone DEFAULT now() NOT NULL,
	"related_project_id" uuid,
	"related_opportunity_id" uuid,
	"related_campaign_id" uuid,
	"related_workflow_definition_id" uuid,
	"related_artifact_id" uuid,
	"status" "founder_decision_status" DEFAULT 'proposed' NOT NULL,
	"review_date" timestamp with time zone,
	"promoted_to_brain_at" timestamp with time zone,
	"superseded_by_decision_id" uuid,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founder_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"title" text NOT NULL,
	"metric_key" text NOT NULL,
	"target_value" numeric(14, 2) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" "founder_goal_status" DEFAULT 'active' NOT NULL,
	"related_sales_target_id" uuid,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founder_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "founder_role" NOT NULL,
	"granted_by_user_id" uuid,
	"revoked_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founder_workspace_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"visible_kpi_groups" jsonb DEFAULT '["growth","sales","marketing","delivery","operations","communications","ai"]'::jsonb NOT NULL,
	"widget_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_saved_report_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_date_range_strategy" "analytics_date_range_strategy" DEFAULT 'last_30_days' NOT NULL,
	"default_workspace_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "founder_decisions" ADD CONSTRAINT "founder_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_decisions" ADD CONSTRAINT "founder_decisions_decision_owner_user_id_users_id_fk" FOREIGN KEY ("decision_owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_decisions" ADD CONSTRAINT "founder_decisions_related_project_id_projects_id_fk" FOREIGN KEY ("related_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_decisions" ADD CONSTRAINT "founder_decisions_related_opportunity_id_crm_opportunities_id_fk" FOREIGN KEY ("related_opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_decisions" ADD CONSTRAINT "founder_decisions_related_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("related_campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_decisions" ADD CONSTRAINT "founder_decisions_related_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("related_workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_decisions" ADD CONSTRAINT "founder_decisions_related_artifact_id_agent_artifacts_id_fk" FOREIGN KEY ("related_artifact_id") REFERENCES "public"."agent_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_decisions" ADD CONSTRAINT "founder_decisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_decisions" ADD CONSTRAINT "founder_decisions_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_decisions" ADD CONSTRAINT "founder_decisions_superseded_by_fk" FOREIGN KEY ("superseded_by_decision_id") REFERENCES "public"."founder_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_goals" ADD CONSTRAINT "founder_goals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_goals" ADD CONSTRAINT "founder_goals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_goals" ADD CONSTRAINT "founder_goals_related_sales_target_id_sales_targets_id_fk" FOREIGN KEY ("related_sales_target_id") REFERENCES "public"."sales_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_goals" ADD CONSTRAINT "founder_goals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_goals" ADD CONSTRAINT "founder_goals_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_role_assignments" ADD CONSTRAINT "founder_role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_role_assignments" ADD CONSTRAINT "founder_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_role_assignments" ADD CONSTRAINT "founder_role_assignments_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_role_assignments" ADD CONSTRAINT "founder_role_assignments_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_workspace_configurations" ADD CONSTRAINT "founder_workspace_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_workspace_configurations" ADD CONSTRAINT "founder_workspace_configurations_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_workspace_configurations" ADD CONSTRAINT "founder_workspace_configurations_default_workspace_org_fk" FOREIGN KEY ("default_workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "founder_decisions_org_status_idx" ON "founder_decisions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "founder_goals_org_status_idx" ON "founder_goals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "founder_role_assignments_active_unique" ON "founder_role_assignments" USING btree ("organization_id","user_id") WHERE "founder_role_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "founder_workspace_configurations_org_only_unique" ON "founder_workspace_configurations" USING btree ("organization_id") WHERE "founder_workspace_configurations"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "founder_workspace_configurations_org_workspace_unique" ON "founder_workspace_configurations" USING btree ("organization_id","workspace_id") WHERE "founder_workspace_configurations"."workspace_id" IS NOT NULL;