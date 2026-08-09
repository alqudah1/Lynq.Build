import { z } from "zod";

export const SALES_LEAD_ASSIGNMENT_STRATEGIES = ["manual", "round_robin", "least_open_leads"] as const;
export const salesLeadAssignmentStrategySchema = z.enum(SALES_LEAD_ASSIGNMENT_STRATEGIES);
export type SalesLeadAssignmentStrategy = (typeof SALES_LEAD_ASSIGNMENT_STRATEGIES)[number];

export const SALES_FORECASTING_MODES = ["stage_probability"] as const;
export const salesForecastingModeSchema = z.enum(SALES_FORECASTING_MODES);
export type SalesForecastingMode = (typeof SALES_FORECASTING_MODES)[number];

export const SALES_TEAM_MEMBER_ROLES = ["manager", "rep", "viewer"] as const;
export const salesTeamMemberRoleSchema = z.enum(SALES_TEAM_MEMBER_ROLES);
export type SalesTeamMemberRole = (typeof SALES_TEAM_MEMBER_ROLES)[number];

/** The Sales OS capability role — independent from CRM/Brain/Workflow/Projects roles. */
export const SALES_ROLES = ["sales_admin", "sales_manager", "sales_rep", "viewer"] as const;
export const salesRoleSchema = z.enum(SALES_ROLES);
export type SalesRole = (typeof SALES_ROLES)[number];

/** Granular capabilities — never checked as a raw role-label string; always derived via `ROLE_CAPABILITIES` in authz.ts. */
export const SALES_CAPABILITIES = [
  "sales_view",
  "sales_work_leads",
  "sales_manage_own_opportunities",
  "sales_manage_team_opportunities",
  "sales_assign_leads",
  "sales_manage_playbooks",
  "sales_manage_forecasts",
  "sales_manage_targets",
  "sales_admin",
] as const;
export const salesCapabilitySchema = z.enum(SALES_CAPABILITIES);
export type SalesCapability = (typeof SALES_CAPABILITIES)[number];

export const SALES_PLAYBOOK_TYPES = ["lead_qualification", "opportunity", "follow_up"] as const;
export const salesPlaybookTypeSchema = z.enum(SALES_PLAYBOOK_TYPES);
export type SalesPlaybookType = (typeof SALES_PLAYBOOK_TYPES)[number];

export const SALES_PLAYBOOK_LIFECYCLES = ["draft", "published", "archived"] as const;
export const salesPlaybookLifecycleSchema = z.enum(SALES_PLAYBOOK_LIFECYCLES);
export type SalesPlaybookLifecycle = (typeof SALES_PLAYBOOK_LIFECYCLES)[number];

export const SALES_PLAYBOOK_VERSION_STATUSES = ["draft", "published", "superseded"] as const;
export const salesPlaybookVersionStatusSchema = z.enum(SALES_PLAYBOOK_VERSION_STATUSES);
export type SalesPlaybookVersionStatus = (typeof SALES_PLAYBOOK_VERSION_STATUSES)[number];

export const SALES_PLAYBOOK_STEP_TYPES = [
  "checklist",
  "collect_information",
  "crm_activity_required",
  "follow_up_required",
  "workflow",
  "approval",
  "artifact_required",
  "stage_recommendation",
  "manual_decision",
] as const;
export const salesPlaybookStepTypeSchema = z.enum(SALES_PLAYBOOK_STEP_TYPES);
export type SalesPlaybookStepType = (typeof SALES_PLAYBOOK_STEP_TYPES)[number];

export const SALES_QUALIFICATION_RUN_STATUSES = ["not_started", "in_progress", "waiting", "qualified", "disqualified", "abandoned"] as const;
export const salesQualificationRunStatusSchema = z.enum(SALES_QUALIFICATION_RUN_STATUSES);
export type SalesQualificationRunStatus = (typeof SALES_QUALIFICATION_RUN_STATUSES)[number];

export const SALES_CHECKLIST_ITEM_STATUSES = ["pending", "complete", "skipped"] as const;
export const salesChecklistItemStatusSchema = z.enum(SALES_CHECKLIST_ITEM_STATUSES);
export type SalesChecklistItemStatus = (typeof SALES_CHECKLIST_ITEM_STATUSES)[number];

export const SALES_OPPORTUNITY_PLAYBOOK_RUN_STATUSES = ["active", "completed", "abandoned"] as const;
export const salesOpportunityPlaybookRunStatusSchema = z.enum(SALES_OPPORTUNITY_PLAYBOOK_RUN_STATUSES);
export type SalesOpportunityPlaybookRunStatus = (typeof SALES_OPPORTUNITY_PLAYBOOK_RUN_STATUSES)[number];

export const SALES_SEQUENCE_TARGET_TYPES = ["lead", "opportunity"] as const;
export const salesSequenceTargetTypeSchema = z.enum(SALES_SEQUENCE_TARGET_TYPES);
export type SalesSequenceTargetType = (typeof SALES_SEQUENCE_TARGET_TYPES)[number];

export const SALES_SEQUENCE_LIFECYCLES = ["draft", "published", "archived"] as const;
export const salesSequenceLifecycleSchema = z.enum(SALES_SEQUENCE_LIFECYCLES);
export type SalesSequenceLifecycle = (typeof SALES_SEQUENCE_LIFECYCLES)[number];

export const SALES_SEQUENCE_VERSION_STATUSES = ["draft", "published", "superseded"] as const;
export const salesSequenceVersionStatusSchema = z.enum(SALES_SEQUENCE_VERSION_STATUSES);
export type SalesSequenceVersionStatus = (typeof SALES_SEQUENCE_VERSION_STATUSES)[number];

export const SALES_SEQUENCE_STEP_ACTION_TYPES = ["crm_follow_up", "workflow_human_task", "approval_request", "internal_reminder"] as const;
export const salesSequenceStepActionTypeSchema = z.enum(SALES_SEQUENCE_STEP_ACTION_TYPES);
export type SalesSequenceStepActionType = (typeof SALES_SEQUENCE_STEP_ACTION_TYPES)[number];

export const SALES_ENROLLMENT_STATUSES = ["active", "completed", "stopped", "cancelled"] as const;
export const salesEnrollmentStatusSchema = z.enum(SALES_ENROLLMENT_STATUSES);
export type SalesEnrollmentStatus = (typeof SALES_ENROLLMENT_STATUSES)[number];

export const SALES_STEP_RUN_STATUSES = ["pending", "completed", "skipped"] as const;
export const salesStepRunStatusSchema = z.enum(SALES_STEP_RUN_STATUSES);
export type SalesStepRunStatus = (typeof SALES_STEP_RUN_STATUSES)[number];

export const SALES_APPROVAL_LINKED_ENTITY_TYPES = ["lead", "opportunity", "qualification_run", "opportunity_playbook_run"] as const;
export const salesApprovalLinkedEntityTypeSchema = z.enum(SALES_APPROVAL_LINKED_ENTITY_TYPES);
export type SalesApprovalLinkedEntityType = (typeof SALES_APPROVAL_LINKED_ENTITY_TYPES)[number];

export const SALES_TARGET_SCOPE_TYPES = ["individual", "team"] as const;
export const salesTargetScopeTypeSchema = z.enum(SALES_TARGET_SCOPE_TYPES);
export type SalesTargetScopeType = (typeof SALES_TARGET_SCOPE_TYPES)[number];

export const SALES_TARGET_METRIC_TYPES = ["won_revenue", "opportunities_won", "leads_qualified", "activities_completed"] as const;
export const salesTargetMetricTypeSchema = z.enum(SALES_TARGET_METRIC_TYPES);
export type SalesTargetMetricType = (typeof SALES_TARGET_METRIC_TYPES)[number];

export const SALES_FORECAST_CATEGORIES = ["pipeline", "best_case", "commit", "closed"] as const;
export const salesForecastCategorySchema = z.enum(SALES_FORECAST_CATEGORIES);
export type SalesForecastCategory = (typeof SALES_FORECAST_CATEGORIES)[number];

/** Deterministic opportunity health classification — never an opaque AI score. */
export const SALES_OPPORTUNITY_HEALTH_STATUSES = ["healthy", "attention", "at_risk"] as const;
export type SalesOpportunityHealthStatus = (typeof SALES_OPPORTUNITY_HEALTH_STATUSES)[number];

/** Next-best-action recommendation types — a closed set, never free text an LLM invents. */
export const SALES_NEXT_ACTION_TYPES = [
  "contact_lead",
  "complete_qualification_field",
  "schedule_follow_up",
  "review_proposal",
  "move_opportunity",
  "resolve_pending_approval",
  "review_stale_opportunity",
] as const;
export type SalesNextActionType = (typeof SALES_NEXT_ACTION_TYPES)[number];

export const salesKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[A-Z][A-Z0-9_]*$/, "must be uppercase letters/digits/underscores, starting with a letter (e.g. STANDARD_QUALIFICATION)");
export const salesNameSchema = z.string().trim().min(1).max(200);
export const salesDescriptionSchema = z.string().trim().max(5000).optional();
export const salesBoundedTextSchema = z.string().trim().max(5000);
export const salesTitleSchema = z.string().trim().min(1).max(200);
export const salesReasonSchema = z.string().trim().max(1000);
