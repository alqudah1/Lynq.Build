CREATE TYPE "public"."marketing_approval_linked_entity_type" AS ENUM('content_item');--> statement-breakpoint
CREATE TYPE "public"."marketing_attribution_touch_type" AS ENUM('first_touch', 'last_touch');--> statement-breakpoint
CREATE TYPE "public"."marketing_audience_entity_type" AS ENUM('contact', 'company', 'lead', 'opportunity');--> statement-breakpoint
CREATE TYPE "public"."marketing_audience_evaluation_mode" AS ENUM('dynamic', 'static');--> statement-breakpoint
CREATE TYPE "public"."marketing_campaign_status" AS ENUM('draft', 'planning', 'ready', 'active', 'paused', 'completed', 'cancelled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."marketing_content_status" AS ENUM('draft', 'review', 'approved', 'scheduled', 'published', 'rejected', 'archived');--> statement-breakpoint
CREATE TYPE "public"."marketing_content_type" AS ENUM('social_post', 'email_draft', 'landing_page_copy', 'ad_copy', 'blog_outline', 'blog_draft', 'campaign_brief', 'creative_brief', 'script', 'announcement', 'other');--> statement-breakpoint
CREATE TYPE "public"."marketing_destination_type" AS ENUM('external_url', 'internal_reference');--> statement-breakpoint
CREATE TYPE "public"."marketing_objective_type" AS ENUM('awareness', 'lead_generation', 'engagement', 'event_promotion', 'product_launch', 'customer_nurture', 'retention', 'other');--> statement-breakpoint
CREATE TYPE "public"."marketing_playbook_lifecycle" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."marketing_playbook_type" AS ENUM('campaign', 'content_creation', 'campaign_review', 'launch', 'nurture');--> statement-breakpoint
CREATE TYPE "public"."marketing_playbook_version_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."marketing_project_link_entity_type" AS ENUM('campaign', 'content_item');--> statement-breakpoint
CREATE TYPE "public"."marketing_role" AS ENUM('marketing_admin', 'marketing_manager', 'marketing_contributor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."marketing_run_item_status" AS ENUM('pending', 'complete', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."marketing_run_status" AS ENUM('not_started', 'in_progress', 'waiting', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."marketing_spend_source" AS ENUM('manual', 'synced');--> statement-breakpoint
CREATE TYPE "public"."marketing_team_member_role" AS ENUM('manager', 'contributor', 'viewer');--> statement-breakpoint
CREATE TABLE "marketing_approval_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"linked_entity_type" "marketing_approval_linked_entity_type" NOT NULL,
	"linked_entity_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_approval_links_approval_unique" UNIQUE("approval_request_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_attribution_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid,
	"destination_id" uuid,
	"crm_lead_id" uuid,
	"crm_contact_id" uuid,
	"source_id" uuid,
	"touch_type" "marketing_attribution_touch_type" NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"external_click_id" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_audiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"audience_key" text NOT NULL,
	"description" text,
	"entity_type" "marketing_audience_entity_type" NOT NULL,
	"filter_definition" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evaluation_mode" "marketing_audience_evaluation_mode" DEFAULT 'dynamic' NOT NULL,
	"snapshot_at" timestamp with time zone,
	"snapshot_count" integer,
	"snapshot_record_ids" jsonb,
	"owner_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_audiences_org_key_unique" UNIQUE("organization_id","audience_key"),
	CONSTRAINT "marketing_audiences_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_budget_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"planned_amount" numeric(14, 2),
	"spend_amount" numeric(14, 2),
	"currency" text NOT NULL,
	"spend_source" "marketing_spend_source" DEFAULT 'manual' NOT NULL,
	"recorded_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_budget_entries_campaign_category_unique" UNIQUE("campaign_id","category")
);
--> statement-breakpoint
CREATE TABLE "marketing_campaign_audience_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"audience_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_campaign_audience_links_unique" UNIQUE("campaign_id","audience_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_campaign_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"destination_type" "marketing_destination_type" DEFAULT 'external_url' NOT NULL,
	"utm_source" text NOT NULL,
	"utm_medium" text NOT NULL,
	"utm_campaign" text NOT NULL,
	"utm_content" text DEFAULT '' NOT NULL,
	"utm_term" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_campaign_destinations_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "marketing_campaign_destinations_utm_unique" UNIQUE("campaign_id","utm_source","utm_medium","utm_campaign","utm_content","utm_term")
);
--> statement-breakpoint
CREATE TABLE "marketing_campaign_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_run_id" uuid NOT NULL,
	"playbook_step_id" uuid NOT NULL,
	"status" "marketing_run_item_status" DEFAULT 'pending' NOT NULL,
	"completed_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"evidence_artifact_id" uuid,
	"evidence_content_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_campaign_run_items_run_step_unique" UNIQUE("campaign_run_id","playbook_step_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_campaign_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"playbook_version_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"status" "marketing_run_status" DEFAULT 'not_started' NOT NULL,
	"missing_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"workflow_execution_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_campaign_runs_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"campaign_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"objective_type" "marketing_objective_type" DEFAULT 'other' NOT NULL,
	"objective_targets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "marketing_campaign_status" DEFAULT 'draft' NOT NULL,
	"owner_user_id" uuid,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"budget_amount" numeric(14, 2),
	"currency" text,
	"primary_audience_id" uuid,
	"source_id" uuid,
	"project_id" uuid,
	"workflow_definition_id" uuid,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_campaigns_org_key_unique" UNIQUE("organization_id","campaign_key"),
	CONSTRAINT "marketing_campaigns_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"business_timezone" text DEFAULT 'UTC' NOT NULL,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"default_campaign_owner_user_id" uuid,
	"default_approval_policy" text DEFAULT 'required' NOT NULL,
	"default_content_playbook_id" uuid,
	"stale_campaign_threshold_days" integer DEFAULT 14 NOT NULL,
	"attribution_window_days" integer DEFAULT 30 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_content_item_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"created_by_user_id" uuid,
	"created_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_content_item_artifacts_item_version_unique" UNIQUE("content_item_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "marketing_content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content_type" "marketing_content_type" NOT NULL,
	"status" "marketing_content_status" DEFAULT 'draft' NOT NULL,
	"owner_user_id" uuid,
	"current_artifact_id" uuid,
	"intended_channel" text,
	"planned_publish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"project_task_id" uuid,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_content_items_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_playbook_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"playbook_version_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"step_type" text DEFAULT 'checklist' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sequence" integer NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_playbook_steps_version_key_unique" UNIQUE("playbook_version_id","step_key"),
	CONSTRAINT "marketing_playbook_steps_version_sequence_unique" UNIQUE("playbook_version_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "marketing_playbook_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"playbook_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "marketing_playbook_version_status" DEFAULT 'draft' NOT NULL,
	"change_reason" text,
	"created_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_playbook_versions_playbook_number_unique" UNIQUE("playbook_id","version_number"),
	CONSTRAINT "marketing_playbook_versions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"playbook_key" text NOT NULL,
	"playbook_type" "marketing_playbook_type" NOT NULL,
	"lifecycle" "marketing_playbook_lifecycle" DEFAULT 'draft' NOT NULL,
	"current_published_version_id" uuid,
	"owner_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_playbooks_org_key_unique" UNIQUE("organization_id","playbook_key"),
	CONSTRAINT "marketing_playbooks_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"marketing_entity_type" "marketing_project_link_entity_type" NOT NULL,
	"marketing_entity_id" uuid NOT NULL,
	"linked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_project_links_unique" UNIQUE("project_id","marketing_entity_type","marketing_entity_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "marketing_role" NOT NULL,
	"granted_by_user_id" uuid,
	"revoked_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_role" "marketing_team_member_role" DEFAULT 'contributor' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_team_members_team_user_unique" UNIQUE("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_teams" (
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
	CONSTRAINT "marketing_teams_org_key_unique" UNIQUE("organization_id","team_key"),
	CONSTRAINT "marketing_teams_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "marketing_approval_links" ADD CONSTRAINT "marketing_approval_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_approval_links" ADD CONSTRAINT "marketing_approval_links_approval_request_id_agent_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."agent_approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_approval_links" ADD CONSTRAINT "marketing_approval_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attribution_records" ADD CONSTRAINT "marketing_attribution_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attribution_records" ADD CONSTRAINT "marketing_attribution_records_campaign_org_fk" FOREIGN KEY ("campaign_id","organization_id") REFERENCES "public"."marketing_campaigns"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attribution_records" ADD CONSTRAINT "marketing_attribution_records_destination_org_fk" FOREIGN KEY ("destination_id","organization_id") REFERENCES "public"."marketing_campaign_destinations"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attribution_records" ADD CONSTRAINT "marketing_attribution_records_lead_org_fk" FOREIGN KEY ("crm_lead_id","organization_id") REFERENCES "public"."crm_leads"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attribution_records" ADD CONSTRAINT "marketing_attribution_records_contact_org_fk" FOREIGN KEY ("crm_contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_audiences" ADD CONSTRAINT "marketing_audiences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_audiences" ADD CONSTRAINT "marketing_audiences_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_audiences" ADD CONSTRAINT "marketing_audiences_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_budget_entries" ADD CONSTRAINT "marketing_budget_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_budget_entries" ADD CONSTRAINT "marketing_budget_entries_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_budget_entries" ADD CONSTRAINT "marketing_budget_entries_campaign_org_fk" FOREIGN KEY ("campaign_id","organization_id") REFERENCES "public"."marketing_campaigns"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_audience_links" ADD CONSTRAINT "marketing_campaign_audience_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_audience_links" ADD CONSTRAINT "marketing_campaign_audience_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_audience_links" ADD CONSTRAINT "marketing_campaign_audience_links_campaign_org_fk" FOREIGN KEY ("campaign_id","organization_id") REFERENCES "public"."marketing_campaigns"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_audience_links" ADD CONSTRAINT "marketing_campaign_audience_links_audience_org_fk" FOREIGN KEY ("audience_id","organization_id") REFERENCES "public"."marketing_audiences"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_destinations" ADD CONSTRAINT "marketing_campaign_destinations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_destinations" ADD CONSTRAINT "marketing_campaign_destinations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_destinations" ADD CONSTRAINT "marketing_campaign_destinations_campaign_org_fk" FOREIGN KEY ("campaign_id","organization_id") REFERENCES "public"."marketing_campaigns"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_run_items" ADD CONSTRAINT "marketing_campaign_run_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_run_items" ADD CONSTRAINT "marketing_campaign_run_items_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_run_items" ADD CONSTRAINT "marketing_campaign_run_items_evidence_artifact_id_agent_artifacts_id_fk" FOREIGN KEY ("evidence_artifact_id") REFERENCES "public"."agent_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_run_items" ADD CONSTRAINT "marketing_campaign_run_items_run_org_fk" FOREIGN KEY ("campaign_run_id","organization_id") REFERENCES "public"."marketing_campaign_runs"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_runs" ADD CONSTRAINT "marketing_campaign_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_runs" ADD CONSTRAINT "marketing_campaign_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_runs" ADD CONSTRAINT "marketing_campaign_runs_workflow_execution_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_runs" ADD CONSTRAINT "marketing_campaign_runs_campaign_org_fk" FOREIGN KEY ("campaign_id","organization_id") REFERENCES "public"."marketing_campaigns"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_runs" ADD CONSTRAINT "marketing_campaign_runs_version_org_fk" FOREIGN KEY ("playbook_version_id","organization_id") REFERENCES "public"."marketing_playbook_versions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_audience_org_fk" FOREIGN KEY ("primary_audience_id","organization_id") REFERENCES "public"."marketing_audiences"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_source_org_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."crm_sources"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_project_org_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_configurations" ADD CONSTRAINT "marketing_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_configurations" ADD CONSTRAINT "marketing_configurations_default_campaign_owner_user_id_users_id_fk" FOREIGN KEY ("default_campaign_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_configurations" ADD CONSTRAINT "marketing_configurations_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_item_artifacts" ADD CONSTRAINT "marketing_content_item_artifacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_item_artifacts" ADD CONSTRAINT "marketing_content_item_artifacts_artifact_id_agent_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."agent_artifacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_item_artifacts" ADD CONSTRAINT "marketing_content_item_artifacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_item_artifacts" ADD CONSTRAINT "marketing_content_item_artifacts_item_org_fk" FOREIGN KEY ("content_item_id","organization_id") REFERENCES "public"."marketing_content_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_items" ADD CONSTRAINT "marketing_content_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_items" ADD CONSTRAINT "marketing_content_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_items" ADD CONSTRAINT "marketing_content_items_current_artifact_id_agent_artifacts_id_fk" FOREIGN KEY ("current_artifact_id") REFERENCES "public"."agent_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_items" ADD CONSTRAINT "marketing_content_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_items" ADD CONSTRAINT "marketing_content_items_campaign_org_fk" FOREIGN KEY ("campaign_id","organization_id") REFERENCES "public"."marketing_campaigns"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_items" ADD CONSTRAINT "marketing_content_items_task_org_fk" FOREIGN KEY ("project_task_id","organization_id") REFERENCES "public"."project_tasks"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_playbook_steps" ADD CONSTRAINT "marketing_playbook_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_playbook_steps" ADD CONSTRAINT "marketing_playbook_steps_version_org_fk" FOREIGN KEY ("playbook_version_id","organization_id") REFERENCES "public"."marketing_playbook_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_playbook_versions" ADD CONSTRAINT "marketing_playbook_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_playbook_versions" ADD CONSTRAINT "marketing_playbook_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_playbook_versions" ADD CONSTRAINT "marketing_playbook_versions_playbook_org_fk" FOREIGN KEY ("playbook_id","organization_id") REFERENCES "public"."marketing_playbooks"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_playbooks" ADD CONSTRAINT "marketing_playbooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_playbooks" ADD CONSTRAINT "marketing_playbooks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_playbooks" ADD CONSTRAINT "marketing_playbooks_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_project_links" ADD CONSTRAINT "marketing_project_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_project_links" ADD CONSTRAINT "marketing_project_links_linked_by_user_id_users_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_project_links" ADD CONSTRAINT "marketing_project_links_project_org_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_role_assignments" ADD CONSTRAINT "marketing_role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_role_assignments" ADD CONSTRAINT "marketing_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_role_assignments" ADD CONSTRAINT "marketing_role_assignments_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_role_assignments" ADD CONSTRAINT "marketing_role_assignments_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_team_members" ADD CONSTRAINT "marketing_team_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_team_members" ADD CONSTRAINT "marketing_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_team_members" ADD CONSTRAINT "marketing_team_members_team_org_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."marketing_teams"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_teams" ADD CONSTRAINT "marketing_teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_teams" ADD CONSTRAINT "marketing_teams_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_approval_links_entity_idx" ON "marketing_approval_links" USING btree ("linked_entity_type","linked_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_attribution_records_lead_touch_unique" ON "marketing_attribution_records" USING btree ("organization_id","crm_lead_id","touch_type") WHERE "marketing_attribution_records"."crm_lead_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_attribution_records_contact_touch_unique" ON "marketing_attribution_records" USING btree ("organization_id","crm_contact_id","touch_type") WHERE "marketing_attribution_records"."crm_contact_id" IS NOT NULL AND "marketing_attribution_records"."crm_lead_id" IS NULL;--> statement-breakpoint
CREATE INDEX "marketing_attribution_records_campaign_idx" ON "marketing_attribution_records" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_campaign_runs_active_unique" ON "marketing_campaign_runs" USING btree ("campaign_id") WHERE "marketing_campaign_runs"."status" IN ('not_started','in_progress','waiting');--> statement-breakpoint
CREATE INDEX "marketing_campaigns_org_status_idx" ON "marketing_campaigns" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "marketing_campaigns_owner_idx" ON "marketing_campaigns" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_configurations_org_only_unique" ON "marketing_configurations" USING btree ("organization_id") WHERE "marketing_configurations"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_configurations_org_workspace_unique" ON "marketing_configurations" USING btree ("organization_id","workspace_id") WHERE "marketing_configurations"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "marketing_content_items_campaign_idx" ON "marketing_content_items" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "marketing_content_items_org_status_idx" ON "marketing_content_items" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "marketing_project_links_entity_idx" ON "marketing_project_links" USING btree ("marketing_entity_type","marketing_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_role_assignments_active_unique" ON "marketing_role_assignments" USING btree ("organization_id","user_id") WHERE "marketing_role_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "marketing_role_assignments_user_idx" ON "marketing_role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "marketing_team_members_user_idx" ON "marketing_team_members" USING btree ("user_id");