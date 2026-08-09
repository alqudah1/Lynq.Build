import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { startExecution } from "@/lib/agent-runtime/lifecycle";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** POST .../{executionId}/start — `assigned -> gathering_context`; assembles and persists the Execution Context snapshot. */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const execution = await startExecution(db, { organizationId, executionId, actorUserId: user.userId });
    return jsonSuccess(execution);
  } catch (err) {
    return handleRouteError(err);
  }
}
