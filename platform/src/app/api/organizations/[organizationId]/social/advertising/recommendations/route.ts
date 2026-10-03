import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { generateAdRecommendations } from "@/lib/social-os/advertising";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const bodySchema = z.object({ channelAccountId: z.string().uuid() }).strict();

/** POST /api/organizations/{organizationId}/social/advertising/recommendations — AI recommendations grounded only in synced campaign data, saved as proposed changes. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const result = await generateAdRecommendations(db, { organizationId, channelAccountId: body.channelAccountId, actorUserId: user.userId });
    return jsonSuccess(result, result.available ? 201 : 200);
  } catch (err) {
    return handleRouteError(err);
  }
}
