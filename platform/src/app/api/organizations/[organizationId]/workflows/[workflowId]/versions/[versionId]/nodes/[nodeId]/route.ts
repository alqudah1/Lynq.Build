import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { updateWorkflowNode, deleteWorkflowNode } from "@/lib/workflows/nodes";
import { workflowNameSchema, workflowDescriptionSchema } from "@/lib/workflows/validation";

export const dynamic = "force-dynamic";

const updateNodeBodySchema = z
  .object({
    name: workflowNameSchema.optional(),
    description: workflowDescriptionSchema.nullable(),
    configuration: z.unknown().optional(),
    inputMapping: z.unknown().optional(),
    outputMapping: z.unknown().optional(),
    retryPolicy: z.unknown().optional(),
    timeoutPolicy: z.unknown().optional(),
    positionX: z.number().int().optional(),
    positionY: z.number().int().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; workflowId: string; versionId: string; nodeId: string }> };

/** PATCH /api/organizations/{organizationId}/workflows/{workflowId}/versions/{versionId}/nodes/{nodeId} */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId, versionId: rawVersionId, nodeId: rawNodeId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);
    const versionId = parseUuidParam(rawVersionId);
    const nodeId = parseUuidParam(rawNodeId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const updates = await parseJsonBody(request, updateNodeBodySchema);
    const node = await updateWorkflowNode(db, { organizationId, definitionId, versionId, nodeId, updates, actorUserId: user.userId });

    return jsonSuccess(node);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** DELETE /api/organizations/{organizationId}/workflows/{workflowId}/versions/{versionId}/nodes/{nodeId} */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId, versionId: rawVersionId, nodeId: rawNodeId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);
    const versionId = parseUuidParam(rawVersionId);
    const nodeId = parseUuidParam(rawNodeId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    await deleteWorkflowNode(db, { organizationId, definitionId, versionId, nodeId, actorUserId: user.userId });

    return jsonSuccess({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
