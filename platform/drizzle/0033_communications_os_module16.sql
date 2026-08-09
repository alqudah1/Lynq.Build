CREATE TYPE "public"."communication_approval_linked_entity_type" AS ENUM('message', 'bulk_batch');--> statement-breakpoint
CREATE TYPE "public"."communication_bulk_batch_status" AS ENUM('draft', 'pending_approval', 'approved', 'queued', 'in_progress', 'paused', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."communication_bulk_recipient_status" AS ENUM('pending', 'skipped_suppressed', 'skipped_no_consent', 'queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."communication_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."communication_consent_source" AS ENUM('explicit_form', 'reply_stop', 'reply_start', 'manual_admin', 'imported', 'inferred_transactional');--> statement-breakpoint
CREATE TYPE "public"."communication_consent_status" AS ENUM('unknown', 'opted_in', 'opted_out', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."communication_conversation_status" AS ENUM('open', 'pending', 'resolved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."communication_delivery_event_type" AS ENUM('accepted', 'sent', 'delivered', 'bounced', 'failed', 'rejected', 'read');--> statement-breakpoint
CREATE TYPE "public"."communication_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."communication_external_identity_type" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TYPE "public"."communication_failure_class" AS ENUM('invalid_recipient', 'suppressed', 'consent_required', 'provider_rejected', 'provider_timeout', 'permanent_provider_error', 'transient_provider_error', 'approval_revoked', 'connection_disabled', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."communication_message_status" AS ENUM('draft', 'pending_approval', 'approved', 'queued', 'sending', 'sent', 'delivered', 'failed', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."communication_provider_event_processing_status" AS ENUM('pending', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."communication_role" AS ENUM('communications_admin', 'communications_manager', 'communications_agent', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."communication_suppression_reason" AS ENUM('user_opt_out', 'bounced_hard', 'complaint', 'manual', 'compliance_hold');--> statement-breakpoint
CREATE TYPE "public"."communication_template_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."communication_template_version_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."integration_connection_status" AS ENUM('pending', 'connected', 'verification_failed', 'disabled', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('resend', 'dev_email', 'twilio', 'dev_sms', 'whatsapp_cloud_api', 'dev_whatsapp');--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'communication_send';--> statement-breakpoint
ALTER TYPE "public"."runtime_job_type" ADD VALUE 'communication_reconcile';--> statement-breakpoint
CREATE TABLE "communication_approval_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"linked_entity_type" "communication_approval_linked_entity_type" NOT NULL,
	"linked_entity_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_approval_links_approval_unique" UNIQUE("approval_request_id")
);
--> statement-breakpoint
CREATE TABLE "communication_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"artifact_id" uuid,
	"external_ref" text,
	"provider_attachment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_bulk_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"channel" "communication_channel" NOT NULL,
	"campaign_id" uuid,
	"audience_id" uuid,
	"template_version_id" uuid NOT NULL,
	"status" "communication_bulk_batch_status" DEFAULT 'draft' NOT NULL,
	"approval_request_id" uuid,
	"recipient_snapshot_count" integer DEFAULT 0 NOT NULL,
	"max_recipients" integer DEFAULT 200 NOT NULL,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_bulk_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"recipient_reference" text NOT NULL,
	"contact_id" uuid,
	"message_id" uuid,
	"status" "communication_bulk_recipient_status" DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel" "communication_channel" NOT NULL,
	"normalized_identity" text NOT NULL,
	"contact_id" uuid,
	"consent_status" "communication_consent_status" DEFAULT 'unknown' NOT NULL,
	"consent_source" "communication_consent_source",
	"captured_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"suppression_reason" "communication_suppression_reason",
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"channel" "communication_channel" NOT NULL,
	"integration_connection_id" uuid,
	"contact_id" uuid,
	"company_id" uuid,
	"lead_id" uuid,
	"opportunity_id" uuid,
	"external_thread_id" text,
	"status" "communication_conversation_status" DEFAULT 'open' NOT NULL,
	"assigned_user_id" uuid,
	"last_message_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"provider_event_id" uuid,
	"event_type" "communication_delivery_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"raw_status_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_external_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"identity_type" "communication_external_identity_type" NOT NULL,
	"normalized_identity" text NOT NULL,
	"contact_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"channel" "communication_channel" NOT NULL,
	"name" text NOT NULL,
	"template_key" text NOT NULL,
	"purpose" text,
	"status" "communication_template_status" DEFAULT 'draft' NOT NULL,
	"current_published_version_id" uuid,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "communication_direction" NOT NULL,
	"channel" "communication_channel" NOT NULL,
	"provider" "integration_provider",
	"integration_connection_id" uuid,
	"sender_reference" text,
	"recipient_reference" text,
	"subject" text,
	"body_text" text,
	"content_artifact_id" uuid,
	"status" "communication_message_status" DEFAULT 'draft' NOT NULL,
	"provider_message_id" text,
	"idempotency_key" text NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"failure_class" "communication_failure_class",
	"failure_code" text,
	"created_by_user_id" uuid,
	"created_by_agent_id" uuid,
	"approval_request_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider" "integration_provider" NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_status" "communication_provider_event_processing_status" DEFAULT 'pending' NOT NULL,
	"normalized_entity_type" text,
	"normalized_entity_id" uuid,
	"failure_code" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "communication_role" NOT NULL,
	"granted_by_user_id" uuid,
	"revoked_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel" "communication_channel" NOT NULL,
	"normalized_identity" text NOT NULL,
	"suppression_reason" "communication_suppression_reason" NOT NULL,
	"source" text,
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "communication_template_version_status" DEFAULT 'draft' NOT NULL,
	"subject_template" text,
	"body_template" text NOT NULL,
	"variable_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"provider" "integration_provider" NOT NULL,
	"integration_type" "communication_channel" NOT NULL,
	"display_name" text NOT NULL,
	"status" "integration_connection_status" DEFAULT 'pending' NOT NULL,
	"external_account_id" text,
	"scopes_metadata" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"connected_by_user_id" uuid,
	"last_verified_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"issued_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communication_approval_links" ADD CONSTRAINT "communication_approval_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_approval_links" ADD CONSTRAINT "communication_approval_links_approval_request_id_agent_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."agent_approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_approval_links" ADD CONSTRAINT "communication_approval_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachments_message_id_communication_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."communication_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachments_artifact_id_agent_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."agent_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_bulk_batches" ADD CONSTRAINT "communication_bulk_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_bulk_batches" ADD CONSTRAINT "communication_bulk_batches_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_bulk_batches" ADD CONSTRAINT "communication_bulk_batches_audience_id_marketing_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."marketing_audiences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_bulk_batches" ADD CONSTRAINT "communication_bulk_batches_template_version_id_communication_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."communication_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_bulk_batches" ADD CONSTRAINT "communication_bulk_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_bulk_recipients" ADD CONSTRAINT "communication_bulk_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_bulk_recipients" ADD CONSTRAINT "communication_bulk_recipients_batch_id_communication_bulk_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."communication_bulk_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_bulk_recipients" ADD CONSTRAINT "communication_bulk_recipients_message_id_communication_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."communication_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_bulk_recipients" ADD CONSTRAINT "communication_bulk_recipients_contact_org_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_consent_records" ADD CONSTRAINT "communication_consent_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_consent_records" ADD CONSTRAINT "communication_consent_records_contact_org_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_contact_org_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_company_org_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."crm_companies"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_lead_org_fk" FOREIGN KEY ("lead_id","organization_id") REFERENCES "public"."crm_leads"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_opportunity_org_fk" FOREIGN KEY ("opportunity_id","organization_id") REFERENCES "public"."crm_opportunities"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_delivery_events" ADD CONSTRAINT "communication_delivery_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_delivery_events" ADD CONSTRAINT "communication_delivery_events_message_id_communication_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."communication_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_delivery_events" ADD CONSTRAINT "communication_delivery_events_provider_event_id_communication_provider_events_id_fk" FOREIGN KEY ("provider_event_id") REFERENCES "public"."communication_provider_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_external_identities" ADD CONSTRAINT "communication_external_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_external_identities" ADD CONSTRAINT "communication_external_identities_contact_org_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_message_templates" ADD CONSTRAINT "communication_message_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_message_templates" ADD CONSTRAINT "communication_message_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_conversation_id_communication_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."communication_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_content_artifact_id_agent_artifacts_id_fk" FOREIGN KEY ("content_artifact_id") REFERENCES "public"."agent_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_agent_org_fk" FOREIGN KEY ("created_by_agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_provider_events" ADD CONSTRAINT "communication_provider_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_provider_events" ADD CONSTRAINT "communication_provider_events_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_role_assignments" ADD CONSTRAINT "communication_role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_role_assignments" ADD CONSTRAINT "communication_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_role_assignments" ADD CONSTRAINT "communication_role_assignments_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_role_assignments" ADD CONSTRAINT "communication_role_assignments_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_suppressions" ADD CONSTRAINT "communication_suppressions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_suppressions" ADD CONSTRAINT "communication_suppressions_lifted_by_user_id_users_id_fk" FOREIGN KEY ("lifted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_suppressions" ADD CONSTRAINT "communication_suppressions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_template_versions" ADD CONSTRAINT "communication_template_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_template_versions" ADD CONSTRAINT "communication_template_versions_template_id_communication_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."communication_message_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_template_versions" ADD CONSTRAINT "communication_template_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communication_approval_links_entity_idx" ON "communication_approval_links" USING btree ("linked_entity_type","linked_entity_id");--> statement-breakpoint
CREATE INDEX "communication_attachments_message_idx" ON "communication_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_bulk_batches_active_per_campaign_unique" ON "communication_bulk_batches" USING btree ("campaign_id") WHERE "communication_bulk_batches"."campaign_id" IS NOT NULL AND "communication_bulk_batches"."status" IN ('queued','in_progress');--> statement-breakpoint
CREATE UNIQUE INDEX "communication_bulk_recipients_unique" ON "communication_bulk_recipients" USING btree ("batch_id","recipient_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_consent_records_identity_unique" ON "communication_consent_records" USING btree ("organization_id","channel","normalized_identity");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_conversations_thread_unique" ON "communication_conversations" USING btree ("organization_id","integration_connection_id","external_thread_id") WHERE "communication_conversations"."external_thread_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "communication_conversations_contact_idx" ON "communication_conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "communication_conversations_org_status_idx" ON "communication_conversations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_delivery_events_provider_event_unique" ON "communication_delivery_events" USING btree ("provider_event_id") WHERE "communication_delivery_events"."provider_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "communication_delivery_events_message_idx" ON "communication_delivery_events" USING btree ("message_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_external_identities_unique" ON "communication_external_identities" USING btree ("organization_id","identity_type","normalized_identity");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_message_templates_key_unique" ON "communication_message_templates" USING btree ("organization_id","template_key");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_messages_idempotency_unique" ON "communication_messages" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_messages_provider_message_unique" ON "communication_messages" USING btree ("organization_id","provider","provider_message_id") WHERE "communication_messages"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "communication_messages_conversation_idx" ON "communication_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "communication_messages_org_status_idx" ON "communication_messages" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_provider_events_dedup_unique" ON "communication_provider_events" USING btree ("provider","connection_id","external_event_id");--> statement-breakpoint
CREATE INDEX "communication_provider_events_org_status_idx" ON "communication_provider_events" USING btree ("organization_id","processing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_role_assignments_active_unique" ON "communication_role_assignments" USING btree ("organization_id","user_id") WHERE "communication_role_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "communication_suppressions_active_unique" ON "communication_suppressions" USING btree ("organization_id","channel","normalized_identity") WHERE "communication_suppressions"."lifted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "communication_template_versions_number_unique" ON "communication_template_versions" USING btree ("template_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_active_account_unique" ON "integration_connections" USING btree ("organization_id","provider","external_account_id") WHERE "integration_connections"."external_account_id" IS NOT NULL AND "integration_connections"."disconnected_at" IS NULL;--> statement-breakpoint
CREATE INDEX "integration_connections_org_idx" ON "integration_connections" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credentials_active_unique" ON "integration_credentials" USING btree ("connection_id") WHERE "integration_credentials"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "integration_credentials_connection_idx" ON "integration_credentials" USING btree ("connection_id");