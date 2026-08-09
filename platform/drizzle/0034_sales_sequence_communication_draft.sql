ALTER TYPE "public"."sales_sequence_step_action_type" ADD VALUE 'communication_draft';--> statement-breakpoint
ALTER TABLE "sales_sequence_step_runs" ADD COLUMN "communication_message_id" uuid;