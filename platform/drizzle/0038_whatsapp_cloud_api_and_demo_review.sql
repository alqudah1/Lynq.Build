-- Module 16 extension — real WhatsApp Cloud API provider + demo quality gate.
--
-- Two additive, nullable JSONB columns. Nothing is backfilled and nothing
-- existing changes shape, so this migration is safe to apply ahead of the
-- deploy that starts writing either column.

-- The provider-native approved-template directive an outbound message must
-- be dispatched as. WhatsApp business-initiated messages are template-only;
-- `body_text` remains the human-reviewable rendering of the same content.
ALTER TABLE "communication_messages" ADD COLUMN IF NOT EXISTS "provider_template" jsonb;
--> statement-breakpoint

-- The recorded demo quality review for a prospect company. Outreach
-- eligibility reads this stored verdict rather than recomputing at send
-- time, so a message can only go out against a review someone actually made.
ALTER TABLE "crm_companies" ADD COLUMN IF NOT EXISTS "demo_review" jsonb;
--> statement-breakpoint

-- Per-recipient personalization, frozen with the recipient snapshot. A
-- lead-gen campaign gives every business its own name, demo URL and market
-- price; the batch-level template values remain the default these merge over.
ALTER TABLE "communication_bulk_recipients" ADD COLUMN IF NOT EXISTS "template_values" jsonb;
--> statement-breakpoint
ALTER TABLE "communication_bulk_recipients" ADD COLUMN IF NOT EXISTS "provider_template" jsonb;
--> statement-breakpoint

-- Which sender a recipient is messaged from, and the provider-native thread
-- key. Per recipient because one organization runs one WhatsApp Business
-- number per market, and a reply must match the conversation the send opened.
ALTER TABLE "communication_bulk_recipients" ADD COLUMN IF NOT EXISTS "integration_connection_id" uuid;
--> statement-breakpoint
ALTER TABLE "communication_bulk_recipients" ADD COLUMN IF NOT EXISTS "external_thread_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "communication_bulk_recipients"
    ADD CONSTRAINT "communication_bulk_recipients_integration_connection_id_fk"
    FOREIGN KEY ("integration_connection_id") REFERENCES "integration_connections"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
