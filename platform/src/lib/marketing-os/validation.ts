import { z } from "zod";

export const MARKETING_CAMPAIGN_STATUSES = ["draft", "planning", "ready", "active", "paused", "completed", "cancelled", "archived"] as const;
export const marketingCampaignStatusSchema = z.enum(MARKETING_CAMPAIGN_STATUSES);
export type MarketingCampaignStatus = (typeof MARKETING_CAMPAIGN_STATUSES)[number];

export const MARKETING_OBJECTIVE_TYPES = ["awareness", "lead_generation", "engagement", "event_promotion", "product_launch", "customer_nurture", "retention", "other"] as const;
export const marketingObjectiveTypeSchema = z.enum(MARKETING_OBJECTIVE_TYPES);
export type MarketingObjectiveType = (typeof MARKETING_OBJECTIVE_TYPES)[number];

/** Bounded, deterministic numeric targets only — never a predictive/fabricated forecast. Every field optional; at most 20 keys, each a non-negative finite number. */
export const marketingObjectiveTargetsSchema = z
  .object({
    targetLeads: z.number().int().min(0).optional(),
    targetQualifiedLeads: z.number().int().min(0).optional(),
    targetRegistrations: z.number().int().min(0).optional(),
    targetConversions: z.number().int().min(0).optional(),
    targetContentOutputs: z.number().int().min(0).optional(),
    targetEngagementEvents: z.number().int().min(0).optional(),
  })
  .strict();
export type MarketingObjectiveTargets = z.infer<typeof marketingObjectiveTargetsSchema>;

export const MARKETING_CONTENT_TYPES = ["social_post", "email_draft", "landing_page_copy", "ad_copy", "blog_outline", "blog_draft", "campaign_brief", "creative_brief", "script", "announcement", "other"] as const;
export const marketingContentTypeSchema = z.enum(MARKETING_CONTENT_TYPES);
export type MarketingContentType = (typeof MARKETING_CONTENT_TYPES)[number];

export const MARKETING_CONTENT_STATUSES = ["draft", "review", "approved", "scheduled", "published", "rejected", "archived"] as const;
export const marketingContentStatusSchema = z.enum(MARKETING_CONTENT_STATUSES);
export type MarketingContentStatus = (typeof MARKETING_CONTENT_STATUSES)[number];

export const MARKETING_AUDIENCE_ENTITY_TYPES = ["contact", "company", "lead", "opportunity"] as const;
export const marketingAudienceEntityTypeSchema = z.enum(MARKETING_AUDIENCE_ENTITY_TYPES);
export type MarketingAudienceEntityType = (typeof MARKETING_AUDIENCE_ENTITY_TYPES)[number];

export const MARKETING_AUDIENCE_EVALUATION_MODES = ["dynamic", "static"] as const;
export const marketingAudienceEvaluationModeSchema = z.enum(MARKETING_AUDIENCE_EVALUATION_MODES);
export type MarketingAudienceEvaluationMode = (typeof MARKETING_AUDIENCE_EVALUATION_MODES)[number];

/** The safe, closed filter-operator vocabulary — never arbitrary SQL/expressions. See `audience-filters.ts` for the per-entity-type field registry these compile against. */
export const MARKETING_AUDIENCE_FILTER_OPERATORS = ["equals", "not_equals", "in", "exists", "not_exists"] as const;
export const marketingAudienceFilterOperatorSchema = z.enum(MARKETING_AUDIENCE_FILTER_OPERATORS);
export type MarketingAudienceFilterOperator = (typeof MARKETING_AUDIENCE_FILTER_OPERATORS)[number];

export const marketingAudienceFilterConditionSchema = z
  .object({
    field: z.string().trim().min(1).max(60),
    operator: marketingAudienceFilterOperatorSchema,
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()).max(50), z.null()]).optional(),
  })
  .strict();
export type MarketingAudienceFilterCondition = z.infer<typeof marketingAudienceFilterConditionSchema>;

/** At most 10 AND-ed conditions per audience — bounded, reviewable, never a vehicle for an arbitrary query. */
export const marketingAudienceFilterDefinitionSchema = z.array(marketingAudienceFilterConditionSchema).max(10);

export const MARKETING_TEAM_MEMBER_ROLES = ["manager", "contributor", "viewer"] as const;
export const marketingTeamMemberRoleSchema = z.enum(MARKETING_TEAM_MEMBER_ROLES);
export type MarketingTeamMemberRole = (typeof MARKETING_TEAM_MEMBER_ROLES)[number];

/** The Marketing OS capability role — independent from CRM/Sales/Brain/Workflow/Projects roles. */
export const MARKETING_ROLES = ["marketing_admin", "marketing_manager", "marketing_contributor", "viewer"] as const;
export const marketingRoleSchema = z.enum(MARKETING_ROLES);
export type MarketingRole = (typeof MARKETING_ROLES)[number];

/** Granular capabilities — never checked as a raw role-label string; always derived via `ROLE_CAPABILITIES` in authz.ts. */
export const MARKETING_CAPABILITIES = [
  "marketing_view",
  "marketing_create_campaigns",
  "marketing_manage_campaigns",
  "marketing_manage_content",
  "marketing_manage_audiences",
  "marketing_manage_budget",
  "marketing_approve_content",
  "marketing_manage_playbooks",
  "marketing_admin",
] as const;
export const marketingCapabilitySchema = z.enum(MARKETING_CAPABILITIES);
export type MarketingCapability = (typeof MARKETING_CAPABILITIES)[number];

export const MARKETING_PLAYBOOK_TYPES = ["campaign", "content_creation", "campaign_review", "launch", "nurture"] as const;
export const marketingPlaybookTypeSchema = z.enum(MARKETING_PLAYBOOK_TYPES);
export type MarketingPlaybookType = (typeof MARKETING_PLAYBOOK_TYPES)[number];

export const MARKETING_PLAYBOOK_LIFECYCLES = ["draft", "published", "archived"] as const;
export const marketingPlaybookLifecycleSchema = z.enum(MARKETING_PLAYBOOK_LIFECYCLES);
export type MarketingPlaybookLifecycle = (typeof MARKETING_PLAYBOOK_LIFECYCLES)[number];

export const MARKETING_PLAYBOOK_VERSION_STATUSES = ["draft", "published", "superseded"] as const;
export const marketingPlaybookVersionStatusSchema = z.enum(MARKETING_PLAYBOOK_VERSION_STATUSES);
export type MarketingPlaybookVersionStatus = (typeof MARKETING_PLAYBOOK_VERSION_STATUSES)[number];

export const MARKETING_PLAYBOOK_STEP_TYPES = ["checklist", "required_content", "required_audience", "required_approval", "required_artifact", "workflow"] as const;
export const marketingPlaybookStepTypeSchema = z.enum(MARKETING_PLAYBOOK_STEP_TYPES);
export type MarketingPlaybookStepType = (typeof MARKETING_PLAYBOOK_STEP_TYPES)[number];

export const MARKETING_RUN_STATUSES = ["not_started", "in_progress", "waiting", "completed", "abandoned"] as const;
export const marketingRunStatusSchema = z.enum(MARKETING_RUN_STATUSES);
export type MarketingRunStatus = (typeof MARKETING_RUN_STATUSES)[number];

export const MARKETING_RUN_ITEM_STATUSES = ["pending", "complete", "skipped"] as const;
export const marketingRunItemStatusSchema = z.enum(MARKETING_RUN_ITEM_STATUSES);
export type MarketingRunItemStatus = (typeof MARKETING_RUN_ITEM_STATUSES)[number];

export const MARKETING_APPROVAL_LINKED_ENTITY_TYPES = ["content_item"] as const;
export const marketingApprovalLinkedEntityTypeSchema = z.enum(MARKETING_APPROVAL_LINKED_ENTITY_TYPES);
export type MarketingApprovalLinkedEntityType = (typeof MARKETING_APPROVAL_LINKED_ENTITY_TYPES)[number];

export const MARKETING_PROJECT_LINK_ENTITY_TYPES = ["campaign", "content_item"] as const;
export const marketingProjectLinkEntityTypeSchema = z.enum(MARKETING_PROJECT_LINK_ENTITY_TYPES);
export type MarketingProjectLinkEntityType = (typeof MARKETING_PROJECT_LINK_ENTITY_TYPES)[number];

export const MARKETING_ATTRIBUTION_TOUCH_TYPES = ["first_touch", "last_touch"] as const;
export const marketingAttributionTouchTypeSchema = z.enum(MARKETING_ATTRIBUTION_TOUCH_TYPES);
export type MarketingAttributionTouchType = (typeof MARKETING_ATTRIBUTION_TOUCH_TYPES)[number];

export const MARKETING_DESTINATION_TYPES = ["external_url", "internal_reference"] as const;
export const marketingDestinationTypeSchema = z.enum(MARKETING_DESTINATION_TYPES);
export type MarketingDestinationType = (typeof MARKETING_DESTINATION_TYPES)[number];

export const MARKETING_SPEND_SOURCES = ["manual", "synced"] as const;
export const marketingSpendSourceSchema = z.enum(MARKETING_SPEND_SOURCES);
export type MarketingSpendSource = (typeof MARKETING_SPEND_SOURCES)[number];

/** Deterministic campaign health classification — never an opaque AI score. */
export const MARKETING_CAMPAIGN_HEALTH_STATUSES = ["healthy", "attention", "at_risk"] as const;
export type MarketingCampaignHealthStatus = (typeof MARKETING_CAMPAIGN_HEALTH_STATUSES)[number];

/** Next-best-marketing-action recommendation types — a closed set, never free text an LLM invents. */
export const MARKETING_NEXT_ACTION_TYPES = [
  "define_audience",
  "create_content",
  "review_overdue_content",
  "resolve_pending_approval",
  "prepare_upcoming_launch",
  "review_completed_campaign",
  "configure_utm",
  "link_workflow",
  "configure_lead_source",
  "resolve_stalled_project_task",
  "complete_playbook_requirement",
] as const;
export type MarketingNextActionType = (typeof MARKETING_NEXT_ACTION_TYPES)[number];

export const marketingKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[A-Z][A-Z0-9_]*$/, "must be uppercase letters/digits/underscores, starting with a letter (e.g. SPRING_LAUNCH)");
export const marketingNameSchema = z.string().trim().min(1).max(200);
export const marketingDescriptionSchema = z.string().trim().max(5000).optional();
export const marketingTitleSchema = z.string().trim().min(1).max(200);
export const marketingReasonSchema = z.string().trim().max(1000);
