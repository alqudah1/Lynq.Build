CREATE TYPE "public"."relationship_type" AS ENUM('supports', 'contradicts', 'depends_on', 'supersedes', 'related_to', 'created_from', 'references', 'used_by', 'required_for');--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
CREATE TABLE "knowledge_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"target_item_id" uuid NOT NULL,
	"relationship_type" "relationship_type" NOT NULL,
	"creator_user_id" uuid,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "knowledge_relationships_no_self_link" CHECK ("knowledge_relationships"."source_item_id" <> "knowledge_relationships"."target_item_id")
);
--> statement-breakpoint
ALTER TABLE "knowledge_relationships" ADD CONSTRAINT "knowledge_relationships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_relationships" ADD CONSTRAINT "knowledge_relationships_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_relationships" ADD CONSTRAINT "knowledge_relationships_source_org_fk" FOREIGN KEY ("source_item_id","organization_id") REFERENCES "public"."knowledge_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_relationships" ADD CONSTRAINT "knowledge_relationships_target_org_fk" FOREIGN KEY ("target_item_id","organization_id") REFERENCES "public"."knowledge_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_relationships_active_edge_unique" ON "knowledge_relationships" USING btree ("source_item_id","target_item_id","relationship_type") WHERE "knowledge_relationships"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "knowledge_relationships_org_source_idx" ON "knowledge_relationships" USING btree ("organization_id","source_item_id");--> statement-breakpoint
CREATE INDEX "knowledge_relationships_org_target_idx" ON "knowledge_relationships" USING btree ("organization_id","target_item_id");