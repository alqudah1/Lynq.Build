import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { generateVariantsForItem } from "@/lib/social-os/studio";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; contentItemId: string }> };

// The body is optional: an empty POST generates with the stored brief alone.
const bodySchema = z.object({ instruction: z.string().trim().max(1000).optional() }).strict().optional();

/** POST /api/organizations/{organizationId}/social/content/{contentItemId}/generate — writes platform-specific copy into every draft variant (drafts only; nothing is submitted). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, contentItemId: rawItem } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentItemId = parseUuidParam(rawItem);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const result = await generateVariantsForItem(db, { organizationId, contentItemId, actorUserId: user.userId, instruction: body?.instruction });
    return jsonSuccess(result, 200);
  } catch (err) {
    return handleRouteError(err);
  }
}
