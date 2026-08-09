CREATE TYPE "public"."tool_category" AS ENUM('brain', 'runtime', 'artifact', 'internal_api', 'external_api', 'communication', 'data', 'file', 'administrative');--> statement-breakpoint
CREATE TYPE "public"."tool_error_class" AS ENUM('invalid_input', 'permission_denied', 'approval_required', 'tool_disabled', 'tool_not_found', 'timeout', 'transient_failure', 'permanent_failure', 'provider_unavailable', 'idempotency_conflict', 'unsafe_retry', 'runtime_error');--> statement-breakpoint
CREATE TYPE "public"."tool_invocation_status" AS ENUM('requested', 'validating', 'waiting_for_approval', 'ready', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."tool_side_effect_class" AS ENUM('read_only', 'internal_write', 'external_write', 'destructive', 'financial', 'permission_changing');--> statement-breakpoint
CREATE TABLE "tool_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_key" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" "tool_category" NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb NOT NULL,
	"risk_level" "agent_approval_risk_level" NOT NULL,
	"side_effect_class" "tool_side_effect_class" NOT NULL,
	"required_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minimum_permission_level" "agent_permission_level",
	"approval_required" boolean DEFAULT false NOT NULL,
	"timeout_seconds" integer DEFAULT 30 NOT NULL,
	"max_retry_attempts" integer DEFAULT 0 NOT NULL,
	"retry_backoff_seconds" integer DEFAULT 0 NOT NULL,
	"idempotency_required" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"change_reason" text,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_definitions_key_version_unique" UNIQUE("tool_key","version"),
	CONSTRAINT "tool_definitions_high_risk_requires_approval_check" CHECK (NOT ("tool_definitions"."side_effect_class" IN ('destructive', 'financial', 'permission_changing') AND "tool_definitions"."approval_required" = false))
);
--> statement-breakpoint
CREATE TABLE "tool_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"execution_id" uuid NOT NULL,
	"plan_step_id" uuid,
	"agent_id" uuid NOT NULL,
	"agent_version_number" integer NOT NULL,
	"tool_key" text NOT NULL,
	"tool_version" integer NOT NULL,
	"status" "tool_invocation_status" DEFAULT 'requested' NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_metadata" jsonb,
	"result_ref" jsonb,
	"artifact_id" uuid,
	"error_class" "tool_error_class",
	"error_message" text,
	"approval_request_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_definitions" ADD CONSTRAINT "tool_definitions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_plan_step_id_agent_plan_steps_id_fk" FOREIGN KEY ("plan_step_id") REFERENCES "public"."agent_plan_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_artifact_id_agent_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."agent_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_approval_request_id_agent_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."agent_approval_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_execution_org_fk" FOREIGN KEY ("execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_agent_org_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_definitions_key_idx" ON "tool_definitions" USING btree ("tool_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_invocations_idempotency_unique" ON "tool_invocations" USING btree ("organization_id","execution_id","tool_key","idempotency_key") WHERE "tool_invocations"."status" <> 'failed';--> statement-breakpoint
CREATE INDEX "tool_invocations_execution_idx" ON "tool_invocations" USING btree ("execution_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_invocations_org_tool_idx" ON "tool_invocations" USING btree ("organization_id","tool_key");