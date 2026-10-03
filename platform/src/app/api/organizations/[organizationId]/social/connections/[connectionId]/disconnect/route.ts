import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { disconnectConnection } from "@/lib/social-os/connections";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; connectionId: string }> };

const disconnectBodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/social/connections/{connectionId}/disconnect */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, connectionId: rawConnection } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const connectionId = parseUuidParam(rawConnection);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, disconnectBodySchema);
    const connection = await disconnectConnection(db, { organizationId, connectionId, actorUserId: user.userId, expectedRevision: body.expectedRevision });
    return jsonSuccess(connection);
  } catch (err) {
    return handleRouteError(err);
  }
}
