import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getDeadLetteredJob } from "@/lib/runtime/dead-letter";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; jobId: string }> };

/** GET /api/organizations/{organizationId}/runtime/dead-letter/{jobId} — never exposes raw tool inputs/secrets, only the same bounded fields every other job row carries. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, jobId: rawJobId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const jobId = parseUuidParam(rawJobId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const job = await getDeadLetteredJob(db, { organizationId, jobId, actorUserId: user.userId });
    return jsonSuccess(job);
  } catch (err) {
    return handleRouteError(err);
  }
}
