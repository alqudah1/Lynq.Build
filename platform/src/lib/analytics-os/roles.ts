import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { analyticsRoleAssignments } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveAnalyticsAuthContext, requireAnalyticsAdminAuthority } from "./authz";
import { AnalyticsRoleAlreadyGrantedError, StaleAnalyticsUpdateError } from "./errors";
import type { AnalyticsRole } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface AnalyticsRoleAssignment {
  id: string;
  organizationId: string;
  userId: string;
  role: AnalyticsRole;
  grantedByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: Date | null;
  revision: number;
  createdAt: Date;
}

export async function grantAnalyticsRole(db: Db, input: { organizationId: string; userId: string; role: AnalyticsRole; actorUserId: string }): Promise<AnalyticsRoleAssignment> {
  const ctx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireAnalyticsAdminAuthority(db, ctx, "analytics_role_assignment", "new");
  await requireOrganizationMembership(db, input.organizationId, input.userId);

  let row: AnalyticsRoleAssignment;
  try {
    [row] = await db
      .insert(analyticsRoleAssignments)
      .values({ organizationId: input.organizationId, userId: input.userId, role: input.role, grantedByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new AnalyticsRoleAlreadyGrantedError();
    throw err;
  }

  await recordAuditEvent(db, { eventType: "analytics_permission_granted", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "analytics_role_assignment", targetId: row.id, metadata: { grantedToUserId: input.userId, role: input.role } });
  return row;
}

export async function revokeAnalyticsRole(db: Db, input: { organizationId: string; roleAssignmentId: string; expectedRevision: number; actorUserId: string }): Promise<AnalyticsRoleAssignment> {
  const ctx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireAnalyticsAdminAuthority(db, ctx, "analytics_role_assignment", input.roleAssignmentId);

  const [row] = await db
    .update(analyticsRoleAssignments)
    .set({ revokedAt: new Date(), revokedByUserId: input.actorUserId, revision: input.expectedRevision + 1 })
    .where(and(eq(analyticsRoleAssignments.id, input.roleAssignmentId), eq(analyticsRoleAssignments.organizationId, input.organizationId), eq(analyticsRoleAssignments.revision, input.expectedRevision), isNull(analyticsRoleAssignments.revokedAt)))
    .returning();
  if (!row) throw new StaleAnalyticsUpdateError("analytics role assignment");

  await recordAuditEvent(db, { eventType: "analytics_permission_revoked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "analytics_role_assignment", targetId: row.id, metadata: { revokedFromUserId: row.userId, role: row.role } });
  return row;
}

export async function listAnalyticsRoleAssignments(db: Db, input: { organizationId: string; actorUserId: string }): Promise<AnalyticsRoleAssignment[]> {
  const ctx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireAnalyticsAdminAuthority(db, ctx, "analytics_role_assignment", "list");
  return db.select().from(analyticsRoleAssignments).where(and(eq(analyticsRoleAssignments.organizationId, input.organizationId), isNull(analyticsRoleAssignments.revokedAt)));
}
