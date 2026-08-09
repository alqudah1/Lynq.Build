import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { founderRoleAssignments } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveFounderAuthContext, requireFounderAdminAuthority } from "./authz";
import { FounderRoleAlreadyGrantedError, StaleFounderUpdateError } from "./errors";
import type { FounderRole } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface FounderRoleAssignment {
  id: string;
  organizationId: string;
  userId: string;
  role: FounderRole;
  grantedByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: Date | null;
  revision: number;
  createdAt: Date;
}

export async function grantFounderRole(db: Db, input: { organizationId: string; userId: string; role: FounderRole; actorUserId: string }): Promise<FounderRoleAssignment> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderAdminAuthority(db, ctx, "founder_role_assignment", "new");

  let row: FounderRoleAssignment;
  try {
    [row] = await db
      .insert(founderRoleAssignments)
      .values({ organizationId: input.organizationId, userId: input.userId, role: input.role, grantedByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new FounderRoleAlreadyGrantedError();
    throw err;
  }

  await recordAuditEvent(db, { eventType: "founder_permission_granted", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "founder_role_assignment", targetId: row.id, metadata: { grantedToUserId: input.userId, role: input.role } });
  return row;
}

export async function revokeFounderRole(db: Db, input: { organizationId: string; roleAssignmentId: string; expectedRevision: number; actorUserId: string }): Promise<FounderRoleAssignment> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderAdminAuthority(db, ctx, "founder_role_assignment", input.roleAssignmentId);

  const [row] = await db
    .update(founderRoleAssignments)
    .set({ revokedAt: new Date(), revokedByUserId: input.actorUserId, revision: input.expectedRevision + 1 })
    .where(and(eq(founderRoleAssignments.id, input.roleAssignmentId), eq(founderRoleAssignments.organizationId, input.organizationId), eq(founderRoleAssignments.revision, input.expectedRevision), isNull(founderRoleAssignments.revokedAt)))
    .returning();
  if (!row) throw new StaleFounderUpdateError("founder role assignment");

  await recordAuditEvent(db, { eventType: "founder_permission_revoked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "founder_role_assignment", targetId: row.id, metadata: { revokedFromUserId: row.userId, role: row.role } });
  return row;
}

export async function listFounderRoleAssignments(db: Db, input: { organizationId: string; actorUserId: string }): Promise<FounderRoleAssignment[]> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderAdminAuthority(db, ctx, "founder_role_assignment", "list");
  return db.select().from(founderRoleAssignments).where(and(eq(founderRoleAssignments.organizationId, input.organizationId), isNull(founderRoleAssignments.revokedAt)));
}
