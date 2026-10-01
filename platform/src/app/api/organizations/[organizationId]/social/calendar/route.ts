import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getSocialCalendar } from "@/lib/social-os/calendar";
import { socialOrganicPlatformSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  view: z.enum(["day", "week", "month"]).default("week"),
  brandProfileId: z.string().uuid().optional(),
  platform: socialOrganicPlatformSchema.optional(),
  campaignId: z.string().uuid().optional(),
});

/** GET /api/organizations/{organizationId}/social/calendar?from=&to=&view=&brandProfileId=&platform=&campaignId= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const calendar = await getSocialCalendar(db, { organizationId, actorUserId: user.userId, ...q });
    return jsonSuccess(calendar);
  } catch (err) {
    return handleRouteError(err);
  }
}
