import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { authenticateAgentFromHeader, type AgentPrincipal } from "@/lib/agents/authentication";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Agent-driven runtime routes live under the same nested
 * `/api/organizations/{organizationId}/agent-executions/...` path human
 * routes use (never a parallel resource hierarchy just for the actor
 * type) but are authenticated by agent credential, never a human session.
 * The path's own `organizationId` must match the credential-resolved
 * agent's real organization — a mismatch is a 404, the identical
 * cross-tenant-invisible discipline every other route in this codebase
 * already applies, never a 403 that would confirm the execution's
 * existence to an agent outside its own tenant.
 */
export async function authenticateAgentForExecutionRoute(db: Db, request: Request, organizationId: string): Promise<AgentPrincipal> {
  const principal = await authenticateAgentFromHeader(db, request);
  if (principal.organizationId !== organizationId) {
    throw new TenantResourceNotFoundError();
  }
  return principal;
}
