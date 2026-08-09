import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { listLeadsInQueue, countLeadsPerQueue, LEAD_QUEUES } from "@/lib/sales-os/lead-queues";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const queueSchema = z.enum(LEAD_QUEUES);

/** GET /api/organizations/{organizationId}/sales/lead-queues?queue=stale&ownerUserId=&teamId=&limit= — omit `queue` to get counts for every queue. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const rawQueue = url.searchParams.get("queue");

    if (!rawQueue) {
      const counts = await countLeadsPerQueue(db, { organizationId, actorUserId: user.userId });
      return jsonSuccess({ counts });
    }

    const queue = queueSchema.parse(rawQueue);
    const ownerUserId = url.searchParams.get("ownerUserId") ?? undefined;
    const teamId = url.searchParams.get("teamId") ?? undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;

    const leads = await listLeadsInQueue(db, { organizationId, queue, ownerUserId, teamId, limit, actorUserId: user.userId });
    return jsonSuccess({ leads });
  } catch (err) {
    return handleRouteError(err);
  }
}
