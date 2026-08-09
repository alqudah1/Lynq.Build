import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { snapshotBulkRecipients } from "@/lib/communications-os/bulk";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; batchId: string }> };
const bodySchema = z.object({ contactIds: z.array(z.string().uuid()).min(1).max(2000) }).strict();

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, batchId: rawBatch } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const batchId = parseUuidParam(rawBatch);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const result = await snapshotBulkRecipients(db, { organizationId, batchId, contactIds: body.contactIds, actorUserId: user.userId });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
