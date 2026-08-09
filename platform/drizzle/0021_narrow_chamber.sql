CREATE TYPE "public"."runtime_job_status" AS ENUM('queued', 'leased', 'running', 'retry_scheduled', 'completed', 'failed', 'cancelled', 'dead_lettered');--> statement-breakpoint
CREATE TYPE "public"."runtime_job_type" AS ENUM('execution_run', 'execution_resume', 'execution_retry', 'tool_invocation_reconcile', 'execution_reconcile', 'cleanup_expired_sessions', 'cleanup_rate_limit_counters');--> statement-breakpoint
CREATE TABLE "runtime_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"workspace_id" uuid,
	"job_type" "runtime_job_type" NOT NULL,
	"execution_id" uuid,
	"tool_invocation_id" uuid,
	"status" "runtime_job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"failure_classification" text,
	"last_error_code" text,
	"last_error_message" text,
	"result_ref" jsonb,
	"requires_human_review" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_jobs_attempt_bound_check" CHECK ("runtime_jobs"."attempt_count" <= "runtime_jobs"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "runtime_operation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_type" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"records_examined" integer DEFAULT 0 NOT NULL,
	"records_affected" integer DEFAULT 0 NOT NULL,
	"outcome_summary" jsonb,
	"succeeded" boolean,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runtime_jobs" ADD CONSTRAINT "runtime_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_jobs" ADD CONSTRAINT "runtime_jobs_tool_invocation_id_tool_invocations_id_fk" FOREIGN KEY ("tool_invocation_id") REFERENCES "public"."tool_invocations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_jobs" ADD CONSTRAINT "runtime_jobs_execution_org_fk" FOREIGN KEY ("execution_id","organization_id") REFERENCES "public"."agent_executions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_jobs_idempotency_unique" ON "runtime_jobs" USING btree ("organization_id","job_type","idempotency_key") WHERE "runtime_jobs"."status" IN ('queued', 'leased', 'running', 'retry_scheduled');--> statement-breakpoint
CREATE INDEX "runtime_jobs_claim_idx" ON "runtime_jobs" USING btree ("job_type","status","available_at");--> statement-breakpoint
CREATE INDEX "runtime_jobs_execution_idx" ON "runtime_jobs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "runtime_jobs_org_status_idx" ON "runtime_jobs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "runtime_operation_runs_type_idx" ON "runtime_operation_runs" USING btree ("operation_type","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_credentials_key_prefix_unique" ON "worker_credentials" USING btree ("key_prefix");