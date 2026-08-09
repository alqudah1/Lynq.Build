import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationRoleAssignments } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveCommunicationAuthContext, requireCommunicationsAdminAuthority } from "./authz";
import { CommunicationRoleAlreadyGrantedError, StaleCommunicationUpdateError } from "./errors";
import type { CommunicationRole } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CommunicationRoleAssignment {
  id: string;
  organizationId: string;
  userId: string;
  role: CommunicationRole;
  grantedByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: Date | null;
  revision: number;
  createdAt: Date;
}

export async function grantCommunicationRole(db: Db, input: { organizationId: string; userId: string; role: CommunicationRole; actorUserId: string }): Promise<CommunicationRoleAssignment> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsAdminAuthority(db, ctx, "communication_role_assignment", "new");
  await requireOrganizationMembership(db, input.organizationId, input.userId);

  let row: CommunicationRoleAssignment;
  try {
    [row] = await db
      .insert(communicationRoleAssignments)
      .values({ organizationId: input.organizationId, userId: input.userId, role: input.role, grantedByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new CommunicationRoleAlreadyGrantedError();
    throw err;
  }

  await recordAuditEvent(db, { eventType: "communication_permission_granted", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_role_assignment", targetId: row.id, metadata: { grantedToUserId: input.userId, role: input.role } });
  return row;
}

export async function revokeCommunicationRole(db: Db, input: { organizationId: string; roleAssignmentId: string; expectedRevision: number; actorUserId: string }): Promise<CommunicationRoleAssignment> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsAdminAuthority(db, ctx, "communication_role_assignment", input.roleAssignmentId);

  const [row] = await db
    .update(communicationRoleAssignments)
    .set({ revokedAt: new Date(), revokedByUserId: input.actorUserId, revision: input.expectedRevision + 1 })
    .where(and(eq(communicationRoleAssignments.id, input.roleAssignmentId), eq(communicationRoleAssignments.organizationId, input.organizationId), eq(communicationRoleAssignments.revision, input.expectedRevision), isNull(communicationRoleAssignments.revokedAt)))
    .returning();
  if (!row) throw new StaleCommunicationUpdateError("communication role assignment");

  await recordAuditEvent(db, { eventType: "communication_permission_revoked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_role_assignment", targetId: row.id, metadata: { revokedFromUserId: row.userId, role: row.role } });
  return row;
}

export async function listCommunicationRoleAssignments(db: Db, input: { organizationId: string; actorUserId: string }): Promise<CommunicationRoleAssignment[]> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsAdminAuthority(db, ctx, "communication_role_assignment", "list");
  return db.select().from(communicationRoleAssignments).where(and(eq(communicationRoleAssignments.organizationId, input.organizationId), isNull(communicationRoleAssignments.revokedAt)));
}
