import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { projectMembers, users, workspaceMemberships } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveProjectById } from "./projects";
import { resolveProjectAuthContext, requireProjectManageAuthority, requireProjectViewAuthority } from "./authz";
import { recordProjectEvent } from "./events";
import { DuplicateProjectMemberError, LastProjectOwnerViolationError } from "./errors";
import type { ProjectMemberRole } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  name: string | null;
  email: string;
  createdAt: Date;
}

export interface AddProjectMemberInput {
  organizationId: string;
  projectId: string;
  targetUserId: string;
  role: ProjectMemberRole;
  actorUserId: string;
}

/** The target must already be an organization member ("do not create new user identities") and, for a workspace-scoped project, a member of that workspace too. */
export async function addProjectMember(db: Db, input: AddProjectMemberInput): Promise<ProjectMember> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectManageAuthority(db, ctx, project.id);

  await requireOrganizationMembership(db, input.organizationId, input.targetUserId);
  if (project.workspaceId) {
    const [wsRow] = await db
      .select({ id: workspaceMemberships.id })
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, project.workspaceId), eq(workspaceMemberships.userId, input.targetUserId)));
    if (!wsRow) throw new TenantResourceNotFoundError();
  }

  let row;
  try {
    [row] = await db
      .insert(projectMembers)
      .values({ id: randomUUID(), organizationId: input.organizationId, projectId: project.id, userId: input.targetUserId, role: input.role, addedByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateProjectMemberError();
    throw err;
  }

  const [user] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, input.targetUserId));

  await recordAuditEvent(db, { eventType: "project_member_added", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_member", targetId: row.id, metadata: { projectId: project.id, role: input.role } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_member_added", actorUserId: input.actorUserId, targetType: "project_member", targetId: row.id, metadata: { role: input.role } });

  return { id: row.id, projectId: project.id, userId: input.targetUserId, role: input.role, name: user?.name ?? null, email: user?.email ?? "", createdAt: row.createdAt };
}

export async function listProjectMembers(db: Db, input: { organizationId: string; projectId: string; actorUserId: string }): Promise<ProjectMember[]> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectViewAuthority(db, ctx, project.id);

  const rows = await db
    .select({ id: projectMembers.id, userId: projectMembers.userId, role: projectMembers.role, name: users.name, email: users.email, createdAt: projectMembers.createdAt })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, project.id));

  return rows.map((r) => ({ id: r.id, projectId: project.id, userId: r.userId, role: r.role, name: r.name, email: r.email, createdAt: r.createdAt }));
}

/**
 * Race-safe last-owner guard — the identical `FOR UPDATE`-locking-CTE
 * pattern `organizations/memberships.ts`'s `demoteOwnerIfNotLast`
 * already establishes, applied to `project_members` instead.
 */
async function demoteProjectOwnerIfNotLast(db: Db, projectId: string, membershipId: string, newRole: ProjectMemberRole): Promise<boolean> {
  const result = await db.execute<{ id: string }>(drizzleSql`
    WITH locked_owners AS (
      SELECT id FROM project_members
      WHERE project_id = ${projectId} AND role = 'project_owner'
      FOR UPDATE
    )
    UPDATE project_members
    SET role = ${newRole}::project_member_role, updated_at = now(), revision = revision + 1
    WHERE id = ${membershipId}
      AND (SELECT count(*) FROM locked_owners) > 1
    RETURNING id
  `);
  return result.rows.length > 0;
}

async function deleteProjectOwnerIfNotLast(db: Db, projectId: string, membershipId: string): Promise<boolean> {
  const result = await db.execute<{ id: string }>(drizzleSql`
    WITH locked_owners AS (
      SELECT id FROM project_members
      WHERE project_id = ${projectId} AND role = 'project_owner'
      FOR UPDATE
    )
    DELETE FROM project_members
    WHERE id = ${membershipId}
      AND (SELECT count(*) FROM locked_owners) > 1
    RETURNING id
  `);
  return result.rows.length > 0;
}

export interface ChangeProjectMemberRoleInput {
  organizationId: string;
  projectId: string;
  targetUserId: string;
  newRole: ProjectMemberRole;
  actorUserId: string;
}

export async function changeProjectMemberRole(db: Db, input: ChangeProjectMemberRoleInput): Promise<void> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectManageAuthority(db, ctx, project.id);

  const [existing] = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, input.targetUserId)));
  if (!existing) throw new TenantResourceNotFoundError();

  if (existing.role === "project_owner" && input.newRole !== "project_owner") {
    const ok = await demoteProjectOwnerIfNotLast(db, project.id, existing.id, input.newRole);
    if (!ok) throw new LastProjectOwnerViolationError();
  } else {
    await db.update(projectMembers).set({ role: input.newRole, revision: existing.revision + 1, updatedAt: new Date() }).where(eq(projectMembers.id, existing.id));
  }

  await recordAuditEvent(db, { eventType: "project_member_role_changed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_member", targetId: existing.id, metadata: { projectId: project.id, from: existing.role, to: input.newRole } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_member_role_changed", actorUserId: input.actorUserId, targetType: "project_member", targetId: existing.id, metadata: { from: existing.role, to: input.newRole } });
}

export interface RemoveProjectMemberInput {
  organizationId: string;
  projectId: string;
  targetUserId: string;
  actorUserId: string;
}

export async function removeProjectMember(db: Db, input: RemoveProjectMemberInput): Promise<void> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectManageAuthority(db, ctx, project.id);

  const [existing] = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, input.targetUserId)));
  if (!existing) throw new TenantResourceNotFoundError();

  if (existing.role === "project_owner") {
    const ok = await deleteProjectOwnerIfNotLast(db, project.id, existing.id);
    if (!ok) throw new LastProjectOwnerViolationError();
  } else {
    await db.delete(projectMembers).where(eq(projectMembers.id, existing.id));
  }

  await recordAuditEvent(db, { eventType: "project_member_removed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_member", targetId: existing.id, metadata: { projectId: project.id, role: existing.role } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_member_removed", actorUserId: input.actorUserId, targetType: "project_member", targetId: existing.id, metadata: { role: existing.role } });
}
