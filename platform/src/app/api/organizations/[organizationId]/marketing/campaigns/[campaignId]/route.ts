import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { getCampaignForUser, updateCampaign } from "@/lib/marketing-os/campaigns";
import { marketingNameSchema, marketingObjectiveTargetsSchema, marketingObjectiveTypeSchema } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; campaignId: string }> };

const updateCampaignBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    name: marketingNameSchema.optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    objectiveType: marketingObjectiveTypeSchema.optional(),
    objectiveTargets: marketingObjectiveTargetsSchema.optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    startDate: z.coerce.date().nullable().optional(),
    endDate: z.coerce.date().nullable().optional(),
    budgetAmount: z.number().nonnegative().nullable().optional(),
    currency: z.string().trim().length(3).toUpperCase().nullable().optional(),
    primaryAudienceId: z.string().uuid().nullable().optional(),
    sourceId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/marketing/campaigns/{campaignId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, campaignId: rawCampaign } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const campaignId = parseUuidParam(rawCampaign);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const campaign = await getCampaignForUser(db, { organizationId, campaignId, actorUserId: user.userId });
    return jsonSuccess(campaign);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/marketing/campaigns/{campaignId} */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, campaignId: rawCampaign } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const campaignId = parseUuidParam(rawCampaign);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateCampaignBodySchema);
    const campaign = await updateCampaign(db, { organizationId, campaignId, actorUserId: user.userId, ...body });
    return jsonSuccess(campaign);
  } catch (err) {
    return handleRouteError(err);
  }
}
