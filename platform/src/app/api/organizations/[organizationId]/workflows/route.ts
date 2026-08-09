import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createWorkflowDefinition, listWorkflowDefinitionsForUser } from "@/lib/workflows/definitions";
import { workflowKeySchema, workflowNameSchema, workflowDescriptionSchema, workflowDefinitionStatusSchema } from "@/lib/workflows/validation";

export const dynamic = "force-dynamic";

const createWorkflowBodySchema = z
  .object({
    workspaceId: uuidParam.optional(),
    name: workflowNameSchema,
    workflowKey: workflowKeySchema,
    description: workflowDescriptionSchema,
    isTemplate: z.boolean().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/workflows — query params: workspaceId?, status?, isTemplate? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({ workspaceId: uuidParam.optional(), status: workflowDefinitionStatusSchema.optional(), isTemplate: z.enum(["true", "false"]).optional() })
      .parse({ workspaceId: url.searchParams.get("workspaceId") ?? undefined, status: url.searchParams.get("status") ?? undefined, isTemplate: url.searchParams.get("isTemplate") ?? undefined });

    const definitions = await listWorkflowDefinitionsForUser(db, { organizationId, actorUserId: user.userId, workspaceId: query.workspaceId, status: query.status, isTemplate: query.isTemplate === undefined ? undefined : query.isTemplate === "true" });
    return jsonSuccess({ workflows: definitions });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/workflows */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createWorkflowBodySchema);
    const definition = await createWorkflowDefinition(db, { organizationId, workspaceId: body.workspaceId, name: body.name, workflowKey: body.workflowKey, description: body.description, isTemplate: body.isTemplate, actorUserId: user.userId });

    return jsonSuccess(definition, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
