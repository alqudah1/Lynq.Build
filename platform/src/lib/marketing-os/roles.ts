import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingRoleAssignments } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveMarketingAuthContext, requireMarketingAdminAuthority } from "./authz";
import { MarketingRoleAlreadyGrantedError, StaleMarketingUpdateError } from "./errors";
import type { MarketingRole } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingRoleAssignment {
  id: string;
  organizationId: string;
  userId: string;
  role: MarketingRole;
  grantedByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Grants a user the given Marketing OS role — never a self-grant path (only a marketing_admin or org owner/admin may call this), and independent of any CRM/Sales/Brain/Workflow role the same user might hold. One active role per user per organization. */
export async function grantMarketingRole(db: Db, input: { organizationId: string; userId: string; role: MarketingRole; actorUserId: string }): Promise<MarketingRoleAssignment> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingAdminAuthority(db, ctx, "marketing_role_assignment", "new");
  await requireOrganizationMembership(db, input.organizationId, input.userId);

  let row: MarketingRoleAssignment;
  try {
    [row] = await db
      .insert(marketingRoleAssignments)
      .values({ organizationId: input.organizationId, userId: input.userId, role: input.role, grantedByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new MarketingRoleAlreadyGrantedError();
    throw err;
  }

  await recordAuditEvent(db, { eventType: "marketing_permission_granted", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_role_assignment", targetId: row.id, metadata: { grantedToUserId: input.userId, role: input.role } });
  return row;
}

export async function revokeMarketingRole(db: Db, input: { organizationId: string; roleAssignmentId: string; expectedRevision: number; actorUserId: string }): Promise<MarketingRoleAssignment> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingAdminAuthority(db, ctx, "marketing_role_assignment", input.roleAssignmentId);

  const [row] = await db
    .update(marketingRoleAssignments)
    .set({ revokedAt: new Date(), revokedByUserId: input.actorUserId, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(marketingRoleAssignments.id, input.roleAssignmentId), eq(marketingRoleAssignments.organizationId, input.organizationId), eq(marketingRoleAssignments.revision, input.expectedRevision), isNull(marketingRoleAssignments.revokedAt)))
    .returning();
  if (!row) throw new StaleMarketingUpdateError("marketing role assignment");

  await recordAuditEvent(db, { eventType: "marketing_permission_revoked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_role_assignment", targetId: row.id, metadata: { revokedFromUserId: row.userId, role: row.role } });
  return row;
}

export async function listMarketingRoleAssignments(db: Db, input: { organizationId: string; actorUserId: string }): Promise<MarketingRoleAssignment[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingAdminAuthority(db, ctx, "marketing_role_assignment", "list");
  return db.select().from(marketingRoleAssignments).where(and(eq(marketingRoleAssignments.organizationId, input.organizationId), isNull(marketingRoleAssignments.revokedAt)));
}
