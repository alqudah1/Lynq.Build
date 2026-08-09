import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { validateWorkflowVersionAndPersist } from "@/lib/workflows/versions";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; workflowId: string; versionId: string }> };

/** POST /api/organizations/{organizationId}/workflows/{workflowId}/versions/{versionId}/validate */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId, versionId: rawVersionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);
    const versionId = parseUuidParam(rawVersionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const result = await validateWorkflowVersionAndPersist(db, { organizationId, definitionId, versionId, actorUserId: user.userId });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
