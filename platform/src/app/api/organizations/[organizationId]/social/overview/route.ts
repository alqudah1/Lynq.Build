import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getSocialOverview } from "@/lib/social-os/overview";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({ brandProfileId: z.string().uuid().optional() });

/** GET /api/organizations/{organizationId}/social/overview?brandProfileId= — the Social home screen. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const overview = await getSocialOverview(db, { organizationId, actorUserId: user.userId, brandProfileId: q.brandProfileId });
    return jsonSuccess(overview);
  } catch (err) {
    return handleRouteError(err);
  }
}
