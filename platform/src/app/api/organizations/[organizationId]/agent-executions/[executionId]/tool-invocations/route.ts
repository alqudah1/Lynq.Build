import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { listToolInvocationsForExecution } from "@/lib/tools/invocation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** GET /api/organizations/{organizationId}/agent-executions/{executionId}/tool-invocations */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const invocations = await listToolInvocationsForExecution(db, { organizationId, executionId, actorUserId: user.userId });
    return jsonSuccess({ invocations });
  } catch (err) {
    return handleRouteError(err);
  }
}
