import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getBulkBatchForUser } from "@/lib/communications-os/bulk";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; batchId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, batchId: rawBatch } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const batchId = parseUuidParam(rawBatch);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const batch = await getBulkBatchForUser(db, { organizationId, batchId, actorUserId: user.userId });
    return jsonSuccess(batch);
  } catch (err) {
    return handleRouteError(err);
  }
}
