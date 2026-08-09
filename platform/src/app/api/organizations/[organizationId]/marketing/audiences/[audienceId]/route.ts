import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { getAudienceForUser, updateAudience } from "@/lib/marketing-os/audiences";
import { marketingNameSchema, marketingAudienceEvaluationModeSchema, marketingAudienceFilterDefinitionSchema } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; audienceId: string }> };

const updateAudienceBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    name: marketingNameSchema.optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    filterDefinition: marketingAudienceFilterDefinitionSchema.optional(),
    evaluationMode: marketingAudienceEvaluationModeSchema.optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/marketing/audiences/{audienceId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, audienceId: rawAudience } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const audienceId = parseUuidParam(rawAudience);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const audience = await getAudienceForUser(db, { organizationId, audienceId, actorUserId: user.userId });
    return jsonSuccess(audience);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/marketing/audiences/{audienceId} */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, audienceId: rawAudience } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const audienceId = parseUuidParam(rawAudience);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateAudienceBodySchema);
    const audience = await updateAudience(db, { organizationId, audienceId, actorUserId: user.userId, ...body });
    return jsonSuccess(audience);
  } catch (err) {
    return handleRouteError(err);
  }
}
