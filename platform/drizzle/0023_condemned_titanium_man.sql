CREATE TYPE "public"."workflow_definition_status" AS ENUM('draft', 'published', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."workflow_execution_status" AS ENUM('queued', 'running', 'waiting', 'waiting_for_approval', 'paused', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_human_task_status" AS ENUM('pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_node_execution_status" AS ENUM('pending', 'ready', 'running', 'waiting', 'succeeded', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_node_type" AS ENUM('start', 'end', 'agent_execution', 'tool_invocation', 'human_task', 'approval', 'condition', 'wait', 'project_task', 'artifact_transform');--> statement-breakpoint
CREATE TYPE "public"."workflow_version_status" AS ENUM('draft', 'valid', 'published', 'superseded', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'workflow_start';--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'workflow_continue';--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'workflow_node_execute';--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'workflow_reconcile';--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"workflow_key" text NOT NULL,
	"description" text,
	"status" "workflow_definition_status" DEFAULT 'draft' NOT NULL,
	"current_published_version_id" uuid,
	"is_template" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_definitions_org_key_unique" UNIQUE("organization_id","workflow_key"),
	CONSTRAINT "workflow_definitions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"condition_key" text,
	"sequence" integer DEFAULT 0 NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_edges_source_target_condition_unique" UNIQUE("source_node_id","target_node_id","condition_key"),
	CONSTRAINT "workflow_edges_no_self_edge_check" CHECK ("workflow_edges"."source_node_id" <> "workflow_edges"."target_node_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_execution_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"workflow_node_id" uuid,
	"workflow_node_execution_id" uuid,
	"actor_user_id" uuid,
	"actor_agent_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"workflow_definition_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"status" "workflow_execution_status" DEFAULT 'queued' NOT NULL,
	"initiator_user_id" uuid,
	"project_id" uuid,
	"project_task_id" uuid,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_node_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failure_classification" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_executions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_human_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_execution_id" uuid NOT NULL,
	"workflow_node_execution_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"assigned_user_id" uuid NOT NULL,
	"due_date" timestamp with time zone,
	"status" "workflow_human_task_status" DEFAULT 'pending' NOT NULL,
	"completed_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"output_data" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_human_tasks_node_execution_unique" UNIQUE("workflow_node_execution_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_node_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_execution_id" uuid NOT NULL,
	"workflow_node_id" uuid NOT NULL,
	"status" "workflow_node_execution_status" DEFAULT 'pending' NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"runtime_execution_id" uuid,
	"tool_invocation_id" uuid,
	"approval_request_id" uuid,
	"project_task_id" uuid,
	"artifact_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_classification" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_node_executions_attempt_unique" UNIQUE("workflow_execution_id","workflow_node_id","attempt_number"),
	CONSTRAINT "workflow_node_executions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"node_type" "workflow_node_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retry_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timeout_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position_x" integer DEFAULT 0 NOT NULL,
	"position_y" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_nodes_version_key_unique" UNIQUE("workflow_version_id","node_key"),
	CONSTRAINT "workflow_nodes_id_version_unique" UNIQUE("id","workflow_version_id"),
	CONSTRAINT "workflow_nodes_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_definition_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "workflow_version_status" DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"created_by_user_id" uuid,
	"change_reason" text,
	"validation_result" jsonb,
	"published_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_versions_definition_number_unique" UNIQUE("workflow_definition_id","version_number"),
	CONSTRAINT "workflow_versions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "runtime_jobs" ADD COLUMN "workflow_execution_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_current_published_version_id_workflow_versions_id_fk" FOREIGN KEY ("current_published_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_version_org_fk" FOREIGN KEY ("workflow_version_id","organization_id") REFERENCES "public"."workflow_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_source_version_fk" FOREIGN KEY ("source_node_id","workflow_version_id") REFERENCES "public"."workflow_nodes"("id","workflow_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_target_version_fk" FOREIGN KEY ("target_node_id","workflow_version_id") REFERENCES "public"."workflow_nodes"("id","workflow_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_events" ADD CONSTRAINT "workflow_execution_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_events" ADD CONSTRAINT "workflow_execution_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_events" ADD CONSTRAINT "workflow_execution_events_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_events" ADD CONSTRAINT "workflow_execution_events_execution_org_fk" FOREIGN KEY ("workflow_execution_id","organization_id") REFERENCES "public"."workflow_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_initiator_user_id_users_id_fk" FOREIGN KEY ("initiator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_definition_org_fk" FOREIGN KEY ("workflow_definition_id","organization_id") REFERENCES "public"."workflow_definitions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_version_org_fk" FOREIGN KEY ("workflow_version_id","organization_id") REFERENCES "public"."workflow_versions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_project_org_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_project_task_org_fk" FOREIGN KEY ("project_task_id","organization_id") REFERENCES "public"."project_tasks"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_current_node_org_fk" FOREIGN KEY ("current_node_id","organization_id") REFERENCES "public"."workflow_nodes"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_human_tasks" ADD CONSTRAINT "workflow_human_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_human_tasks" ADD CONSTRAINT "workflow_human_tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_human_tasks" ADD CONSTRAINT "workflow_human_tasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_human_tasks" ADD CONSTRAINT "workflow_human_tasks_execution_org_fk" FOREIGN KEY ("workflow_execution_id","organization_id") REFERENCES "public"."workflow_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_human_tasks" ADD CONSTRAINT "workflow_human_tasks_node_execution_org_fk" FOREIGN KEY ("workflow_node_execution_id","organization_id") REFERENCES "public"."workflow_node_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_tool_invocation_id_tool_invocations_id_fk" FOREIGN KEY ("tool_invocation_id") REFERENCES "public"."tool_invocations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_approval_request_id_agent_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."agent_approval_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_artifact_id_agent_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."agent_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_execution_org_fk" FOREIGN KEY ("workflow_execution_id","organization_id") REFERENCES "public"."workflow_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_node_org_fk" FOREIGN KEY ("workflow_node_id","organization_id") REFERENCES "public"."workflow_nodes"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_runtime_execution_org_fk" FOREIGN KEY ("runtime_execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_project_task_org_fk" FOREIGN KEY ("project_task_id","organization_id") REFERENCES "public"."project_tasks"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_version_org_fk" FOREIGN KEY ("workflow_version_id","organization_id") REFERENCES "public"."workflow_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_definition_org_fk" FOREIGN KEY ("workflow_definition_id","organization_id") REFERENCES "public"."workflow_definitions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_definitions_org_status_idx" ON "workflow_definitions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "workflow_edges_source_idx" ON "workflow_edges" USING btree ("source_node_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_target_idx" ON "workflow_edges" USING btree ("target_node_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_events_execution_idx" ON "workflow_execution_events" USING btree ("workflow_execution_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_executions_org_status_idx" ON "workflow_executions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "workflow_executions_definition_idx" ON "workflow_executions" USING btree ("workflow_definition_id");--> statement-breakpoint
CREATE INDEX "workflow_executions_project_idx" ON "workflow_executions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_human_tasks_assignee_status_idx" ON "workflow_human_tasks" USING btree ("assigned_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_node_executions_active_unique" ON "workflow_node_executions" USING btree ("workflow_execution_id","workflow_node_id") WHERE "workflow_node_executions"."status" IN ('pending', 'ready', 'running', 'waiting');--> statement-breakpoint
CREATE INDEX "workflow_node_executions_execution_idx" ON "workflow_node_executions" USING btree ("workflow_execution_id");--> statement-breakpoint
CREATE INDEX "workflow_nodes_version_idx" ON "workflow_nodes" USING btree ("workflow_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_one_published_unique" ON "workflow_versions" USING btree ("workflow_definition_id") WHERE "workflow_versions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "workflow_versions_definition_idx" ON "workflow_versions" USING btree ("workflow_definition_id");--> statement-breakpoint
ALTER TABLE "runtime_jobs" ADD CONSTRAINT "runtime_jobs_workflow_execution_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_jobs_workflow_execution_idx" ON "runtime_jobs" USING btree ("workflow_execution_id");