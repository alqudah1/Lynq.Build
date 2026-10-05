import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { cancelAdChange } from "@/lib/social-os/advertising";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; changeId: string }> };

const bodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/social/advertising/changes/{changeId}/cancel — cancel a proposed or pending change. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, changeId: rawChangeId } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const changeId = parseUuidParam(rawChangeId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const change = await cancelAdChange(db, { organizationId, changeRequestId: changeId, actorUserId: user.userId, ...body });
    return jsonSuccess(change);
  } catch (err) {
    return handleRouteError(err);
  }
}
