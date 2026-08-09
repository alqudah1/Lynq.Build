import { z } from "zod";

/** LYNQ's fixed 13-department list (`marketing/LYNQ_COMPANY_OS.md` §9–11), matching the `agent_department` Postgres enum exactly. */
export const AGENT_DEPARTMENTS = [
  "founders_office",
  "product",
  "design",
  "engineering",
  "ai_systems",
  "client_success",
  "sales_and_bizdev",
  "marketing_and_brand",
  "support",
  "finance_and_operations",
  "legal_and_compliance",
  "security_and_trust",
  "research_and_strategy",
] as const;

export const agentDepartmentSchema = z.enum(AGENT_DEPARTMENTS);

/**
 * AGENT_FRAMEWORK §5's six agent-assignable permission levels — `founder`
 * is deliberately absent, matching `agentPermissionLevelEnum`'s own value
 * set (schema.ts), not merely rejected by a runtime check.
 */
export const AGENT_PERMISSION_LEVELS = ["observer", "assistant", "operator", "manager", "executive", "system"] as const;

export const agentPermissionLevelSchema = z.enum(AGENT_PERMISSION_LEVELS);

export const AGENT_LIFECYCLE_STAGES = [
  "idea",
  "specification",
  "development",
  "testing",
  "approval",
  "deployment",
  "monitoring",
  "improvement",
  "retired",
] as const;

export const agentLifecycleStageSchema = z.enum(AGENT_LIFECYCLE_STAGES);

export const AGENT_HEALTH_STATUSES = ["healthy", "degraded", "unhealthy", "unknown"] as const;

export const agentHealthStatusSchema = z.enum(AGENT_HEALTH_STATUSES);

/** §3: "specific enough to describe exactly one job, never a generic label" — enforced as a length bound here; the "not generic" judgment itself is a human review concern, not something a regex can catch. */
export const agentNameSchema = z.string().trim().min(1).max(120);

/** Every other Anatomy field (§3) is free-form prose — bounded at 2,000 characters, generous for a real paragraph, small enough to keep row size predictable (matches `knowledgeContentSchema`'s own "explicit, reasonable limit" discipline). */
export const agentAnatomyFieldSchema = z.string().trim().min(1).max(2000);

export const agentRetirementReasonSchema = z.string().trim().min(1).max(500);
