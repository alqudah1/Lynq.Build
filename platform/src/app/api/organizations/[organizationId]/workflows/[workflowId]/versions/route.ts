import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createWorkflowVersion, listWorkflowVersions } from "@/lib/workflows/versions";
import { workflowNameSchema, workflowDescriptionSchema } from "@/lib/workflows/validation";

export const dynamic = "force-dynamic";

const createVersionBodySchema = z
  .object({
    name: workflowNameSchema.optional(),
    description: workflowDescriptionSchema,
    inputSchema: z.unknown().optional(),
    outputSchema: z.unknown().optional(),
    changeReason: z.string().trim().max(1000).optional(),
    cloneFromVersionId: uuidParam.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; workflowId: string }> };

/** GET /api/organizations/{organizationId}/workflows/{workflowId}/versions */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const versions = await listWorkflowVersions(db, { organizationId, definitionId, actorUserId: user.userId });
    return jsonSuccess({ versions });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/workflows/{workflowId}/versions */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createVersionBodySchema);
    const version = await createWorkflowVersion(db, { organizationId, definitionId, ...body, actorUserId: user.userId });

    return jsonSuccess(version, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
