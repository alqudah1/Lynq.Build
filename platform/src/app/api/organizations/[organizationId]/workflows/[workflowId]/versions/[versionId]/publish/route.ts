import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { publishWorkflowVersion } from "@/lib/workflows/versions";

export const dynamic = "force-dynamic";

const publishBodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; workflowId: string; versionId: string }> };

/** POST /api/organizations/{organizationId}/workflows/{workflowId}/versions/{versionId}/publish */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId, versionId: rawVersionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);
    const versionId = parseUuidParam(rawVersionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, publishBodySchema);
    const version = await publishWorkflowVersion(db, { organizationId, definitionId, versionId, expectedRevision: body.expectedRevision, actorUserId: user.userId });

    return jsonSuccess(version);
  } catch (err) {
    return handleRouteError(err);
  }
}
