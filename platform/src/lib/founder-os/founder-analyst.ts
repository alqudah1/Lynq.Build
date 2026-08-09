import "server-only";
import { and, eq, gte } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agents, agentExecutions } from "@/db/schema";
import { registerAgent, resolveAgentById, type Agent } from "@/lib/agents/agents";
import { advanceAgentLifecycleStage, changeAgentPermissionLevel } from "@/lib/agents/lifecycle";
import { createExecution, type AgentExecution } from "@/lib/agent-runtime/executions";
import { assignExecution, startExecution, advanceExecution, completeExecution } from "@/lib/agent-runtime/lifecycle";
import { createPlan, completePlanStep } from "@/lib/agent-runtime/plans";
import { createArtifact, listArtifactsForExecution, type AgentArtifact } from "@/lib/agent-runtime/artifacts";
import { registerAgentTaskHandler, resolveReportArtifactTaskState } from "@/lib/agent-runtime/task-handlers";
import { recordAuditEvent } from "@/lib/audit";
import { computeDailyBrief, formatDailyBriefAsText } from "./daily-brief";
import { FounderAgentNotSeededError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Founder Analyst — Module 18
 * ============================================================================
 * One narrow agent, one task type (`founder_company_brief`). Fully
 * deterministic: the task's own body is exactly `computeDailyBrief`
 * (already-real, already-tested), formatted into a bounded `report`
 * artifact — no LLM call, no free-text reasoning, no tool invocation. This
 * agent may NEVER mutate CRM/Sales/Marketing/Communications/Projects/
 * permissions — structurally true here because this task type's own code
 * path only ever READS (`computeDailyBrief`, `computeCompanyPulse`,
 * `computeAttentionItems`, `listFounderApprovals` are all pure reads) and
 * WRITES exactly one thing: its own `report` artifact, the same narrow
 * "assistant"-level capability the Company Knowledge Analyst (Module 8)
 * already established as the precedent for a reporting-only agent.
 */
export const FOUNDER_ANALYST_NAME = "Founder Analyst";

export async function seedFounderAnalystAgent(db: Db, input: { organizationId: string; humanOwnerUserId: string; actorUserId: string }): Promise<Agent> {
  const [existingRow] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, input.organizationId), eq(agents.name, FOUNDER_ANALYST_NAME)));
  if (existingRow) return (await resolveAgentById(db, existingRow.id))!;

  const agent = await registerAgent(db, {
    organizationId: input.organizationId,
    name: FOUNDER_ANALYST_NAME,
    humanOwnerUserId: input.humanOwnerUserId,
    permissionLevel: "assistant",
    actorUserId: input.actorUserId,
    department: "founders_office",
    purpose: "Produce a deterministic, evidence-backed executive daily brief for the Founder Workspace — decision SUPPORT only, never an autonomous action.",
    responsibilities: "Read explicitly permitted executive Analytics data, bounded cross-module summaries, and the real attention/approval queues, and assemble them into a structured report artifact — never invent a figure not backed by a real canonical record.",
    goals: "Every number in its report is mechanically traceable to a real Analytics OS metric or canonical record it was permitted to read during that same execution.",
    inputs: "An organization id and optional workspace id.",
    outputs: "One `report` artifact per task: company snapshot, day-over-day changes, attention items, pending approvals, and suggested (never autonomous) actions.",
    successCriteria: "The report artifact is created and the execution reaches `completed` through the real Runtime completion gate.",
    failureCriteria: "The daily brief computation itself fails (e.g. an underlying Analytics query error).",
    retirementCriteria: "Superseded by a broader executive analyst agent, or Founder Workspace's own daily brief feature is retired.",
  });

  for (const toStage of ["specification", "development", "testing", "approval", "deployment"] as const) {
    await advanceAgentLifecycleStage(db, { organizationId: input.organizationId, agentId: agent.id, toStage, actorUserId: input.actorUserId });
  }
  await changeAgentPermissionLevel(db, { organizationId: input.organizationId, agentId: agent.id, newPermissionLevel: "assistant", reason: "Founder Workspace (Module 18) — 'assistant' is the minimum permission level artifact creation requires; this agent is never granted write capability to any operational system.", actorUserId: input.actorUserId });
  return agent;
}

export async function resolveFounderAnalystAgent(db: Db, organizationId: string): Promise<Agent> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.name, FOUNDER_ANALYST_NAME)));
  if (!row) throw new FounderAgentNotSeededError();
  return (await resolveAgentById(db, row.id))!;
}

const PLAN_STEPS = ["Compute the deterministic daily brief", "Create the report artifact", "Verify completion evidence"];

export interface FounderBriefTaskResult {
  execution: AgentExecution;
  artifact: AgentArtifact;
  reusedExisting: boolean;
}

/**
 * Idempotent within a calendar day (UTC): if the Founder Analyst already
 * has an execution for this organization created today, that execution is
 * returned as-is rather than launching a second one — the practical
 * "duplicate daily brief generation" guard the spec asks for. This is an
 * application-level read-then-create check, not a database-level unique
 * constraint (no existing schema column supports one) — documented
 * explicitly as the exact guarantee level in the final report: safe
 * against a repeated/accidental call, not a hardened defense against two
 * literally simultaneous requests racing the same millisecond.
 */
export async function launchFounderCompanyBriefTask(db: Db, input: { organizationId: string; workspaceId: string | null; ownerUserId: string; actorUserId: string }): Promise<FounderBriefTaskResult> {
  const agent = await resolveFounderAnalystAgent(db, input.organizationId);

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const [existingExecution] = await db
    .select()
    .from(agentExecutions)
    .where(and(eq(agentExecutions.organizationId, input.organizationId), eq(agentExecutions.assignedAgentId, agent.id), gte(agentExecutions.createdAt, startOfToday)))
    .limit(1);

  if (existingExecution) {
    const artifacts = await listArtifactsForExecution(db, input.organizationId, existingExecution.id);
    const report = artifacts.filter((a) => a.artifactType === "report").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (report) return { execution: existingExecution as AgentExecution, artifact: report, reusedExisting: true };
    // An execution exists today but has no report yet (e.g. it failed before creating one) — fall through and drive a fresh one rather than returning an incomplete result.
  }

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? undefined,
    ownerUserId: input.ownerUserId,
    goal: `Generate the Founder daily brief for ${input.organizationId}`,
    successCriteria: "A report artifact containing the deterministic daily brief exists",
    failureCriteria: "The daily brief computation fails",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });

  await recordAuditEvent(db, { eventType: "founder_agent_task_started", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "agent_execution", targetId: execution.id, metadata: { taskType: "founder_company_brief" } });

  await assignExecution(db, { organizationId: input.organizationId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: input.actorUserId });
  await startExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorUserId: input.actorUserId });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "planning", actorAgentId: agent.id });
  const { plan } = await createPlan(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id, steps: PLAN_STEPS });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "reasoning", actorAgentId: agent.id });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "executing", actorAgentId: agent.id });

  const brief = await computeDailyBrief(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, actorUserId: input.actorUserId });
  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 1, actorAgentId: agent.id });

  const artifact = await createArtifact(db, {
    organizationId: input.organizationId,
    executionId: execution.id,
    artifactType: "report",
    title: `Founder Daily Brief — ${new Date().toISOString().slice(0, 10)}`,
    content: formatDailyBriefAsText(brief),
    actorAgentId: agent.id,
  });
  await recordAuditEvent(db, { eventType: "founder_agent_artifact_created", organizationId: input.organizationId, actorAgentId: agent.id, targetType: "agent_artifact", targetId: artifact.id, metadata: { executionId: execution.id } });
  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 2, actorAgentId: agent.id });

  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "verifying", actorAgentId: agent.id });
  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 3, actorAgentId: agent.id });

  const completed = await completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id });
  await recordAuditEvent(db, { eventType: "founder_daily_brief_generated", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "agent_execution", targetId: execution.id, metadata: { artifactId: artifact.id } });

  return { execution: completed, artifact, reusedExisting: false };
}

registerAgentTaskHandler({
  taskType: "founder_company_brief",
  expectedAgentName: FOUNDER_ANALYST_NAME,
  isAgentEligible: (agent) => agent.name === FOUNDER_ANALYST_NAME && agent.lifecycleStage !== "retired",
  launch: async (db, input) => {
    const result = await launchFounderCompanyBriefTask(db as Db, { organizationId: input.organizationId, workspaceId: input.workspaceId, ownerUserId: input.actorUserId, actorUserId: input.actorUserId });
    return { runtimeExecutionId: result.execution.id };
  },
  resolveState: (db, input) => resolveReportArtifactTaskState(db as Db, "founder_company_brief", input),
});
