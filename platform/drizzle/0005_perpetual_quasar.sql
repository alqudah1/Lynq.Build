CREATE TABLE "knowledge_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_item_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"classification" text NOT NULL,
	"created_by_user_id" uuid,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_item_versions_id_item_unique" UNIQUE("id","knowledge_item_id"),
	CONSTRAINT "knowledge_item_versions_item_version_unique" UNIQUE("knowledge_item_id","version_number"),
	CONSTRAINT "knowledge_item_versions_classification_check" CHECK ("knowledge_item_versions"."classification" IN ('fact', 'instruction', 'policy', 'procedure', 'decision', 'observation', 'note', 'summary', 'template', 'prompt', 'reference'))
);
--> statement-breakpoint
ALTER TABLE "knowledge_items" DROP CONSTRAINT "knowledge_items_classification_check";--> statement-breakpoint
ALTER TABLE "knowledge_items" ALTER COLUMN "classification" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_items" ALTER COLUMN "title" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_items" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_items" ALTER COLUMN "revision" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "knowledge_items" ALTER COLUMN "revision" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "current_version_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_item_versions_item_idx" ON "knowledge_item_versions" USING btree ("knowledge_item_id","version_number");--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_current_version_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."knowledge_item_versions"("id","knowledge_item_id") ON DELETE no action ON UPDATE no action;