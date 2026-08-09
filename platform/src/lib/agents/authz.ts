import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import {
  requireOrganizationMembership,
  type OrganizationMembershipRecord,
} from "@/lib/authz/helpers";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Who may register, edit, advance, retire, or issue/revoke credentials for
 * an agent — a meta-level "who manages the registry" question, the exact
 * same shape as `src/lib/brain/permissions.ts`'s "management authority"
 * question for Brain permission grants.
 *
 * AGENT_FRAMEWORK's own literal ownership language points to a department
 * lead (the AI Systems department, §10-11 of `LYNQ_COMPANY_OS.md`, "builds
 * and maintains the other departments' AI agents"). But exactly like
 * Brain Module 7 found, `LYNQ_COMPANY_OS.md`'s department list is a fixed
 * enum with no lead/owner table anywhere in this schema — department-lead
 * authority is not implementable today, not silently overridden. This
 * module adopts Module 7's own already-reasoned fallback identically:
 * an organization **owner or admin** manages the agent registry, org-wide
 * (no per-department admin subset concept exists to borrow, matching
 * `permissions.ts`'s own note that `requireOrganizationAdminOverride`'s
 * precedent is already org-wide). Revisit both together once a real
 * department-lead model exists.
 */
export async function requireAgentRegistryManagementAuthority(
  db: Db,
  input: { organizationId: string; actorUserId: string; targetId?: string | null }
): Promise<OrganizationMembershipRecord> {
  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  if (membership.role !== "owner" && membership.role !== "admin") {
    await recordAgentRegistryDenied(db, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetId: input.targetId,
      reason: `organization role "${membership.role}" is not owner or admin`,
    });
    throw new InsufficientRoleError("agent registry management requires organization owner or admin");
  }
  return membership;
}

/** Records the denial the same way `recordBrainPermissionDenied` does — every denial audited, no allowed-path noise. */
export async function recordAgentRegistryDenied(
  db: Db,
  input: { organizationId: string; actorUserId: string; targetId?: string | null; reason: string }
): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "agent_registry_denied",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "agent",
    targetId: input.targetId ?? null,
    metadata: { reason: input.reason },
  });
}
