import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, asc, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { projectPhases } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveProjectById } from "./projects";
import { resolveProjectAuthContext, requireProjectContentAuthority, requireProjectViewAuthority } from "./authz";
import { recordProjectEvent } from "./events";
import { StaleUpdateError } from "./errors";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import type { ProjectPhaseStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const SEQUENCE_GAP = 1000;

export interface ProjectPhase {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  sequence: number;
  status: ProjectPhaseStatus;
  startDate: Date | null;
  targetDate: Date | null;
  completedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

function toPhase(row: typeof projectPhases.$inferSelect): ProjectPhase {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    sequence: row.sequence,
    status: row.status,
    startDate: row.startDate,
    targetDate: row.targetDate,
    completedAt: row.completedAt,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreatePhaseInput {
  organizationId: string;
  projectId: string;
  name: string;
  description?: string | null;
  startDate?: Date | null;
  targetDate?: Date | null;
  actorUserId: string;
}

export async function createPhase(db: Db, input: CreatePhaseInput): Promise<ProjectPhase> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectContentAuthority(db, ctx, project.id);

  const [last] = await db.select({ sequence: projectPhases.sequence }).from(projectPhases).where(eq(projectPhases.projectId, project.id)).orderBy(desc(projectPhases.sequence)).limit(1);
  const sequence = (last?.sequence ?? 0) + SEQUENCE_GAP;

  const [row] = await db
    .insert(projectPhases)
    .values({ id: randomUUID(), organizationId: input.organizationId, projectId: project.id, name: input.name, description: input.description ?? null, sequence, startDate: input.startDate ?? null, targetDate: input.targetDate ?? null })
    .returning();

  await recordAuditEvent(db, { eventType: "project_phase_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_phase", targetId: row.id, metadata: { projectId: project.id, name: input.name } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_phase_created", actorUserId: input.actorUserId, targetType: "project_phase", targetId: row.id, metadata: { name: input.name } });

  return toPhase(row);
}

export async function listPhases(db: Db, input: { organizationId: string; projectId: string; actorUserId: string }): Promise<ProjectPhase[]> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectViewAuthority(db, ctx, project.id);

  const rows = await db.select().from(projectPhases).where(eq(projectPhases.projectId, project.id)).orderBy(asc(projectPhases.sequence));
  return rows.map(toPhase);
}

export interface UpdatePhaseInput {
  organizationId: string;
  projectId: string;
  phaseId: string;
  expectedRevision: number;
  actorUserId: string;
  updates: { name?: string; description?: string | null; status?: ProjectPhaseStatus; startDate?: Date | null; targetDate?: Date | null };
}

export async function updatePhase(db: Db, input: UpdatePhaseInput): Promise<ProjectPhase> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectContentAuthority(db, ctx, project.id);

  const extra: Record<string, unknown> = {};
  if (input.updates.status === "completed") extra.completedAt = new Date();

  const [row] = await db
    .update(projectPhases)
    .set({ ...input.updates, ...extra, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(projectPhases.id, input.phaseId), eq(projectPhases.projectId, project.id), eq(projectPhases.revision, input.expectedRevision)))
    .returning();

  if (!row) throw new StaleUpdateError("phase");

  await recordAuditEvent(db, { eventType: "project_phase_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_phase", targetId: input.phaseId, metadata: { fields: Object.keys(input.updates) } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_phase_updated", actorUserId: input.actorUserId, targetType: "project_phase", targetId: input.phaseId, metadata: { fields: Object.keys(input.updates) } });

  return toPhase(row);
}

export interface ReorderPhaseInput {
  organizationId: string;
  projectId: string;
  phaseId: string;
  targetIndex: number;
  actorUserId: string;
}

/**
 * Gap-based reordering: the moved phase's OWN `sequence` becomes the
 * midpoint of its new neighbors — no other row is ever touched, so no
 * multi-row swap or deferred constraint is needed. Falls back to a full
 * renumber (fresh 1000-gaps) only when the gap between two neighbors has
 * been exhausted by prior moves, which a plain integer sequence will
 * eventually reach after enough consecutive re-inserts at the same spot.
 */
export async function reorderPhase(db: Db, input: ReorderPhaseInput): Promise<ProjectPhase[]> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectContentAuthority(db, ctx, project.id);

  const all = await db.select().from(projectPhases).where(eq(projectPhases.projectId, project.id)).orderBy(asc(projectPhases.sequence));
  const moving = all.find((p) => p.id === input.phaseId);
  if (!moving) throw new TenantResourceNotFoundError();

  const rest = all.filter((p) => p.id !== input.phaseId);
  const clampedIndex = Math.max(0, Math.min(input.targetIndex, rest.length));
  const before = rest[clampedIndex - 1];
  const after = rest[clampedIndex];

  let newSequence: number;
  if (!before && !after) newSequence = SEQUENCE_GAP;
  else if (!before) newSequence = after.sequence - SEQUENCE_GAP > 0 ? after.sequence - SEQUENCE_GAP : Math.floor(after.sequence / 2);
  else if (!after) newSequence = before.sequence + SEQUENCE_GAP;
  else newSequence = Math.floor((before.sequence + after.sequence) / 2);

  const gapExhausted = (before && newSequence <= before.sequence) || (after && newSequence >= after.sequence) || newSequence < 1;

  if (gapExhausted) {
    // Gap exhausted — renumber everything with fresh 1000-gaps, in the
    // already-desired order, then place the moved phase at its slot.
    const reordered = [...rest.slice(0, clampedIndex), moving, ...rest.slice(clampedIndex)];
    for (let i = 0; i < reordered.length; i++) {
      await db.update(projectPhases).set({ sequence: (i + 1) * SEQUENCE_GAP, revision: reordered[i].revision + 1, updatedAt: new Date() }).where(eq(projectPhases.id, reordered[i].id));
    }
  } else {
    const updated = await db
      .update(projectPhases)
      .set({ sequence: newSequence, revision: moving.revision + 1, updatedAt: new Date() })
      .where(and(eq(projectPhases.id, moving.id), eq(projectPhases.revision, moving.revision)))
      .returning();
    if (updated.length === 0) throw new StaleUpdateError("phase");
  }

  await recordAuditEvent(db, { eventType: "project_phase_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_phase", targetId: input.phaseId, metadata: { reordered: true } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_phase_updated", actorUserId: input.actorUserId, targetType: "project_phase", targetId: input.phaseId, metadata: { reordered: true } });

  const rows = await db.select().from(projectPhases).where(eq(projectPhases.projectId, project.id)).orderBy(asc(projectPhases.sequence));
  return rows.map(toPhase);
}
