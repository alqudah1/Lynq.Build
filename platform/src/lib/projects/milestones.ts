import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { projectMilestones } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveProjectById } from "./projects";
import { resolveProjectAuthContext, requireProjectContentAuthority, requireProjectViewAuthority } from "./authz";
import { recordProjectEvent } from "./events";
import { StaleUpdateError } from "./errors";
import type { ProjectMilestoneStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface ProjectMilestone {
  id: string;
  projectId: string;
  phaseId: string | null;
  title: string;
  description: string | null;
  status: ProjectMilestoneStatus;
  targetDate: Date | null;
  completedAt: Date | null;
  ownerUserId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

function toMilestone(row: typeof projectMilestones.$inferSelect): ProjectMilestone {
  return {
    id: row.id,
    projectId: row.projectId,
    phaseId: row.phaseId,
    title: row.title,
    description: row.description,
    status: row.status,
    targetDate: row.targetDate,
    completedAt: row.completedAt,
    ownerUserId: row.ownerUserId,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateMilestoneInput {
  organizationId: string;
  projectId: string;
  phaseId?: string | null;
  title: string;
  description?: string | null;
  targetDate?: Date | null;
  ownerUserId?: string | null;
  actorUserId: string;
}

export async function createMilestone(db: Db, input: CreateMilestoneInput): Promise<ProjectMilestone> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectContentAuthority(db, ctx, project.id);

  const [row] = await db
    .insert(projectMilestones)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: project.id,
      phaseId: input.phaseId ?? null,
      title: input.title,
      description: input.description ?? null,
      targetDate: input.targetDate ?? null,
      ownerUserId: input.ownerUserId ?? null,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "project_milestone_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_milestone", targetId: row.id, metadata: { projectId: project.id, title: input.title } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_milestone_created", actorUserId: input.actorUserId, targetType: "project_milestone", targetId: row.id, metadata: { title: input.title } });

  return toMilestone(row);
}

export async function listMilestones(db: Db, input: { organizationId: string; projectId: string; actorUserId: string }): Promise<ProjectMilestone[]> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectViewAuthority(db, ctx, project.id);

  const rows = await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, project.id)).orderBy(desc(projectMilestones.targetDate));
  return rows.map(toMilestone);
}

export interface UpdateMilestoneInput {
  organizationId: string;
  projectId: string;
  milestoneId: string;
  expectedRevision: number;
  actorUserId: string;
  updates: { title?: string; description?: string | null; status?: ProjectMilestoneStatus; targetDate?: Date | null; phaseId?: string | null; ownerUserId?: string | null };
}

/**
 * Milestone completion is an explicit state transition here — never
 * derived from task percentages ("milestone completion must be based on
 * explicit state transition, not only task percentages"). Progress
 * against a milestone's linked tasks is a separate, read-only calculation
 * (`progress.ts`), never a substitute for this field.
 */
export async function updateMilestone(db: Db, input: UpdateMilestoneInput): Promise<ProjectMilestone> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectContentAuthority(db, ctx, project.id);

  const extra: Record<string, unknown> = {};
  if (input.updates.status === "completed") extra.completedAt = new Date();

  const [row] = await db
    .update(projectMilestones)
    .set({ ...input.updates, ...extra, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(projectMilestones.id, input.milestoneId), eq(projectMilestones.projectId, project.id), eq(projectMilestones.revision, input.expectedRevision)))
    .returning();

  if (!row) throw new StaleUpdateError("milestone");

  await recordAuditEvent(db, { eventType: "project_milestone_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_milestone", targetId: input.milestoneId, metadata: { fields: Object.keys(input.updates) } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_milestone_updated", actorUserId: input.actorUserId, targetType: "project_milestone", targetId: input.milestoneId, metadata: { fields: Object.keys(input.updates) } });

  return toMilestone(row);
}
