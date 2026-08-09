CREATE TYPE "public"."crm_activity_direction" AS ENUM('inbound', 'outbound', 'internal');--> statement-breakpoint
CREATE TYPE "public"."crm_activity_type" AS ENUM('call', 'email', 'meeting', 'message', 'note', 'form_submission', 'website_event', 'other');--> statement-breakpoint
CREATE TYPE "public"."crm_agent_permission" AS ENUM('crm_contact_read', 'crm_company_read', 'crm_lead_read', 'crm_opportunity_read', 'crm_activity_read', 'crm_note_read');--> statement-breakpoint
CREATE TYPE "public"."crm_contact_company_relationship_type" AS ENUM('employee', 'owner', 'decision_maker', 'billing_contact', 'technical_contact', 'advisor', 'partner_contact', 'former_employee', 'other');--> statement-breakpoint
CREATE TYPE "public"."crm_custom_field_entity_type" AS ENUM('contact', 'company', 'lead', 'opportunity');--> statement-breakpoint
CREATE TYPE "public"."crm_custom_field_type" AS ENUM('short_text', 'long_text', 'number', 'boolean', 'date', 'datetime', 'single_select', 'multi_select');--> statement-breakpoint
CREATE TYPE "public"."crm_follow_up_status" AS ENUM('open', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."crm_lead_status" AS ENUM('new', 'contacted', 'engaged', 'qualified', 'disqualified', 'converted');--> statement-breakpoint
CREATE TYPE "public"."crm_lifecycle_stage" AS ENUM('subscriber', 'lead', 'qualified_lead', 'opportunity', 'customer', 'former_customer', 'partner', 'other');--> statement-breakpoint
CREATE TYPE "public"."crm_opportunity_status" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."crm_pipeline_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."crm_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."crm_project_link_entity_type" AS ENUM('contact', 'company', 'opportunity');--> statement-breakpoint
CREATE TYPE "public"."crm_record_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."crm_relationship_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."crm_source_type" AS ENUM('manual', 'website', 'referral', 'event', 'paid_search', 'organic_search', 'social', 'partner', 'import', 'api', 'other');--> statement-breakpoint
CREATE TYPE "public"."crm_tag_entity_type" AS ENUM('contact', 'company', 'lead', 'opportunity');--> statement-breakpoint
CREATE TABLE "crm_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"lead_id" uuid,
	"opportunity_id" uuid,
	"activity_type" "crm_activity_type" NOT NULL,
	"direction" "crm_activity_direction",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject" text,
	"summary" text,
	"created_by_user_id" uuid,
	"agent_id" uuid,
	"external_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_activities_target_check" CHECK ("crm_activities"."contact_id" IS NOT NULL OR "crm_activities"."company_id" IS NOT NULL OR "crm_activities"."lead_id" IS NOT NULL OR "crm_activities"."opportunity_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "crm_agent_permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"permission" "crm_agent_permission" NOT NULL,
	"granted_by_user_id" uuid,
	"revoked_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"legal_name" text,
	"domain" text,
	"normalized_domain" text,
	"website" text,
	"industry" text,
	"employee_range" text,
	"annual_revenue_range" text,
	"phone" text,
	"address" jsonb,
	"lifecycle_stage" "crm_lifecycle_stage" DEFAULT 'lead' NOT NULL,
	"status" "crm_record_status" DEFAULT 'active' NOT NULL,
	"owner_user_id" uuid,
	"source_id" uuid,
	"idempotency_key" text,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_companies_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "crm_contact_company_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"relationship_type" "crm_contact_company_relationship_type" NOT NULL,
	"status" "crm_relationship_status" DEFAULT 'active' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"first_name" text,
	"last_name" text,
	"display_name" text NOT NULL,
	"primary_email" text,
	"normalized_primary_email" text,
	"primary_phone" text,
	"normalized_primary_phone" text,
	"job_title" text,
	"department" text,
	"lifecycle_stage" "crm_lifecycle_stage" DEFAULT 'lead' NOT NULL,
	"status" "crm_record_status" DEFAULT 'active' NOT NULL,
	"owner_user_id" uuid,
	"source_id" uuid,
	"idempotency_key" text,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_contacts_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "crm_custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" "crm_custom_field_entity_type" NOT NULL,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" "crm_custom_field_type" NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"options" jsonb,
	"validation_rules" jsonb,
	"sequence" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_custom_field_definitions_org_key_unique" UNIQUE("organization_id","entity_type","field_key"),
	CONSTRAINT "crm_custom_field_definitions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "crm_custom_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"field_definition_id" uuid NOT NULL,
	"entity_type" "crm_custom_field_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_custom_field_values_unique" UNIQUE("field_definition_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "crm_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"lead_id" uuid,
	"opportunity_id" uuid,
	"assigned_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"status" "crm_follow_up_status" DEFAULT 'open' NOT NULL,
	"priority" "crm_priority" DEFAULT 'normal' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_follow_ups_target_check" CHECK ("crm_follow_ups"."contact_id" IS NOT NULL OR "crm_follow_ups"."company_id" IS NOT NULL OR "crm_follow_ups"."lead_id" IS NOT NULL OR "crm_follow_ups"."opportunity_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "crm_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"owner_user_id" uuid,
	"source_id" uuid,
	"status" "crm_lead_status" DEFAULT 'new' NOT NULL,
	"score" integer,
	"estimated_value_amount" numeric(14, 2),
	"estimated_value_currency" text,
	"qualification_notes" text,
	"next_action" text,
	"converted_opportunity_id" uuid,
	"idempotency_key" text,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"qualified_at" timestamp with time zone,
	"disqualified_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_leads_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "crm_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"lead_id" uuid,
	"opportunity_id" uuid,
	"author_user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_notes_target_check" CHECK ("crm_notes"."contact_id" IS NOT NULL OR "crm_notes"."company_id" IS NOT NULL OR "crm_notes"."lead_id" IS NOT NULL OR "crm_notes"."opportunity_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "crm_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"name" text NOT NULL,
	"primary_contact_id" uuid,
	"company_id" uuid,
	"owner_user_id" uuid,
	"amount" numeric(14, 2),
	"currency" text,
	"expected_close_date" timestamp with time zone,
	"probability_override" integer,
	"source_id" uuid,
	"status" "crm_opportunity_status" DEFAULT 'open' NOT NULL,
	"lost_reason" text,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"idempotency_key" text,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_opportunities_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "crm_opportunities_lost_reason_check" CHECK ("crm_opportunities"."status" <> 'lost' OR "crm_opportunities"."lost_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "crm_pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"stage_key" text NOT NULL,
	"sequence" integer NOT NULL,
	"stage_type" text,
	"probability" integer,
	"is_closed" boolean DEFAULT false NOT NULL,
	"is_won" boolean DEFAULT false NOT NULL,
	"is_lost" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_pipeline_stages_pipeline_key_unique" UNIQUE("pipeline_id","stage_key"),
	CONSTRAINT "crm_pipeline_stages_pipeline_sequence_unique" UNIQUE("pipeline_id","sequence"),
	CONSTRAINT "crm_pipeline_stages_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "crm_pipeline_stages_id_pipeline_unique" UNIQUE("id","pipeline_id"),
	CONSTRAINT "crm_pipeline_stages_won_lost_exclusive_check" CHECK (NOT ("crm_pipeline_stages"."is_won" AND "crm_pipeline_stages"."is_lost")),
	CONSTRAINT "crm_pipeline_stages_won_lost_implies_closed_check" CHECK ((NOT ("crm_pipeline_stages"."is_won" OR "crm_pipeline_stages"."is_lost")) OR "crm_pipeline_stages"."is_closed")
);
--> statement-breakpoint
CREATE TABLE "crm_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"pipeline_key" text NOT NULL,
	"description" text,
	"status" "crm_pipeline_status" DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_pipelines_org_key_unique" UNIQUE("organization_id","pipeline_key"),
	CONSTRAINT "crm_pipelines_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "crm_project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crm_entity_type" "crm_project_link_entity_type" NOT NULL,
	"crm_entity_id" uuid NOT NULL,
	"linked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_project_links_unique" UNIQUE("project_id","crm_entity_type","crm_entity_id")
);
--> statement-breakpoint
CREATE TABLE "crm_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"name" text NOT NULL,
	"source_type" "crm_source_type" NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_sources_org_key_unique" UNIQUE("organization_id","source_key"),
	CONSTRAINT "crm_sources_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "crm_tag_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"entity_type" "crm_tag_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_tag_assignments_unique" UNIQUE("tag_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "crm_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tag_key" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_tags_org_key_unique" UNIQUE("organization_id","tag_key"),
	CONSTRAINT "crm_tags_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_contact_org_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_company_org_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."crm_companies"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_lead_org_fk" FOREIGN KEY ("lead_id","organization_id") REFERENCES "public"."crm_leads"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_opportunity_org_fk" FOREIGN KEY ("opportunity_id","organization_id") REFERENCES "public"."crm_opportunities"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_agent_org_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_agent_permission_grants" ADD CONSTRAINT "crm_agent_permission_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_agent_permission_grants" ADD CONSTRAINT "crm_agent_permission_grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_agent_permission_grants" ADD CONSTRAINT "crm_agent_permission_grants_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_agent_permission_grants" ADD CONSTRAINT "crm_agent_permission_grants_agent_org_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_source_org_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."crm_sources"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contact_company_relationships" ADD CONSTRAINT "crm_contact_company_relationships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contact_company_relationships" ADD CONSTRAINT "crm_contact_company_relationships_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contact_company_relationships" ADD CONSTRAINT "crm_contact_company_rel_contact_org_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contact_company_relationships" ADD CONSTRAINT "crm_contact_company_rel_company_org_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."crm_companies"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_source_org_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."crm_sources"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_custom_field_definitions" ADD CONSTRAINT "crm_custom_field_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_definition_org_fk" FOREIGN KEY ("field_definition_id","organization_id") REFERENCES "public"."crm_custom_field_definitions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_follow_ups" ADD CONSTRAINT "crm_follow_ups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_follow_ups" ADD CONSTRAINT "crm_follow_ups_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_follow_ups" ADD CONSTRAINT "crm_follow_ups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_follow_ups" ADD CONSTRAINT "crm_follow_ups_contact_org_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_follow_ups" ADD CONSTRAINT "crm_follow_ups_company_org_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."crm_companies"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_follow_ups" ADD CONSTRAINT "crm_follow_ups_lead_org_fk" FOREIGN KEY ("lead_id","organization_id") REFERENCES "public"."crm_leads"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_follow_ups" ADD CONSTRAINT "crm_follow_ups_opportunity_org_fk" FOREIGN KEY ("opportunity_id","organization_id") REFERENCES "public"."crm_opportunities"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_contact_org_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_company_org_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."crm_companies"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_source_org_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."crm_sources"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_opportunity_org_fk" FOREIGN KEY ("converted_opportunity_id","organization_id") REFERENCES "public"."crm_opportunities"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_contact_org_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_company_org_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."crm_companies"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_lead_org_fk" FOREIGN KEY ("lead_id","organization_id") REFERENCES "public"."crm_leads"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_opportunity_org_fk" FOREIGN KEY ("opportunity_id","organization_id") REFERENCES "public"."crm_opportunities"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_pipeline_org_fk" FOREIGN KEY ("pipeline_id","organization_id") REFERENCES "public"."crm_pipelines"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_stage_pipeline_fk" FOREIGN KEY ("stage_id","pipeline_id") REFERENCES "public"."crm_pipeline_stages"("id","pipeline_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_contact_org_fk" FOREIGN KEY ("primary_contact_id","organization_id") REFERENCES "public"."crm_contacts"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_company_org_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."crm_companies"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_source_org_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."crm_sources"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_pipeline_org_fk" FOREIGN KEY ("pipeline_id","organization_id") REFERENCES "public"."crm_pipelines"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_workspace_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_project_links" ADD CONSTRAINT "crm_project_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_project_links" ADD CONSTRAINT "crm_project_links_linked_by_user_id_users_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_project_links" ADD CONSTRAINT "crm_project_links_project_org_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sources" ADD CONSTRAINT "crm_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tag_assignments" ADD CONSTRAINT "crm_tag_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tag_assignments" ADD CONSTRAINT "crm_tag_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tag_assignments" ADD CONSTRAINT "crm_tag_assignments_tag_org_fk" FOREIGN KEY ("tag_id","organization_id") REFERENCES "public"."crm_tags"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_activities_contact_idx" ON "crm_activities" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "crm_activities_company_idx" ON "crm_activities" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "crm_activities_lead_idx" ON "crm_activities" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "crm_activities_opportunity_idx" ON "crm_activities" USING btree ("opportunity_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_agent_permission_grants_active_unique" ON "crm_agent_permission_grants" USING btree ("organization_id","agent_id","permission") WHERE "crm_agent_permission_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "crm_agent_permission_grants_agent_idx" ON "crm_agent_permission_grants" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_companies_idempotency_unique" ON "crm_companies" USING btree ("organization_id","idempotency_key") WHERE "crm_companies"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_companies_org_domain_idx" ON "crm_companies" USING btree ("organization_id","normalized_domain");--> statement-breakpoint
CREATE INDEX "crm_companies_owner_idx" ON "crm_companies" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "crm_companies_org_status_idx" ON "crm_companies" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contact_company_rel_active_unique" ON "crm_contact_company_relationships" USING btree ("contact_id","company_id","relationship_type") WHERE "crm_contact_company_relationships"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contact_company_rel_primary_unique" ON "crm_contact_company_relationships" USING btree ("contact_id") WHERE "crm_contact_company_relationships"."is_primary" = true AND "crm_contact_company_relationships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "crm_contact_company_rel_company_idx" ON "crm_contact_company_relationships" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contacts_idempotency_unique" ON "crm_contacts" USING btree ("organization_id","idempotency_key") WHERE "crm_contacts"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_contacts_org_email_idx" ON "crm_contacts" USING btree ("organization_id","normalized_primary_email");--> statement-breakpoint
CREATE INDEX "crm_contacts_org_phone_idx" ON "crm_contacts" USING btree ("organization_id","normalized_primary_phone");--> statement-breakpoint
CREATE INDEX "crm_contacts_owner_idx" ON "crm_contacts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "crm_contacts_org_status_idx" ON "crm_contacts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "crm_custom_field_values_entity_idx" ON "crm_custom_field_values" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "crm_follow_ups_assignee_status_idx" ON "crm_follow_ups" USING btree ("assigned_user_id","status");--> statement-breakpoint
CREATE INDEX "crm_follow_ups_due_idx" ON "crm_follow_ups" USING btree ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_leads_idempotency_unique" ON "crm_leads" USING btree ("organization_id","idempotency_key") WHERE "crm_leads"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_leads_owner_status_idx" ON "crm_leads" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "crm_leads_contact_idx" ON "crm_leads" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "crm_leads_company_idx" ON "crm_leads" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "crm_notes_contact_idx" ON "crm_notes" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_notes_company_idx" ON "crm_notes" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_notes_lead_idx" ON "crm_notes" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_notes_opportunity_idx" ON "crm_notes" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_opportunities_idempotency_unique" ON "crm_opportunities" USING btree ("organization_id","idempotency_key") WHERE "crm_opportunities"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_opportunities_pipeline_stage_idx" ON "crm_opportunities" USING btree ("pipeline_id","stage_id");--> statement-breakpoint
CREATE INDEX "crm_opportunities_owner_idx" ON "crm_opportunities" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "crm_opportunities_org_status_idx" ON "crm_opportunities" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipelines_org_default_unique" ON "crm_pipelines" USING btree ("organization_id") WHERE "crm_pipelines"."is_default" = true;--> statement-breakpoint
CREATE INDEX "crm_project_links_entity_idx" ON "crm_project_links" USING btree ("crm_entity_type","crm_entity_id");--> statement-breakpoint
CREATE INDEX "crm_tag_assignments_entity_idx" ON "crm_tag_assignments" USING btree ("entity_type","entity_id");