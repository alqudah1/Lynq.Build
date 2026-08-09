import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getWorkflowExecutionForUser } from "@/lib/workflows/executions";
import { listNodeExecutionsForExecution } from "@/lib/workflows/node-executions";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** GET /api/organizations/{organizationId}/workflow-executions/{executionId} — includes node executions. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const execution = await getWorkflowExecutionForUser(db, { organizationId, executionId, actorUserId: user.userId });
    const nodeExecutions = await listNodeExecutionsForExecution(db, execution.id);

    return jsonSuccess({ ...execution, nodeExecutions });
  } catch (err) {
    return handleRouteError(err);
  }
}
