import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createCampaign, listCampaignsForUser } from "@/lib/marketing-os/campaigns";
import { marketingKeySchema, marketingNameSchema, marketingObjectiveTargetsSchema, marketingObjectiveTypeSchema, marketingCampaignStatusSchema } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createCampaignBodySchema = z
  .object({
    campaignKey: marketingKeySchema,
    name: marketingNameSchema,
    description: z.string().trim().max(5000).optional(),
    objectiveType: marketingObjectiveTypeSchema.optional(),
    objectiveTargets: marketingObjectiveTargetsSchema.optional(),
    workspaceId: z.string().uuid().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    startDate: z.coerce.date().nullable().optional(),
    endDate: z.coerce.date().nullable().optional(),
    budgetAmount: z.number().nonnegative().nullable().optional(),
    currency: z.string().trim().length(3).toUpperCase().nullable().optional(),
    primaryAudienceId: z.string().uuid().nullable().optional(),
    sourceId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/marketing/campaigns?status=&ownerUserId= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const status = statusParam ? marketingCampaignStatusSchema.parse(statusParam) : undefined;
    const ownerUserId = url.searchParams.get("ownerUserId") ?? undefined;

    const campaigns = await listCampaignsForUser(db, { organizationId, actorUserId: user.userId, status, ownerUserId });
    return jsonSuccess({ campaigns });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/marketing/campaigns */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createCampaignBodySchema);
    const campaign = await createCampaign(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(campaign, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
