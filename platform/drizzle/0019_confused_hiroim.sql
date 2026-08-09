CREATE TYPE "public"."agent_approval_risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."agent_approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'cancelled', 'revision_requested');--> statement-breakpoint
CREATE TYPE "public"."agent_artifact_status" AS ENUM('draft', 'review', 'approved', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."agent_artifact_type" AS ENUM('draft_text', 'report', 'proposal', 'structured_data', 'code_patch_reference', 'file_reference', 'action_proposal');--> statement-breakpoint
CREATE TYPE "public"."agent_delegation_status" AS ENUM('active', 'completed', 'failed', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."agent_execution_status" AS ENUM('queued', 'assigned', 'gathering_context', 'planning', 'reasoning', 'waiting', 'executing', 'delegating', 'human_approval', 'verifying', 'paused', 'completed', 'failed', 'cancelled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."agent_plan_step_status" AS ENUM('pending', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "agent_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"requesting_agent_id" uuid NOT NULL,
	"requested_action" text NOT NULL,
	"summary" text NOT NULL,
	"risk_level" "agent_approval_risk_level" NOT NULL,
	"artifact_id" uuid,
	"proposed_action_ref" jsonb,
	"status" "agent_approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"artifact_type" "agent_artifact_type" NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"external_ref" text,
	"status" "agent_artifact_status" DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"created_by_agent_id" uuid,
	"created_by_type" "access_actor_type" NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_artifacts_at_most_one_creator_check" CHECK (NOT ("agent_artifacts"."created_by_user_id" IS NOT NULL AND "agent_artifacts"."created_by_agent_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "agent_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"status_at_checkpoint" "agent_execution_status" NOT NULL,
	"step_position" text,
	"safe_state_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_side_effect_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retry_count_at_checkpoint" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_checkpoints_execution_sequence_unique" UNIQUE("execution_id","sequence_number")
);
--> statement-breakpoint
CREATE TABLE "agent_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_execution_id" uuid NOT NULL,
	"child_execution_id" uuid NOT NULL,
	"delegating_agent_id" uuid NOT NULL,
	"delegate_agent_id" uuid NOT NULL,
	"ancestry_path" jsonb NOT NULL,
	"depth" integer NOT NULL,
	"timeout_at" timestamp with time zone NOT NULL,
	"status" "agent_delegation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_delegations_child_unique" UNIQUE("child_execution_id"),
	CONSTRAINT "agent_delegations_no_self_delegation_check" CHECK ("agent_delegations"."parent_execution_id" <> "agent_delegations"."child_execution_id")
);
--> statement-breakpoint
CREATE TABLE "agent_execution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"from_status" "agent_execution_status",
	"to_status" "agent_execution_status",
	"actor_user_id" uuid,
	"actor_agent_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_execution_events_at_most_one_actor_check" CHECK (NOT ("agent_execution_events"."actor_user_id" IS NOT NULL AND "agent_execution_events"."actor_agent_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "agent_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"initiating_user_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"assigned_agent_id" uuid,
	"assigned_agent_version_number" integer,
	"parent_execution_id" uuid,
	"root_execution_id" uuid NOT NULL,
	"delegation_depth" integer DEFAULT 0 NOT NULL,
	"goal" text NOT NULL,
	"success_criteria" text NOT NULL,
	"failure_criteria" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"deadline" timestamp with time zone,
	"status" "agent_execution_status" DEFAULT 'queued' NOT NULL,
	"wait_reason" text,
	"domains_requested" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context_snapshot" jsonb,
	"current_plan_id" uuid,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_executions_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "agent_executions_retry_bound_check" CHECK ("agent_executions"."retry_count" <= "agent_executions"."max_retries"),
	CONSTRAINT "agent_executions_delegation_depth_bound_check" CHECK ("agent_executions"."delegation_depth" >= 0 AND "agent_executions"."delegation_depth" <= 5)
);
--> statement-breakpoint
CREATE TABLE "agent_plan_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"description" text NOT NULL,
	"status" "agent_plan_step_status" DEFAULT 'pending' NOT NULL,
	"related_execution_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_plan_steps_plan_step_unique" UNIQUE("plan_id","step_number")
);
--> statement-breakpoint
CREATE TABLE "agent_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"change_reason" text,
	"created_by_user_id" uuid,
	"created_by_agent_id" uuid,
	"created_by_type" "access_actor_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_plans_execution_version_unique" UNIQUE("execution_id","version_number"),
	CONSTRAINT "agent_plans_at_most_one_creator_check" CHECK (NOT ("agent_plans"."created_by_user_id" IS NOT NULL AND "agent_plans"."created_by_agent_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "agent_task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dependent_execution_id" uuid NOT NULL,
	"depends_on_execution_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_task_dependencies_edge_unique" UNIQUE("dependent_execution_id","depends_on_execution_id"),
	CONSTRAINT "agent_task_dependencies_no_self_link" CHECK ("agent_task_dependencies"."dependent_execution_id" <> "agent_task_dependencies"."depends_on_execution_id")
);
--> statement-breakpoint
ALTER TABLE "agent_approval_requests" ADD CONSTRAINT "agent_approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval_requests" ADD CONSTRAINT "agent_approval_requests_requesting_agent_id_agents_id_fk" FOREIGN KEY ("requesting_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval_requests" ADD CONSTRAINT "agent_approval_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval_requests" ADD CONSTRAINT "agent_approval_requests_execution_org_fk" FOREIGN KEY ("execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_artifacts" ADD CONSTRAINT "agent_artifacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_artifacts" ADD CONSTRAINT "agent_artifacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_artifacts" ADD CONSTRAINT "agent_artifacts_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_artifacts" ADD CONSTRAINT "agent_artifacts_execution_org_fk" FOREIGN KEY ("execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_checkpoints" ADD CONSTRAINT "agent_checkpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_checkpoints" ADD CONSTRAINT "agent_checkpoints_execution_org_fk" FOREIGN KEY ("execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_delegating_agent_id_agents_id_fk" FOREIGN KEY ("delegating_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_delegate_agent_id_agents_id_fk" FOREIGN KEY ("delegate_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_parent_org_fk" FOREIGN KEY ("parent_execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_child_org_fk" FOREIGN KEY ("child_execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_events" ADD CONSTRAINT "agent_execution_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_events" ADD CONSTRAINT "agent_execution_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_events" ADD CONSTRAINT "agent_execution_events_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_events" ADD CONSTRAINT "agent_execution_events_execution_org_fk" FOREIGN KEY ("execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_initiating_user_id_users_id_fk" FOREIGN KEY ("initiating_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_assigned_agent_org_fk" FOREIGN KEY ("assigned_agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_parent_org_fk" FOREIGN KEY ("parent_execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_root_org_fk" FOREIGN KEY ("root_execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plan_steps" ADD CONSTRAINT "agent_plan_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plan_steps" ADD CONSTRAINT "agent_plan_steps_plan_id_agent_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."agent_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plan_steps" ADD CONSTRAINT "agent_plan_steps_related_execution_org_fk" FOREIGN KEY ("related_execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plans" ADD CONSTRAINT "agent_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plans" ADD CONSTRAINT "agent_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plans" ADD CONSTRAINT "agent_plans_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plans" ADD CONSTRAINT "agent_plans_execution_org_fk" FOREIGN KEY ("execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_dependencies" ADD CONSTRAINT "agent_task_dependencies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_dependencies" ADD CONSTRAINT "agent_task_dependencies_dependent_org_fk" FOREIGN KEY ("dependent_execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_dependencies" ADD CONSTRAINT "agent_task_dependencies_depends_on_org_fk" FOREIGN KEY ("depends_on_execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_approval_requests_execution_status_idx" ON "agent_approval_requests" USING btree ("execution_id","status");--> statement-breakpoint
CREATE INDEX "agent_approval_requests_org_status_expires_idx" ON "agent_approval_requests" USING btree ("organization_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "agent_artifacts_execution_status_idx" ON "agent_artifacts" USING btree ("execution_id","status");--> statement-breakpoint
CREATE INDEX "agent_artifacts_org_status_idx" ON "agent_artifacts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "agent_checkpoints_execution_sequence_idx" ON "agent_checkpoints" USING btree ("execution_id","sequence_number");--> statement-breakpoint
CREATE INDEX "agent_delegations_parent_idx" ON "agent_delegations" USING btree ("parent_execution_id");--> statement-breakpoint
CREATE INDEX "agent_delegations_org_status_timeout_idx" ON "agent_delegations" USING btree ("organization_id","status","timeout_at");--> statement-breakpoint
CREATE INDEX "agent_execution_events_execution_created_idx" ON "agent_execution_events" USING btree ("execution_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_execution_events_org_created_idx" ON "agent_execution_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_executions_org_status_idx" ON "agent_executions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "agent_executions_org_agent_status_idx" ON "agent_executions" USING btree ("organization_id","assigned_agent_id","status");--> statement-breakpoint
CREATE INDEX "agent_executions_parent_idx" ON "agent_executions" USING btree ("parent_execution_id");--> statement-breakpoint
CREATE INDEX "agent_executions_root_idx" ON "agent_executions" USING btree ("root_execution_id");--> statement-breakpoint
CREATE INDEX "agent_executions_org_owner_idx" ON "agent_executions" USING btree ("organization_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "agent_plan_steps_plan_idx" ON "agent_plan_steps" USING btree ("plan_id","step_number");--> statement-breakpoint
CREATE INDEX "agent_plans_execution_version_idx" ON "agent_plans" USING btree ("execution_id","version_number");--> statement-breakpoint
CREATE INDEX "agent_task_dependencies_depends_on_idx" ON "agent_task_dependencies" USING btree ("depends_on_execution_id");