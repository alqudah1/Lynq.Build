import "server-only";

import { randomUUID } from "node:crypto";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { listAgents } from "@/lib/agents/agents";
import { createProject, transitionProjectStatus } from "@/lib/projects/projects";
import { createTask, transitionTaskStatus } from "@/lib/projects/tasks";
import { launchAgentForTask } from "@/lib/projects/links";
import { addDependency } from "@/lib/projects/dependencies";
import { ensureOfficeDeliveryTeam } from "./team";
import { formatOfficeTaskDescription } from "./task-metadata";
import { getAgentOfficeIdentity } from "./view";
import { getDirectiveDomains, planOfficeDirective } from "./directives";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Office directive intake — the single orchestration path
 * ============================================================================
 * This is the body that used to live inline in
 * `POST /api/organizations/[organizationId]/office/directives`. It was
 * extracted, unchanged in behavior, for one reason: the secure phone lane
 * must create directives through EXACTLY the same code as the web Command
 * Center, not through a parallel implementation that would drift.
 *
 * Everything about the original remains true here — the AI plans and routes,
 * but every durable write still goes through the existing tenant
 * authorization, audit, lifecycle, and Agent Runtime gates
 * (`createProject`/`createTask`/`launchAgentForTask` each re-authorize the
 * actor themselves). The only difference is that the actor is now a
 * parameter: a browser session supplies its authenticated user, and the phone
 * lane supplies the founder account it has separately verified.
 *
 * Deliberately does NOT schedule the post-response worker poll. `after()` is
 * a Next.js request-scoped API and belongs at the route boundary, so this
 * function returns `launchedCount` and each caller schedules its own drain.
 */

export interface DirectiveDispatchAssignment {
  agentId: string;
  agentName: string;
  role: string;
  taskId: string;
  executionId: string;
  status: string;
  title: string;
  handoff: string;
}

export interface CreateDirectiveProjectInput {
  organizationId: string;
  instruction: string;
  actorUserId: string;
  workspaceId?: string | null;
  preferredAgentId?: string | null;
  /**
   * Recorded in the project description so a reader can always tell how a
   * directive entered the Office. Never changes what is created.
   */
  source?: "command_center" | "founder_phone_call";
}

export interface CreateDirectiveProjectResult {
  assistantReply: string;
  plannedByAI: boolean;
  executionMode: "delivery" | "advisory";
  project: { id: string; name: string; projectKey: string; status: string; workspaceId: string | null };
  assignments: DirectiveDispatchAssignment[];
  /** How many executions were actually launched — the caller uses this to size its background drain. */
  launchedCount: number;
}

export function buildProjectKey(name: string): string {
  let prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
  if (!/^[A-Z]/.test(prefix)) prefix = `P${prefix}`;
  if (prefix.length < 2) prefix = "LYNQ";
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`.slice(0, 12);
}

/**
 * The `extractFounderDirective` parser in `jarvis-presentation.ts` reads this
 * exact shape, so the description format is load-bearing and must not change
 * casually. The source line is appended AFTER the kickoff section so the
 * existing parser (which stops at "Executive Assistant kickoff") keeps
 * returning the same directive text it always did.
 */
function formatDirectiveDescription(input: { instruction: string; assistantReply: string; source: CreateDirectiveProjectInput["source"] }): string {
  const base = `Founder directive\n\n${input.instruction}\n\nExecutive Assistant kickoff\n\n${input.assistantReply}`;
  return input.source === "founder_phone_call" ? `${base}\n\nCaptured from a verified founder phone call.` : base;
}

export async function createDirectiveProject(db: Db, input: CreateDirectiveProjectInput): Promise<CreateDirectiveProjectResult> {
  await ensureOfficeDeliveryTeam(db, { organizationId: input.organizationId, humanOwnerUserId: input.actorUserId, actorUserId: input.actorUserId });

  const agents = (await listAgents(db, { organizationId: input.organizationId, actorUserId: input.actorUserId })).filter(
    (agent) => agent.lifecycleStage !== "retired"
  );
  const plan = await planOfficeDirective({
    instruction: input.instruction,
    agents,
    preferredAgentId: input.preferredAgentId ?? null,
  });

  const project = await createProject(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? null,
    name: plan.projectName,
    projectKey: buildProjectKey(plan.projectName),
    description: formatDirectiveDescription({ instruction: input.instruction, assistantReply: plan.assistantReply, source: input.source }),
    objective: plan.objective,
    priority: "high",
    actorUserId: input.actorUserId,
  });
  const planningProject = await transitionProjectStatus(db, {
    organizationId: input.organizationId,
    projectId: project.id,
    toStatus: "planning",
    expectedRevision: project.revision,
    actorUserId: input.actorUserId,
  });

  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const uniqueAssignments = [...new Map(plan.assignments.map((assignment) => [assignment.agentId, assignment])).values()];
  const dispatched: DirectiveDispatchAssignment[] = [];

  const prepared: Array<{ assignment: (typeof uniqueAssignments)[number]; agent: (typeof agents)[number]; task: Awaited<ReturnType<typeof createTask>> }> = [];
  for (const assignment of uniqueAssignments) {
    const agent = agentById.get(assignment.agentId);
    if (!agent) continue;

    const task = await createTask(db, {
      organizationId: input.organizationId,
      projectId: project.id,
      title: assignment.title,
      description: formatOfficeTaskDescription({
        version: 1,
        stage: assignment.stage,
        agentId: assignment.agentId,
        goal: assignment.goal,
        successCriteria: assignment.successCriteria,
        handoff: assignment.handoff,
      }),
      priority: "high",
      taskType: `office_${assignment.stage}`,
      actorUserId: input.actorUserId,
    });
    prepared.push({ assignment, agent, task });
  }

  if (plan.sequentialHandoffs) {
    for (let index = 1; index < prepared.length; index += 1) {
      await addDependency(db, {
        organizationId: input.organizationId,
        blockedTaskId: prepared[index].task.id,
        blockingTaskId: prepared[index - 1].task.id,
        actorUserId: input.actorUserId,
      });
    }
  }

  const launchNow = plan.sequentialHandoffs ? prepared.slice(0, 1) : prepared;
  for (const { assignment, agent, task } of launchNow) {
    const readyTask = await transitionTaskStatus(db, {
      organizationId: input.organizationId,
      taskId: task.id,
      toStatus: "ready",
      expectedRevision: task.revision,
      actorUserId: input.actorUserId,
    });
    const execution = await launchAgentForTask(db, {
      organizationId: input.organizationId,
      projectId: project.id,
      taskId: task.id,
      agentId: agent.id,
      goal: assignment.goal,
      successCriteria: assignment.successCriteria,
      failureCriteria: "Escalate to the founder if required information, permission, or evidence is missing; never fabricate completion.",
      allowedDomains: getDirectiveDomains(agent),
      priority: 80,
      actorUserId: input.actorUserId,
    });
    await transitionTaskStatus(db, {
      organizationId: input.organizationId,
      taskId: readyTask.id,
      toStatus: "in_progress",
      expectedRevision: readyTask.revision,
      actorUserId: input.actorUserId,
    });

    dispatched.push({
      agentId: agent.id,
      agentName: agent.name,
      role: getAgentOfficeIdentity(agent).title,
      taskId: task.id,
      executionId: execution.executionId,
      status: execution.executionStatus,
      title: assignment.title,
      handoff: assignment.handoff,
    });
  }

  for (const { assignment, agent, task } of prepared.slice(launchNow.length)) {
    dispatched.push({
      agentId: agent.id,
      agentName: agent.name,
      role: getAgentOfficeIdentity(agent).title,
      taskId: task.id,
      executionId: `pending:${task.id}`,
      status: "backlog",
      title: assignment.title,
      handoff: assignment.handoff,
    });
  }

  const activeProject =
    dispatched.length > 0
      ? await transitionProjectStatus(db, {
          organizationId: input.organizationId,
          projectId: project.id,
          toStatus: "active",
          expectedRevision: planningProject.revision,
          actorUserId: input.actorUserId,
        })
      : planningProject;

  return {
    assistantReply: plan.assistantReply,
    plannedByAI: plan.plannedByAI,
    executionMode: plan.executionMode,
    project: {
      id: activeProject.id,
      name: activeProject.name,
      projectKey: activeProject.projectKey,
      status: activeProject.status,
      workspaceId: activeProject.workspaceId ?? null,
    },
    assignments: dispatched,
    launchedCount: launchNow.length,
  };
}
