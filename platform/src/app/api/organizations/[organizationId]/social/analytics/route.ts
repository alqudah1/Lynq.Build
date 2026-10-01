import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getSocialAnalytics } from "@/lib/social-os/analytics";
import { socialPlatformSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({ days: z.coerce.number().int().min(1).max(365).optional(), brandProfileId: z.string().uuid().optional(), platform: socialPlatformSchema.optional(), campaignId: z.string().uuid().optional() });

/** GET /api/organizations/{organizationId}/social/analytics?days=&brandProfileId=&platform=&campaignId= — synced + recorded performance (null = no data). */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const analytics = await getSocialAnalytics(db, { organizationId, actorUserId: user.userId, ...q });
    return jsonSuccess(analytics);
  } catch (err) {
    return handleRouteError(err);
  }
}
