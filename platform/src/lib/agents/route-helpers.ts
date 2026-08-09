import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import { authenticateAgentFromHeader, type AgentPrincipal } from "./authentication";
import { agentBrainReadRateLimitKey, enforceAgentBrainRateLimit, AGENT_BRAIN_READ_RATE_LIMIT, AGENT_BRAIN_WRITE_RATE_LIMIT, type AgentBrainEndpointClass } from "./rate-limits";
import { recordAuditEvent } from "@/lib/audit";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * The one shared entry point every `/api/agent/brain/*` route calls
 * first: authenticate the credential, then rate-limit by (agent,
 * organization, endpoint class) — the exact order human routes use too
 * (`getAuthenticatedUser` before any rate-limited action). `endpointClass`
 * doubles as the rate-limit budget selector (`draft_create` gets the
 * narrower write budget; every read endpoint shares the read budget).
 */
export async function authenticateAgentForRoute(db: Db, request: Request, endpointClass: AgentBrainEndpointClass): Promise<AgentPrincipal> {
  const principal = await authenticateAgentFromHeader(db, request);

  const limiter = new PostgresRateLimiter(db);
  const key = agentBrainReadRateLimitKey(principal.agentId, principal.organizationId, endpointClass);
  const config = endpointClass === "draft_create" ? AGENT_BRAIN_WRITE_RATE_LIMIT : AGENT_BRAIN_READ_RATE_LIMIT;

  try {
    await enforceAgentBrainRateLimit(limiter, key, config);
  } catch (err) {
    await recordAuditEvent(db, {
      eventType: "agent_brain_rate_limited",
      actorAgentId: principal.agentId,
      organizationId: principal.organizationId,
      metadata: { endpointClass },
    });
    throw err;
  }

  return principal;
}
