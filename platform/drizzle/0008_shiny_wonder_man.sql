CREATE TYPE "public"."evidence_class" AS ENUM('primary', 'supporting', 'weak', 'historical', 'conflicting');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('founder_decision', 'official_documentation', 'client_approved', 'internal_documentation', 'meeting_notes', 'ai_generated_draft', 'external_research', 'open_internet_search', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."trust_tier" AS ENUM('verified', 'approved', 'observed', 'hypothesis', 'unknown', 'deprecated');--> statement-breakpoint
CREATE TABLE "knowledge_item_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"knowledge_item_id" uuid NOT NULL,
	"knowledge_item_version_id" uuid NOT NULL,
	"evidence_class" "evidence_class" NOT NULL,
	"description" text NOT NULL,
	"external_reference" text,
	"evidence_trust_tier" "trust_tier" NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_item_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"knowledge_item_id" uuid NOT NULL,
	"knowledge_item_version_id" uuid NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_detail" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_item_sources_version_unique" UNIQUE("knowledge_item_version_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_item_trust" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"knowledge_item_id" uuid NOT NULL,
	"knowledge_item_version_id" uuid NOT NULL,
	"trust_tier" "trust_tier" NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"last_assessed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_item_trust_version_unique" UNIQUE("knowledge_item_version_id")
);
--> statement-breakpoint
ALTER TABLE "knowledge_item_evidence" ADD CONSTRAINT "knowledge_item_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_evidence" ADD CONSTRAINT "knowledge_item_evidence_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_evidence" ADD CONSTRAINT "knowledge_item_evidence_version_item_fk" FOREIGN KEY ("knowledge_item_version_id","knowledge_item_id") REFERENCES "public"."knowledge_item_versions"("id","knowledge_item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_evidence" ADD CONSTRAINT "knowledge_item_evidence_item_org_fk" FOREIGN KEY ("knowledge_item_id","organization_id") REFERENCES "public"."knowledge_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_sources" ADD CONSTRAINT "knowledge_item_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_sources" ADD CONSTRAINT "knowledge_item_sources_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_sources" ADD CONSTRAINT "knowledge_item_sources_version_item_fk" FOREIGN KEY ("knowledge_item_version_id","knowledge_item_id") REFERENCES "public"."knowledge_item_versions"("id","knowledge_item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_sources" ADD CONSTRAINT "knowledge_item_sources_item_org_fk" FOREIGN KEY ("knowledge_item_id","organization_id") REFERENCES "public"."knowledge_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_trust" ADD CONSTRAINT "knowledge_item_trust_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_trust" ADD CONSTRAINT "knowledge_item_trust_last_assessed_by_user_id_users_id_fk" FOREIGN KEY ("last_assessed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_trust" ADD CONSTRAINT "knowledge_item_trust_version_item_fk" FOREIGN KEY ("knowledge_item_version_id","knowledge_item_id") REFERENCES "public"."knowledge_item_versions"("id","knowledge_item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_trust" ADD CONSTRAINT "knowledge_item_trust_item_org_fk" FOREIGN KEY ("knowledge_item_id","organization_id") REFERENCES "public"."knowledge_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_item_evidence_version_created_idx" ON "knowledge_item_evidence" USING btree ("knowledge_item_version_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_item_sources_org_item_idx" ON "knowledge_item_sources" USING btree ("organization_id","knowledge_item_id");--> statement-breakpoint
CREATE INDEX "knowledge_item_trust_org_item_idx" ON "knowledge_item_trust" USING btree ("organization_id","knowledge_item_id");