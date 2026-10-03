import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { escalateItem, hideItem, ignoreItem, markNeedsReply } from "@/lib/social-os/engagement";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; itemId: string }> };

const bodySchema = z.object({ action: z.enum(["hide", "ignore", "needs_reply", "escalate"]), expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/social/inbox/{itemId}/status — hide | ignore | needs_reply | escalate. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, itemId: rawItemId } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const itemId = parseUuidParam(rawItemId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const args = { organizationId, engagementItemId: itemId, actorUserId: user.userId, expectedRevision: body.expectedRevision };
    const item = body.action === "hide" ? await hideItem(db, args) : body.action === "ignore" ? await ignoreItem(db, args) : body.action === "needs_reply" ? await markNeedsReply(db, args) : await escalateItem(db, args);
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
