CREATE TYPE "public"."sales_approval_linked_entity_type" AS ENUM('lead', 'opportunity', 'qualification_run', 'opportunity_playbook_run');--> statement-breakpoint
CREATE TYPE "public"."sales_checklist_item_status" AS ENUM('pending', 'complete', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."sales_enrollment_status" AS ENUM('active', 'completed', 'stopped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sales_forecast_category" AS ENUM('pipeline', 'best_case', 'commit', 'closed');--> statement-breakpoint
CREATE TYPE "public"."sales_forecasting_mode" AS ENUM('stage_probability');--> statement-breakpoint
CREATE TYPE "public"."sales_lead_assignment_strategy" AS ENUM('manual', 'round_robin', 'least_open_leads');--> statement-breakpoint
CREATE TYPE "public"."sales_opportunity_playbook_run_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."sales_playbook_lifecycle" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sales_playbook_step_type" AS ENUM('checklist', 'collect_information', 'crm_activity_required', 'follow_up_required', 'workflow', 'approval', 'artifact_required', 'stage_recommendation', 'manual_decision');--> statement-breakpoint
CREATE TYPE "public"."sales_playbook_type" AS ENUM('lead_qualification', 'opportunity', 'follow_up');--> statement-breakpoint
CREATE TYPE "public"."sales_playbook_version_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."sales_qualification_run_status" AS ENUM('not_started', 'in_progress', 'waiting', 'qualified', 'disqualified', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."sales_role" AS ENUM('sales_admin', 'sales_manager', 'sales_rep', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."sales_sequence_lifecycle" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sales_sequence_step_action_type" AS ENUM('crm_follow_up', 'workflow_human_task', 'approval_request', 'internal_reminder');--> statement-breakpoint
CREATE TYPE "public"."sales_sequence_target_type" AS ENUM('lead', 'opportunity');--> statement-breakpoint
CREATE TYPE "public"."sales_sequence_version_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."sales_step_run_status" AS ENUM('pending', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."sales_target_metric_type" AS ENUM('won_revenue', 'opportunities_won', 'leads_qualified', 'activities_completed');--> statement-breakpoint
CREATE TYPE "public"."sales_target_scope_type" AS ENUM('individual', 'team');--> statement-breakpoint
CREATE TYPE "public"."sales_team_member_role" AS ENUM('manager', 'rep', 'viewer');--> statement-breakpoint
CREATE TABLE "sales_approval_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"linked_entity_type" "sales_approval_linked_entity_type" NOT NULL,
	"linked_entity_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_approval_links_approval_unique" UNIQUE("approval_request_id")
);
--> statement-breakpoint
CREATE TABLE "sales_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"default_pipeline_id" uuid,
	"business_timezone" text DEFAULT 'UTC' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"default_lead_assignment_strategy" "sales_lead_assignment_strategy" DEFAULT 'manual' NOT NULL,
	"default_qualification_playbook_id" uuid,
	"default_opportunity_playbook_id" uuid,
	"stale_lead_threshold_days" integer DEFAULT 7 NOT NULL,
	"stale_opportunity_threshold_days" integer DEFAULT 14 NOT NULL,
	"forecasting_mode" "sales_forecasting_mode" DEFAULT 'stage_probability' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_follow_up_sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sequence_version_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"day_offset" integer NOT NULL,
	"action_type" "sales_sequence_step_action_type" NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_follow_up_sequence_steps_version_key_unique" UNIQUE("sequence_version_id","step_key"),
	CONSTRAINT "sales_follow_up_sequence_steps_version_sequence_unique" UNIQUE("sequence_version_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "sales_follow_up_sequence_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "sales_sequence_version_status" DEFAULT 'draft' NOT NULL,
	"change_reason" text,
	"created_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_follow_up_sequence_versions_seq_number_unique" UNIQUE("sequence_id","version_number"),
	CONSTRAINT "sales_follow_up_sequence_versions_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "sales_follow_up_sequence_versions_id_seq_unique" UNIQUE("id","sequence_id")
);
--> statement-breakpoint
CREATE TABLE "sales_follow_up_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"sequence_key" text NOT NULL,
	"target_type" "sales_sequence_target_type" NOT NULL,
	"lifecycle" "sales_sequence_lifecycle" DEFAULT 'draft' NOT NULL,
	"current_published_version_id" uuid,
	"owner_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_follow_up_sequences_org_key_unique" UNIQUE("organization_id","sequence_key"),
	CONSTRAINT "sales_follow_up_sequences_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "sales_lead_qualification_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"qualification_run_id" uuid NOT NULL,
	"playbook_step_id" uuid NOT NULL,
	"status" "sales_checklist_item_status" DEFAULT 'pending' NOT NULL,
	"completed_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"evidence_activity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_lead_qualification_items_run_step_unique" UNIQUE("qualification_run_id","playbook_step_id")
);
--> statement-breakpoint
CREATE TABLE "sales_lead_qualification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"playbook_version_id" uuid NOT NULL,
	"assigned_user_id" uuid,
	"status" "sales_qualification_run_status" DEFAULT 'not_started' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"workflow_execution_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_lead_qualification_runs_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "sales_opportunity_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"forecast_category" "sales_forecast_category" NOT NULL,
	"set_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_opportunity_forecasts_opportunity_unique" UNIQUE("opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "sales_opportunity_playbook_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_playbook_run_id" uuid NOT NULL,
	"playbook_step_id" uuid NOT NULL,
	"status" "sales_checklist_item_status" DEFAULT 'pending' NOT NULL,
	"completed_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"evidence_activity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_opportunity_playbook_items_run_step_unique" UNIQUE("opportunity_playbook_run_id","playbook_step_id")
);
--> statement-breakpoint
CREATE TABLE "sales_opportunity_playbook_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"playbook_version_id" uuid NOT NULL,
	"assigned_user_id" uuid,
	"status" "sales_opportunity_playbook_run_status" DEFAULT 'active' NOT NULL,
	"current_step_id" uuid,
	"last_reviewed_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_opportunity_playbook_runs_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "sales_playbook_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"playbook_version_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"step_type" "sales_playbook_step_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sequence" integer NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_playbook_steps_version_key_unique" UNIQUE("playbook_version_id","step_key"),
	CONSTRAINT "sales_playbook_steps_version_sequence_unique" UNIQUE("playbook_version_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "sales_playbook_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"playbook_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "sales_playbook_version_status" DEFAULT 'draft' NOT NULL,
	"change_reason" text,
	"created_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_playbook_versions_playbook_number_unique" UNIQUE("playbook_id","version_number"),
	CONSTRAINT "sales_playbook_versions_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "sales_playbook_versions_id_playbook_unique" UNIQUE("id","playbook_id")
);
--> statement-breakpoint
CREATE TABLE "sales_playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"playbook_key" text NOT NULL,
	"playbook_type" "sales_playbook_type" NOT NULL,
	"lifecycle" "sales_playbook_lifecycle" DEFAULT 'draft' NOT NULL,
	"current_published_version_id" uuid,
	"owner_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_playbooks_org_key_unique" UNIQUE("organization_id","playbook_key"),
	CONSTRAINT "sales_playbooks_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "sales_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "sales_role" NOT NULL,
	"granted_by_user_id" uuid,
	"revoked_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_sequence_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sequence_version_id" uuid NOT NULL,
	"target_type" "sales_sequence_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"enrolled_by_user_id" uuid,
	"status" "sales_enrollment_status" DEFAULT 'active' NOT NULL,
	"next_step_due_at" timestamp with time zone,
	"stopped_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_sequence_enrollments_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "sales_sequence_step_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"sequence_step_id" uuid NOT NULL,
	"status" "sales_step_run_status" DEFAULT 'pending' NOT NULL,
	"crm_follow_up_id" uuid,
	"workflow_human_task_id" uuid,
	"approval_request_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_sequence_step_runs_enrollment_step_unique" UNIQUE("enrollment_id","sequence_step_id")
);
--> statement-breakpoint
CREATE TABLE "sales_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"scope_type" "sales_target_scope_type" NOT NULL,
	"user_id" uuid,
	"team_id" uuid,
	"metric_type" "sales_target_metric_type" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"target_value" numeric(14, 2) NOT NULL,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_targets_scope_shape_check" CHECK (("sales_targets"."scope_type" = 'individual' AND "sales_targets"."user_id" IS NOT NULL AND "sales_targets"."team_id" IS NULL) OR ("sales_targets"."scope_type" = 'team' AND "sales_targets"."team_id" IS NOT NULL AND "sales_targets"."user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sales_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_role" "sales_team_member_role" DEFAULT 'rep' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_team_members_team_user_unique" UNIQUE("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sales_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"team_key" text NOT NULL,
	"description" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_teams_org_key_unique" UNIQUE("organization_id","team_key"),
	CONSTRAINT "sales_teams_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "sales_approval_links" ADD CONSTRAINT "sales_approval_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_approval_links" ADD CONSTRAINT "sales_approval_links_approval_request_id_agent_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."agent_approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_approval_links" ADD CONSTRAINT "sales_approval_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_configurations" ADD CONSTRAINT "sales_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_configurations" ADD CONSTRAINT "sales_configurations_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_follow_up_sequence_steps" ADD CONSTRAINT "sales_follow_up_sequence_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_follow_up_sequence_steps" ADD CONSTRAINT "sales_follow_up_sequence_steps_version_org_fk" FOREIGN KEY ("sequence_version_id","organization_id") REFERENCES "public"."sales_follow_up_sequence_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_follow_up_sequence_versions" ADD CONSTRAINT "sales_follow_up_sequence_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_follow_up_sequence_versions" ADD CONSTRAINT "sales_follow_up_sequence_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_follow_up_sequence_versions" ADD CONSTRAINT "sales_follow_up_sequence_versions_seq_org_fk" FOREIGN KEY ("sequence_id","organization_id") REFERENCES "public"."sales_follow_up_sequences"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_follow_up_sequences" ADD CONSTRAINT "sales_follow_up_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_follow_up_sequences" ADD CONSTRAINT "sales_follow_up_sequences_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_follow_up_sequences" ADD CONSTRAINT "sales_follow_up_sequences_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lead_qualification_items" ADD CONSTRAINT "sales_lead_qualification_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lead_qualification_items" ADD CONSTRAINT "sales_lead_qualification_items_playbook_step_id_sales_playbook_steps_id_fk" FOREIGN KEY ("playbook_step_id") REFERENCES "public"."sales_playbook_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lead_qualification_items" ADD CONSTRAINT "sales_lead_qualification_items_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lead_qualification_items" ADD CONSTRAINT "sales_lead_qualification_items_run_org_fk" FOREIGN KEY ("qualification_run_id","organization_id") REFERENCES "public"."sales_lead_qualification_runs"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lead_qualification_runs" ADD CONSTRAINT "sales_lead_qualification_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lead_qualification_runs" ADD CONSTRAINT "sales_lead_qualification_runs_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lead_qualification_runs" ADD CONSTRAINT "sales_lead_qualification_runs_workflow_execution_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lead_qualification_runs" ADD CONSTRAINT "sales_lead_qualification_runs_lead_org_fk" FOREIGN KEY ("lead_id","organization_id") REFERENCES "public"."crm_leads"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lead_qualification_runs" ADD CONSTRAINT "sales_lead_qualification_runs_version_org_fk" FOREIGN KEY ("playbook_version_id","organization_id") REFERENCES "public"."sales_playbook_versions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_forecasts" ADD CONSTRAINT "sales_opportunity_forecasts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_forecasts" ADD CONSTRAINT "sales_opportunity_forecasts_set_by_user_id_users_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_forecasts" ADD CONSTRAINT "sales_opportunity_forecasts_opp_org_fk" FOREIGN KEY ("opportunity_id","organization_id") REFERENCES "public"."crm_opportunities"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_playbook_items" ADD CONSTRAINT "sales_opportunity_playbook_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_playbook_items" ADD CONSTRAINT "sales_opportunity_playbook_items_playbook_step_id_sales_playbook_steps_id_fk" FOREIGN KEY ("playbook_step_id") REFERENCES "public"."sales_playbook_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_playbook_items" ADD CONSTRAINT "sales_opportunity_playbook_items_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_playbook_items" ADD CONSTRAINT "sales_opportunity_playbook_items_run_org_fk" FOREIGN KEY ("opportunity_playbook_run_id","organization_id") REFERENCES "public"."sales_opportunity_playbook_runs"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_playbook_runs" ADD CONSTRAINT "sales_opportunity_playbook_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_playbook_runs" ADD CONSTRAINT "sales_opportunity_playbook_runs_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_playbook_runs" ADD CONSTRAINT "sales_opportunity_playbook_runs_current_step_id_sales_playbook_steps_id_fk" FOREIGN KEY ("current_step_id") REFERENCES "public"."sales_playbook_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_playbook_runs" ADD CONSTRAINT "sales_opportunity_playbook_runs_opp_org_fk" FOREIGN KEY ("opportunity_id","organization_id") REFERENCES "public"."crm_opportunities"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_playbook_runs" ADD CONSTRAINT "sales_opportunity_playbook_runs_version_org_fk" FOREIGN KEY ("playbook_version_id","organization_id") REFERENCES "public"."sales_playbook_versions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_playbook_steps" ADD CONSTRAINT "sales_playbook_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_playbook_steps" ADD CONSTRAINT "sales_playbook_steps_version_org_fk" FOREIGN KEY ("playbook_version_id","organization_id") REFERENCES "public"."sales_playbook_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_playbook_versions" ADD CONSTRAINT "sales_playbook_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_playbook_versions" ADD CONSTRAINT "sales_playbook_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_playbook_versions" ADD CONSTRAINT "sales_playbook_versions_playbook_org_fk" FOREIGN KEY ("playbook_id","organization_id") REFERENCES "public"."sales_playbooks"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_playbooks" ADD CONSTRAINT "sales_playbooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_playbooks" ADD CONSTRAINT "sales_playbooks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_playbooks" ADD CONSTRAINT "sales_playbooks_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_role_assignments" ADD CONSTRAINT "sales_role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_role_assignments" ADD CONSTRAINT "sales_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_role_assignments" ADD CONSTRAINT "sales_role_assignments_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_role_assignments" ADD CONSTRAINT "sales_role_assignments_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_sequence_enrollments" ADD CONSTRAINT "sales_sequence_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_sequence_enrollments" ADD CONSTRAINT "sales_sequence_enrollments_enrolled_by_user_id_users_id_fk" FOREIGN KEY ("enrolled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_sequence_enrollments" ADD CONSTRAINT "sales_sequence_enrollments_version_org_fk" FOREIGN KEY ("sequence_version_id","organization_id") REFERENCES "public"."sales_follow_up_sequence_versions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_sequence_step_runs" ADD CONSTRAINT "sales_sequence_step_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_sequence_step_runs" ADD CONSTRAINT "sales_sequence_step_runs_sequence_step_id_sales_follow_up_sequence_steps_id_fk" FOREIGN KEY ("sequence_step_id") REFERENCES "public"."sales_follow_up_sequence_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_sequence_step_runs" ADD CONSTRAINT "sales_sequence_step_runs_enrollment_org_fk" FOREIGN KEY ("enrollment_id","organization_id") REFERENCES "public"."sales_sequence_enrollments"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_team_org_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."sales_teams"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_team_members" ADD CONSTRAINT "sales_team_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_team_members" ADD CONSTRAINT "sales_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_team_members" ADD CONSTRAINT "sales_team_members_team_org_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."sales_teams"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_teams" ADD CONSTRAINT "sales_teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_teams" ADD CONSTRAINT "sales_teams_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_approval_links_entity_idx" ON "sales_approval_links" USING btree ("linked_entity_type","linked_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_configurations_org_only_unique" ON "sales_configurations" USING btree ("organization_id") WHERE "sales_configurations"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_configurations_org_workspace_unique" ON "sales_configurations" USING btree ("organization_id","workspace_id") WHERE "sales_configurations"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_lead_qualification_runs_active_unique" ON "sales_lead_qualification_runs" USING btree ("lead_id") WHERE "sales_lead_qualification_runs"."status" IN ('not_started','in_progress','waiting');--> statement-breakpoint
CREATE INDEX "sales_lead_qualification_runs_assignee_idx" ON "sales_lead_qualification_runs" USING btree ("assigned_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_opportunity_playbook_runs_active_unique" ON "sales_opportunity_playbook_runs" USING btree ("opportunity_id") WHERE "sales_opportunity_playbook_runs"."status" = 'active';--> statement-breakpoint
CREATE INDEX "sales_opportunity_playbook_runs_assignee_idx" ON "sales_opportunity_playbook_runs" USING btree ("assigned_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_role_assignments_active_unique" ON "sales_role_assignments" USING btree ("organization_id","user_id") WHERE "sales_role_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sales_role_assignments_user_idx" ON "sales_role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_sequence_enrollments_active_unique" ON "sales_sequence_enrollments" USING btree ("target_type","target_id") WHERE "sales_sequence_enrollments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "sales_sequence_enrollments_due_idx" ON "sales_sequence_enrollments" USING btree ("status","next_step_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_targets_individual_unique" ON "sales_targets" USING btree ("organization_id","user_id","metric_type","period_start","period_end") WHERE "sales_targets"."scope_type" = 'individual';--> statement-breakpoint
CREATE UNIQUE INDEX "sales_targets_team_unique" ON "sales_targets" USING btree ("organization_id","team_id","metric_type","period_start","period_end") WHERE "sales_targets"."scope_type" = 'team';--> statement-breakpoint
CREATE INDEX "sales_team_members_user_idx" ON "sales_team_members" USING btree ("user_id");