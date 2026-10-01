import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { listPublishJobs } from "@/lib/social-os/publishing";
import { socialPublishJobStatusSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({ status: socialPublishJobStatusSchema.optional(), brandProfileId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).optional() });

/** GET /api/organizations/{organizationId}/social/publishing?status=&brandProfileId=&limit= — the publish queue and its history. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const jobs = await listPublishJobs(db, { organizationId, actorUserId: user.userId, ...q });
    return jsonSuccess({ jobs });
  } catch (err) {
    return handleRouteError(err);
  }
}
