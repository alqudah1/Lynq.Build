import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmAgentPermissionGrants } from "@/db/schema";
import { resolveAgentById } from "@/lib/agents/agents";
import { recordAuditEvent } from "@/lib/audit";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { resolveCrmAuthContext, requireCrmAdminAuthority } from "./authz";
import { StaleCrmUpdateError, DuplicateAgentGrantError } from "./errors";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import type { CrmAgentPermission } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * CRM agent permission grants — Module 12
 * ============================================================================
 * Structurally separate from `brainPermissionGrants` (Module 3/16) — an
 * agent's Brain domain read access never implies any CRM access, and
 * vice versa. Default deny: an agent with zero rows here can read no CRM
 * data at all, regardless of its Brain grants, department, or permission
 * level. Organization-scoped only in this phase (the smallest safe
 * interim authority — see `MODULE_12_CRM_AUTHORIZATION_AND_PRIVACY.md`).
 */
export interface CrmAgentPermissionGrant {
  id: string;
  organizationId: string;
  agentId: string;
  permission: CrmAgentPermission;
  grantedByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function grantCrmAgentPermission(db: Db, input: { organizationId: string; agentId: string; permission: CrmAgentPermission; actorUserId: string }): Promise<CrmAgentPermissionGrant> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmAdminAuthority(db, ctx, "crm_agent_permission_grant", "new");
  const agent = await resolveAgentById(db, input.agentId);
  if (!agent || agent.organizationId !== input.organizationId) throw new TenantResourceNotFoundError();

  try {
    const [row] = await db
      .insert(crmAgentPermissionGrants)
      .values({ organizationId: input.organizationId, agentId: input.agentId, permission: input.permission, grantedByUserId: input.actorUserId })
      .returning();

    await recordAuditEvent(db, { eventType: "crm_agent_permission_granted", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_agent_permission_grant", targetId: row.id, metadata: { agentId: input.agentId, permission: input.permission } });
    return row as CrmAgentPermissionGrant;
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateAgentGrantError();
    throw err;
  }
}

export async function revokeCrmAgentPermission(db: Db, input: { organizationId: string; grantId: string; expectedRevision: number; actorUserId: string }): Promise<CrmAgentPermissionGrant> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmAdminAuthority(db, ctx, "crm_agent_permission_grant", input.grantId);

  const [updated] = await db
    .update(crmAgentPermissionGrants)
    .set({ revokedAt: new Date(), revokedByUserId: input.actorUserId, updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(crmAgentPermissionGrants.id, input.grantId), eq(crmAgentPermissionGrants.organizationId, input.organizationId), eq(crmAgentPermissionGrants.revision, input.expectedRevision), isNull(crmAgentPermissionGrants.revokedAt)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("agent permission grant");
  await recordAuditEvent(db, { eventType: "crm_agent_permission_revoked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_agent_permission_grant", targetId: updated.id, metadata: { agentId: updated.agentId, permission: updated.permission } });
  return updated as CrmAgentPermissionGrant;
}

export async function listCrmAgentPermissionGrants(db: Db, input: { organizationId: string; agentId?: string; actorUserId: string }): Promise<CrmAgentPermissionGrant[]> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmAdminAuthority(db, ctx, "crm_agent_permission_grant", "list");

  const conditions = [eq(crmAgentPermissionGrants.organizationId, input.organizationId)];
  if (input.agentId) conditions.push(eq(crmAgentPermissionGrants.agentId, input.agentId));
  const rows = await db.select().from(crmAgentPermissionGrants).where(and(...conditions));
  return rows as CrmAgentPermissionGrant[];
}

/** The one function every agent-facing CRM read checks first — true only if this exact agent holds an active (non-revoked) grant for this exact permission in this organization. */
export async function agentHasCrmPermission(db: Db, organizationId: string, agentId: string, permission: CrmAgentPermission): Promise<boolean> {
  const [row] = await db
    .select({ id: crmAgentPermissionGrants.id })
    .from(crmAgentPermissionGrants)
    .where(and(eq(crmAgentPermissionGrants.organizationId, organizationId), eq(crmAgentPermissionGrants.agentId, agentId), eq(crmAgentPermissionGrants.permission, permission), isNull(crmAgentPermissionGrants.revokedAt)));
  return Boolean(row);
}
