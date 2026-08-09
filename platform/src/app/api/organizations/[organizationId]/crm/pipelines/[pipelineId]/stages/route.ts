import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createStage, listStagesForPipeline } from "@/lib/crm/stages";
import { crmNameSchema, crmKeySchema, crmProbabilitySchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createStageBodySchema = z
  .object({
    name: crmNameSchema,
    stageKey: crmKeySchema,
    stageType: z.string().trim().max(100).optional(),
    probability: crmProbabilitySchema.optional(),
    isClosed: z.boolean().optional(),
    isWon: z.boolean().optional(),
    isLost: z.boolean().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; pipelineId: string }> };

/** GET /api/organizations/{organizationId}/crm/pipelines/{pipelineId}/stages */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, pipelineId: rawPipelineId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const pipelineId = parseUuidParam(rawPipelineId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const stages = await listStagesForPipeline(db, { organizationId, pipelineId, actorUserId: user.userId });
    return jsonSuccess({ stages });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/pipelines/{pipelineId}/stages */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, pipelineId: rawPipelineId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const pipelineId = parseUuidParam(rawPipelineId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createStageBodySchema);
    const stage = await createStage(db, { organizationId, pipelineId, actorUserId: user.userId, ...body });

    return jsonSuccess(stage, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
