import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createWorkflowEdge, listWorkflowEdges } from "@/lib/workflows/edges";

export const dynamic = "force-dynamic";

const createEdgeBodySchema = z
  .object({
    sourceNodeId: uuidParam,
    targetNodeId: uuidParam,
    conditionKey: z.string().trim().min(1).max(60).optional(),
    sequence: z.number().int().optional(),
    label: z.string().trim().max(200).optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; workflowId: string; versionId: string }> };

/** GET /api/organizations/{organizationId}/workflows/{workflowId}/versions/{versionId}/edges */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId, versionId: rawVersionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);
    const versionId = parseUuidParam(rawVersionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const edges = await listWorkflowEdges(db, { organizationId, definitionId, versionId, actorUserId: user.userId });
    return jsonSuccess({ edges });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/workflows/{workflowId}/versions/{versionId}/edges */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId, versionId: rawVersionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);
    const versionId = parseUuidParam(rawVersionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createEdgeBodySchema);
    const edge = await createWorkflowEdge(db, { organizationId, definitionId, versionId, ...body, actorUserId: user.userId });

    return jsonSuccess(edge, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
