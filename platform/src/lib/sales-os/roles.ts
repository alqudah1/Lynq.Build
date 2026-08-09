import "server-only";
import { and, eq, isNull, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { salesRoleAssignments } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveSalesAuthContext, requireSalesAdminAuthority } from "./authz";
import { SalesRoleAlreadyGrantedError, StaleSalesUpdateError } from "./errors";
import type { SalesRole } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface SalesRoleAssignment {
  id: string;
  organizationId: string;
  userId: string;
  role: SalesRole;
  grantedByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Grants a user the given Sales OS role — never a self-grant path (only a
 * sales_admin or org owner/admin may call this), and independent of any
 * CRM/Brain/Workflow role the same user might hold. One active role per
 * user per organization.
 */
export async function grantSalesRole(db: Db, input: { organizationId: string; userId: string; role: SalesRole; actorUserId: string }): Promise<SalesRoleAssignment> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesAdminAuthority(db, ctx, "sales_role_assignment", "new");
  await requireOrganizationMembership(db, input.organizationId, input.userId);

  let row: SalesRoleAssignment;
  try {
    [row] = await db
      .insert(salesRoleAssignments)
      .values({ organizationId: input.organizationId, userId: input.userId, role: input.role, grantedByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SalesRoleAlreadyGrantedError();
    throw err;
  }

  await recordAuditEvent(db, { eventType: "sales_role_granted", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "sales_role_assignment", targetId: row.id, metadata: { grantedToUserId: input.userId, role: input.role } });
  return row;
}

export async function revokeSalesRole(db: Db, input: { organizationId: string; roleAssignmentId: string; expectedRevision: number; actorUserId: string }): Promise<SalesRoleAssignment> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesAdminAuthority(db, ctx, "sales_role_assignment", input.roleAssignmentId);

  const [row] = await db
    .update(salesRoleAssignments)
    .set({ revokedAt: new Date(), revokedByUserId: input.actorUserId, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(salesRoleAssignments.id, input.roleAssignmentId), eq(salesRoleAssignments.organizationId, input.organizationId), eq(salesRoleAssignments.revision, input.expectedRevision), isNull(salesRoleAssignments.revokedAt)))
    .returning();
  if (!row) throw new StaleSalesUpdateError("sales role assignment");

  await recordAuditEvent(db, { eventType: "sales_role_revoked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "sales_role_assignment", targetId: row.id, metadata: { revokedFromUserId: row.userId, role: row.role } });
  return row;
}

export async function listSalesRoleAssignments(db: Db, input: { organizationId: string; actorUserId: string }): Promise<SalesRoleAssignment[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesAdminAuthority(db, ctx, "sales_role_assignment", "list");
  return db.select().from(salesRoleAssignments).where(and(eq(salesRoleAssignments.organizationId, input.organizationId), isNull(salesRoleAssignments.revokedAt)));
}

/** The full pool of users holding an active Sales OS role that qualifies them to receive lead assignments (sales_rep, sales_manager, or sales_admin — never `viewer`). */
export async function listAssignmentEligibleUserIds(db: Db, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: salesRoleAssignments.userId })
    .from(salesRoleAssignments)
    .where(and(eq(salesRoleAssignments.organizationId, organizationId), isNull(salesRoleAssignments.revokedAt), inArray(salesRoleAssignments.role, ["sales_rep", "sales_manager", "sales_admin"])));
  return rows.map((r) => r.userId);
}
