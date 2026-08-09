import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { organizationMemberships, users } from "@/db/schema";
import {
  requireOrganizationMembership,
  requireOrganizationRole,
  requireTenantScopedResource,
  type OrganizationMembershipRecord,
  type OrganizationRole,
} from "@/lib/authz/helpers";
import { auditInsertQuery, recordAuditEvent } from "@/lib/audit";
import {
  LastOwnerViolationError,
  SelfRoleChangeViolationError,
  AdminCannotActOnOwnerViolationError,
} from "@/lib/authz/errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

export interface AddOrganizationMemberInput {
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  role: OrganizationRole;
}

/** Only owners and admins may invite or manage members (Step 4A organization rules). */
export async function addOrganizationMember(
  db: Db,
  rawSql: RawSql,
  input: AddOrganizationMemberInput
): Promise<OrganizationMembershipRecord> {
  const actorMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  await guardOrDeny(db, actorMembership, ["owner", "admin"], input.organizationId, input.actorUserId, "add_organization_member");

  const membershipId = randomUUID();
  const now = new Date();

  await rawSql.transaction([
    rawSql`INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at, updated_at)
           VALUES (${membershipId}, ${input.organizationId}, ${input.targetUserId}, ${input.role}::organization_role, ${now}, ${now})`,
    auditInsertQuery(rawSql, {
      eventType: "membership_added",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "user",
      targetId: input.targetUserId,
      metadata: { role: input.role },
    }),
  ]);

  return { organizationId: input.organizationId, userId: input.targetUserId, role: input.role };
}

export interface RemoveOrganizationMemberInput {
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
}

/**
 * Only owners and admins may remove members. Admins can never remove an
 * owner (unconditionally, regardless of owner count) — organization rules.
 * Removing the final owner is blocked via a race-safe, lock-based guard
 * (see the module doc comment on the CTE pattern below), not a
 * check-then-act application-level count that two concurrent requests
 * could both pass.
 */
export async function removeOrganizationMember(db: Db, rawSql: RawSql, input: RemoveOrganizationMemberInput): Promise<void> {
  const actorMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  await guardOrDeny(db, actorMembership, ["owner", "admin"], input.organizationId, input.actorUserId, "remove_organization_member", input.targetUserId);

  const targetMembership = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select({ id: organizationMemberships.id, role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, input.organizationId), eq(organizationMemberships.userId, input.targetUserId)));
    return row;
  });

  if (targetMembership.role === "owner" && actorMembership.role === "admin") {
    await denyAndAudit(db, input.actorUserId, input.organizationId, input.targetUserId, "remove_organization_member", "admin_cannot_act_on_owner");
    throw new AdminCannotActOnOwnerViolationError();
  }

  if (targetMembership.role === "owner") {
    const deleted = await deleteOwnerIfNotLast(db, input.organizationId, targetMembership.id);
    if (!deleted) {
      await denyAndAudit(db, input.actorUserId, input.organizationId, input.targetUserId, "remove_organization_member", "last_owner");
      throw new LastOwnerViolationError();
    }
  } else {
    await db.delete(organizationMemberships).where(eq(organizationMemberships.id, targetMembership.id));
  }

  await recordAuditEvent(db, {
    eventType: "membership_removed",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "user",
    targetId: input.targetUserId,
    metadata: { previousRole: targetMembership.role },
  });
}

export interface ChangeOrganizationRoleInput {
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  newRole: OrganizationRole;
}

/**
 * Users cannot change their own role, under any circumstance — checked
 * before the actor's own role is even consulted, so this applies even to
 * an owner acting on themselves. Demoting the final owner away from
 * "owner" is blocked by the same race-safe guard as removal.
 */
export async function changeOrganizationRole(
  db: Db,
  rawSql: RawSql,
  input: ChangeOrganizationRoleInput
): Promise<OrganizationMembershipRecord> {
  if (input.actorUserId === input.targetUserId) {
    await denyAndAudit(db, input.actorUserId, input.organizationId, input.targetUserId, "change_organization_role", "self_role_change");
    throw new SelfRoleChangeViolationError();
  }

  const actorMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  await guardOrDeny(db, actorMembership, ["owner", "admin"], input.organizationId, input.actorUserId, "change_organization_role", input.targetUserId);

  const targetMembership = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select({ id: organizationMemberships.id, role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, input.organizationId), eq(organizationMemberships.userId, input.targetUserId)));
    return row;
  });

  if (targetMembership.role === "owner" && actorMembership.role === "admin") {
    await denyAndAudit(db, input.actorUserId, input.organizationId, input.targetUserId, "change_organization_role", "admin_cannot_act_on_owner");
    throw new AdminCannotActOnOwnerViolationError();
  }

  if (targetMembership.role === "owner" && input.newRole !== "owner") {
    const updated = await demoteOwnerIfNotLast(db, input.organizationId, targetMembership.id, input.newRole);
    if (!updated) {
      await denyAndAudit(db, input.actorUserId, input.organizationId, input.targetUserId, "change_organization_role", "last_owner");
      throw new LastOwnerViolationError();
    }
  } else {
    await db
      .update(organizationMemberships)
      .set({ role: input.newRole, updatedAt: new Date() })
      .where(eq(organizationMemberships.id, targetMembership.id));
  }

  await recordAuditEvent(db, {
    eventType: "role_changed",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "user",
    targetId: input.targetUserId,
    metadata: { previousRole: targetMembership.role, newRole: input.newRole },
  });

  return { organizationId: input.organizationId, userId: input.targetUserId, role: input.newRole };
}

export interface OrganizationMemberListItem {
  userId: string;
  email: string;
  name: string | null;
  role: OrganizationRole;
}

/**
 * Any member may view the roster (read-only) — matches "View organization"
 * being open to every role (Module 2 §7's permission matrix). `name` was
 * added in Step 5B (a small, additive `SELECT` column — no behavior or
 * authorization change) since the admin UI's own explicit requirement is
 * to display a member's name, not just their email.
 */
export async function listOrganizationMembers(
  db: Db,
  organizationId: string,
  actorUserId: string
): Promise<OrganizationMemberListItem[]> {
  await requireOrganizationMembership(db, organizationId, actorUserId);

  return db
    .select({ userId: organizationMemberships.userId, email: users.email, name: users.name, role: organizationMemberships.role })
    .from(organizationMemberships)
    .innerJoin(users, eq(organizationMemberships.userId, users.id))
    .where(eq(organizationMemberships.organizationId, organizationId));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function guardOrDeny(
  db: Db,
  actorMembership: OrganizationMembershipRecord,
  allowedRoles: OrganizationRole[],
  organizationId: string,
  actorUserId: string,
  action: string,
  targetUserId?: string
): Promise<void> {
  try {
    requireOrganizationRole(actorMembership, allowedRoles);
  } catch (err) {
    await denyAndAudit(db, actorUserId, organizationId, targetUserId ?? null, action, "insufficient_role");
    throw err;
  }
}

async function denyAndAudit(
  db: Db,
  actorUserId: string,
  organizationId: string,
  targetUserId: string | null,
  action: string,
  reason: string
): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "authorization_denied",
    actorUserId,
    organizationId,
    targetType: targetUserId ? "user" : undefined,
    targetId: targetUserId,
    metadata: { action, reason },
  });
}

/**
 * Race-safe last-owner guard (Step 4A concurrency requirement): locks
 * every current owner row for the organization with `FOR UPDATE` inside a
 * CTE, then only deletes the target row if more than one owner remains
 * locked. Two concurrent removals targeting different owners of the same
 * two-owner organization correctly serialize on this lock — the second to
 * acquire it re-evaluates the owner count *after* the first has committed,
 * seeing the reduced count and correctly refusing. This is the standard
 * Postgres pattern for exactly this class of write-skew anomaly (the
 * classic "at least one doctor must remain on call" example) — a plain
 * SELECT-count-then-DELETE across two separate statements/transactions
 * would NOT be safe under this exact race, since both could read the same
 * pre-decrement count before either commits.
 */
async function deleteOwnerIfNotLast(db: Db, organizationId: string, membershipId: string): Promise<boolean> {
  const result = await db.execute<{ id: string }>(drizzleSql`
    WITH locked_owners AS (
      SELECT id FROM organization_memberships
      WHERE organization_id = ${organizationId} AND role = 'owner'
      FOR UPDATE
    )
    DELETE FROM organization_memberships
    WHERE id = ${membershipId}
      AND (SELECT count(*) FROM locked_owners) > 1
    RETURNING id
  `);
  return result.rows.length > 0;
}

/** Same race-safe locking pattern as `deleteOwnerIfNotLast`, for demotion instead of removal. */
async function demoteOwnerIfNotLast(
  db: Db,
  organizationId: string,
  membershipId: string,
  newRole: OrganizationRole
): Promise<boolean> {
  const result = await db.execute<{ id: string }>(drizzleSql`
    WITH locked_owners AS (
      SELECT id FROM organization_memberships
      WHERE organization_id = ${organizationId} AND role = 'owner'
      FOR UPDATE
    )
    UPDATE organization_memberships
    SET role = ${newRole}::organization_role, updated_at = now()
    WHERE id = ${membershipId}
      AND (SELECT count(*) FROM locked_owners) > 1
    RETURNING id
  `);
  return result.rows.length > 0;
}
