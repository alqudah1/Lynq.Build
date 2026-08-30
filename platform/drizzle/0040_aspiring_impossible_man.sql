CREATE TABLE "marketing_creative_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"brand_profile_id" uuid NOT NULL,
	"title" text NOT NULL,
	"reference_type" text DEFAULT 'short_video' NOT NULL,
	"source_url" text NOT NULL,
	"transcript" text DEFAULT '' NOT NULL,
	"creative_notes" text NOT NULL,
	"adaptation_rules" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_creative_references_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "marketing_content_studio_drafts" ADD COLUMN "creative_reference_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_creative_references" ADD CONSTRAINT "marketing_creative_references_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_creative_references" ADD CONSTRAINT "marketing_creative_references_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_creative_references" ADD CONSTRAINT "marketing_creative_references_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_creative_references" ADD CONSTRAINT "marketing_creative_references_brand_org_fk" FOREIGN KEY ("brand_profile_id","organization_id") REFERENCES "public"."marketing_brand_profiles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_creative_references_org_brand_idx" ON "marketing_creative_references" USING btree ("organization_id","brand_profile_id");