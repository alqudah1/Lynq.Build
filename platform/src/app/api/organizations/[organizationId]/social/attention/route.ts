import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeSocialAttention } from "@/lib/social-os/attention";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({ brandProfileId: z.string().uuid().optional() });

/** GET /api/organizations/{organizationId}/social/attention?brandProfileId= — the deterministic daily manager. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const attention = await computeSocialAttention(db, { organizationId, actorUserId: user.userId, brandProfileId: q.brandProfileId });
    return jsonSuccess(attention);
  } catch (err) {
    return handleRouteError(err);
  }
}
