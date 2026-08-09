import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { listWorkflowExecutionTimeline } from "@/lib/workflows/executions";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** GET /api/organizations/{organizationId}/workflow-executions/{executionId}/timeline — query param: limit? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const limit = z.coerce.number().int().min(1).max(200).optional().parse(url.searchParams.get("limit") ?? undefined);

    const events = await listWorkflowExecutionTimeline(db, { organizationId, executionId, actorUserId: user.userId, limit });
    return jsonSuccess({ events });
  } catch (err) {
    return handleRouteError(err);
  }
}
