CREATE TYPE "public"."marketing_content_studio_status" AS ENUM('concepts', 'production', 'saved');--> statement-breakpoint
CREATE TABLE "marketing_brand_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"brand_key" text NOT NULL,
	"name" text NOT NULL,
	"positioning" text NOT NULL,
	"audience" text NOT NULL,
	"voice" text NOT NULL,
	"visual_rules" text NOT NULL,
	"product_context" text NOT NULL,
	"calls_to_action" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claims_guardrails" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_brand_profiles_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_content_studio_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"brand_profile_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"intended_channel" text NOT NULL,
	"planned_publish_at" timestamp with time zone,
	"concepts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_concept_id" text,
	"production_package" jsonb,
	"status" "marketing_content_studio_status" DEFAULT 'concepts' NOT NULL,
	"content_item_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD CONSTRAINT "marketing_brand_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_brand_profiles" ADD CONSTRAINT "marketing_brand_profiles_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_studio_drafts" ADD CONSTRAINT "marketing_content_studio_drafts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_studio_drafts" ADD CONSTRAINT "marketing_content_studio_drafts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_studio_drafts" ADD CONSTRAINT "marketing_content_studio_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_studio_drafts" ADD CONSTRAINT "marketing_content_studio_brand_org_fk" FOREIGN KEY ("brand_profile_id","organization_id") REFERENCES "public"."marketing_brand_profiles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_studio_drafts" ADD CONSTRAINT "marketing_content_studio_content_org_fk" FOREIGN KEY ("content_item_id","organization_id") REFERENCES "public"."marketing_content_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_brand_profiles_org_only_key_unique" ON "marketing_brand_profiles" USING btree ("organization_id","brand_key") WHERE "marketing_brand_profiles"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_brand_profiles_workspace_key_unique" ON "marketing_brand_profiles" USING btree ("organization_id","workspace_id","brand_key") WHERE "marketing_brand_profiles"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "marketing_content_studio_org_status_idx" ON "marketing_content_studio_drafts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "marketing_content_studio_owner_idx" ON "marketing_content_studio_drafts" USING btree ("owner_user_id");