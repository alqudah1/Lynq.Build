import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { getPipelineForUser, updatePipeline, setDefaultPipeline } from "@/lib/crm/pipelines";
import { crmNameSchema, crmPipelineStatusSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const updatePipelineBodySchema = z
  .object({ expectedRevision: z.number().int().min(1), name: crmNameSchema.optional(), description: z.string().trim().max(5000).nullable().optional(), status: crmPipelineStatusSchema.optional(), setDefault: z.boolean().optional() })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; pipelineId: string }> };

/** GET /api/organizations/{organizationId}/crm/pipelines/{pipelineId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, pipelineId: rawPipelineId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const pipelineId = parseUuidParam(rawPipelineId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const pipeline = await getPipelineForUser(db, { organizationId, pipelineId, actorUserId: user.userId });
    return jsonSuccess(pipeline);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/crm/pipelines/{pipelineId} — `setDefault: true` promotes this pipeline (via the explicit two-step demote/promote operation) instead of updating fields. */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, pipelineId: rawPipelineId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const pipelineId = parseUuidParam(rawPipelineId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updatePipelineBodySchema);

    if (body.setDefault) {
      const pipeline = await setDefaultPipeline(db, { organizationId, pipelineId, actorUserId: user.userId });
      return jsonSuccess(pipeline);
    }

    const { setDefault: _setDefault, expectedRevision, ...fields } = body;
    void _setDefault;
    const updated = await updatePipeline(db, { organizationId, pipelineId, expectedRevision, actorUserId: user.userId, ...fields });
    return jsonSuccess(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
