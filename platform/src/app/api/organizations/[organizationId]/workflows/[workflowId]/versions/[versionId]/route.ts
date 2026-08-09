import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { getWorkflowVersionForUser, updateWorkflowVersion } from "@/lib/workflows/versions";
import { listWorkflowNodes } from "@/lib/workflows/nodes";
import { listWorkflowEdges } from "@/lib/workflows/edges";
import { workflowNameSchema, workflowDescriptionSchema } from "@/lib/workflows/validation";

export const dynamic = "force-dynamic";

const updateVersionBodySchema = z.object({ expectedRevision: z.number().int().min(1), name: workflowNameSchema.optional(), description: workflowDescriptionSchema.nullable(), inputSchema: z.unknown().optional(), outputSchema: z.unknown().optional() }).strict();

type RouteParams = { params: Promise<{ organizationId: string; workflowId: string; versionId: string }> };

/** GET /api/organizations/{organizationId}/workflows/{workflowId}/versions/{versionId} — includes nodes and edges. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId, versionId: rawVersionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);
    const versionId = parseUuidParam(rawVersionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const [version, nodes, edges] = await Promise.all([
      getWorkflowVersionForUser(db, { organizationId, definitionId, versionId, actorUserId: user.userId }),
      listWorkflowNodes(db, { organizationId, definitionId, versionId, actorUserId: user.userId }),
      listWorkflowEdges(db, { organizationId, definitionId, versionId, actorUserId: user.userId }),
    ]);

    return jsonSuccess({ ...version, nodes, edges });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/workflows/{workflowId}/versions/{versionId} */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId, versionId: rawVersionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);
    const versionId = parseUuidParam(rawVersionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateVersionBodySchema);
    const { expectedRevision, ...updates } = body;
    const version = await updateWorkflowVersion(db, { organizationId, definitionId, versionId, expectedRevision, actorUserId: user.userId, updates });

    return jsonSuccess(version);
  } catch (err) {
    return handleRouteError(err);
  }
}
