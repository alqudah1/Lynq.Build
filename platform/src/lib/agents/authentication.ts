import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { UnauthenticatedError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { verifyAgentCredentialDetailed } from "./credentials";
import { resolveAgentById } from "./agents";
import type { AgentDepartment, AgentPermissionLevel } from "./types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Agent credential authentication — Brain Module 16
 * ============================================================================
 *
 * The one place an agent's identity is ever established from a raw HTTP
 * request. Every fact this module produces (`AgentPrincipal`) comes ONLY
 * from resolving a presented credential server-side — never from any
 * value the request itself claims to be true. A request body or header
 * naming an `agentId`, `organizationId`, `permissionLevel`, or
 * `department` directly is never consulted for identity; those fields
 * exist only as the OUTPUT of this module, resolved from the credential's
 * hash match, never as an input any caller can assert.
 */

export interface AgentPrincipal {
  principalType: "agent";
  agentId: string;
  organizationId: string;
  permissionLevel: AgentPermissionLevel;
  department: AgentDepartment;
}

const AGENT_AUTH_HEADER = "authorization";
const AGENT_AUTH_SCHEME = "Bearer ";

function extractPresentedSecret(request: Request): string | null {
  const header = request.headers.get(AGENT_AUTH_HEADER);
  if (!header || !header.startsWith(AGENT_AUTH_SCHEME)) return null;
  const secret = header.slice(AGENT_AUTH_SCHEME.length).trim();
  return secret.length > 0 ? secret : null;
}

/**
 * Resolves the calling agent from the request's `Authorization: Bearer
 * <secret>` header, or throws `UnauthenticatedError` (401) — the identical
 * error class and status the human session path already uses for "not
 * authenticated," so a route never needs two different unauthenticated
 * shapes. The underlying reason (no header, unknown secret, revoked
 * credential, or a retired/ineligible agent) is never distinguishable
 * from the HTTP response itself; it is captured ONLY in the audit trail
 * (`agent_brain_credential_invalid`/`agent_brain_credential_revoked`),
 * per this module's own "never leak which credentials are almost-valid"
 * discipline.
 *
 * Eligibility (§14/§17 of AGENT_FRAMEWORK): the only disqualifying state
 * this codebase can actually express today is `lifecycleStage ===
 * "retired"` — there is no separate "suspended" flag anywhere in the
 * Agent Registry schema. A retired agent's still-unrevoked credential is
 * treated identically to an invalid one (audited as
 * `agent_brain_credential_invalid`) — "not implementable today, not
 * silently skipped," the same honesty already applied to `Purged` in
 * Brain Module 8/9.
 */
export async function authenticateAgentFromHeader(db: Db, request: Request): Promise<AgentPrincipal> {
  const presentedSecret = extractPresentedSecret(request);
  if (!presentedSecret) {
    throw new UnauthenticatedError();
  }

  const result = await verifyAgentCredentialDetailed(db, presentedSecret);

  if (result.status === "invalid") {
    await recordAuditEvent(db, { eventType: "agent_brain_credential_invalid", metadata: { reason: "no_matching_credential" } });
    throw new UnauthenticatedError();
  }

  if (result.status === "revoked") {
    const agent = await resolveAgentById(db, result.agentId);
    await recordAuditEvent(db, {
      eventType: "agent_brain_credential_revoked",
      organizationId: agent?.organizationId ?? null,
      actorAgentId: result.agentId,
      metadata: { reason: "credential_revoked", credentialId: result.credentialId },
    });
    throw new UnauthenticatedError();
  }

  const agent = await resolveAgentById(db, result.agentId);
  if (!agent || agent.lifecycleStage === "retired") {
    await recordAuditEvent(db, {
      eventType: "agent_brain_credential_invalid",
      organizationId: agent?.organizationId ?? null,
      actorAgentId: agent?.id ?? null,
      metadata: { reason: agent ? "agent_retired" : "agent_not_found", credentialId: result.credential.id },
    });
    throw new UnauthenticatedError();
  }

  return {
    principalType: "agent",
    agentId: agent.id,
    organizationId: agent.organizationId,
    permissionLevel: agent.permissionLevel,
    department: agent.department,
  };
}
