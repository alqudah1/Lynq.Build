CREATE TYPE "public"."social_ad_change_status" AS ENUM('proposed', 'pending_approval', 'approved', 'rejected', 'executing', 'executed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."social_ad_change_type" AS ENUM('create_campaign', 'update_budget', 'pause_campaign', 'resume_campaign', 'update_targeting', 'create_ad_set', 'create_ad');--> statement-breakpoint
CREATE TYPE "public"."social_asset_source" AS ENUM('uploaded', 'generated', 'rendered', 'external');--> statement-breakpoint
CREATE TYPE "public"."social_asset_type" AS ENUM('image', 'video', 'logo', 'brand_file', 'thumbnail', 'document');--> statement-breakpoint
CREATE TYPE "public"."social_automation_kind" AS ENUM('weekly_plan', 'daily_attention', 'metrics_sync', 'engagement_sync', 'token_watch', 'reply_drafts');--> statement-breakpoint
CREATE TYPE "public"."social_engagement_status" AS ENUM('new', 'needs_reply', 'reply_drafted', 'replied', 'ignored', 'hidden', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."social_engagement_type" AS ENUM('comment', 'mention', 'direct_message', 'review');--> statement-breakpoint
CREATE TYPE "public"."social_generation_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."social_generation_type" AS ENUM('text', 'image', 'video', 'strategy', 'plan', 'reply_draft', 'analysis', 'manager_task');--> statement-breakpoint
CREATE TYPE "public"."social_manager_message_role" AS ENUM('user', 'assistant', 'tool', 'system');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'x', 'meta_ads', 'google_ads', 'linkedin_ads');--> statement-breakpoint
CREATE TYPE "public"."social_publish_job_status" AS ENUM('queued', 'processing', 'published', 'failed', 'retrying', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."social_variant_status" AS ENUM('draft', 'generating', 'ready_for_review', 'changes_requested', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'rejected', 'archived');--> statement-breakpoint
ALTER TYPE "public"."communication_channel" ADD VALUE 'social';--> statement-breakpoint
ALTER TYPE "public"."communication_channel" ADD VALUE 'ads';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'meta';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'linkedin';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'google_ads';--> statement-breakpoint
ALTER TYPE "public"."marketing_approval_linked_entity_type" ADD VALUE 'content_variant';--> statement-breakpoint
ALTER TYPE "public"."marketing_approval_linked_entity_type" ADD VALUE 'publish_job';--> statement-breakpoint
ALTER TYPE "public"."marketing_approval_linked_entity_type" ADD VALUE 'ad_change_request';--> statement-breakpoint
ALTER TYPE "public"."marketing_approval_linked_entity_type" ADD VALUE 'engagement_reply';--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'social_publish';--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'social_metrics_sync';--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'social_engagement_sync';--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'social_token_watch';--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'social_automation_run';--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'social_ad_change_execute';--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'social_generation_run';--> statement-breakpoint
CREATE TABLE "social_account_metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"followers" integer,
	"reach" integer,
	"impressions" integer,
	"views" integer,
	"engagements" integer,
	"profile_views" integer,
	"website_clicks" integer,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_ad_campaign_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"external_campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"objective" text,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"daily_budget_minor" integer,
	"lifetime_budget_minor" integer,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"spend_minor" integer,
	"impressions" integer,
	"clicks" integer,
	"reach" integer,
	"conversions" numeric(14, 2),
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_ad_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"change_type" "social_ad_change_type" NOT NULL,
	"status" "social_ad_change_status" DEFAULT 'proposed' NOT NULL,
	"external_campaign_id" text,
	"title" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_daily_spend_minor" integer,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"approval_request_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"decision_note" text,
	"idempotency_key" text NOT NULL,
	"runtime_job_id" uuid,
	"executed_at" timestamp with time zone,
	"external_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"proposed_by_user_id" uuid,
	"proposed_by_agent_id" uuid,
	"generation_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_ad_change_requests_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "social_ad_change_requests_idempotency_unique" UNIQUE("organization_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "social_ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"brand_profile_id" uuid,
	"campaign_id" uuid,
	"content_item_id" uuid,
	"content_variant_id" uuid,
	"generation_type" "social_generation_type" NOT NULL,
	"status" "social_generation_status" DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"asset_id" uuid,
	"provider_task_id" text,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_usd" numeric(12, 6),
	"error_code" text,
	"error_message" text,
	"requested_by_user_id" uuid,
	"requested_by_agent_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_ai_generations_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "social_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"brand_profile_id" uuid,
	"campaign_id" uuid,
	"content_item_id" uuid,
	"content_variant_id" uuid,
	"asset_type" "social_asset_type" NOT NULL,
	"source" "social_asset_source" NOT NULL,
	"storage_kind" text DEFAULT 'blob' NOT NULL,
	"pathname" text,
	"url" text,
	"content_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" numeric(10, 2),
	"title" text NOT NULL,
	"alt_text" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"platform_hint" "social_platform",
	"provider" text,
	"model" text,
	"generation_id" uuid,
	"thumbnail_asset_id" uuid,
	"created_by_user_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_assets_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "social_assets_storage_check" CHECK (("social_assets"."storage_kind" = 'blob' AND "social_assets"."pathname" IS NOT NULL) OR ("social_assets"."storage_kind" = 'external_url' AND "social_assets"."url" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "social_automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"brand_profile_id" uuid,
	"kind" "social_automation_kind" NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"interval_minutes" integer NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_run_status" text,
	"last_run_summary" text,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_automation_rules_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "social_automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"kind" "social_automation_kind" NOT NULL,
	"runtime_job_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"succeeded" boolean,
	"summary" text DEFAULT '' NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "social_content_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"channel_account_id" uuid,
	"format" text DEFAULT 'text' NOT NULL,
	"status" "social_variant_status" DEFAULT 'draft' NOT NULL,
	"hook" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"call_to_action" text DEFAULT '' NOT NULL,
	"link_url" text,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"platform_options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone,
	"approval_request_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"review_note" text,
	"external_post_id" text,
	"external_post_url" text,
	"published_at" timestamp with time zone,
	"last_generation_id" uuid,
	"created_by_user_id" uuid,
	"created_by_agent_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_content_variants_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "social_engagement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"content_variant_id" uuid,
	"item_type" "social_engagement_type" NOT NULL,
	"status" "social_engagement_status" DEFAULT 'new' NOT NULL,
	"external_id" text NOT NULL,
	"external_parent_id" text,
	"external_post_id" text,
	"external_url" text,
	"author_external_id" text,
	"author_name" text,
	"author_handle" text,
	"text" text DEFAULT '' NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"sentiment" text,
	"category" text,
	"is_lead" boolean DEFAULT false NOT NULL,
	"crm_lead_id" uuid,
	"crm_contact_id" uuid,
	"assigned_user_id" uuid,
	"reply_draft" text,
	"reply_draft_generation_id" uuid,
	"reply_text" text,
	"replied_at" timestamp with time zone,
	"replied_by_user_id" uuid,
	"external_reply_id" text,
	"hidden_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_engagement_items_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "social_manager_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" "social_manager_message_role" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_manager_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"brand_profile_id" uuid,
	"title" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_manager_threads_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "social_publish_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"content_variant_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"status" "social_publish_job_status" DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"runtime_job_id" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 4 NOT NULL,
	"started_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"external_post_id" text,
	"external_post_url" text,
	"provider_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"last_error_class" text,
	"requested_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_publish_jobs_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "social_publish_jobs_idempotency_unique" UNIQUE("organization_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "company_info" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "brand_story" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "writing_style" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "visual_identity" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "websites" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "competitors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "content_pillars" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "preferred_platforms" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "prohibited_language" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "never_claim" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "geographic_market" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "objectives" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD COLUMN "integration_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD COLUMN "external_account_id" text;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD COLUMN "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD COLUMN "last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD COLUMN "last_error_message" text;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD COLUMN "last_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_content_items" ADD COLUMN "brand_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_content_items" ADD COLUMN "brief" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_content_performance_snapshots" ADD COLUMN "content_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_content_performance_snapshots" ADD COLUMN "external_post_id" text;--> statement-breakpoint
ALTER TABLE "marketing_content_performance_snapshots" ADD COLUMN "extra_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "social_account_metric_snapshots" ADD CONSTRAINT "social_account_metric_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_account_metric_snapshots" ADD CONSTRAINT "social_account_metrics_account_org_fk" FOREIGN KEY ("channel_account_id","organization_id") REFERENCES "public"."marketing_channel_accounts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ad_campaign_snapshots" ADD CONSTRAINT "social_ad_campaign_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ad_campaign_snapshots" ADD CONSTRAINT "social_ad_campaign_snapshots_account_org_fk" FOREIGN KEY ("channel_account_id","organization_id") REFERENCES "public"."marketing_channel_accounts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ad_change_requests" ADD CONSTRAINT "social_ad_change_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ad_change_requests" ADD CONSTRAINT "social_ad_change_requests_approval_request_id_agent_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."agent_approval_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ad_change_requests" ADD CONSTRAINT "social_ad_change_requests_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ad_change_requests" ADD CONSTRAINT "social_ad_change_requests_runtime_job_id_runtime_jobs_id_fk" FOREIGN KEY ("runtime_job_id") REFERENCES "public"."runtime_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ad_change_requests" ADD CONSTRAINT "social_ad_change_requests_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ad_change_requests" ADD CONSTRAINT "social_ad_change_requests_account_org_fk" FOREIGN KEY ("channel_account_id","organization_id") REFERENCES "public"."marketing_channel_accounts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ai_generations" ADD CONSTRAINT "social_ai_generations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ai_generations" ADD CONSTRAINT "social_ai_generations_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ai_generations" ADD CONSTRAINT "social_ai_generations_brand_org_fk" FOREIGN KEY ("brand_profile_id","organization_id") REFERENCES "public"."marketing_brand_profiles"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ai_generations" ADD CONSTRAINT "social_ai_generations_item_org_fk" FOREIGN KEY ("content_item_id","organization_id") REFERENCES "public"."marketing_content_items"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ai_generations" ADD CONSTRAINT "social_ai_generations_variant_org_fk" FOREIGN KEY ("content_variant_id","organization_id") REFERENCES "public"."social_content_variants"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_ai_generations" ADD CONSTRAINT "social_ai_generations_asset_org_fk" FOREIGN KEY ("asset_id","organization_id") REFERENCES "public"."social_assets"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_assets" ADD CONSTRAINT "social_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_assets" ADD CONSTRAINT "social_assets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_assets" ADD CONSTRAINT "social_assets_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_assets" ADD CONSTRAINT "social_assets_brand_org_fk" FOREIGN KEY ("brand_profile_id","organization_id") REFERENCES "public"."marketing_brand_profiles"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_assets" ADD CONSTRAINT "social_assets_campaign_org_fk" FOREIGN KEY ("campaign_id","organization_id") REFERENCES "public"."marketing_campaigns"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_assets" ADD CONSTRAINT "social_assets_content_org_fk" FOREIGN KEY ("content_item_id","organization_id") REFERENCES "public"."marketing_content_items"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_rules" ADD CONSTRAINT "social_automation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_rules" ADD CONSTRAINT "social_automation_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_rules" ADD CONSTRAINT "social_automation_rules_brand_org_fk" FOREIGN KEY ("brand_profile_id","organization_id") REFERENCES "public"."marketing_brand_profiles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_runs" ADD CONSTRAINT "social_automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_runs" ADD CONSTRAINT "social_automation_runs_runtime_job_id_runtime_jobs_id_fk" FOREIGN KEY ("runtime_job_id") REFERENCES "public"."runtime_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_automation_runs" ADD CONSTRAINT "social_automation_runs_rule_org_fk" FOREIGN KEY ("rule_id","organization_id") REFERENCES "public"."social_automation_rules"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_content_variants" ADD CONSTRAINT "social_content_variants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_content_variants" ADD CONSTRAINT "social_content_variants_approval_request_id_agent_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."agent_approval_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_content_variants" ADD CONSTRAINT "social_content_variants_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_content_variants" ADD CONSTRAINT "social_content_variants_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_content_variants" ADD CONSTRAINT "social_content_variants_item_org_fk" FOREIGN KEY ("content_item_id","organization_id") REFERENCES "public"."marketing_content_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_content_variants" ADD CONSTRAINT "social_content_variants_account_org_fk" FOREIGN KEY ("channel_account_id","organization_id") REFERENCES "public"."marketing_channel_accounts"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_engagement_items" ADD CONSTRAINT "social_engagement_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_engagement_items" ADD CONSTRAINT "social_engagement_items_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_engagement_items" ADD CONSTRAINT "social_engagement_items_replied_by_user_id_users_id_fk" FOREIGN KEY ("replied_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_engagement_items" ADD CONSTRAINT "social_engagement_account_org_fk" FOREIGN KEY ("channel_account_id","organization_id") REFERENCES "public"."marketing_channel_accounts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_engagement_items" ADD CONSTRAINT "social_engagement_variant_org_fk" FOREIGN KEY ("content_variant_id","organization_id") REFERENCES "public"."social_content_variants"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_engagement_items" ADD CONSTRAINT "social_engagement_lead_org_fk" FOREIGN KEY ("crm_lead_id","organization_id") REFERENCES "public"."crm_leads"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_engagement_items" ADD CONSTRAINT "social_engagement_contact_org_fk" FOREIGN KEY ("crm_contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_manager_messages" ADD CONSTRAINT "social_manager_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_manager_messages" ADD CONSTRAINT "social_manager_messages_thread_org_fk" FOREIGN KEY ("thread_id","organization_id") REFERENCES "public"."social_manager_threads"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_manager_threads" ADD CONSTRAINT "social_manager_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_manager_threads" ADD CONSTRAINT "social_manager_threads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_manager_threads" ADD CONSTRAINT "social_manager_threads_brand_org_fk" FOREIGN KEY ("brand_profile_id","organization_id") REFERENCES "public"."marketing_brand_profiles"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publish_jobs" ADD CONSTRAINT "social_publish_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publish_jobs" ADD CONSTRAINT "social_publish_jobs_runtime_job_id_runtime_jobs_id_fk" FOREIGN KEY ("runtime_job_id") REFERENCES "public"."runtime_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publish_jobs" ADD CONSTRAINT "social_publish_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publish_jobs" ADD CONSTRAINT "social_publish_jobs_item_org_fk" FOREIGN KEY ("content_item_id","organization_id") REFERENCES "public"."marketing_content_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publish_jobs" ADD CONSTRAINT "social_publish_jobs_variant_org_fk" FOREIGN KEY ("content_variant_id","organization_id") REFERENCES "public"."social_content_variants"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publish_jobs" ADD CONSTRAINT "social_publish_jobs_account_org_fk" FOREIGN KEY ("channel_account_id","organization_id") REFERENCES "public"."marketing_channel_accounts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_account_metrics_period_unique" ON "social_account_metric_snapshots" USING btree ("channel_account_id","source","period_start","period_end");--> statement-breakpoint
CREATE INDEX "social_account_metrics_org_captured_idx" ON "social_account_metric_snapshots" USING btree ("organization_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_ad_campaign_snapshots_period_unique" ON "social_ad_campaign_snapshots" USING btree ("channel_account_id","external_campaign_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "social_ad_campaign_snapshots_org_captured_idx" ON "social_ad_campaign_snapshots" USING btree ("organization_id","captured_at");--> statement-breakpoint
CREATE INDEX "social_ad_change_requests_org_status_idx" ON "social_ad_change_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "social_ai_generations_active_fingerprint_unique" ON "social_ai_generations" USING btree ("organization_id","request_fingerprint") WHERE "social_ai_generations"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "social_ai_generations_org_created_idx" ON "social_ai_generations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "social_ai_generations_org_type_idx" ON "social_ai_generations" USING btree ("organization_id","generation_type");--> statement-breakpoint
CREATE INDEX "social_assets_org_brand_idx" ON "social_assets" USING btree ("organization_id","brand_profile_id");--> statement-breakpoint
CREATE INDEX "social_assets_org_content_idx" ON "social_assets" USING btree ("organization_id","content_item_id");--> statement-breakpoint
CREATE INDEX "social_assets_org_type_idx" ON "social_assets" USING btree ("organization_id","asset_type");--> statement-breakpoint
CREATE UNIQUE INDEX "social_automation_rules_scope_kind_unique" ON "social_automation_rules" USING btree ("organization_id","brand_profile_id","kind") WHERE "social_automation_rules"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "social_automation_rules_due_idx" ON "social_automation_rules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "social_automation_runs_org_started_idx" ON "social_automation_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "social_automation_runs_rule_idx" ON "social_automation_runs" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_content_variants_item_platform_account_unique" ON "social_content_variants" USING btree ("content_item_id","platform","channel_account_id") WHERE "social_content_variants"."archived_at" IS NULL AND "social_content_variants"."channel_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "social_content_variants_org_status_idx" ON "social_content_variants" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "social_content_variants_org_scheduled_idx" ON "social_content_variants" USING btree ("organization_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "social_content_variants_account_idx" ON "social_content_variants" USING btree ("channel_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_engagement_items_external_unique" ON "social_engagement_items" USING btree ("channel_account_id","item_type","external_id");--> statement-breakpoint
CREATE INDEX "social_engagement_items_org_status_idx" ON "social_engagement_items" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "social_engagement_items_org_posted_idx" ON "social_engagement_items" USING btree ("organization_id","posted_at");--> statement-breakpoint
CREATE INDEX "social_manager_messages_thread_idx" ON "social_manager_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "social_manager_threads_org_owner_idx" ON "social_manager_threads" USING btree ("organization_id","owner_user_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_publish_jobs_variant_active_unique" ON "social_publish_jobs" USING btree ("content_variant_id") WHERE "social_publish_jobs"."status" IN ('queued', 'processing', 'retrying');--> statement-breakpoint
CREATE INDEX "social_publish_jobs_org_status_idx" ON "social_publish_jobs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "social_publish_jobs_org_scheduled_idx" ON "social_publish_jobs" USING btree ("organization_id","scheduled_for");--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD CONSTRAINT "marketing_brand_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD CONSTRAINT "marketing_channel_accounts_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_items" ADD CONSTRAINT "marketing_content_items_brand_org_fk" FOREIGN KEY ("brand_profile_id","organization_id") REFERENCES "public"."marketing_brand_profiles"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_channel_accounts_external_unique" ON "marketing_channel_accounts" USING btree ("organization_id","platform","external_account_id") WHERE "marketing_channel_accounts"."external_account_id" IS NOT NULL AND "marketing_channel_accounts"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "marketing_channel_accounts_connection_idx" ON "marketing_channel_accounts" USING btree ("integration_connection_id");--> statement-breakpoint
CREATE INDEX "marketing_content_items_org_brand_idx" ON "marketing_content_items" USING btree ("organization_id","brand_profile_id");--> statement-breakpoint
CREATE INDEX "marketing_performance_variant_idx" ON "marketing_content_performance_snapshots" USING btree ("content_variant_id");