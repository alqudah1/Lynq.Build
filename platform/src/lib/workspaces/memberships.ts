import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { workspaceMemberships, organizationMemberships, users } from "@/db/schema";
import {
  requireWorkspaceMembership,
  requireOrganizationAdminOverride,
  requireTenantScopedResource,
  type WorkspaceMembershipRecord,
  type WorkspaceRole,
} from "@/lib/authz/helpers";
import { requireWorkspaceManagementAccess } from "./workspaces";
import { auditInsertQuery, recordAuditEvent } from "@/lib/audit";
import { SelfRoleChangeViolationError, ParentMembershipRequiredViolationError } from "@/lib/authz/errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

export interface AddWorkspaceMemberInput {
  workspaceId: string;
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  role: WorkspaceRole;
}

/**
 * Authorized via `requireWorkspaceManagementAccess` — a workspace manager,
 * or an organization owner/admin via the admin-override (Step 4A workspace
 * rules). Before inserting, verifies the target user already holds an
 * organization membership in this workspace's parent organization — "a
 * workspace membership cannot exist without" one, an explicit Step 4A rule.
 */
export async function addWorkspaceMember(
  db: Db,
  rawSql: RawSql,
  input: AddWorkspaceMemberInput
): Promise<WorkspaceMembershipRecord> {
  await guardManagementOrDeny(db, input.workspaceId, input.organizationId, input.actorUserId, "add_workspace_member", input.targetUserId);

  const [parentMembership] = await db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, input.organizationId), eq(organizationMemberships.userId, input.targetUserId)));

  if (!parentMembership) {
    await denyAndAudit(db, input.actorUserId, input.organizationId, input.workspaceId, input.targetUserId, "add_workspace_member", "parent_membership_required");
    throw new ParentMembershipRequiredViolationError();
  }

  const membershipId = randomUUID();
  const now = new Date();

  await rawSql.transaction([
    rawSql`INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
           VALUES (${membershipId}, ${input.workspaceId}, ${input.targetUserId}, ${input.role}::workspace_role, ${now}, ${now})`,
    auditInsertQuery(rawSql, {
      eventType: "workspace_access_added",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "user",
      targetId: input.targetUserId,
      metadata: { workspaceId: input.workspaceId, role: input.role },
    }),
  ]);

  return { workspaceId: input.workspaceId, organizationId: input.organizationId, userId: input.targetUserId, role: input.role };
}

export interface RemoveWorkspaceMemberInput {
  workspaceId: string;
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
}

/** Same authorization as `addWorkspaceMember` — manager, or org owner/admin via override. No "last manager" invariant is required (unlike organizations' last-owner rule). */
export async function removeWorkspaceMember(db: Db, rawSql: RawSql, input: RemoveWorkspaceMemberInput): Promise<void> {
  await guardManagementOrDeny(db, input.workspaceId, input.organizationId, input.actorUserId, "remove_workspace_member", input.targetUserId);

  const targetMembership = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select({ id: workspaceMemberships.id, role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, input.workspaceId), eq(workspaceMemberships.userId, input.targetUserId)));
    return row;
  });

  await db.delete(workspaceMemberships).where(eq(workspaceMemberships.id, targetMembership.id));

  await recordAuditEvent(db, {
    eventType: "workspace_access_removed",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "user",
    targetId: input.targetUserId,
    metadata: { workspaceId: input.workspaceId, previousRole: targetMembership.role },
  });
}

export interface ChangeWorkspaceRoleInput {
  workspaceId: string;
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  newRole: WorkspaceRole;
}

/** Users cannot change their own workspace role either — the same safety principle Step 4A applies to organization roles, extended here defensively. */
export async function changeWorkspaceRole(
  db: Db,
  rawSql: RawSql,
  input: ChangeWorkspaceRoleInput
): Promise<WorkspaceMembershipRecord> {
  if (input.actorUserId === input.targetUserId) {
    await denyAndAudit(db, input.actorUserId, input.organizationId, input.workspaceId, input.targetUserId, "change_workspace_role", "self_role_change");
    throw new SelfRoleChangeViolationError();
  }

  await guardManagementOrDeny(db, input.workspaceId, input.organizationId, input.actorUserId, "change_workspace_role", input.targetUserId);

  const targetMembership = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select({ id: workspaceMemberships.id, role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, input.workspaceId), eq(workspaceMemberships.userId, input.targetUserId)));
    return row;
  });

  await db
    .update(workspaceMemberships)
    .set({ role: input.newRole, updatedAt: new Date() })
    .where(eq(workspaceMemberships.id, targetMembership.id));

  await recordAuditEvent(db, {
    eventType: "workspace_role_changed",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "user",
    targetId: input.targetUserId,
    metadata: { workspaceId: input.workspaceId, previousRole: targetMembership.role, newRole: input.newRole },
  });

  return { workspaceId: input.workspaceId, organizationId: input.organizationId, userId: input.targetUserId, role: input.newRole };
}

export interface WorkspaceMemberListItem {
  userId: string;
  email: string;
  name: string | null;
  role: WorkspaceRole;
}

/**
 * Any explicit workspace member (any role, including viewer) may view the
 * roster; an organization owner/admin may too, via the admin-override,
 * even without an explicit membership of their own. `name` was added in
 * Step 5B (a small, additive `SELECT` column — no behavior or
 * authorization change) to match the admin UI's explicit requirement to
 * display a member's name, not just their email.
 */
export async function listWorkspaceMembers(
  db: Db,
  workspaceId: string,
  organizationId: string,
  actorUserId: string
): Promise<WorkspaceMemberListItem[]> {
  try {
    await requireWorkspaceMembership(db, workspaceId, actorUserId);
  } catch {
    await requireOrganizationAdminOverride(db, organizationId, actorUserId);
  }

  return db
    .select({ userId: workspaceMemberships.userId, email: users.email, name: users.name, role: workspaceMemberships.role })
    .from(workspaceMemberships)
    .innerJoin(users, eq(workspaceMemberships.userId, users.id))
    .where(eq(workspaceMemberships.workspaceId, workspaceId));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function guardManagementOrDeny(
  db: Db,
  workspaceId: string,
  organizationId: string,
  actorUserId: string,
  action: string,
  targetUserId: string
): Promise<void> {
  try {
    await requireWorkspaceManagementAccess(db, workspaceId, organizationId, actorUserId);
  } catch (err) {
    await denyAndAudit(db, actorUserId, organizationId, workspaceId, targetUserId, action, "insufficient_role");
    throw err;
  }
}

async function denyAndAudit(
  db: Db,
  actorUserId: string,
  organizationId: string,
  workspaceId: string,
  targetUserId: string,
  action: string,
  reason: string
): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "authorization_denied",
    actorUserId,
    organizationId,
    targetType: "user",
    targetId: targetUserId,
    metadata: { action, workspaceId, reason },
  });
}
