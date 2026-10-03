import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { retryPublishJob } from "@/lib/social-os/publishing";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; jobId: string }> };

/** POST /api/organizations/{organizationId}/social/publishing/{jobId}/retry — retry a failed publish as a new job series. */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, jobId: rawJob } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const publishJobId = parseUuidParam(rawJob);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const job = await retryPublishJob(db, { organizationId, publishJobId, actorUserId: user.userId });
    return jsonSuccess(job);
  } catch (err) {
    return handleRouteError(err);
  }
}
