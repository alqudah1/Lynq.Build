import { z } from "zod";

export const PROJECT_STATUSES = ["proposed", "planning", "active", "paused", "blocked", "completed", "cancelled", "archived"] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const projectPrioritySchema = z.enum(PROJECT_PRIORITIES);
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

export const PROJECT_MEMBER_ROLES = ["project_owner", "project_manager", "contributor", "viewer"] as const;
export const projectMemberRoleSchema = z.enum(PROJECT_MEMBER_ROLES);
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export const PROJECT_PHASE_STATUSES = ["not_started", "active", "completed", "cancelled"] as const;
export const projectPhaseStatusSchema = z.enum(PROJECT_PHASE_STATUSES);
export type ProjectPhaseStatus = (typeof PROJECT_PHASE_STATUSES)[number];

export const PROJECT_MILESTONE_STATUSES = ["planned", "active", "at_risk", "completed", "cancelled"] as const;
export const projectMilestoneStatusSchema = z.enum(PROJECT_MILESTONE_STATUSES);
export type ProjectMilestoneStatus = (typeof PROJECT_MILESTONE_STATUSES)[number];

export const PROJECT_TASK_STATUSES = ["backlog", "ready", "in_progress", "blocked", "review", "completed", "cancelled"] as const;
export const projectTaskStatusSchema = z.enum(PROJECT_TASK_STATUSES);
export type ProjectTaskStatus = (typeof PROJECT_TASK_STATUSES)[number];

/** Deliberately not a DB enum (schema.ts's own comment) — bounded here at the application layer instead, so a new value never needs a migration. */
export const PROJECT_TASK_TYPES = ["general", "agent_report"] as const;
export const projectTaskTypeSchema = z.enum(PROJECT_TASK_TYPES);

export const PROJECT_LINKED_ENTITY_TYPES = ["project", "phase", "milestone", "task"] as const;
export const projectLinkedEntityTypeSchema = z.enum(PROJECT_LINKED_ENTITY_TYPES);
export type ProjectLinkedEntityType = (typeof PROJECT_LINKED_ENTITY_TYPES)[number];

export const projectKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(12)
  .regex(/^[A-Z][A-Z0-9]*$/, "must be uppercase letters/digits, starting with a letter (e.g. KIDS, REBATE)");

export const projectNameSchema = z.string().trim().min(1).max(200);
export const projectDescriptionSchema = z.string().trim().max(5000).optional();
export const taskTitleSchema = z.string().trim().min(1).max(300);
