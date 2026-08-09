import "server-only";
import { createHash } from "node:crypto";
import { recordAuditEvent } from "@/lib/audit";
import type { RateLimiter, RateLimitConfig } from "@/lib/rate-limit/types";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import type { CommunicationChannel } from "./validation";

/**
 * Multi-layer send limits — reasonable, conservative starting defaults
 * (the same "a starting point, not a proven figure" honesty Module 9's own
 * `RUNTIME_CONFIG` already applies to itself). Reuses the existing
 * Postgres-backed `RateLimiter`/`rate_limit_counters` infrastructure Module
 * 2/8 already built — never a second rate-limit table.
 */
export const ORG_SEND_RATE_LIMIT: RateLimitConfig = { limit: 500, windowSeconds: 3600 };
export const CONNECTION_SEND_RATE_LIMIT: RateLimitConfig = { limit: 300, windowSeconds: 3600 };
export const CHANNEL_SEND_RATE_LIMIT: RateLimitConfig = { limit: 300, windowSeconds: 3600 };
export const RECIPIENT_SEND_RATE_LIMIT: RateLimitConfig = { limit: 5, windowSeconds: 3600 };
export const AGENT_SEND_RATE_LIMIT: RateLimitConfig = { limit: 50, windowSeconds: 3600 };
export const WORKFLOW_SEND_RATE_LIMIT: RateLimitConfig = { limit: 100, windowSeconds: 3600 };

class CommunicationRateLimitedError extends DomainRuleViolationError {
  readonly reason = "communication_rate_limited";
  constructor(layer: string) {
    super(`Too many outbound sends (${layer} limit reached). Please try again later.`);
    this.name = "CommunicationRateLimitedError";
  }
}
export { CommunicationRateLimitedError };

/** Recipients are hashed before ever becoming part of a rate-limit key — never raw PII in a key that could end up in logs/metrics. */
function hashRecipient(recipientReference: string): string {
  return createHash("sha256").update(recipientReference.trim().toLowerCase()).digest("hex").slice(0, 24);
}

export interface SendRateLimitScope {
  organizationId: string;
  connectionId: string | null;
  channel: CommunicationChannel;
  recipientReference: string;
  agentId: string | null;
  workflowExecutionId: string | null;
}

/**
 * Enforces every applicable layer in sequence, atomically recording an
 * attempt against each — the first layer that's already at capacity stops
 * the send and records a bounded audit event (channel/reason only, never
 * the raw recipient). Guards accidental send loops, duplicate sends, bursts,
 * and retry storms without needing per-caller bespoke logic.
 */
export async function enforceSendRateLimits(db: Parameters<typeof recordAuditEvent>[0], limiter: RateLimiter, scope: SendRateLimitScope): Promise<void> {
  const recipientHash = hashRecipient(scope.recipientReference);

  const checks: Array<{ layer: string; key: string; config: RateLimitConfig }> = [
    { layer: "organization", key: `comms-send:org:${scope.organizationId}`, config: ORG_SEND_RATE_LIMIT },
    { layer: "channel", key: `comms-send:org:${scope.organizationId}:channel:${scope.channel}`, config: CHANNEL_SEND_RATE_LIMIT },
    { layer: "recipient", key: `comms-send:org:${scope.organizationId}:recipient:${recipientHash}`, config: RECIPIENT_SEND_RATE_LIMIT },
  ];
  if (scope.connectionId) checks.push({ layer: "connection", key: `comms-send:org:${scope.organizationId}:connection:${scope.connectionId}`, config: CONNECTION_SEND_RATE_LIMIT });
  if (scope.agentId) checks.push({ layer: "agent", key: `comms-send:org:${scope.organizationId}:agent:${scope.agentId}`, config: AGENT_SEND_RATE_LIMIT });
  if (scope.workflowExecutionId) checks.push({ layer: "workflow", key: `comms-send:org:${scope.organizationId}:workflow:${scope.workflowExecutionId}`, config: WORKFLOW_SEND_RATE_LIMIT });

  for (const check of checks) {
    let result;
    try {
      result = await limiter.recordAttempt(check.key, check.config);
    } catch {
      result = { allowed: false, remaining: 0, resetAt: new Date() };
    }
    if (!result.allowed) {
      await recordAuditEvent(db, { eventType: "communication_send_permission_denied", organizationId: scope.organizationId, targetType: "communication_message", metadata: { reason: "rate_limited", layer: check.layer, channel: scope.channel } });
      throw new CommunicationRateLimitedError(check.layer);
    }
  }
}
