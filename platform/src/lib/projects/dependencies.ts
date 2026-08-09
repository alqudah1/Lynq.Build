import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { projectTaskDependencies, projectTasks } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveProjectById } from "./projects";
import { resolveProjectAuthContext, requireProjectContentAuthority } from "./authz";
import { recordProjectEvent } from "./events";
import { SelfDependencyError, DuplicateDependencyError, DependencyCycleError, CrossProjectDependencyError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const MAX_TRAVERSAL_NODES = 2000;

export interface ProjectTaskDependency {
  id: string;
  blockedTaskId: string;
  blockingTaskId: string;
  createdAt: Date;
}

function toDependency(row: typeof projectTaskDependencies.$inferSelect): ProjectTaskDependency {
  return { id: row.id, blockedTaskId: row.blockedTaskId, blockingTaskId: row.blockingTaskId, createdAt: row.createdAt };
}

/**
 * Bounded BFS: would adding edge `blockingTaskId -> blockedTaskId`
 * (blockingTaskId blocks blockedTaskId) create a cycle? True exactly
 * when `blockedTaskId` can already (directly or transitively) reach
 * `blockingTaskId` by following existing "blocks" edges forward — i.e.
 * the new blocked task already blocks its would-be blocker. Bounded to
 * `MAX_TRAVERSAL_NODES` visited edges, appropriate for a single
 * project's task graph.
 */
async function wouldCreateCycle(db: Db, organizationId: string, blockedTaskId: string, blockingTaskId: string): Promise<boolean> {
  const visited = new Set<string>([blockedTaskId]);
  let frontier = [blockedTaskId];
  let examined = 0;

  while (frontier.length > 0 && examined < MAX_TRAVERSAL_NODES) {
    const rows = await db
      .select({ blockedTaskId: projectTaskDependencies.blockedTaskId, blockingTaskId: projectTaskDependencies.blockingTaskId })
      .from(projectTaskDependencies)
      .where(and(eq(projectTaskDependencies.organizationId, organizationId), inArray(projectTaskDependencies.blockingTaskId, frontier)));
    examined += rows.length;

    const next: string[] = [];
    for (const row of rows) {
      if (row.blockedTaskId === blockingTaskId) return true;
      if (!visited.has(row.blockedTaskId)) {
        visited.add(row.blockedTaskId);
        next.push(row.blockedTaskId);
      }
    }
    frontier = next;
  }
  return false;
}

export interface AddDependencyInput {
  organizationId: string;
  blockedTaskId: string;
  blockingTaskId: string;
  actorUserId: string;
}

export async function addDependency(db: Db, input: AddDependencyInput): Promise<ProjectTaskDependency> {
  if (input.blockedTaskId === input.blockingTaskId) throw new SelfDependencyError();

  const [blocked] = await db.select().from(projectTasks).where(and(eq(projectTasks.id, input.blockedTaskId), eq(projectTasks.organizationId, input.organizationId)));
  const [blocking] = await db.select().from(projectTasks).where(and(eq(projectTasks.id, input.blockingTaskId), eq(projectTasks.organizationId, input.organizationId)));
  if (!blocked || !blocking) throw new TenantResourceNotFoundError();
  if (blocked.projectId !== blocking.projectId) throw new CrossProjectDependencyError();

  const project = await resolveProjectById(db, input.organizationId, blocked.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectContentAuthority(db, ctx, project.id);

  if (await wouldCreateCycle(db, input.organizationId, input.blockedTaskId, input.blockingTaskId)) {
    throw new DependencyCycleError();
  }

  let row;
  try {
    [row] = await db
      .insert(projectTaskDependencies)
      .values({ id: randomUUID(), organizationId: input.organizationId, blockedTaskId: input.blockedTaskId, blockingTaskId: input.blockingTaskId, createdByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateDependencyError();
    throw err;
  }

  await recordAuditEvent(db, { eventType: "project_task_dependency_added", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_task_dependency", targetId: row.id, metadata: { blockedTaskId: input.blockedTaskId, blockingTaskId: input.blockingTaskId } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_task_dependency_added", actorUserId: input.actorUserId, targetType: "project_task", targetId: input.blockedTaskId, metadata: { blockingTaskId: input.blockingTaskId } });

  return toDependency(row);
}

export async function removeDependency(db: Db, input: { organizationId: string; dependencyId: string; actorUserId: string }): Promise<void> {
  const [existing] = await db.select().from(projectTaskDependencies).where(and(eq(projectTaskDependencies.id, input.dependencyId), eq(projectTaskDependencies.organizationId, input.organizationId)));
  if (!existing) throw new TenantResourceNotFoundError();

  const [blocked] = await db.select({ projectId: projectTasks.projectId }).from(projectTasks).where(eq(projectTasks.id, existing.blockedTaskId));
  if (!blocked) throw new TenantResourceNotFoundError();

  const project = await resolveProjectById(db, input.organizationId, blocked.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectContentAuthority(db, ctx, project.id);

  await db.delete(projectTaskDependencies).where(eq(projectTaskDependencies.id, existing.id));

  await recordAuditEvent(db, { eventType: "project_task_dependency_removed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_task_dependency", targetId: existing.id, metadata: { blockedTaskId: existing.blockedTaskId, blockingTaskId: existing.blockingTaskId } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_task_dependency_removed", actorUserId: input.actorUserId, targetType: "project_task", targetId: existing.blockedTaskId, metadata: { blockingTaskId: existing.blockingTaskId } });
}

export interface TaskDependencies {
  blocks: ProjectTaskDependency[];
  blockedBy: ProjectTaskDependency[];
}

/** "blocks"/"blocked_by" are both derived views over the one canonical edge direction — never stored twice. */
export async function listDependenciesForTask(db: Db, organizationId: string, taskId: string): Promise<TaskDependencies> {
  const [blocks, blockedBy] = await Promise.all([
    db.select().from(projectTaskDependencies).where(and(eq(projectTaskDependencies.organizationId, organizationId), eq(projectTaskDependencies.blockingTaskId, taskId))),
    db.select().from(projectTaskDependencies).where(and(eq(projectTaskDependencies.organizationId, organizationId), eq(projectTaskDependencies.blockedTaskId, taskId))),
  ]);
  return { blocks: blocks.map(toDependency), blockedBy: blockedBy.map(toDependency) };
}

/** Completion eligibility: a blocking task counts as unresolved unless it has actually reached `completed` — a cancelled blocker still requires the dependency to be explicitly removed, never silently treated as satisfied. */
export async function getUnresolvedBlockingTaskIds(db: Db, organizationId: string, taskId: string): Promise<string[]> {
  const edges = await db.select({ blockingTaskId: projectTaskDependencies.blockingTaskId }).from(projectTaskDependencies).where(and(eq(projectTaskDependencies.organizationId, organizationId), eq(projectTaskDependencies.blockedTaskId, taskId)));
  if (edges.length === 0) return [];

  const blockingIds = edges.map((e) => e.blockingTaskId);
  const blockingTasks = await db.select({ id: projectTasks.id, status: projectTasks.status }).from(projectTasks).where(inArray(projectTasks.id, blockingIds));
  return blockingTasks.filter((t) => t.status !== "completed").map((t) => t.id);
}
