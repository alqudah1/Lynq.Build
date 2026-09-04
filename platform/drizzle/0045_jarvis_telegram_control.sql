CREATE TYPE "public"."jarvis_telegram_link_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "jarvis_telegram_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"external_event_id" text NOT NULL,
	"chat_id" text,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jarvis_telegram_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"telegram_username" text,
	"status" "jarvis_telegram_link_status" DEFAULT 'active' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jarvis_telegram_events" ADD CONSTRAINT "jarvis_telegram_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_telegram_links" ADD CONSTRAINT "jarvis_telegram_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_telegram_links" ADD CONSTRAINT "jarvis_telegram_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_telegram_links" ADD CONSTRAINT "jarvis_telegram_links_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jarvis_telegram_events_external_unique" ON "jarvis_telegram_events" USING btree ("external_event_id");--> statement-breakpoint
CREATE INDEX "jarvis_telegram_events_chat_idx" ON "jarvis_telegram_events" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jarvis_telegram_links_active_chat_unique" ON "jarvis_telegram_links" USING btree ("telegram_chat_id") WHERE "jarvis_telegram_links"."status" = 'active';--> statement-breakpoint
CREATE INDEX "jarvis_telegram_links_org_idx" ON "jarvis_telegram_links" USING btree ("organization_id","status");