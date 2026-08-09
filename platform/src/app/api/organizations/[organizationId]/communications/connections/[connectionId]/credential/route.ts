import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { storeConnectionCredential } from "@/lib/communications-os/connections";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; connectionId: string }> };

const bodySchema = z.object({ secret: z.string().trim().min(1).max(2000) }).strict();

/** Never returns the secret — only confirms it was stored (encrypted). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, connectionId: rawConn } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const connectionId = parseUuidParam(rawConn);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const result = await storeConnectionCredential(db, { organizationId, connectionId, secret: body.secret, actorUserId: user.userId });
    return jsonSuccess({ credentialId: result.credentialId, stored: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
