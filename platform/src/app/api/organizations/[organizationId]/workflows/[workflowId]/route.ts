import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { getWorkflowDefinitionForUser, updateWorkflowDefinition } from "@/lib/workflows/definitions";
import { workflowNameSchema, workflowDescriptionSchema } from "@/lib/workflows/validation";

export const dynamic = "force-dynamic";

const updateWorkflowBodySchema = z.object({ expectedRevision: z.number().int().min(1), name: workflowNameSchema.optional(), description: workflowDescriptionSchema.nullable() }).strict();

type RouteParams = { params: Promise<{ organizationId: string; workflowId: string }> };

/** GET /api/organizations/{organizationId}/workflows/{workflowId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const definition = await getWorkflowDefinitionForUser(db, { organizationId, definitionId, actorUserId: user.userId });
    return jsonSuccess(definition);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/workflows/{workflowId} */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateWorkflowBodySchema);
    const { expectedRevision, ...updates } = body;
    const definition = await updateWorkflowDefinition(db, { organizationId, definitionId, actorUserId: user.userId, expectedRevision, updates });

    return jsonSuccess(definition);
  } catch (err) {
    return handleRouteError(err);
  }
}
