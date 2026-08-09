import "server-only";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { runtimeJobs } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { runtimeJobStatusSchema, runtimeJobTypeSchema } from "@/lib/runtime/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/runtime/jobs — query params: status?, jobType?, limit? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await requireOrganizationMembership(db, organizationId, user.userId);

    const url = new URL(request.url);
    const query = z
      .object({ status: runtimeJobStatusSchema.optional(), jobType: runtimeJobTypeSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(20) })
      .parse({ status: url.searchParams.get("status") ?? undefined, jobType: url.searchParams.get("jobType") ?? undefined, limit: url.searchParams.get("limit") ?? undefined });

    const conditions = [eq(runtimeJobs.organizationId, organizationId)];
    if (query.status) conditions.push(eq(runtimeJobs.status, query.status));
    if (query.jobType) conditions.push(eq(runtimeJobs.jobType, query.jobType));

    const jobs = await db
      .select()
      .from(runtimeJobs)
      .where(and(...conditions))
      .orderBy(desc(runtimeJobs.createdAt))
      .limit(query.limit);

    return jsonSuccess({ jobs });
  } catch (err) {
    return handleRouteError(err);
  }
}
