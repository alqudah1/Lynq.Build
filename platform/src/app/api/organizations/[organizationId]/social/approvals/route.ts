import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { listPendingApprovals } from "@/lib/social-os/content";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({ brandProfileId: z.string().uuid().optional() });

/** GET /api/organizations/{organizationId}/social/approvals?brandProfileId= — posts awaiting a human decision. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const approvals = await listPendingApprovals(db, { organizationId, actorUserId: user.userId, brandProfileId: q.brandProfileId });
    return jsonSuccess({ approvals });
  } catch (err) {
    return handleRouteError(err);
  }
}
