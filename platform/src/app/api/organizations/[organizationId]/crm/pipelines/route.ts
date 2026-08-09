import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createPipeline, listPipelinesForUser } from "@/lib/crm/pipelines";
import { crmNameSchema, crmKeySchema, crmDescriptionSchema, crmPipelineStatusSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createPipelineBodySchema = z
  .object({ workspaceId: uuidParam.optional(), name: crmNameSchema, pipelineKey: crmKeySchema, description: crmDescriptionSchema, isDefault: z.boolean().optional() })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/pipelines — query params: workspaceId?, status? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({ workspaceId: uuidParam.optional(), status: crmPipelineStatusSchema.optional() })
      .parse({ workspaceId: url.searchParams.get("workspaceId") ?? undefined, status: url.searchParams.get("status") ?? undefined });

    const pipelines = await listPipelinesForUser(db, { organizationId, actorUserId: user.userId, ...query });
    return jsonSuccess({ pipelines });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/pipelines */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createPipelineBodySchema);
    const pipeline = await createPipeline(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(pipeline, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
