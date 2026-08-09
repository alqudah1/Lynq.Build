import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { unassignTask } from "@/lib/projects/tasks";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; projectId: string; taskId: string; userId: string }> };

/** DELETE /api/organizations/{organizationId}/projects/{projectId}/tasks/{taskId}/assignments/{userId} */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, taskId: rawTaskId, userId: rawUserId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const taskId = parseUuidParam(rawTaskId);
    const targetUserId = parseUuidParam(rawUserId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    await unassignTask(db, { organizationId, taskId, targetUserId, actorUserId: user.userId });

    return jsonSuccess({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
