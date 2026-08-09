CREATE TYPE "public"."analytics_date_range_strategy" AS ENUM('last_7_days', 'last_30_days', 'last_90_days', 'month_to_date', 'quarter_to_date', 'year_to_date', 'custom');--> statement-breakpoint
CREATE TYPE "public"."analytics_report_visibility" AS ENUM('private', 'organization');--> statement-breakpoint
CREATE TYPE "public"."analytics_role" AS ENUM('analytics_admin', 'analytics_manager', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."analytics_time_grain" AS ENUM('day', 'week', 'month', 'quarter');--> statement-breakpoint
CREATE TYPE "public"."analytics_visualization" AS ENUM('kpi_card', 'line', 'bar', 'table', 'funnel', 'progress', 'status_distribution');--> statement-breakpoint
CREATE TABLE "analytics_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"business_timezone" text DEFAULT 'UTC' NOT NULL,
	"default_time_grain" "analytics_time_grain" DEFAULT 'day' NOT NULL,
	"default_date_range_strategy" "analytics_date_range_strategy" DEFAULT 'last_30_days' NOT NULL,
	"default_comparison_enabled" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "analytics_role" NOT NULL,
	"granted_by_user_id" uuid,
	"revoked_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"metric_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"date_range_strategy" "analytics_date_range_strategy" DEFAULT 'last_30_days' NOT NULL,
	"custom_start_date" timestamp with time zone,
	"custom_end_date" timestamp with time zone,
	"comparison_enabled" boolean DEFAULT true NOT NULL,
	"time_grain" "analytics_time_grain" DEFAULT 'day' NOT NULL,
	"dimensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visualization" "analytics_visualization" DEFAULT 'kpi_card' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"visibility" "analytics_report_visibility" DEFAULT 'private' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_configurations" ADD CONSTRAINT "analytics_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_configurations" ADD CONSTRAINT "analytics_configurations_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_role_assignments" ADD CONSTRAINT "analytics_role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_role_assignments" ADD CONSTRAINT "analytics_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_role_assignments" ADD CONSTRAINT "analytics_role_assignments_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_role_assignments" ADD CONSTRAINT "analytics_role_assignments_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_saved_reports" ADD CONSTRAINT "analytics_saved_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_saved_reports" ADD CONSTRAINT "analytics_saved_reports_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_saved_reports" ADD CONSTRAINT "analytics_saved_reports_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_configurations_org_only_unique" ON "analytics_configurations" USING btree ("organization_id") WHERE "analytics_configurations"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_configurations_org_workspace_unique" ON "analytics_configurations" USING btree ("organization_id","workspace_id") WHERE "analytics_configurations"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_role_assignments_active_unique" ON "analytics_role_assignments" USING btree ("organization_id","user_id") WHERE "analytics_role_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "analytics_saved_reports_org_idx" ON "analytics_saved_reports" USING btree ("organization_id","owner_user_id");