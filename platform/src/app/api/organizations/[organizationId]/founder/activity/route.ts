import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeExecutiveActivityFeed } from "@/lib/founder-os/activity-feed";
import { MAX_ACTIVITY_FEED_ITEMS } from "@/lib/founder-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(MAX_ACTIVITY_FEED_ITEMS).optional() });

/** GET /api/organizations/{organizationId}/founder/activity — bounded, curated executive activity feed. Never every audit event. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams));

    const items = await computeExecutiveActivityFeed(db, { organizationId, actorUserId: user.userId, limit: parsed.limit });
    return jsonSuccess({ items });
  } catch (err) {
    return handleRouteError(err);
  }
}
