import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getRuntimeStatus } from "@/lib/runtime/status";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/runtime/status — any org member may inspect (read-only, no business-data exposure beyond counts/timings). */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const status = await getRuntimeStatus(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess(status);
  } catch (err) {
    return handleRouteError(err);
  }
}
