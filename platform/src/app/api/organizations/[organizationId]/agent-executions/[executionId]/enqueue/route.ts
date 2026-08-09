import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getExecutionForUser } from "@/lib/agent-runtime/executions";
import { requireExecutionManageAuthority } from "@/lib/agent-runtime/authz";
import { enqueueJob } from "@/lib/runtime/queue";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/**
 * POST /api/organizations/{organizationId}/agent-executions/{executionId}/enqueue
 *
 * Human-triggered manual resume — the same `execution_resume` job type
 * reconciliation itself enqueues, idempotency-keyed identically
 * (`exec:{executionId}`), so a manual enqueue while one is already
 * active safely reuses that same job rather than duplicating it.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const execution = await getExecutionForUser(db, { organizationId, executionId, actorUserId: user.userId });
    await requireExecutionManageAuthority(db, { organizationId, workspaceId: execution.workspaceId, ownerUserId: execution.ownerUserId, actorUserId: user.userId });

    const job = await enqueueJob(db, {
      organizationId,
      workspaceId: execution.workspaceId,
      jobType: "execution_resume",
      executionId,
      idempotencyKey: `exec:${executionId}`,
    });

    return jsonSuccess({ jobId: job.id, status: job.status }, 202);
  } catch (err) {
    return handleRouteError(err);
  }
}
