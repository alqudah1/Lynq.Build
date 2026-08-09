import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeNextBestActionsForUser } from "@/lib/sales-os/next-best-action";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/sales/next-actions?forUserId= — deterministic, reason-coded recommendations; defaults to the caller. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const forUserId = url.searchParams.get("forUserId") ?? user.userId;

    const actions = await computeNextBestActionsForUser(db, { organizationId, forUserId, actorUserId: user.userId });
    return jsonSuccess({ actions });
  } catch (err) {
    return handleRouteError(err);
  }
}
