CREATE TYPE "public"."agent_department" AS ENUM('founders_office', 'product', 'design', 'engineering', 'ai_systems', 'client_success', 'sales_and_bizdev', 'marketing_and_brand', 'support', 'finance_and_operations', 'legal_and_compliance', 'security_and_trust', 'research_and_strategy');--> statement-breakpoint
CREATE TYPE "public"."agent_health_status" AS ENUM('healthy', 'degraded', 'unhealthy', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."agent_lifecycle_stage" AS ENUM('idea', 'specification', 'development', 'testing', 'approval', 'deployment', 'monitoring', 'improvement', 'retired');--> statement-breakpoint
CREATE TYPE "public"."agent_permission_level" AS ENUM('observer', 'assistant', 'operator', 'manager', 'executive', 'system');--> statement-breakpoint
CREATE TABLE "agent_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"key_prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"issued_by_user_id" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"purpose" text NOT NULL,
	"responsibilities" text NOT NULL,
	"goals" text NOT NULL,
	"inputs" text NOT NULL,
	"outputs" text NOT NULL,
	"success_criteria" text NOT NULL,
	"failure_criteria" text NOT NULL,
	"retirement_criteria" text NOT NULL,
	"permission_level" "agent_permission_level" NOT NULL,
	"change_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"department" "agent_department" NOT NULL,
	"purpose" text NOT NULL,
	"responsibilities" text NOT NULL,
	"goals" text NOT NULL,
	"inputs" text NOT NULL,
	"outputs" text NOT NULL,
	"success_criteria" text NOT NULL,
	"failure_criteria" text NOT NULL,
	"retirement_criteria" text NOT NULL,
	"human_owner_user_id" uuid NOT NULL,
	"permission_level" "agent_permission_level" NOT NULL,
	"lifecycle_stage" "agent_lifecycle_stage" DEFAULT 'idea' NOT NULL,
	"health_status" "agent_health_status" DEFAULT 'unknown' NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"registered_by_user_id" uuid,
	"retired_at" timestamp with time zone,
	"retired_by_user_id" uuid,
	"retirement_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_human_owner_user_id_users_id_fk" FOREIGN KEY ("human_owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_registered_by_user_id_users_id_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_retired_by_user_id_users_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_human_owner_org_membership_fk" FOREIGN KEY ("human_owner_user_id","organization_id") REFERENCES "public"."organization_memberships"("user_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_credentials_key_prefix_unique" ON "agent_credentials" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "agent_credentials_agent_active_idx" ON "agent_credentials" USING btree ("agent_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_agent_version_unique" ON "agent_versions" USING btree ("agent_id","version_number");--> statement-breakpoint
CREATE INDEX "agents_org_department_idx" ON "agents" USING btree ("organization_id","department");--> statement-breakpoint
CREATE INDEX "agents_org_lifecycle_stage_idx" ON "agents" USING btree ("organization_id","lifecycle_stage");