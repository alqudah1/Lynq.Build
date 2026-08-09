import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { listMyWorkflowHumanTasks } from "@/lib/workflows/human-tasks";
import { workflowHumanTaskStatusSchema } from "@/lib/workflows/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/workflow-human-tasks — every workflow human task assigned to the caller ("My Work"). Query param: status? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const status = workflowHumanTaskStatusSchema.optional().parse(url.searchParams.get("status") ?? undefined);

    const tasks = await listMyWorkflowHumanTasks(db, { organizationId, actorUserId: user.userId, status });
    return jsonSuccess({ tasks });
  } catch (err) {
    return handleRouteError(err);
  }
}
