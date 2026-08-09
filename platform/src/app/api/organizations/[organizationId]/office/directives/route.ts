import "server-only";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError, jsonSuccess } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { listAgents } from "@/lib/agents/agents";
import { createProject, transitionProjectStatus } from "@/lib/projects/projects";
import { createTask, transitionTaskStatus } from "@/lib/projects/tasks";
import { launchAgentForTask } from "@/lib/projects/links";
import { getDirectiveDomains, planOfficeDirective } from "@/lib/office/directives";
import { getAgentOfficeIdentity } from "@/lib/office/view";
import { pollAndProcess } from "@/lib/runtime/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z
  .object({
    instruction: z.string().trim().min(10).max(5000),
    workspaceId: uuidParam.optional(),
    preferredAgentId: uuidParam.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

function projectKey(name: string): string {
  let prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
  if (!/^[A-Z]/.test(prefix)) prefix = `P${prefix}`;
  if (prefix.length < 2) prefix = "LYNQ";
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`.slice(0, 12);
}

/**
 * Founder-facing office intake. One plain-language directive becomes a real
 * Project OS record, real tasks, and real Agent Runtime executions. The AI is
 * allowed to plan and route; every durable write still passes through the
 * existing human authorization, audit, tenant, and lifecycle gates.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);

    const agents = (await listAgents(db, { organizationId, actorUserId: user.userId })).filter(
      (agent) => agent.lifecycleStage !== "retired"
    );
    const plan = await planOfficeDirective({
      instruction: body.instruction,
      agents,
      preferredAgentId: body.preferredAgentId ?? null,
    });

    const project = await createProject(db, {
      organizationId,
      workspaceId: body.workspaceId ?? null,
      name: plan.projectName,
      projectKey: projectKey(plan.projectName),
      description: `Founder directive\n\n${body.instruction}\n\nExecutive Assistant kickoff\n\n${plan.assistantReply}`,
      objective: plan.objective,
      priority: "high",
      actorUserId: user.userId,
    });
    const planningProject = await transitionProjectStatus(db, {
      organizationId,
      projectId: project.id,
      toStatus: "planning",
      expectedRevision: project.revision,
      actorUserId: user.userId,
    });

    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const uniqueAssignments = [...new Map(plan.assignments.map((assignment) => [assignment.agentId, assignment])).values()];
    const dispatched: Array<{
      agentId: string;
      agentName: string;
      role: string;
      taskId: string;
      executionId: string;
      status: string;
      title: string;
      handoff: string;
    }> = [];

    for (const assignment of uniqueAssignments) {
      const agent = agentById.get(assignment.agentId);
      if (!agent) continue;

      const task = await createTask(db, {
        organizationId,
        projectId: project.id,
        title: assignment.title,
        description: `${assignment.goal}\n\nHandoff: ${assignment.handoff}`,
        priority: "high",
        taskType: "agent_report",
        actorUserId: user.userId,
      });
      const readyTask = await transitionTaskStatus(db, {
        organizationId,
        taskId: task.id,
        toStatus: "ready",
        expectedRevision: task.revision,
        actorUserId: user.userId,
      });
      const execution = await launchAgentForTask(db, {
        organizationId,
        projectId: project.id,
        taskId: task.id,
        agentId: agent.id,
        goal: assignment.goal,
        successCriteria: assignment.successCriteria,
        failureCriteria: "Escalate to the founder if required information, permission, or evidence is missing; never fabricate completion.",
        allowedDomains: getDirectiveDomains(agent),
        priority: 80,
        actorUserId: user.userId,
      });
      await transitionTaskStatus(db, {
        organizationId,
        taskId: readyTask.id,
        toStatus: "in_progress",
        expectedRevision: readyTask.revision,
        actorUserId: user.userId,
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

    const activeProject =
      dispatched.length > 0
        ? await transitionProjectStatus(db, {
            organizationId,
            projectId: project.id,
            toStatus: "active",
            expectedRevision: planningProject.revision,
            actorUserId: user.userId,
          })
        : planningProject;

    if (dispatched.length > 0) {
      const rawSql = neon(env.DATABASE_URL);
      after(async () => {
        await pollAndProcess(db, rawSql, {
          leaseOwner: `office-directive:${project.id}`,
          jobTypes: ["execution_run"],
          maxJobs: dispatched.length,
        });
      });
    }

    return jsonSuccess(
      {
        assistantReply: plan.assistantReply,
        plannedByAI: plan.plannedByAI,
        project: {
          id: activeProject.id,
          name: activeProject.name,
          projectKey: activeProject.projectKey,
          status: activeProject.status,
        },
        assignments: dispatched,
      },
      201
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
