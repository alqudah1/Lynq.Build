import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, or, inArray, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { projects, projectMembers, workspaces, workspaceMemberships } from "@/db/schema";
import { requireOrganizationMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveProjectAuthContext, requireProjectCreateAuthority, requireProjectViewAuthority, requireProjectManageAuthority } from "./authz";
import { recordProjectEvent } from "./events";
import { ProjectKeyAlreadyTakenError, InvalidProjectTransitionError, StaleUpdateError } from "./errors";
import type { ProjectStatus, ProjectPriority } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface Project {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  projectKey: string;
  description: string | null;
  objective: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate: Date | null;
  targetDate: Date | null;
  actualCompletionDate: Date | null;
  ownerUserId: string;
  createdByUserId: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    name: row.name,
    projectKey: row.projectKey,
    description: row.description,
    objective: row.objective,
    status: row.status,
    priority: row.priority,
    startDate: row.startDate,
    targetDate: row.targetDate,
    actualCompletionDate: row.actualCompletionDate,
    ownerUserId: row.ownerUserId,
    createdByUserId: row.createdByUserId,
    revision: row.revision,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateProjectInput {
  organizationId: string;
  workspaceId?: string | null;
  name: string;
  projectKey: string;
  description?: string | null;
  objective?: string | null;
  priority?: ProjectPriority;
  startDate?: Date | null;
  targetDate?: Date | null;
  ownerUserId?: string | null;
  actorUserId: string;
}

/** Creates a project and, in the same call, its first `project_owner` membership (never a project with no owner, mirroring the organization-creation precedent of never having an org with no owner membership). */
export async function createProject(db: Db, input: CreateProjectInput): Promise<Project> {
  const orgMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  let workspaceRole = null;
  if (input.workspaceId) {
    const [wsRow] = await db
      .select({ role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, input.workspaceId), eq(workspaceMemberships.userId, input.actorUserId)));
    workspaceRole = wsRow?.role ?? null;
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.organizationId, input.organizationId)));
    if (!ws) throw new TenantResourceNotFoundError();
  }
  requireProjectCreateAuthority({ orgRole: orgMembership.role, workspaceId: input.workspaceId ?? null, workspaceRole });

  const ownerUserId = input.ownerUserId ?? input.actorUserId;
  const id = randomUUID();

  let row;
  try {
    [row] = await db
      .insert(projects)
      .values({
        id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        name: input.name,
        projectKey: input.projectKey,
        description: input.description ?? null,
        objective: input.objective ?? null,
        priority: input.priority ?? "normal",
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        ownerUserId,
        createdByUserId: input.actorUserId,
      })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new ProjectKeyAlreadyTakenError(input.projectKey);
    throw err;
  }

  await db.insert(projectMembers).values({
    organizationId: input.organizationId,
    projectId: id,
    userId: ownerUserId,
    role: "project_owner",
    addedByUserId: input.actorUserId,
  });

  await recordAuditEvent(db, {
    eventType: "project_created",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "project",
    targetId: id,
    metadata: { projectKey: input.projectKey, workspaceScoped: Boolean(input.workspaceId) },
  });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: id, eventType: "project_created", actorUserId: input.actorUserId, targetType: "project", targetId: id, metadata: { name: input.name } });

  return toProject(row);
}

/** Internal, unauthorized resolve — for services that establish their own authority via `resolveProjectAuthContext` themselves. */
export async function resolveProjectById(db: Db, organizationId: string, projectId: string): Promise<Project> {
  const row = await requireTenantScopedResource(async () => {
    const [found] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)));
    return found;
  });
  return toProject(row);
}

export async function getProjectForUser(db: Db, input: { organizationId: string; projectId: string; actorUserId: string }): Promise<Project> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectViewAuthority(db, ctx, project.id);
  return project;
}

export interface ListProjectsInput {
  organizationId: string;
  actorUserId: string;
  workspaceId?: string;
  status?: ProjectStatus;
}

/** Org owner/admin see every project; everyone else sees only projects they're a member of, or (for a workspace-scoped project) a member of that workspace. */
export async function listProjectsForUser(db: Db, input: ListProjectsInput): Promise<Project[]> {
  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  const isAdmin = membership.role === "owner" || membership.role === "admin";

  if (isAdmin) {
    const conditions = [eq(projects.organizationId, input.organizationId)];
    if (input.workspaceId) conditions.push(eq(projects.workspaceId, input.workspaceId));
    if (input.status) conditions.push(eq(projects.status, input.status));
    const rows = await db.select().from(projects).where(and(...conditions)).orderBy(desc(projects.updatedAt));
    return rows.map(toProject);
  }

  const memberProjectIds = await db.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, input.actorUserId));
  const memberWorkspaceIds = await db.select({ workspaceId: workspaceMemberships.workspaceId }).from(workspaceMemberships).where(eq(workspaceMemberships.userId, input.actorUserId));

  const idList = memberProjectIds.map((r) => r.projectId);
  const wsList = memberWorkspaceIds.map((r) => r.workspaceId);
  if (idList.length === 0 && wsList.length === 0) return [];

  const visibilityCondition = or(idList.length > 0 ? inArray(projects.id, idList) : undefined, wsList.length > 0 ? inArray(projects.workspaceId, wsList) : undefined);

  const conditions = [eq(projects.organizationId, input.organizationId), visibilityCondition];
  if (input.workspaceId) conditions.push(eq(projects.workspaceId, input.workspaceId));
  if (input.status) conditions.push(eq(projects.status, input.status));

  const rows = await db.select().from(projects).where(and(...conditions)).orderBy(desc(projects.updatedAt));
  return rows.map(toProject);
}

export interface UpdateProjectInput {
  organizationId: string;
  projectId: string;
  actorUserId: string;
  expectedRevision: number;
  updates: {
    name?: string;
    description?: string | null;
    objective?: string | null;
    priority?: ProjectPriority;
    startDate?: Date | null;
    targetDate?: Date | null;
    ownerUserId?: string;
  };
}

/** `projectKey` is never accepted here — immutable after creation, by design (see schema.ts's own comment). */
export async function updateProject(db: Db, input: UpdateProjectInput): Promise<Project> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectManageAuthority(db, ctx, project.id);

  const [row] = await db
    .update(projects)
    .set({ ...input.updates, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.revision, input.expectedRevision)))
    .returning();

  if (!row) throw new StaleUpdateError();

  await recordAuditEvent(db, { eventType: "project_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project", targetId: project.id, metadata: { fields: Object.keys(input.updates) } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_updated", actorUserId: input.actorUserId, targetType: "project", targetId: project.id, metadata: { fields: Object.keys(input.updates) } });

  return toProject(row);
}

/**
 * Projects sometimes need to be reopened after a founder marks one complete
 * or archived by mistake. Reopening is intentionally an explicit status
 * transition, still protected by the project-management permission floor;
 * it never changes history or quietly erases the prior outcome.
 */
const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  proposed: ["planning", "cancelled"],
  planning: ["active", "cancelled"],
  active: ["paused", "blocked", "completed", "cancelled"],
  paused: ["active", "cancelled"],
  blocked: ["active", "cancelled"],
  completed: ["active", "archived"],
  cancelled: ["planning", "archived"],
  archived: ["planning", "active"],
};

/** UI-facing: which target statuses are legal from here right now — so a status picker never even offers an illegal transition, rather than relying on the server to reject it after the fact. */
export function getLegalProjectTransitions(status: ProjectStatus): ProjectStatus[] {
  return PROJECT_TRANSITIONS[status] ?? [];
}

export interface TransitionProjectInput {
  organizationId: string;
  projectId: string;
  toStatus: ProjectStatus;
  actorUserId: string;
  expectedRevision: number;
}

export async function transitionProjectStatus(db: Db, input: TransitionProjectInput): Promise<Project> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectManageAuthority(db, ctx, project.id);

  const legalTargets = PROJECT_TRANSITIONS[project.status] ?? [];
  if (!legalTargets.includes(input.toStatus)) {
    throw new InvalidProjectTransitionError(project.status, input.toStatus);
  }

  const extra: Record<string, unknown> = {};
  if (input.toStatus === "completed") extra.actualCompletionDate = new Date();
  if (input.toStatus === "archived") extra.archivedAt = new Date();
  if (input.toStatus !== "completed") extra.actualCompletionDate = null;
  if (input.toStatus !== "archived") extra.archivedAt = null;

  const [row] = await db
    .update(projects)
    .set({ status: input.toStatus, revision: input.expectedRevision + 1, updatedAt: new Date(), ...extra })
    .where(and(eq(projects.id, project.id), eq(projects.revision, input.expectedRevision), eq(projects.status, project.status)))
    .returning();

  if (!row) throw new InvalidProjectTransitionError(project.status, input.toStatus);

  await recordAuditEvent(db, {
    eventType: input.toStatus === "archived" ? "project_archived" : "project_status_changed",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "project",
    targetId: project.id,
    metadata: { from: project.status, to: input.toStatus },
  });
  await recordProjectEvent(db, {
    organizationId: input.organizationId,
    projectId: project.id,
    eventType: "project_status_changed",
    actorUserId: input.actorUserId,
    targetType: "project",
    targetId: project.id,
    metadata: { from: project.status, to: input.toStatus },
  });

  return toProject(row);
}
