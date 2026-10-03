import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { proposeAdChange } from "@/lib/social-os/advertising";
import { socialAdChangeTypeSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const bodySchema = z
  .object({
    channelAccountId: z.string().uuid(),
    changeType: socialAdChangeTypeSchema,
    title: z.string().trim().min(1).max(200),
    rationale: z.string().trim().max(4000).optional(),
    payload: z.record(z.string(), z.unknown()),
    externalCampaignId: z.string().trim().max(100).nullable().optional(),
    estimatedDailySpendMinor: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    currency: z.string().trim().length(3).optional(),
  })
  .strict();

/** POST /api/organizations/{organizationId}/social/advertising/changes — propose an ad change (nothing executes until approved). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const change = await proposeAdChange(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(change, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
