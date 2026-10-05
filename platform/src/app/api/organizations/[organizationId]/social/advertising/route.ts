import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getAdCommandCenter } from "@/lib/social-os/advertising";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({ brandProfileId: z.string().uuid().optional(), days: z.coerce.number().int().min(1).max(365).optional() });

/** GET /api/organizations/{organizationId}/social/advertising?brandProfileId=&days= — ad accounts, campaigns, anomalies and change requests. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const center = await getAdCommandCenter(db, { organizationId, actorUserId: user.userId, ...q });
    return jsonSuccess(center);
  } catch (err) {
    return handleRouteError(err);
  }
}
