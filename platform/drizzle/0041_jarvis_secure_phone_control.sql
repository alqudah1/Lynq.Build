CREATE TYPE "public"."jarvis_call_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."jarvis_call_purpose" AS ENUM('founder_notification', 'founder_command');--> statement-breakpoint
CREATE TYPE "public"."jarvis_call_session_status" AS ENUM('active', 'completed', 'failed', 'refused');--> statement-breakpoint
CREATE TYPE "public"."jarvis_call_verification_state" AS ENUM('unverified', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."jarvis_command_confirmation_status" AS ENUM('pending', 'confirmed', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."jarvis_command_dispatch_state" AS ENUM('awaiting_confirmation', 'awaiting_approval', 'declined', 'directive_created', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."jarvis_command_risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."jarvis_transcript_role" AS ENUM('founder', 'jarvis');--> statement-breakpoint
CREATE TYPE "public"."jarvis_webhook_processing_status" AS ENUM('processed', 'ignored', 'failed');--> statement-breakpoint
CREATE TABLE "jarvis_call_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"founder_user_id" uuid NOT NULL,
	"direction" "jarvis_call_direction" NOT NULL,
	"purpose" "jarvis_call_purpose" NOT NULL,
	"provider" text DEFAULT 'vapi' NOT NULL,
	"provider_call_id" text NOT NULL,
	"caller_number_last_four" text,
	"caller_number_matched" boolean DEFAULT false NOT NULL,
	"status" "jarvis_call_session_status" DEFAULT 'active' NOT NULL,
	"verification_state" "jarvis_call_verification_state" DEFAULT 'unverified' NOT NULL,
	"verification_attempts" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"delivery_status" text,
	"ended_reason" text,
	"failure_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"redacted_summary_transcript" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jarvis_call_sessions_provider_call_unique" UNIQUE("provider","provider_call_id"),
	CONSTRAINT "jarvis_call_sessions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "jarvis_call_transcript_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"call_session_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"role" "jarvis_transcript_role" NOT NULL,
	"is_final" boolean NOT NULL,
	"redacted_text" text NOT NULL,
	"redacted_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spoken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jarvis_call_transcript_turns_session_sequence_unique" UNIQUE("call_session_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "jarvis_phone_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"call_session_id" uuid NOT NULL,
	"requested_outcome" text NOT NULL,
	"target_name" text,
	"constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_integrations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_level" "jarvis_command_risk_level" NOT NULL,
	"requires_approval" boolean NOT NULL,
	"gated_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"override_attempted" boolean DEFAULT false NOT NULL,
	"readback_text" text NOT NULL,
	"confirmation_status" "jarvis_command_confirmation_status" DEFAULT 'pending' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"dispatch_state" "jarvis_command_dispatch_state" DEFAULT 'awaiting_confirmation' NOT NULL,
	"approval_decided_by_user_id" uuid,
	"approval_decided_at" timestamp with time zone,
	"approval_decision_note" text,
	"project_id" uuid,
	"failure_code" text,
	"failure_message" text,
	"dispatch_attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jarvis_phone_commands_idempotency_unique" UNIQUE("organization_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "jarvis_voice_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"provider" text DEFAULT 'vapi' NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_call_id" text,
	"call_session_id" uuid,
	"processing_status" "jarvis_webhook_processing_status" NOT NULL,
	"failure_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jarvis_call_sessions" ADD CONSTRAINT "jarvis_call_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_call_sessions" ADD CONSTRAINT "jarvis_call_sessions_founder_user_id_users_id_fk" FOREIGN KEY ("founder_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_call_transcript_turns" ADD CONSTRAINT "jarvis_call_transcript_turns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_call_transcript_turns" ADD CONSTRAINT "jarvis_call_transcript_turns_session_org_fk" FOREIGN KEY ("call_session_id","organization_id") REFERENCES "public"."jarvis_call_sessions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_phone_commands" ADD CONSTRAINT "jarvis_phone_commands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_phone_commands" ADD CONSTRAINT "jarvis_phone_commands_approval_decided_by_user_id_users_id_fk" FOREIGN KEY ("approval_decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_phone_commands" ADD CONSTRAINT "jarvis_phone_commands_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_phone_commands" ADD CONSTRAINT "jarvis_phone_commands_session_org_fk" FOREIGN KEY ("call_session_id","organization_id") REFERENCES "public"."jarvis_call_sessions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_voice_webhook_events" ADD CONSTRAINT "jarvis_voice_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_voice_webhook_events" ADD CONSTRAINT "jarvis_voice_webhook_events_call_session_id_jarvis_call_sessions_id_fk" FOREIGN KEY ("call_session_id") REFERENCES "public"."jarvis_call_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jarvis_call_sessions_org_started_idx" ON "jarvis_call_sessions" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "jarvis_call_sessions_org_status_idx" ON "jarvis_call_sessions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "jarvis_call_transcript_turns_session_idx" ON "jarvis_call_transcript_turns" USING btree ("call_session_id","sequence");--> statement-breakpoint
CREATE INDEX "jarvis_phone_commands_session_idx" ON "jarvis_phone_commands" USING btree ("call_session_id");--> statement-breakpoint
CREATE INDEX "jarvis_phone_commands_org_state_idx" ON "jarvis_phone_commands" USING btree ("organization_id","dispatch_state");--> statement-breakpoint
CREATE UNIQUE INDEX "jarvis_voice_webhook_events_dedup_unique" ON "jarvis_voice_webhook_events" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "jarvis_voice_webhook_events_call_idx" ON "jarvis_voice_webhook_events" USING btree ("provider_call_id");