import "server-only";

import { and, eq } from "drizzle-orm";
import { generateText } from "ai";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentApprovalRequests, agentArtifacts, projectArtifactLinks, projectExecutionLinks, projects } from "@/db/schema";
import { resolveAgentById } from "@/lib/agents/agents";
import { createArtifact, listArtifactsForExecution } from "@/lib/agent-runtime/artifacts";
import { requestApproval } from "@/lib/agent-runtime/approvals";
import { listCheckpointsForExecution } from "@/lib/agent-runtime/checkpoints";
import { resolveExecutionById, type AgentExecutionStatus } from "@/lib/agent-runtime/executions";
import { advanceExecution, completeExecution } from "@/lib/agent-runtime/lifecycle";
import { completePlanStep, getLatestPlan, getPlanSteps } from "@/lib/agent-runtime/plans";
import { getUnresolvedBlockingTaskIds } from "@/lib/projects/dependencies";
import { launchAgentForTask, listArtifactLinks, linkApprovalToEntity, linkArtifactToEntity } from "@/lib/projects/links";
import { resolveProjectById, transitionProjectStatus } from "@/lib/projects/projects";
import { listTasks, resolveTaskById, transitionTaskStatus } from "@/lib/projects/tasks";
import { executeEngineeringDelivery, inspectEngineeringDelivery, type EngineeringDeliveryResult } from "./engineering";
import { getDirectiveDomains } from "./directives";
import { parseOfficeTaskMetadata } from "./task-metadata";
import { getOfficeModel } from "./models";
import { getAgentOfficeIdentity } from "./view";
import { notifyJarvisApprovalNeeded } from "@/lib/email/jarvis-notifier";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const ENGINEERING_RESULT_START = "<!-- LYNQ_ENGINEERING_RESULT ";
const ENGINEERING_RESULT_END = " -->";

export async function isOfficeDirectiveExecution(db: Db, organizationId: string, executionId: string): Promise<boolean> {
  const checkpoints = await listCheckpointsForExecution(db, organizationId, executionId);
  return checkpoints.some((checkpoint) => checkpoint.safeStateSummary.officeDirectiveExecution === true);
}

async function advanceIfAt(db: Db, organizationId: string, executionId: string, agentId: string, from: AgentExecutionStatus, to: AgentExecutionStatus): Promise<void> {
  const current = await resolveExecutionById(db, organizationId, executionId);
  if (current.status === from) await advanceExecution(db, { organizationId, executionId, actorAgentId: agentId, toStatus: to });
}

function completed(stepNumber: number, statuses: Map<number, string>): boolean {
  return statuses.get(stepNumber) === "completed";
}

function engineeringMarker(result: EngineeringDeliveryResult): string {
  return `${ENGINEERING_RESULT_START}${JSON.stringify(result)}${ENGINEERING_RESULT_END}`;
}

function parseEngineeringResult(content: string | null): EngineeringDeliveryResult | null {
  if (!content) return null;
  const start = content.lastIndexOf(ENGINEERING_RESULT_START);
  const end = content.indexOf(ENGINEERING_RESULT_END, start + ENGINEERING_RESULT_START.length);
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(content.slice(start + ENGINEERING_RESULT_START.length, end)) as EngineeringDeliveryResult;
  } catch {
    return null;
  }
}

async function projectContext(db: Db, organizationId: string, projectId: string): Promise<string> {
  const [projectRows, artifactRows] = await Promise.all([
    db
      .select({ name: projects.name, description: projects.description, objective: projects.objective })
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId))),
    db
      .select({ title: agentArtifacts.title, content: agentArtifacts.content, artifactType: agentArtifacts.artifactType })
      .from(projectArtifactLinks)
      .innerJoin(agentArtifacts, eq(agentArtifacts.id, projectArtifactLinks.artifactId))
      .where(and(eq(projectArtifactLinks.organizationId, organizationId), eq(projectArtifactLinks.projectId, projectId))),
  ]);
  const project = projectRows[0];
  const projectBrief = project
    ? `# ${project.name} — project brief\n\n${project.description ?? "No project description recorded."}${project.objective ? `\n\n## Objective\n\n${project.objective}` : ""}`
    : "";
  const artifacts = artifactRows.map((row) => `# ${row.title} (${row.artifactType})\n\n${row.content ?? ""}`).join("\n\n---\n\n");
  return [projectBrief, artifacts].filter(Boolean).join("\n\n---\n\n").slice(0, 60_000);
}

async function latestEngineeringResult(db: Db, organizationId: string, projectId: string, createdAfter?: Date | null): Promise<EngineeringDeliveryResult | null> {
  const rows = await db
    .select({ content: agentArtifacts.content, createdAt: agentArtifacts.createdAt })
    .from(projectArtifactLinks)
    .innerJoin(agentArtifacts, eq(agentArtifacts.id, projectArtifactLinks.artifactId))
    .where(and(eq(projectArtifactLinks.organizationId, organizationId), eq(projectArtifactLinks.projectId, projectId)));
  for (const row of rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    if (createdAfter && row.createdAt <= createdAfter) continue;
    const parsed = parseEngineeringResult(row.content);
    if (parsed) return parsed;
  }
  return null;
}

async function makeTextArtifact(db: Db, input: { organizationId: string; executionId: string; agentId: string; projectContext: string; goal: string; successCriteria: string; title: string; modelRole: "planning" | "review" }) {
  const agent = await resolveAgentById(db, input.agentId);
  if (!agent) throw new Error("assigned employee is unavailable");
  const identity = getAgentOfficeIdentity(agent);
  const result = await generateText({
    model: getOfficeModel(input.modelRole),
    system: `You are the ${identity.title} at LYNQ. Produce the actual project deliverable. Be concrete, testable, and decision-oriented. Use prior project artifacts as shared memory. State missing evidence honestly. Do not claim external actions occurred unless context proves them. Return polished Markdown only.`,
    prompt: JSON.stringify({ goal: input.goal, successCriteria: input.successCriteria, sharedProjectContext: input.projectContext, requestedSections: ["Executive summary", "Scope and decisions", "Acceptance criteria", "Deliverable", "Dependencies and risks", "Handoff"] }),
  });
  if (!result.text.trim()) throw new Error("Office employee produced an empty deliverable");
  return createArtifact(db, { organizationId: input.organizationId, executionId: input.executionId, artifactType: "report", title: input.title, content: result.text.trim().slice(0, 20_000), actorAgentId: input.agentId });
}

async function dispatchReadyTasks(db: Db, input: { organizationId: string; projectId: string; actorUserId: string }) {
  const tasks = await listTasks(db, { organizationId: input.organizationId, projectId: input.projectId, actorUserId: input.actorUserId });
  for (const task of tasks) {
    if (task.status !== "backlog") continue;
    const metadata = parseOfficeTaskMetadata(task.description);
    if (!metadata) continue;
    if ((await getUnresolvedBlockingTaskIds(db, input.organizationId, task.id)).length > 0) continue;
    const ready = await transitionTaskStatus(db, { organizationId: input.organizationId, taskId: task.id, toStatus: "ready", expectedRevision: task.revision, actorUserId: input.actorUserId });
    const agent = await resolveAgentById(db, metadata.agentId);
    if (!agent) throw new Error("A queued Office employee is unavailable");
    await launchAgentForTask(db, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      taskId: task.id,
      agentId: agent.id,
      goal: metadata.goal,
      successCriteria: metadata.successCriteria,
      failureCriteria: "Stop and escalate if permissions, evidence, isolation, validation, or repository scope cannot be proven.",
      allowedDomains: getDirectiveDomains(agent),
      priority: 90,
      actorUserId: input.actorUserId,
    });
    await transitionTaskStatus(db, { organizationId: input.organizationId, taskId: task.id, toStatus: "in_progress", expectedRevision: ready.revision, actorUserId: input.actorUserId });
  }
}

async function completeTaskAndAdvance(db: Db, input: { organizationId: string; projectId: string; taskId: string; actorUserId: string }) {
  let task = await resolveTaskById(db, input.organizationId, input.taskId);
  if (task.status === "in_progress") task = await transitionTaskStatus(db, { organizationId: input.organizationId, taskId: task.id, toStatus: "review", expectedRevision: task.revision, actorUserId: input.actorUserId });
  if (task.status === "review") await transitionTaskStatus(db, { organizationId: input.organizationId, taskId: task.id, toStatus: "completed", expectedRevision: task.revision, actorUserId: input.actorUserId });
  await dispatchReadyTasks(db, input);
}

export async function continueOfficeDirectiveExecution(db: Db, input: { organizationId: string; executionId: string }) {
  let execution = await resolveExecutionById(db, input.organizationId, input.executionId);
  if (!execution.assignedAgentId) throw new Error("office execution has no assigned employee");
  if (execution.status === "completed") return execution;
  if (["failed", "cancelled", "archived"].includes(execution.status)) throw new Error(`office execution is terminal: ${execution.status}`);
  const agent = await resolveAgentById(db, execution.assignedAgentId);
  if (!agent || agent.organizationId !== input.organizationId) throw new Error("assigned employee is unavailable");
  const [link] = await db.select({ projectId: projectExecutionLinks.projectId, taskId: projectExecutionLinks.taskId }).from(projectExecutionLinks).where(and(eq(projectExecutionLinks.executionId, execution.id), eq(projectExecutionLinks.organizationId, input.organizationId)));
  if (!link) throw new Error("office execution is not linked to a project task");
  const task = await resolveTaskById(db, input.organizationId, link.taskId);
  const metadata = parseOfficeTaskMetadata(task.description);
  if (!metadata) throw new Error("office task metadata is missing");
  const [projectRow] = await db.select({ name: projects.name, projectKey: projects.projectKey, objective: projects.objective }).from(projects).where(and(eq(projects.id, link.projectId), eq(projects.organizationId, input.organizationId)));
  if (!projectRow) throw new Error("office project is unavailable");

  const approvals = await db.select().from(agentApprovalRequests).where(and(eq(agentApprovalRequests.organizationId, input.organizationId), eq(agentApprovalRequests.executionId, execution.id)));
  const latestApproval = approvals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (metadata.stage === "qa" && latestApproval?.status === "approved") {
    const plan = await getLatestPlan(db, execution.id);
    if (!plan) throw new Error("office execution has no durable plan");
    const statuses = new Map((await getPlanSteps(db, plan.id)).map((step) => [step.stepNumber, step.status]));
    if (!completed(4, statuses)) await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 4, actorAgentId: agent.id });
    await completeTaskAndAdvance(db, { organizationId: input.organizationId, projectId: link.projectId, taskId: link.taskId, actorUserId: execution.ownerUserId });
    const project = await resolveProjectById(db, input.organizationId, link.projectId);
    const tasks = await listTasks(db, { organizationId: input.organizationId, projectId: link.projectId, actorUserId: execution.ownerUserId });
    if (project.status === "active" && tasks.every((item) => item.status === "completed")) {
      await transitionProjectStatus(db, { organizationId: input.organizationId, projectId: project.id, toStatus: "completed", expectedRevision: project.revision, actorUserId: execution.ownerUserId });
    }
    await advanceIfAt(db, input.organizationId, execution.id, agent.id, "executing", "verifying");
    execution = await resolveExecutionById(db, input.organizationId, execution.id);
    return execution.status === "verifying" ? completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id }) : execution;
  }
  if (metadata.stage === "qa" && latestApproval?.status === "pending") return execution;

  const plan = await getLatestPlan(db, execution.id);
  if (!plan) throw new Error("office execution has no durable plan");
  const statuses = new Map((await getPlanSteps(db, plan.id)).map((step) => [step.stepNumber, step.status]));
  await advanceIfAt(db, input.organizationId, execution.id, agent.id, "planning", "reasoning");
  if (!completed(1, statuses)) await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 1, actorAgentId: agent.id });
  await advanceIfAt(db, input.organizationId, execution.id, agent.id, "reasoning", "executing");

  let artifact = (await listArtifactsForExecution(db, input.organizationId, execution.id)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const context = await projectContext(db, input.organizationId, link.projectId);
  if (!artifact || latestApproval?.status === "revision_requested") {
    if (metadata.stage === "engineering") {
      const objective = projectRow.objective ?? metadata.goal;
      const delivery = await executeEngineeringDelivery({ executionId: execution.id, projectKey: projectRow.projectKey, projectName: projectRow.name, objective, acceptanceCriteria: metadata.successCriteria, sharedContext: context });
      artifact = await createArtifact(db, {
        organizationId: input.organizationId,
        executionId: execution.id,
        artifactType: "report",
        title: `Engineering delivery — ${projectRow.projectKey}`,
        content: `${engineeringMarker(delivery)}\n\n# Engineering delivery\n\n- Pull request: ${delivery.pullRequestUrl}\n- Branch: \`${delivery.branch}\`\n- Commit: \`${delivery.commitSha}\`\n- Preview: ${delivery.previewUrl ?? "Pending Vercel check"}\n\n## Validation and implementation report\n\n${delivery.validationSummary}`.slice(0, 20_000),
        actorAgentId: agent.id,
      });
    } else if (metadata.stage === "qa") {
      let delivery = latestApproval?.status === "revision_requested"
        ? await latestEngineeringResult(db, input.organizationId, link.projectId, latestApproval.decidedAt)
        : await latestEngineeringResult(db, input.organizationId, link.projectId);
      if (!delivery && latestApproval?.status === "revision_requested") {
        const objective = `${projectRow.objective ?? metadata.goal}\n\nFounder requested these changes: ${latestApproval.decisionNote || "Revise the implementation based on the founder review."}`;
        delivery = await executeEngineeringDelivery({ executionId: execution.id, projectKey: projectRow.projectKey, projectName: projectRow.name, objective, acceptanceCriteria: metadata.successCriteria, sharedContext: context });
        const revisionArtifact = await createArtifact(db, {
          organizationId: input.organizationId,
          executionId: execution.id,
          artifactType: "report",
          title: `Revised engineering delivery — ${projectRow.projectKey}`,
          content: `${engineeringMarker(delivery)}\n\n# Revised engineering delivery\n\n- Pull request: ${delivery.pullRequestUrl}\n- Branch: \`${delivery.branch}\`\n- Commit: \`${delivery.commitSha}\`\n- Preview: ${delivery.previewUrl ?? "Pending Vercel check"}\n\n## Validation and implementation report\n\n${delivery.validationSummary}`.slice(0, 20_000),
          actorAgentId: agent.id,
        });
        await linkArtifactToEntity(db, { organizationId: input.organizationId, projectId: link.projectId, artifactId: revisionArtifact.id, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });
      }
      if (!delivery) throw new Error("QA is waiting for an Engineering pull request");
      const inspected = await inspectEngineeringDelivery(delivery);
      if (!inspected.previewUrl) throw new Error("QA is waiting for the Vercel preview deployment");
      const review = await generateText({
        model: getOfficeModel("review"),
        system: "You are LYNQ's independent Quality Assurance Lead. Review the supplied implementation evidence against the objective and acceptance criteria. Be concise and factual. Identify defects or missing evidence; never claim checks passed unless the evidence says so. Return polished Markdown with Verdict, Acceptance criteria, Risks, and Founder recommendation.",
        prompt: JSON.stringify({ objective: projectRow.objective ?? metadata.goal, acceptanceCriteria: metadata.successCriteria, implementation: delivery.agentSummary, automatedChecks: inspected.checks, previewUrl: inspected.previewUrl, pullRequestUrl: delivery.pullRequestUrl }),
      });
      artifact = await createArtifact(db, {
        organizationId: input.organizationId,
        executionId: execution.id,
        artifactType: "report",
        title: `Founder review — ${projectRow.projectKey}`,
        content: `# Founder review\n\n${review.text.trim()}\n\n## What was built\n\n${delivery.agentSummary}\n\n## Review links\n\n- Preview: ${inspected.previewUrl}\n- Pull request: ${delivery.pullRequestUrl}\n- Commit: \`${delivery.commitSha}\`\n\n## Automated checks\n\n\`\`\`text\n${inspected.checks}\n\`\`\`\n\n## Decision\n\nApprove to mark this Office project complete, or request changes to send it through another isolated Engineering revision.`,
        actorAgentId: agent.id,
      });
    } else {
      artifact = await makeTextArtifact(db, { organizationId: input.organizationId, executionId: execution.id, agentId: agent.id, projectContext: context, goal: metadata.goal, successCriteria: metadata.successCriteria, title: `${getAgentOfficeIdentity(agent).title} — ${projectRow.projectKey}`, modelRole: metadata.stage === "product" ? "planning" : "review" });
    }
  }

  if (!artifact?.content) throw new Error("office deliverable has no reviewable content");
  for (const stepNumber of [2, 3] as const) {
    if (!completed(stepNumber, statuses)) await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber, actorAgentId: agent.id });
  }
  const existingLinks = await listArtifactLinks(db, { organizationId: input.organizationId, projectId: link.projectId, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });
  if (!existingLinks.some((item) => item.artifactId === artifact!.id)) await linkArtifactToEntity(db, { organizationId: input.organizationId, projectId: link.projectId, artifactId: artifact.id, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });

  if (metadata.stage === "qa") {
    const approvalSummary = `Review the preview and pull request for ${projectRow.name}. Approving marks the Office project complete; requesting changes starts another isolated Engineering revision.`;
    const approval = await requestApproval(db, { organizationId: input.organizationId, executionId: execution.id, requestedAction: "office_project_completion", summary: approvalSummary, riskLevel: "high", artifactId: artifact.id, proposedActionRef: { projectId: link.projectId, taskId: link.taskId }, actorAgentId: agent.id });
    await linkApprovalToEntity(db, { organizationId: input.organizationId, projectId: link.projectId, approvalRequestId: approval.request.id, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });
    await notifyJarvisApprovalNeeded(db, { organizationId: input.organizationId, ownerUserId: execution.ownerUserId, projectName: projectRow.name, summary: approvalSummary });
    return approval.execution;
  }

  await completeTaskAndAdvance(db, { organizationId: input.organizationId, projectId: link.projectId, taskId: link.taskId, actorUserId: execution.ownerUserId });
  if (!completed(4, statuses)) await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 4, actorAgentId: agent.id });
  await advanceIfAt(db, input.organizationId, execution.id, agent.id, "executing", "verifying");
  execution = await resolveExecutionById(db, input.organizationId, execution.id);
  return execution.status === "verifying" ? completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id }) : execution;
}
