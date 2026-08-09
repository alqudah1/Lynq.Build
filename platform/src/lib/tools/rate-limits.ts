import "server-only";
import type { RateLimiter, RateLimitConfig } from "@/lib/rate-limit/types";
import { recordAuditEvent } from "@/lib/audit";
import type { ToolErrorClass } from "./errors";
import { DomainRuleViolationError } from "@/lib/authz/errors";

/** Reasonable default for read-heavy internal tools (`brain.search`/`brain.get_context`) — generous enough that a normal multi-step execution never trips it, bounded enough to stop a runaway loop. Internal-write tools (`artifact.create_report`) get a narrower budget, the same "write actions cost more budget than reads" judgment Brain Module 16 already applied. */
export const TOOL_READ_RATE_LIMIT: RateLimitConfig = { limit: 120, windowSeconds: 60 };
export const TOOL_WRITE_RATE_LIMIT: RateLimitConfig = { limit: 30, windowSeconds: 60 };

/** Keyed by (organization, agent, tool, endpoint class) — never a raw credential, matching Brain Module 16's exact precedent. */
export function toolInvocationRateLimitKey(organizationId: string, agentId: string, toolKey: string): string {
  return `tool-invocation:agent:${agentId}:org:${organizationId}:tool:${toolKey}`;
}

class ToolRateLimitedError extends DomainRuleViolationError {
  readonly reason = "tool_rate_limited";
  readonly toolErrorClass: ToolErrorClass = "transient_failure";
  constructor() {
    super("Too many tool invocations. Please try again later.");
    this.name = "ToolRateLimitedError";
  }
}

export { ToolRateLimitedError };

export async function enforceToolRateLimit(
  db: Parameters<typeof recordAuditEvent>[0],
  limiter: RateLimiter,
  input: { organizationId: string; agentId: string; toolKey: string; config: RateLimitConfig }
): Promise<void> {
  const key = toolInvocationRateLimitKey(input.organizationId, input.agentId, input.toolKey);
  let result;
  try {
    result = await limiter.recordAttempt(key, input.config);
  } catch {
    result = { allowed: false, remaining: 0, resetAt: new Date() };
  }
  if (!result.allowed) {
    await recordAuditEvent(db, {
      eventType: "tool_invocation_rate_limited",
      organizationId: input.organizationId,
      actorAgentId: input.agentId,
      targetType: "tool_definition",
      metadata: { toolKey: input.toolKey },
    });
    throw new ToolRateLimitedError();
  }
}
