CREATE TABLE "marketing_channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"brand_profile_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"account_kind" text DEFAULT 'organic' NOT NULL,
	"display_name" text NOT NULL,
	"handle" text,
	"external_url" text,
	"connection_status" text DEFAULT 'manual' NOT NULL,
	"owner_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_channel_accounts_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_content_performance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"spend_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"revenue_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD CONSTRAINT "marketing_channel_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD CONSTRAINT "marketing_channel_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD CONSTRAINT "marketing_channel_accounts_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_channel_accounts" ADD CONSTRAINT "marketing_channel_accounts_brand_org_fk" FOREIGN KEY ("brand_profile_id","organization_id") REFERENCES "public"."marketing_brand_profiles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_performance_snapshots" ADD CONSTRAINT "marketing_content_performance_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_performance_snapshots" ADD CONSTRAINT "marketing_content_performance_snapshots_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_performance_snapshots" ADD CONSTRAINT "marketing_performance_content_org_fk" FOREIGN KEY ("content_item_id","organization_id") REFERENCES "public"."marketing_content_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content_performance_snapshots" ADD CONSTRAINT "marketing_performance_account_org_fk" FOREIGN KEY ("channel_account_id","organization_id") REFERENCES "public"."marketing_channel_accounts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_channel_accounts_scope_unique" ON "marketing_channel_accounts" USING btree ("organization_id","brand_profile_id","platform","account_kind","display_name") WHERE "marketing_channel_accounts"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "marketing_channel_accounts_org_platform_idx" ON "marketing_channel_accounts" USING btree ("organization_id","platform");--> statement-breakpoint
CREATE INDEX "marketing_performance_org_captured_idx" ON "marketing_content_performance_snapshots" USING btree ("organization_id","captured_at");--> statement-breakpoint
CREATE INDEX "marketing_performance_content_idx" ON "marketing_content_performance_snapshots" USING btree ("content_item_id");