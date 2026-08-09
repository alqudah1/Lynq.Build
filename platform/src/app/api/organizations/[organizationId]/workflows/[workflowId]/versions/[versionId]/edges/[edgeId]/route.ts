import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { deleteWorkflowEdge } from "@/lib/workflows/edges";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; workflowId: string; versionId: string; edgeId: string }> };

/** DELETE /api/organizations/{organizationId}/workflows/{workflowId}/versions/{versionId}/edges/{edgeId} */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId, versionId: rawVersionId, edgeId: rawEdgeId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);
    const versionId = parseUuidParam(rawVersionId);
    const edgeId = parseUuidParam(rawEdgeId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    await deleteWorkflowEdge(db, { organizationId, definitionId, versionId, edgeId, actorUserId: user.userId });

    return jsonSuccess({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
