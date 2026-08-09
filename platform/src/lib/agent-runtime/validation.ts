import { z } from "zod";

export const AGENT_EXECUTION_STATUSES = [
  "queued",
  "assigned",
  "gathering_context",
  "planning",
  "reasoning",
  "waiting",
  "executing",
  "delegating",
  "human_approval",
  "verifying",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "archived",
] as const;

export const agentExecutionStatusSchema = z.enum(AGENT_EXECUTION_STATUSES);

export const goalSchema = z.string().trim().min(1).max(2000);
export const criteriaSchema = z.string().trim().min(1).max(2000);
export const changeReasonSchema = z.string().trim().min(1).max(500);

export const AGENT_PLAN_STEP_STATUSES = ["pending", "completed", "failed", "skipped"] as const;
export const agentPlanStepStatusSchema = z.enum(AGENT_PLAN_STEP_STATUSES);

export const AGENT_APPROVAL_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export const agentApprovalRiskLevelSchema = z.enum(AGENT_APPROVAL_RISK_LEVELS);

export const AGENT_APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "cancelled", "revision_requested"] as const;
export const agentApprovalStatusSchema = z.enum(AGENT_APPROVAL_STATUSES);

export const AGENT_ARTIFACT_TYPES = [
  "draft_text",
  "report",
  "proposal",
  "structured_data",
  "code_patch_reference",
  "file_reference",
  "action_proposal",
] as const;
export const agentArtifactTypeSchema = z.enum(AGENT_ARTIFACT_TYPES);

export const AGENT_ARTIFACT_STATUSES = ["draft", "review", "approved", "published", "archived"] as const;
export const agentArtifactStatusSchema = z.enum(AGENT_ARTIFACT_STATUSES);

/** §11's failure taxonomy — the minimum classification set the task requires. */
export const FAILURE_CLASSES = [
  "validation_failure",
  "permission_failure",
  "knowledge_missing",
  "contradiction_detected",
  "approval_rejected",
  "dependency_failure",
  "timeout",
  "provider_unavailable",
  "transient_tool_failure",
  "permanent_tool_failure",
  "runtime_error",
  "cancellation",
] as const;
export const failureClassSchema = z.enum(FAILURE_CLASSES);

export const summarySchema = z.string().trim().min(1).max(1000);
export const titleSchema = z.string().trim().min(1).max(300);
export const contentSchema = z.string().trim().max(20000);
export const listLimitSchema = z.coerce.number().int().min(1).max(100).default(20);
