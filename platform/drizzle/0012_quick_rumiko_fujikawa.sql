ALTER TYPE "public"."knowledge_item_status" ADD VALUE 'idea' BEFORE 'draft';--> statement-breakpoint
ALTER TYPE "public"."knowledge_item_status" ADD VALUE 'review' BEFORE 'archived';--> statement-breakpoint
ALTER TYPE "public"."knowledge_item_status" ADD VALUE 'approved' BEFORE 'archived';--> statement-breakpoint
ALTER TYPE "public"."knowledge_item_status" ADD VALUE 'published' BEFORE 'archived';--> statement-breakpoint
ALTER TYPE "public"."knowledge_item_status" ADD VALUE 'retired';--> statement-breakpoint
ALTER TYPE "public"."knowledge_item_status" ADD VALUE 'purged';--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "published_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "retired_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "retired_reason" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_retired_by_user_id_users_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;