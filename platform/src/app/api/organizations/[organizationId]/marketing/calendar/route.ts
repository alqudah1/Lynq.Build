import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getMarketingCalendar } from "@/lib/marketing-os/calendar";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/marketing/calendar?from=&to=&campaignId=&channel= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = toParam ? new Date(toParam) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const campaignId = url.searchParams.get("campaignId") ?? undefined;
    const channel = url.searchParams.get("channel") ?? undefined;

    const events = await getMarketingCalendar(db, { organizationId, actorUserId: user.userId, from, to, campaignId, channel });
    return jsonSuccess({ events });
  } catch (err) {
    return handleRouteError(err);
  }
}
