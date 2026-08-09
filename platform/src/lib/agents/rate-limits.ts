import "server-only";
import type { RateLimiter, RateLimitConfig } from "@/lib/rate-limit/types";
import { AgentBrainRateLimitedError } from "./errors";

/**
 * Brain Module 16 — provider-agnostic rate limiting for agent reads,
 * reusing the existing `RateLimiter` interface/`PostgresRateLimiter`
 * implementation (`src/lib/rate-limit/`) rather than a bespoke mechanism.
 * A starting point, not an empirically-tuned figure — generous relative to
 * `INVITATION_CREATE_RATE_LIMIT` etc. because this is a machine-to-machine
 * read API expected to have materially higher legitimate call volume than
 * a human clicking a UI, but still bounded so a misbehaving or looping
 * agent cannot exert unbounded load.
 */
export const AGENT_BRAIN_READ_RATE_LIMIT: RateLimitConfig = { limit: 300, windowSeconds: 60 };

/** Brain Module 17's one write path gets its own, narrower budget — a draft-creation loop is a more consequential failure mode than an over-eager read loop. */
export const AGENT_BRAIN_WRITE_RATE_LIMIT: RateLimitConfig = { limit: 60, windowSeconds: 60 };

export type AgentBrainEndpointClass = "list" | "get" | "versions" | "relationships" | "context" | "draft_create";

/**
 * Keyed by agent identity, organization, and endpoint class only — never
 * the raw credential (which is never available here anyway; only the
 * already-authenticated `agentId` is), matching the task's explicit "do
 * not place raw credentials in keys or logs" instruction. `agentId`/
 * `organizationId` are non-secret UUIDs, the identical "safe to use
 * directly, no HMAC derivation needed" judgment `invitationCreateRateLimitKey`
 * already applies to `organizationId`/`actorUserId`.
 */
export function agentBrainReadRateLimitKey(agentId: string, organizationId: string, endpointClass: AgentBrainEndpointClass): string {
  return `agent-brain:${endpointClass}:agent:${agentId}:org:${organizationId}`;
}

/**
 * Enforces a rate limit and fails CLOSED if the backend itself is
 * unreachable — the identical fail-closed default `enforceRateLimit`
 * (`src/lib/invitations/rate-limits.ts`) already establishes for this
 * codebase's other rate-limited paths. Throws `AgentBrainRateLimitedError`
 * (429) on either an exceeded limit or a backend failure; the caller
 * cannot tell the two apart, which is the correct fail-closed behavior.
 */
export async function enforceAgentBrainRateLimit(limiter: RateLimiter, key: string, config: RateLimitConfig): Promise<void> {
  let result;
  try {
    result = await limiter.recordAttempt(key, config);
  } catch {
    throw new AgentBrainRateLimitedError();
  }
  if (!result.allowed) {
    throw new AgentBrainRateLimitedError();
  }
}
