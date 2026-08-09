import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentPlans, agentPlanSteps, agentExecutions } from "@/db/schema";
import { recordExecutionEvent } from "./events";
import { resolveExecutionById } from "./executions";
import { requireAssignedAgent } from "./authz";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * §4: "every material change to subtasks or dependencies produces a new
 * Plan version, retaining the prior one" — the identical
 * `knowledge_item_versions` discipline. A plan is never edited in place;
 * `createPlan` always inserts a brand-new row with the next
 * `versionNumber` for its execution. Bounded in size at the service
 * layer via `MAX_PLAN_STEPS`.
 */
const MAX_PLAN_STEPS = 50;

export interface AgentPlan {
  id: string;
  executionId: string;
  versionNumber: number;
  changeReason: string | null;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdByType: "human" | "agent";
  createdAt: Date;
}

function toPlan(row: typeof agentPlans.$inferSelect): AgentPlan {
  return {
    id: row.id,
    executionId: row.executionId,
    versionNumber: row.versionNumber,
    changeReason: row.changeReason,
    createdByUserId: row.createdByUserId,
    createdByAgentId: row.createdByAgentId,
    createdByType: row.createdByType,
    createdAt: row.createdAt,
  };
}

export interface AgentPlanStep {
  id: string;
  planId: string;
  stepNumber: number;
  description: string;
  status: "pending" | "completed" | "failed" | "skipped";
  relatedExecutionId: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

function toPlanStep(row: typeof agentPlanSteps.$inferSelect): AgentPlanStep {
  return {
    id: row.id,
    planId: row.planId,
    stepNumber: row.stepNumber,
    description: row.description,
    status: row.status,
    relatedExecutionId: row.relatedExecutionId,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

export interface CreatePlanInput {
  organizationId: string;
  executionId: string;
  steps: string[];
  changeReason?: string | null;
  actorAgentId: string;
}

/**
 * Creates the next plan version for an execution, with its initial set of
 * steps, all in one call — matching §4's "Plan (v1) → Subtasks +
 * Dependencies" single unit. Only the execution's own assigned agent may
 * plan for it (re-planning is this same function, called again with a
 * mandatory `changeReason`).
 */
export async function createPlan(db: Db, input: CreatePlanInput): Promise<{ plan: AgentPlan; steps: AgentPlanStep[] }> {
  const execution = await resolveExecutionById(db, input.organizationId, input.executionId);
  requireAssignedAgent(execution, input.actorAgentId);

  if (input.steps.length === 0 || input.steps.length > MAX_PLAN_STEPS) {
    throw new Error(`A plan must have between 1 and ${MAX_PLAN_STEPS} steps`);
  }

  const [latest] = await db.select({ versionNumber: agentPlans.versionNumber }).from(agentPlans).where(eq(agentPlans.executionId, input.executionId)).orderBy(desc(agentPlans.versionNumber)).limit(1);
  const versionNumber = (latest?.versionNumber ?? 0) + 1;

  if (versionNumber > 1 && !input.changeReason) {
    throw new Error("A re-plan (version > 1) requires a changeReason");
  }

  const planId = randomUUID();
  const [plan] = await db
    .insert(agentPlans)
    .values({
      id: planId,
      organizationId: input.organizationId,
      executionId: input.executionId,
      versionNumber,
      changeReason: input.changeReason ?? null,
      createdByAgentId: input.actorAgentId,
      createdByType: "agent",
    })
    .returning();

  const stepRows = await db
    .insert(agentPlanSteps)
    .values(
      input.steps.map((description, index) => ({
        id: randomUUID(),
        organizationId: input.organizationId,
        planId,
        stepNumber: index + 1,
        description,
      }))
    )
    .returning();

  await db.update(agentExecutions).set({ currentPlanId: planId, updatedAt: new Date() }).where(eq(agentExecutions.id, input.executionId));

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_plan_created",
    actorAgentId: input.actorAgentId,
    metadata: { versionNumber, stepCount: input.steps.length, changeReason: input.changeReason ?? null },
  });

  return { plan: toPlan(plan), steps: stepRows.map(toPlanStep) };
}

export async function getPlanSteps(db: Db, planId: string): Promise<AgentPlanStep[]> {
  const rows = await db.select().from(agentPlanSteps).where(eq(agentPlanSteps.planId, planId)).orderBy(agentPlanSteps.stepNumber);
  return rows.map(toPlanStep);
}

export async function getLatestPlan(db: Db, executionId: string): Promise<AgentPlan | null> {
  const [row] = await db.select().from(agentPlans).where(eq(agentPlans.executionId, executionId)).orderBy(desc(agentPlans.versionNumber)).limit(1);
  return row ? toPlan(row) : null;
}

async function setStepStatus(
  db: Db,
  input: { organizationId: string; executionId: string; planId: string; stepNumber: number; status: "completed" | "failed" | "skipped"; actorAgentId: string; relatedExecutionId?: string | null }
): Promise<AgentPlanStep> {
  const execution = await resolveExecutionById(db, input.organizationId, input.executionId);
  requireAssignedAgent(execution, input.actorAgentId);

  const [row] = await db
    .update(agentPlanSteps)
    .set({ status: input.status, completedAt: new Date(), ...(input.relatedExecutionId !== undefined ? { relatedExecutionId: input.relatedExecutionId } : {}) })
    .where(and(eq(agentPlanSteps.planId, input.planId), eq(agentPlanSteps.stepNumber, input.stepNumber)))
    .returning();

  if (!row) {
    throw new Error("Plan step not found");
  }

  // `agent_task_completed` covers every terminal step status (completed,
  // failed, skipped) — the specific outcome lives in `metadata.status`,
  // the same "one event name, status carried in metadata" judgment
  // already used elsewhere (e.g. Brain's `knowledge_item_archived`
  // reused across several source states).
  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_task_completed",
    actorAgentId: input.actorAgentId,
    metadata: { planId: input.planId, stepNumber: input.stepNumber, status: input.status },
  });

  return toPlanStep(row);
}

export async function completePlanStep(db: Db, input: { organizationId: string; executionId: string; planId: string; stepNumber: number; actorAgentId: string; relatedExecutionId?: string | null }): Promise<AgentPlanStep> {
  return setStepStatus(db, { ...input, status: "completed" });
}

export async function failPlanStep(db: Db, input: { organizationId: string; executionId: string; planId: string; stepNumber: number; actorAgentId: string }): Promise<AgentPlanStep> {
  return setStepStatus(db, { ...input, status: "failed" });
}
