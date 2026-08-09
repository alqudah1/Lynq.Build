import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import {
  requireOrganizationMembership,
  requireWorkspaceMembership,
  type OrganizationMembershipRecord,
} from "@/lib/authz/helpers";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { resolveAgentById } from "@/lib/agents/agents";
import { NotAssignedAgentError, LivePermissionRevalidationFailedError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Agent Runtime authorization — Module 7
 * ============================================================================
 *
 * Distinguishes exactly the roles the task names: initiating human, assigned
 * agent, parent agent (delegation — checked in `delegation.ts` against its
 * own grants), approver, administrator. No global administrator exists
 * anywhere in this file — every check is organization-scoped.
 *
 * "Smallest safe interim management authority" (create/pause/cancel/inspect),
 * reusing the identical owner/admin fallback Brain Module 7 and Agent
 * Registry already established for the same "no department-lead model
 * exists yet" gap — not a new judgment call, the same one applied a third
 * time.
 */

/** Baseline gate for creating/listing/inspecting executions — organization membership, plus workspace membership if workspace-scoped (identical gate 2–3 shape Brain's own `requireBrainCapability` uses). */
export async function requireExecutionVisibility(
  db: Db,
  input: { organizationId: string; workspaceId: string | null; actorUserId: string }
): Promise<OrganizationMembershipRecord> {
  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  if (input.workspaceId) {
    const workspaceMembership = await requireWorkspaceMembership(db, input.workspaceId, input.actorUserId);
    if (workspaceMembership.organizationId !== input.organizationId) {
      throw new TenantResourceNotFoundError();
    }
  }
  return membership;
}

/**
 * Management authority for pausing, cancelling, or retrying an execution:
 * organization owner/admin (org-wide, the established interim fallback), OR
 * the execution's own accountable `ownerUserId` acting on their own
 * execution — mirroring Brain's "edit_any OR (author AND edit_own)" shape,
 * applied to runtime management instead of content editing.
 */
export async function requireExecutionManageAuthority(
  db: Db,
  input: { organizationId: string; workspaceId: string | null; ownerUserId: string; actorUserId: string }
): Promise<void> {
  const membership = await requireExecutionVisibility(db, input);
  const isOwner = input.ownerUserId === input.actorUserId;
  const isOrgAdmin = membership.role === "owner" || membership.role === "admin";
  if (!isOwner && !isOrgAdmin) {
    throw new InsufficientRoleError("requires organization owner/admin, or being this execution's own accountable owner");
  }
}

/** Approver authority — identical to management authority today (any org owner/admin, or the execution's own owner may decide a pending approval). A dedicated "approver" role does not exist yet — see `MODULE_7_AGENT_RUNTIME_CORE.md`'s own deferred-items note. */
export const requireApproverAuthority = requireExecutionManageAuthority;

/** For agent-driven transitions (the runtime advancing its OWN assigned work, never a human action) — the caller must be the execution's actual `assignedAgentId`, nothing else. */
export function requireAssignedAgent(execution: { assignedAgentId: string | null }, agentId: string): void {
  if (execution.assignedAgentId !== agentId) {
    throw new NotAssignedAgentError();
  }
}

async function recordRuntimePermissionDenied(
  db: Db,
  input: { organizationId: string; executionId?: string | null; actorAgentId?: string | null; actorUserId?: string | null; detail: string }
): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "agent_runtime_permission_denied",
    organizationId: input.organizationId,
    actorAgentId: input.actorAgentId ?? null,
    actorUserId: input.actorUserId ?? null,
    targetType: "agent_execution",
    targetId: input.executionId ?? null,
    metadata: { detail: input.detail },
  });
}

/**
 * §3/§12's non-negotiable rule: "live, at-the-moment-of-action permission
 * checks always re-validate against current grants, never solely against
 * [the Execution Context] snapshot." This is the runtime-eligibility half
 * of that re-check (is the assigned agent still real and not retired) —
 * the Brain-capability half is already satisfied automatically, since
 * every Brain read/draft-write call inside this runtime goes through
 * `requireAgentBrainReadAccess`/`requireAgentBrainCreateAccess`
 * (Brain Module 16/17) fresh, every time, with no caching anywhere in
 * that path — there is no snapshot to accidentally trust there either.
 */
export async function revalidateAgentEligibility(db: Db, organizationId: string, agentId: string): Promise<void> {
  const agent = await resolveAgentById(db, agentId);
  if (!agent || agent.organizationId !== organizationId || agent.lifecycleStage === "retired") {
    await recordRuntimePermissionDenied(db, { organizationId, actorAgentId: agentId, detail: "agent_ineligible" });
    throw new LivePermissionRevalidationFailedError("assigned agent is no longer eligible (retired, or not found)");
  }
}

export { recordRuntimePermissionDenied };
