CREATE TABLE "knowledge_domain_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" "knowledge_domain" NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer NOT NULL,
	"owner_department" text,
	"is_retired" boolean DEFAULT false NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_domain_metadata_domain_unique" UNIQUE("domain"),
	CONSTRAINT "knowledge_domain_metadata_sort_order_unique" UNIQUE("sort_order")
);
