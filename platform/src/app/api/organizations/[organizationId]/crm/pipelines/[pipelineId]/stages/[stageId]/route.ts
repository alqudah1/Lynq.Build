import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { updateStage, reorderStage } from "@/lib/crm/stages";
import { crmNameSchema, crmProbabilitySchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const patchBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    name: crmNameSchema.optional(),
    stageType: z.string().trim().max(100).nullable().optional(),
    probability: crmProbabilitySchema.nullable().optional(),
    isClosed: z.boolean().optional(),
    isWon: z.boolean().optional(),
    isLost: z.boolean().optional(),
    targetIndex: z.number().int().min(0).optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; pipelineId: string; stageId: string }> };

/** PATCH /api/organizations/{organizationId}/crm/pipelines/{pipelineId}/stages/{stageId} — providing `targetIndex` reorders (gap-based) instead of updating fields. */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, pipelineId: rawPipelineId, stageId: rawStageId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const pipelineId = parseUuidParam(rawPipelineId);
    const stageId = parseUuidParam(rawStageId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, patchBodySchema);

    if (body.targetIndex !== undefined) {
      const stages = await reorderStage(db, { organizationId, pipelineId, stageId, targetIndex: body.targetIndex, actorUserId: user.userId });
      return jsonSuccess({ stages });
    }

    const { targetIndex: _targetIndex, expectedRevision, ...fields } = body;
    void _targetIndex;
    const updated = await updateStage(db, { organizationId, pipelineId, stageId, expectedRevision, actorUserId: user.userId, ...fields });
    return jsonSuccess(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
