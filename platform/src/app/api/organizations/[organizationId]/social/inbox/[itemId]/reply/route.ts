import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { sendReply } from "@/lib/social-os/engagement";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; itemId: string }> };

const bodySchema = z.object({ text: z.string().trim().min(1).max(8000), expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/social/inbox/{itemId}/reply — a human sends the (edited) reply publicly. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, itemId: rawItemId } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const itemId = parseUuidParam(rawItemId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const item = await sendReply(db, { organizationId, engagementItemId: itemId, actorUserId: user.userId, expectedRevision: body.expectedRevision, text: body.text });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
