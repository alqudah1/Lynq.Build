import { z } from "zod";

export const CRM_LIFECYCLE_STAGES = ["subscriber", "lead", "qualified_lead", "opportunity", "customer", "former_customer", "partner", "other"] as const;
export const crmLifecycleStageSchema = z.enum(CRM_LIFECYCLE_STAGES);
export type CrmLifecycleStage = (typeof CRM_LIFECYCLE_STAGES)[number];

export const CRM_RECORD_STATUSES = ["active", "archived"] as const;
export const crmRecordStatusSchema = z.enum(CRM_RECORD_STATUSES);
export type CrmRecordStatus = (typeof CRM_RECORD_STATUSES)[number];

export const CRM_RELATIONSHIP_TYPES = ["employee", "owner", "decision_maker", "billing_contact", "technical_contact", "advisor", "partner_contact", "former_employee", "other"] as const;
export const crmRelationshipTypeSchema = z.enum(CRM_RELATIONSHIP_TYPES);
export type CrmRelationshipType = (typeof CRM_RELATIONSHIP_TYPES)[number];

export const CRM_RELATIONSHIP_STATUSES = ["active", "ended"] as const;
export const crmRelationshipStatusSchema = z.enum(CRM_RELATIONSHIP_STATUSES);
export type CrmRelationshipStatus = (typeof CRM_RELATIONSHIP_STATUSES)[number];

export const CRM_LEAD_STATUSES = ["new", "contacted", "engaged", "qualified", "disqualified", "converted"] as const;
export const crmLeadStatusSchema = z.enum(CRM_LEAD_STATUSES);
export type CrmLeadStatus = (typeof CRM_LEAD_STATUSES)[number];

export const CRM_PIPELINE_STATUSES = ["active", "archived"] as const;
export const crmPipelineStatusSchema = z.enum(CRM_PIPELINE_STATUSES);
export type CrmPipelineStatus = (typeof CRM_PIPELINE_STATUSES)[number];

export const CRM_OPPORTUNITY_STATUSES = ["open", "won", "lost"] as const;
export const crmOpportunityStatusSchema = z.enum(CRM_OPPORTUNITY_STATUSES);
export type CrmOpportunityStatus = (typeof CRM_OPPORTUNITY_STATUSES)[number];

export const CRM_ACTIVITY_TYPES = ["call", "email", "meeting", "message", "note", "form_submission", "website_event", "other"] as const;
export const crmActivityTypeSchema = z.enum(CRM_ACTIVITY_TYPES);
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];

export const CRM_ACTIVITY_DIRECTIONS = ["inbound", "outbound", "internal"] as const;
export const crmActivityDirectionSchema = z.enum(CRM_ACTIVITY_DIRECTIONS);
export type CrmActivityDirection = (typeof CRM_ACTIVITY_DIRECTIONS)[number];

export const CRM_FOLLOW_UP_STATUSES = ["open", "completed", "cancelled"] as const;
export const crmFollowUpStatusSchema = z.enum(CRM_FOLLOW_UP_STATUSES);
export type CrmFollowUpStatus = (typeof CRM_FOLLOW_UP_STATUSES)[number];

export const CRM_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const crmPrioritySchema = z.enum(CRM_PRIORITIES);
export type CrmPriority = (typeof CRM_PRIORITIES)[number];

export const CRM_CUSTOM_FIELD_ENTITY_TYPES = ["contact", "company", "lead", "opportunity"] as const;
export const crmCustomFieldEntityTypeSchema = z.enum(CRM_CUSTOM_FIELD_ENTITY_TYPES);
export type CrmCustomFieldEntityType = (typeof CRM_CUSTOM_FIELD_ENTITY_TYPES)[number];

export const CRM_CUSTOM_FIELD_TYPES = ["short_text", "long_text", "number", "boolean", "date", "datetime", "single_select", "multi_select"] as const;
export const crmCustomFieldTypeSchema = z.enum(CRM_CUSTOM_FIELD_TYPES);
export type CrmCustomFieldType = (typeof CRM_CUSTOM_FIELD_TYPES)[number];

export const CRM_SOURCE_TYPES = ["manual", "website", "referral", "event", "paid_search", "organic_search", "social", "partner", "import", "api", "other"] as const;
export const crmSourceTypeSchema = z.enum(CRM_SOURCE_TYPES);
export type CrmSourceType = (typeof CRM_SOURCE_TYPES)[number];

export const CRM_TAG_ENTITY_TYPES = ["contact", "company", "lead", "opportunity"] as const;
export const crmTagEntityTypeSchema = z.enum(CRM_TAG_ENTITY_TYPES);
export type CrmTagEntityType = (typeof CRM_TAG_ENTITY_TYPES)[number];

export const CRM_PROJECT_LINK_ENTITY_TYPES = ["contact", "company", "opportunity"] as const;
export const crmProjectLinkEntityTypeSchema = z.enum(CRM_PROJECT_LINK_ENTITY_TYPES);
export type CrmProjectLinkEntityType = (typeof CRM_PROJECT_LINK_ENTITY_TYPES)[number];

export const CRM_AGENT_PERMISSIONS = ["crm_contact_read", "crm_company_read", "crm_lead_read", "crm_opportunity_read", "crm_activity_read", "crm_note_read"] as const;
export const crmAgentPermissionSchema = z.enum(CRM_AGENT_PERMISSIONS);
export type CrmAgentPermission = (typeof CRM_AGENT_PERMISSIONS)[number];

export const crmKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[A-Z][A-Z0-9_]*$/, "must be uppercase letters/digits/underscores, starting with a letter (e.g. DEFAULT_SALES)");
export const crmNameSchema = z.string().trim().min(1).max(200);
export const crmDisplayNameSchema = z.string().trim().min(1).max(200);
export const crmDescriptionSchema = z.string().trim().max(5000).optional();
export const crmEmailSchema = z.string().trim().email().max(320);
export const crmPhoneSchema = z.string().trim().min(3).max(40);
export const crmBoundedTextSchema = z.string().trim().max(5000);
export const crmSubjectSchema = z.string().trim().max(500);
export const crmIdempotencyKeySchema = z.string().trim().min(1).max(200);
export const crmScoreSchema = z.number().int().min(0).max(100);
export const crmProbabilitySchema = z.number().int().min(0).max(100);
export const crmAmountSchema = z.number().min(0).max(1_000_000_000_000);
export const crmCurrencySchema = z.string().trim().length(3).toUpperCase();

/** Bounded, non-executable custom-field validation metadata — never code, SQL, or a formula. */
export const crmCustomFieldValidationRulesSchema = z
  .object({
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).max(20_000).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().max(200).optional(),
  })
  .strict()
  .optional();

export const crmCustomFieldOptionsSchema = z.array(z.string().trim().min(1).max(200)).max(100).optional();
