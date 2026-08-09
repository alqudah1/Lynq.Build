import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { retryDeadLetteredJob } from "@/lib/runtime/dead-letter";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; jobId: string }> };

/** POST /api/organizations/{organizationId}/runtime/jobs/{jobId}/retry — only dead-lettered jobs are manually retryable; anything else 409s. */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, jobId: rawJobId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const jobId = parseUuidParam(rawJobId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const job = await retryDeadLetteredJob(db, { organizationId, jobId, actorUserId: user.userId });
    return jsonSuccess(job);
  } catch (err) {
    return handleRouteError(err);
  }
}
