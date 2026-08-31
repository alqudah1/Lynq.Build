import "server-only";

import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError, jsonSuccess } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getProjectForUser } from "@/lib/projects/projects";
import { listTasks } from "@/lib/projects/tasks";
import { listApprovalLinks, listExecutionLinksForProject } from "@/lib/projects/links";
import { parseOfficeTaskMetadata } from "@/lib/office/task-metadata";

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
    const [tasks, executions, approvals] = await Promise.all([
      listTasks(db, { organizationId, projectId, actorUserId: user.userId }),
      listExecutionLinksForProject(db, { organizationId, projectId, actorUserId: user.userId }),
      listApprovalLinks(db, { organizationId, projectId, actorUserId: user.userId }),
    ]);

    const executionByTask = new Map(executions.map((execution) => [execution.taskId, execution]));
    const approvalByTask = new Map(approvals.map((approval) => [approval.linkedEntityId, approval]));
    const steps = tasks.map((task) => {
      const metadata = parseOfficeTaskMetadata(task.description);
      const execution = executionByTask.get(task.id) ?? null;
      const approval = approvalByTask.get(task.id) ?? null;
      const state =
        approval?.status === "pending"
          ? "needs_approval"
          : execution && ["failed", "cancelled"].includes(execution.executionStatus)
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
        goal: metadata?.goal ?? task.description,
        handoff: metadata?.handoff ?? null,
        execution: execution ? { id: execution.executionId, status: execution.executionStatus } : null,
        approval: approval ? { id: approval.approvalRequestId, status: approval.status } : null,
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
      project: { id: project.id, name: project.name, projectKey: project.projectKey, status: project.status, objective: project.objective },
      overallState,
      steps,
      refreshAfterMs: overallState === "completed" || overallState === "failed" ? null : 5000,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
