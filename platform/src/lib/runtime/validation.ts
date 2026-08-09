import { z } from "zod";

export const RUNTIME_JOB_TYPES = [
  "execution_run",
  "execution_resume",
  "execution_retry",
  "tool_invocation_reconcile",
  "execution_reconcile",
  "cleanup_expired_sessions",
  "cleanup_rate_limit_counters",
  "workflow_start",
  "workflow_continue",
  "workflow_node_execute",
  "workflow_reconcile",
  "communication_send",
  "communication_reconcile",
] as const;
export const runtimeJobTypeSchema = z.enum(RUNTIME_JOB_TYPES);
export type RuntimeJobType = (typeof RUNTIME_JOB_TYPES)[number];

export const RUNTIME_JOB_STATUSES = ["queued", "leased", "running", "retry_scheduled", "completed", "failed", "cancelled", "dead_lettered"] as const;
export const runtimeJobStatusSchema = z.enum(RUNTIME_JOB_STATUSES);
export type RuntimeJobStatus = (typeof RUNTIME_JOB_STATUSES)[number];

/**
 * The queue's OWN failure taxonomy — deliberately distinct from Agent
 * Runtime Core's `FailureClass` (an execution's own reason for failing)
 * and Tool Runtime's `ToolErrorClass` (why one tool call failed). A job
 * wraps EITHER kind of work, so its retry-eligibility question is one
 * level up: "given whatever went wrong inside, is retrying this job
 * itself safe?" Only `transient` may schedule a retry.
 */
export const JOB_FAILURE_CLASSES = ["transient", "permission_revoked", "cancelled", "permanent", "unsafe_uncertain"] as const;
export const jobFailureClassSchema = z.enum(JOB_FAILURE_CLASSES);
export type JobFailureClass = (typeof JOB_FAILURE_CLASSES)[number];

export const RETRYABLE_JOB_FAILURE_CLASSES: ReadonlySet<JobFailureClass> = new Set(["transient"]);
