import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createAudience, listAudiencesForUser } from "@/lib/marketing-os/audiences";
import { marketingKeySchema, marketingNameSchema, marketingAudienceEntityTypeSchema, marketingAudienceEvaluationModeSchema, marketingAudienceFilterDefinitionSchema } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createAudienceBodySchema = z
  .object({
    name: marketingNameSchema,
    audienceKey: marketingKeySchema,
    description: z.string().trim().max(5000).optional(),
    entityType: marketingAudienceEntityTypeSchema,
    filterDefinition: marketingAudienceFilterDefinitionSchema.optional(),
    evaluationMode: marketingAudienceEvaluationModeSchema.optional(),
    workspaceId: z.string().uuid().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/marketing/audiences */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const audiences = await listAudiencesForUser(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ audiences });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/marketing/audiences */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createAudienceBodySchema);
    const audience = await createAudience(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(audience, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
