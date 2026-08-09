import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createWorkflowNode, listWorkflowNodes } from "@/lib/workflows/nodes";
import { nodeKeySchema, workflowNodeTypeSchema, workflowNameSchema, workflowDescriptionSchema } from "@/lib/workflows/validation";

export const dynamic = "force-dynamic";

const createNodeBodySchema = z
  .object({
    nodeKey: nodeKeySchema,
    nodeType: workflowNodeTypeSchema,
    name: workflowNameSchema,
    description: workflowDescriptionSchema,
    configuration: z.unknown().optional(),
    inputMapping: z.unknown().optional(),
    outputMapping: z.unknown().optional(),
    retryPolicy: z.unknown().optional(),
    timeoutPolicy: z.unknown().optional(),
    positionX: z.number().int().optional(),
    positionY: z.number().int().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; workflowId: string; versionId: string }> };

/** GET /api/organizations/{organizationId}/workflows/{workflowId}/versions/{versionId}/nodes */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId, versionId: rawVersionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);
    const versionId = parseUuidParam(rawVersionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const nodes = await listWorkflowNodes(db, { organizationId, definitionId, versionId, actorUserId: user.userId });
    return jsonSuccess({ nodes });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/workflows/{workflowId}/versions/{versionId}/nodes */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId, versionId: rawVersionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);
    const versionId = parseUuidParam(rawVersionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createNodeBodySchema);
    const node = await createWorkflowNode(db, { organizationId, definitionId, versionId, ...body, actorUserId: user.userId });

    return jsonSuccess(node, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
