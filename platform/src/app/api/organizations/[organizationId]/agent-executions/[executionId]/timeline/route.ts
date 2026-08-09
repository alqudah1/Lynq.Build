import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { listLimitSchema } from "@/lib/agent-runtime/validation";
import { getExecutionForUser } from "@/lib/agent-runtime/executions";
import { getExecutionTimeline } from "@/lib/agent-runtime/events";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** GET .../{executionId}/timeline — §10's Execution Timeline: one task's ordered sequence of everything, from Assigned to Archived. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    // Establishes visibility (tenant/workspace) before returning any timeline detail.
    await getExecutionForUser(db, { organizationId, executionId, actorUserId: user.userId });

    const url = new URL(request.url);
    const query = z.object({ cursor: z.string().optional(), limit: listLimitSchema.optional() }).parse({ cursor: url.searchParams.get("cursor") ?? undefined, limit: url.searchParams.get("limit") ?? undefined });

    const result = await getExecutionTimeline(db, { organizationId, executionId, cursor: query.cursor ?? null, limit: query.limit });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
