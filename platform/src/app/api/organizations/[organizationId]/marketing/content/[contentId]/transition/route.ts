import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { scheduleContent, confirmContentPublished, archiveContentItem } from "@/lib/marketing-os/content";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; contentId: string }> };

const transitionBodySchema = z.object({ toStatus: z.enum(["scheduled", "published", "archived"]), expectedRevision: z.number().int().min(1) }).strict();

/**
 * POST /api/organizations/{organizationId}/marketing/content/{contentId}/transition
 * Only the transitions that don't require a Runtime approval decision as
 * their trigger — `scheduled`/`published`/`archived`. `review`/`approved`/
 * `rejected` go through `/submit` and the approval-decision route instead,
 * since those are driven by a real Runtime approval request.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, contentId: rawContent } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentItemId = parseUuidParam(rawContent);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, transitionBodySchema);
    const input = { organizationId, contentItemId, expectedRevision: body.expectedRevision, actorUserId: user.userId };
    const item = body.toStatus === "scheduled" ? await scheduleContent(db, { ...input, toStatus: "scheduled" }) : body.toStatus === "published" ? await confirmContentPublished(db, { ...input, toStatus: "published" }) : await archiveContentItem(db, { ...input, toStatus: "archived" });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
