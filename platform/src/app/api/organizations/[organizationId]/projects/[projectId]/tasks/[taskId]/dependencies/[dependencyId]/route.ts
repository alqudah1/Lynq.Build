import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { removeDependency } from "@/lib/projects/dependencies";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; projectId: string; taskId: string; dependencyId: string }> };

/** DELETE /api/organizations/{organizationId}/projects/{projectId}/tasks/{taskId}/dependencies/{dependencyId} */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, dependencyId: rawDependencyId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const dependencyId = parseUuidParam(rawDependencyId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    await removeDependency(db, { organizationId, dependencyId, actorUserId: user.userId });

    return jsonSuccess({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
