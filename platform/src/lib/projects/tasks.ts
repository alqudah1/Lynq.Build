import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, desc, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { projectTasks, projectTaskAssignments, users } from "@/db/schema";
import { requireOrganizationMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveProjectById } from "./projects";
import { resolveProjectAuthContext, requireProjectViewAuthority, requireTaskCreateAuthority, requireTaskUpdateAuthority, requireProjectContentAuthority } from "./authz";
import { recordProjectEvent } from "./events";
import { getUnresolvedBlockingTaskIds } from "./dependencies";
import { StaleUpdateError, InvalidTaskTransitionError, DuplicateTaskAssignmentError, UnresolvedDependenciesError } from "./errors";
import type { ProjectTaskStatus, ProjectPriority } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface ProjectTask {
  id: string;
  organizationId: string;
  projectId: string;
  phaseId: string | null;
  milestoneId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  status: ProjectTaskStatus;
  priority: ProjectPriority;
  taskType: string;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  createdByUserId: string | null;
  position: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

function toTask(row: typeof projectTasks.$inferSelect): ProjectTask {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    phaseId: row.phaseId,
    milestoneId: row.milestoneId,
    parentTaskId: row.parentTaskId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    taskType: row.taskType,
    startDate: row.startDate,
    dueDate: row.dueDate,
    completedAt: row.completedAt,
    createdByUserId: row.createdByUserId,
    position: row.position,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function resolveTaskById(db: Db, organizationId: string, taskId: string): Promise<ProjectTask> {
  const row = await requireTenantScopedResource(async () => {
    const [found] = await db.select().from(projectTasks).where(and(eq(projectTasks.id, taskId), eq(projectTasks.organizationId, organizationId)));
    return found;
  });
  return toTask(row);
}

async function isTaskAssignee(db: Db, taskId: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: projectTaskAssignments.id }).from(projectTaskAssignments).where(and(eq(projectTaskAssignments.taskId, taskId), eq(projectTaskAssignments.userId, userId)));
  return Boolean(row);
}

export interface CreateTaskInput {
  organizationId: string;
  projectId: string;
  phaseId?: string | null;
  milestoneId?: string | null;
  parentTaskId?: string | null;
  title: string;
  description?: string | null;
  priority?: ProjectPriority;
  taskType?: string;
  startDate?: Date | null;
  dueDate?: Date | null;
  actorUserId: string;
}

export async function createTask(db: Db, input: CreateTaskInput): Promise<ProjectTask> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireTaskCreateAuthority(db, ctx, project.id);

  if (input.parentTaskId) {
    const parent = await resolveTaskById(db, input.organizationId, input.parentTaskId);
    if (parent.projectId !== project.id) throw new TenantResourceNotFoundError();
  }

  const [last] = await db.select({ position: projectTasks.position }).from(projectTasks).where(eq(projectTasks.projectId, project.id)).orderBy(desc(projectTasks.position)).limit(1);

  const [row] = await db
    .insert(projectTasks)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: project.id,
      phaseId: input.phaseId ?? null,
      milestoneId: input.milestoneId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "normal",
      taskType: input.taskType ?? "general",
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      createdByUserId: input.actorUserId,
      position: (last?.position ?? 0) + 1,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "project_task_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_task", targetId: row.id, metadata: { projectId: project.id, isSubtask: Boolean(input.parentTaskId) } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_task_created", actorUserId: input.actorUserId, targetType: "project_task", targetId: row.id, metadata: { title: input.title } });

  return toTask(row);
}

export interface ListTasksInput {
  organizationId: string;
  projectId: string;
  actorUserId: string;
  status?: ProjectTaskStatus;
  phaseId?: string;
  milestoneId?: string;
  topLevelOnly?: boolean;
}

export async function listTasks(db: Db, input: ListTasksInput): Promise<ProjectTask[]> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectViewAuthority(db, ctx, project.id);

  const conditions = [eq(projectTasks.projectId, project.id)];
  if (input.status) conditions.push(eq(projectTasks.status, input.status));
  if (input.phaseId) conditions.push(eq(projectTasks.phaseId, input.phaseId));
  if (input.milestoneId) conditions.push(eq(projectTasks.milestoneId, input.milestoneId));
  if (input.topLevelOnly) conditions.push(isNull(projectTasks.parentTaskId));

  const rows = await db.select().from(projectTasks).where(and(...conditions)).orderBy(projectTasks.position);
  return rows.map(toTask);
}

export async function getTaskForUser(db: Db, input: { organizationId: string; taskId: string; actorUserId: string }): Promise<ProjectTask> {
  const task = await resolveTaskById(db, input.organizationId, input.taskId);
  const project = await resolveProjectById(db, input.organizationId, task.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectViewAuthority(db, ctx, project.id);
  return task;
}

export interface UpdateTaskInput {
  organizationId: string;
  taskId: string;
  expectedRevision: number;
  actorUserId: string;
  updates: {
    title?: string;
    description?: string | null;
    priority?: ProjectPriority;
    taskType?: string;
    phaseId?: string | null;
    milestoneId?: string | null;
    parentTaskId?: string | null;
    startDate?: Date | null;
    dueDate?: Date | null;
    position?: number;
  };
}

/** Covers "update task" and "move task" — moving between phase/milestone/parent or reordering `position` is just another field update, gated by the same task-update authority (management floor, or an assigned contributor). */
export async function updateTask(db: Db, input: UpdateTaskInput): Promise<ProjectTask> {
  const task = await resolveTaskById(db, input.organizationId, input.taskId);
  const project = await resolveProjectById(db, input.organizationId, task.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  const isAssignee = await isTaskAssignee(db, task.id, input.actorUserId);
  await requireTaskUpdateAuthority(db, ctx, project.id, isAssignee);

  const [row] = await db
    .update(projectTasks)
    .set({ ...input.updates, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(projectTasks.id, task.id), eq(projectTasks.revision, input.expectedRevision)))
    .returning();

  if (!row) throw new StaleUpdateError("task");

  await recordAuditEvent(db, { eventType: "project_task_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_task", targetId: task.id, metadata: { fields: Object.keys(input.updates) } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: task.projectId, eventType: "project_task_updated", actorUserId: input.actorUserId, targetType: "project_task", targetId: task.id, metadata: { fields: Object.keys(input.updates) } });

  return toTask(row);
}

const TASK_TRANSITIONS: Record<ProjectTaskStatus, ProjectTaskStatus[]> = {
  backlog: ["ready", "cancelled"],
  ready: ["backlog", "in_progress", "cancelled"],
  in_progress: ["blocked", "review", "completed", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  review: ["in_progress", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export interface TransitionTaskInput {
  organizationId: string;
  taskId: string;
  toStatus: ProjectTaskStatus;
  expectedRevision: number;
  actorUserId: string;
}

export async function transitionTaskStatus(db: Db, input: TransitionTaskInput): Promise<ProjectTask> {
  const task = await resolveTaskById(db, input.organizationId, input.taskId);
  const project = await resolveProjectById(db, input.organizationId, task.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  const isAssignee = await isTaskAssignee(db, task.id, input.actorUserId);
  await requireTaskUpdateAuthority(db, ctx, project.id, isAssignee);

  const legalTargets = TASK_TRANSITIONS[task.status] ?? [];
  if (!legalTargets.includes(input.toStatus)) {
    throw new InvalidTaskTransitionError(task.status, input.toStatus);
  }

  if (input.toStatus === "completed") {
    const unresolved = await getUnresolvedBlockingTaskIds(db, input.organizationId, task.id);
    if (unresolved.length > 0) throw new UnresolvedDependenciesError(unresolved.length);
  }

  const extra: Record<string, unknown> = {};
  if (input.toStatus === "completed") extra.completedAt = new Date();

  const [row] = await db
    .update(projectTasks)
    .set({ status: input.toStatus, ...extra, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(projectTasks.id, task.id), eq(projectTasks.revision, input.expectedRevision), eq(projectTasks.status, task.status)))
    .returning();

  if (!row) throw new InvalidTaskTransitionError(task.status, input.toStatus);

  await recordAuditEvent(db, { eventType: "project_task_status_changed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_task", targetId: task.id, metadata: { from: task.status, to: input.toStatus } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: task.projectId, eventType: "project_task_status_changed", actorUserId: input.actorUserId, targetType: "project_task", targetId: task.id, metadata: { from: task.status, to: input.toStatus } });

  return toTask(row);
}

// ---------------------------------------------------------------------------
// Task assignments — human members only. Agent involvement is represented
// entirely by `project_execution_links` (see `links.ts`), never a row
// here — "do not represent agents as human project members."
// ---------------------------------------------------------------------------

export interface ProjectTaskAssignment {
  id: string;
  taskId: string;
  userId: string;
  name: string | null;
  email: string;
  createdAt: Date;
}

export async function assignTask(db: Db, input: { organizationId: string; taskId: string; targetUserId: string; actorUserId: string }): Promise<ProjectTaskAssignment> {
  const task = await resolveTaskById(db, input.organizationId, input.taskId);
  const project = await resolveProjectById(db, input.organizationId, task.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectContentAuthority(db, ctx, project.id);

  await requireOrganizationMembership(db, input.organizationId, input.targetUserId);

  let row;
  try {
    [row] = await db
      .insert(projectTaskAssignments)
      .values({ id: randomUUID(), organizationId: input.organizationId, taskId: task.id, userId: input.targetUserId, assignedByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateTaskAssignmentError();
    throw err;
  }

  const [user] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, input.targetUserId));

  await recordAuditEvent(db, { eventType: "project_task_assigned", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_task", targetId: task.id, metadata: { assigneeUserId: input.targetUserId } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: task.projectId, eventType: "project_task_assigned", actorUserId: input.actorUserId, targetType: "project_task", targetId: task.id, metadata: { assigneeUserId: input.targetUserId } });

  return { id: row.id, taskId: task.id, userId: input.targetUserId, name: user?.name ?? null, email: user?.email ?? "", createdAt: row.createdAt };
}

export async function unassignTask(db: Db, input: { organizationId: string; taskId: string; targetUserId: string; actorUserId: string }): Promise<void> {
  const task = await resolveTaskById(db, input.organizationId, input.taskId);
  const project = await resolveProjectById(db, input.organizationId, task.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectContentAuthority(db, ctx, project.id);

  const [existing] = await db.select().from(projectTaskAssignments).where(and(eq(projectTaskAssignments.taskId, task.id), eq(projectTaskAssignments.userId, input.targetUserId)));
  if (!existing) throw new TenantResourceNotFoundError();

  await db.delete(projectTaskAssignments).where(eq(projectTaskAssignments.id, existing.id));

  await recordAuditEvent(db, { eventType: "project_task_assignment_removed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_task", targetId: task.id, metadata: { assigneeUserId: input.targetUserId } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: task.projectId, eventType: "project_task_assignment_removed", actorUserId: input.actorUserId, targetType: "project_task", targetId: task.id, metadata: { assigneeUserId: input.targetUserId } });
}

export async function listTaskAssignments(db: Db, taskId: string): Promise<ProjectTaskAssignment[]> {
  const rows = await db
    .select({ id: projectTaskAssignments.id, userId: projectTaskAssignments.userId, name: users.name, email: users.email, createdAt: projectTaskAssignments.createdAt })
    .from(projectTaskAssignments)
    .innerJoin(users, eq(users.id, projectTaskAssignments.userId))
    .where(eq(projectTaskAssignments.taskId, taskId));
  return rows.map((r) => ({ id: r.id, taskId, userId: r.userId, name: r.name, email: r.email, createdAt: r.createdAt }));
}
