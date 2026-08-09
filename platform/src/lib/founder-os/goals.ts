import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq, desc } from "drizzle-orm";
import { founderGoals } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveFounderAuthContext, requireFounderViewAuthority, requireFounderManageGoalsAuthority } from "./authz";
import { StaleFounderUpdateError, UnknownGoalMetricError, InvalidRelatedRecordError } from "./errors";
import { titleSchema, type FounderGoalStatus } from "./validation";
import { resolveMetric } from "@/lib/analytics-os/metrics/registry";
import { runAnalyticsQuery } from "@/lib/analytics-os/query";
import { UnknownMetricError } from "@/lib/analytics-os/errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface FounderGoal {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  title: string;
  metricKey: string;
  targetValue: string;
  periodStart: Date;
  periodEnd: Date;
  ownerUserId: string;
  status: FounderGoalStatus;
  relatedSalesTargetId: string | null;
  revision: number;
}

function assertKnownMetric(metricKey: string): void {
  try {
    resolveMetric(metricKey);
  } catch (err) {
    if (err instanceof UnknownMetricError) throw new UnknownGoalMetricError(metricKey);
    throw err;
  }
}

export async function createFounderGoal(
  db: Db,
  input: { organizationId: string; workspaceId?: string | null; title: string; metricKey: string; targetValue: number; periodStart: Date; periodEnd: Date; ownerUserId: string; relatedSalesTargetId?: string | null; actorUserId: string }
): Promise<FounderGoal> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderManageGoalsAuthority(db, ctx, "founder_goal", "new");

  const title = titleSchema.parse(input.title);
  assertKnownMetric(input.metricKey);

  const [row] = await db
    .insert(founderGoals)
    .values({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId ?? null,
      title,
      metricKey: input.metricKey,
      targetValue: String(input.targetValue),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      ownerUserId: input.ownerUserId,
      relatedSalesTargetId: input.relatedSalesTargetId ?? null,
      createdByUserId: input.actorUserId,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "founder_goal_created", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "founder_goal", targetId: row.id, metadata: { metricKey: input.metricKey } });
  return row as unknown as FounderGoal;
}

export async function listFounderGoals(db: Db, input: { organizationId: string; actorUserId: string }): Promise<FounderGoal[]> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, ctx, "founder_goal", input.organizationId);
  const rows = await db.select().from(founderGoals).where(eq(founderGoals.organizationId, input.organizationId)).orderBy(desc(founderGoals.periodEnd));
  return rows as unknown as FounderGoal[];
}

async function loadGoalRow(db: Db, organizationId: string, goalId: string): Promise<FounderGoal> {
  const [row] = await db.select().from(founderGoals).where(and(eq(founderGoals.id, goalId), eq(founderGoals.organizationId, organizationId)));
  if (!row) throw new InvalidRelatedRecordError("goal");
  return row as unknown as FounderGoal;
}

export async function updateFounderGoal(
  db: Db,
  input: { organizationId: string; goalId: string; expectedRevision: number; title?: string; targetValue?: number; status?: FounderGoalStatus; actorUserId: string }
): Promise<FounderGoal> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderManageGoalsAuthority(db, ctx, "founder_goal", input.goalId);

  const values: Record<string, unknown> = { revision: input.expectedRevision + 1, updatedAt: new Date() };
  if (input.title !== undefined) values.title = titleSchema.parse(input.title);
  if (input.targetValue !== undefined) values.targetValue = String(input.targetValue);
  if (input.status !== undefined) values.status = input.status;

  const [row] = await db
    .update(founderGoals)
    .set(values)
    .where(and(eq(founderGoals.id, input.goalId), eq(founderGoals.organizationId, input.organizationId), eq(founderGoals.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleFounderUpdateError("goal");

  await recordAuditEvent(db, { eventType: input.status === "completed" ? "founder_goal_completed" : "founder_goal_updated", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "founder_goal", targetId: row.id, metadata: {} });
  return row as unknown as FounderGoal;
}

export interface FounderGoalProgress {
  goal: FounderGoal;
  currentValue: number | null;
  progressRatio: number | null;
}

/** Current value is always DERIVED live from Analytics OS — never stored on the goal row itself. */
export async function computeFounderGoalProgress(db: Db, input: { organizationId: string; goalId: string; actorUserId: string }): Promise<FounderGoalProgress> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, ctx, "founder_goal", input.goalId);

  const goal = await loadGoalRow(db, input.organizationId, input.goalId);
  const result = await runAnalyticsQuery(db, {
    organizationId: input.organizationId,
    workspaceId: goal.workspaceId,
    actorUserId: input.actorUserId,
    metricKeys: [goal.metricKey],
    dateRangeStrategy: "custom",
    customFrom: goal.periodStart,
    customTo: goal.periodEnd,
    comparisonStrategy: "none",
    recordAudit: false,
  });

  const currentValue = result.metrics[0]?.current.points[0]?.value ?? null;
  const target = Number(goal.targetValue);
  const progressRatio = currentValue !== null && target > 0 ? Math.round((currentValue / target) * 1000) / 1000 : null;
  return { goal, currentValue, progressRatio };
}
