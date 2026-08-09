import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeAttentionItems } from "@/lib/founder-os/attention-engine";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({ workspaceId: z.string().uuid().optional() });

/** GET /api/organizations/{organizationId}/founder/attention — deterministic cross-domain attention items, most severe first. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams));

    const items = await computeAttentionItems(db, { organizationId, workspaceId: parsed.workspaceId ?? null, actorUserId: user.userId });
    return jsonSuccess({ items });
  } catch (err) {
    return handleRouteError(err);
  }
}
