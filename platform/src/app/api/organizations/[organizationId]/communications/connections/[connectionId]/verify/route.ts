import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { verifyConnection } from "@/lib/communications-os/connections";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; connectionId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, connectionId: rawConn } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const connectionId = parseUuidParam(rawConn);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const connection = await verifyConnection(db, { organizationId, connectionId, actorUserId: user.userId });
    return jsonSuccess(connection);
  } catch (err) {
    return handleRouteError(err);
  }
}
