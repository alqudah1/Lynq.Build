import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { getJob } from "@/lib/runtime/queue";
import { RuntimeJobNotFoundError } from "@/lib/runtime/errors";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; jobId: string }> };

/** GET /api/organizations/{organizationId}/runtime/jobs/{jobId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, jobId: rawJobId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const jobId = parseUuidParam(rawJobId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await requireOrganizationMembership(db, organizationId, user.userId);

    const job = await getJob(db, jobId);
    if (job.organizationId !== organizationId) throw new RuntimeJobNotFoundError();

    return jsonSuccess(job);
  } catch (err) {
    return handleRouteError(err);
  }
}
