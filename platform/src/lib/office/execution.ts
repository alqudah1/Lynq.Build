import "server-only";

import { and, eq } from "drizzle-orm";
import { generateText } from "ai";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { projectExecutionLinks } from "@/db/schema";
import { resolveAgentById } from "@/lib/agents/agents";
import { createArtifact, listArtifactsForExecution } from "@/lib/agent-runtime/artifacts";
import { listCheckpointsForExecution } from "@/lib/agent-runtime/checkpoints";
import { resolveExecutionById, type AgentExecutionStatus } from "@/lib/agent-runtime/executions";
import { advanceExecution, completeExecution } from "@/lib/agent-runtime/lifecycle";
import { completePlanStep, getLatestPlan, getPlanSteps } from "@/lib/agent-runtime/plans";
import { listArtifactLinks, linkArtifactToEntity } from "@/lib/projects/links";
import { resolveTaskById, transitionTaskStatus } from "@/lib/projects/tasks";
import { getAgentOfficeIdentity } from "./view";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export async function isOfficeDirectiveExecution(db: Db, organizationId: string, executionId: string): Promise<boolean> {
  const checkpoints = await listCheckpointsForExecution(db, organizationId, executionId);
  return checkpoints.some((checkpoint) => checkpoint.safeStateSummary.officeDirectiveExecution === true);
}

async function advanceIfAt(db: Db, organizationId: string, executionId: string, agentId: string, from: AgentExecutionStatus, to: AgentExecutionStatus): Promise<void> {
  const current = await resolveExecutionById(db, organizationId, executionId);
  if (current.status === from) {
    await advanceExecution(db, { organizationId, executionId, actorAgentId: agentId, toStatus: to });
  }
}

function completed(stepNumber: number, statuses: Map<number, string>): boolean {
  return statuses.get(stepNumber) === "completed";
}

export async function continueOfficeDirectiveExecution(db: Db, input: { organizationId: string; executionId: string }) {
  const execution = await resolveExecutionById(db, input.organizationId, input.executionId);
  if (!execution.assignedAgentId) throw new Error("office execution has no assigned employee");
  if (execution.status === "completed") return execution;
  if (["failed", "cancelled", "archived"].includes(execution.status)) throw new Error(`office execution is terminal: ${execution.status}`);

  const agent = await resolveAgentById(db, execution.assignedAgentId);
  if (!agent || agent.organizationId !== input.organizationId) throw new Error("assigned employee is unavailable");
  const plan = await getLatestPlan(db, execution.id);
  if (!plan) throw new Error("office execution has no durable plan");
  const planSteps = await getPlanSteps(db, plan.id);
  const statuses = new Map(planSteps.map((step) => [step.stepNumber, step.status]));

  await advanceIfAt(db, input.organizationId, execution.id, agent.id, "planning", "reasoning");
  if (!completed(1, statuses)) {
    await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 1, actorAgentId: agent.id });
    statuses.set(1, "completed");
  }
  await advanceIfAt(db, input.organizationId, execution.id, agent.id, "reasoning", "executing");

  let artifact = (await listArtifactsForExecution(db, input.organizationId, execution.id))
    .filter((item) => item.artifactType === "report")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  if (!artifact) {
    if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
      throw new Error("AI Gateway is not available for Office employee execution");
    }
    const identity = getAgentOfficeIdentity(agent);
    const result = await generateText({
      model: "openai/gpt-5.6-sol",
      system:
        `You are the ${identity.title} at LYNQ. Produce the actual workstream deliverable requested by the founder. ` +
        "Be concrete and decision-oriented. State assumptions and missing inputs honestly. Coordinate by ending with a concise handoff for the Executive Assistant and other departments. " +
        "Do not claim that external actions, code changes, purchases, messages, deployments, or approvals occurred unless the supplied context proves they did. Return polished Markdown only; do not expose hidden reasoning.",
      prompt: JSON.stringify({
        employee: { name: agent.name, title: identity.title, department: agent.department, purpose: agent.purpose, responsibilities: agent.responsibilities },
        workstream: { goal: execution.goal, successCriteria: execution.successCriteria, failureCriteria: execution.failureCriteria },
        requestedSections: ["Executive summary", "Decisions and recommendations", "Deliverable", "Dependencies and risks", "Next actions", "Handoff"],
      }),
    });
    const content = result.text.trim();
    if (!content) throw new Error("Office employee produced an empty deliverable");
    artifact = await createArtifact(db, {
      organizationId: input.organizationId,
      executionId: execution.id,
      artifactType: "report",
      title: `${identity.title} workstream`.slice(0, 300),
      content: content.slice(0, 20_000),
      actorAgentId: agent.id,
    });
  }

  if (!completed(2, statuses)) {
    await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 2, actorAgentId: agent.id });
    statuses.set(2, "completed");
  }
  if (!artifact.content) throw new Error("office deliverable has no reviewable content");
  if (!completed(3, statuses)) {
    await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 3, actorAgentId: agent.id });
    statuses.set(3, "completed");
  }

  const [link] = await db
    .select({ projectId: projectExecutionLinks.projectId, taskId: projectExecutionLinks.taskId })
    .from(projectExecutionLinks)
    .where(and(eq(projectExecutionLinks.executionId, execution.id), eq(projectExecutionLinks.organizationId, input.organizationId)));
  if (link) {
    const existingLinks = await listArtifactLinks(db, { organizationId: input.organizationId, projectId: link.projectId, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });
    if (!existingLinks.some((item) => item.artifactId === artifact.id)) {
      await linkArtifactToEntity(db, { organizationId: input.organizationId, projectId: link.projectId, artifactId: artifact.id, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });
    }
    const task = await resolveTaskById(db, input.organizationId, link.taskId);
    if (task.status === "in_progress") {
      await transitionTaskStatus(db, { organizationId: input.organizationId, taskId: task.id, toStatus: "review", expectedRevision: task.revision, actorUserId: execution.ownerUserId });
    }
  }

  if (!completed(4, statuses)) {
    await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 4, actorAgentId: agent.id });
  }
  await advanceIfAt(db, input.organizationId, execution.id, agent.id, "executing", "verifying");
  const current = await resolveExecutionById(db, input.organizationId, execution.id);
  return current.status === "verifying"
    ? completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id })
    : current;
}
