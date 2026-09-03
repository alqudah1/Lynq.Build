import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { agentArtifacts, agentExecutions, projectArtifactLinks, runtimeJobs } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError, jsonSuccess } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getProjectForUser } from "@/lib/projects/projects";
import { listTasks } from "@/lib/projects/tasks";
import { listApprovalLinks, listExecutionLinksForProject } from "@/lib/projects/links";
import { parseOfficeTaskMetadata } from "@/lib/office/task-metadata";
import { explainJarvisFailure, extractEngineeringLinks, extractFounderDirective, summarizeDemoDelivery } from "@/lib/office/jarvis-presentation";
import { listAgents } from "@/lib/agents/agents";
import { getAgentOfficeIdentity } from "@/lib/office/view";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; projectId: string }> };

const ACTIVE_EXECUTION_STATUSES = new Set(["queued", "assigned", "gathering_context", "planning", "reasoning", "waiting", "executing", "delegating", "verifying", "paused"]);

/** Live, permission-checked status for one Jarvis directive project. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const project = await getProjectForUser(db, { organizationId, projectId, actorUserId: user.userId });
    const [tasks, executions, approvals, agents, artifacts] = await Promise.all([
      listTasks(db, { organizationId, projectId, actorUserId: user.userId }),
      listExecutionLinksForProject(db, { organizationId, projectId, actorUserId: user.userId }),
      listApprovalLinks(db, { organizationId, projectId, actorUserId: user.userId }),
      listAgents(db, { organizationId, actorUserId: user.userId }),
      db
        .select({ taskId: projectArtifactLinks.linkedEntityId, artifactId: agentArtifacts.id, title: agentArtifacts.title, content: agentArtifacts.content, createdAt: agentArtifacts.createdAt })
        .from(projectArtifactLinks)
        .innerJoin(agentArtifacts, eq(agentArtifacts.id, projectArtifactLinks.artifactId))
        .where(and(eq(projectArtifactLinks.organizationId, organizationId), eq(projectArtifactLinks.projectId, projectId), eq(projectArtifactLinks.linkedEntityType, "task")))
        .orderBy(desc(agentArtifacts.createdAt)),
    ]);

    const executionIds = executions.map((execution) => execution.executionId);
    const [executionRows, runtimeJobRows] = executionIds.length > 0
      ? await Promise.all([
          db.select({ id: agentExecutions.id, waitReason: agentExecutions.waitReason }).from(agentExecutions).where(and(eq(agentExecutions.organizationId, organizationId), inArray(agentExecutions.id, executionIds))),
          db
            .select({ executionId: runtimeJobs.executionId, status: runtimeJobs.status, lastErrorMessage: runtimeJobs.lastErrorMessage })
            .from(runtimeJobs)
            .where(and(eq(runtimeJobs.organizationId, organizationId), inArray(runtimeJobs.executionId, executionIds)))
            .orderBy(desc(runtimeJobs.createdAt)),
        ])
      : [[], []];

    const executionByTask = new Map(executions.map((execution) => [execution.taskId, execution]));
    const approvalByTask = new Map(approvals.map((approval) => [approval.linkedEntityId, approval]));
    const waitReasonByExecution = new Map(executionRows.map((execution) => [execution.id, execution.waitReason]));
    const runtimeJobByExecution = new Map<string, (typeof runtimeJobRows)[number]>();
    for (const job of runtimeJobRows) if (job.executionId && !runtimeJobByExecution.has(job.executionId)) runtimeJobByExecution.set(job.executionId, job);
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const artifactByTask = new Map<string, (typeof artifacts)[number]>();
    for (const artifact of artifacts) if (!artifactByTask.has(artifact.taskId)) artifactByTask.set(artifact.taskId, artifact);
    const steps = tasks.map((task) => {
      const metadata = parseOfficeTaskMetadata(task.description);
      const execution = executionByTask.get(task.id) ?? null;
      const approval = approvalByTask.get(task.id) ?? null;
      const agent = metadata?.agentId ? agentById.get(metadata.agentId) ?? null : null;
      const artifact = artifactByTask.get(task.id) ?? null;
      const runtimeJob = execution ? runtimeJobByExecution.get(execution.executionId) ?? null : null;
      const runtimeStopped = runtimeJob ? ["failed", "dead_lettered", "cancelled"].includes(runtimeJob.status) : false;
      // The structured delivery record is authoritative; the markdown
      // fallback only covers artifacts written before it existed.
      const demo = summarizeDemoDelivery(artifact?.content ?? null);
      const engineeringLinks = demo.commitSha ? { pullRequestUrl: demo.pullRequestUrl, previewUrl: demo.previewUrl } : extractEngineeringLinks(artifact?.content ?? null);
      const rawFailure = runtimeJob?.lastErrorMessage ?? waitReasonByExecution.get(execution?.executionId ?? "") ?? null;
      const state =
        approval?.status === "pending"
          ? "needs_approval"
          : runtimeStopped || (execution && ["failed", "cancelled"].includes(execution.executionStatus))
            ? "failed"
            : task.status === "completed"
              ? "completed"
              : execution && ACTIVE_EXECUTION_STATUSES.has(execution.executionStatus)
                ? "running"
                : task.status === "backlog"
                  ? "queued"
                  : "waiting";

      return {
        taskId: task.id,
        title: task.title,
        taskStatus: task.status,
        state,
        stage: metadata?.stage ?? "advisory",
        agentId: metadata?.agentId ?? null,
        agent: agent ? { id: agent.id, name: agent.name, role: getAgentOfficeIdentity(agent).title } : null,
        goal: metadata?.goal ?? task.description,
        handoff: metadata?.handoff ?? null,
        execution: execution ? {
          id: execution.executionId,
          status: execution.executionStatus,
          waitReason: rawFailure,
          runtimeStatus: runtimeJob?.status ?? null,
        } : null,
        failure: explainJarvisFailure(rawFailure),
        demo: demo.commitSha ? demo : null,
        approval: approval ? { id: approval.approvalRequestId, status: approval.status } : null,
        deliverable: artifact ? { id: artifact.artifactId, title: artifact.title } : null,
        pullRequestUrl: engineeringLinks.pullRequestUrl,
        previewUrl: engineeringLinks.previewUrl,
      };
    });

    const overallState = steps.some((step) => step.state === "needs_approval")
      ? "needs_approval"
      : steps.some((step) => step.state === "failed")
        ? "failed"
        : project.status === "completed" || (steps.length > 0 && steps.every((step) => step.state === "completed"))
          ? "completed"
          : steps.some((step) => step.state === "running")
            ? "running"
            : "queued";

    return jsonSuccess({
      project: { id: project.id, name: project.name, projectKey: project.projectKey, status: project.status, objective: project.objective, directive: extractFounderDirective(project.description) },
      overallState,
      steps,
      refreshAfterMs: overallState === "completed" || overallState === "failed" ? null : 5000,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
