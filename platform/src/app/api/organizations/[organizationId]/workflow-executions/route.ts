import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, uuidParam } from "@/lib/http/validation";
import { listWorkflowExecutionsForUser } from "@/lib/workflows/executions";
import { workflowExecutionStatusSchema } from "@/lib/workflows/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/workflow-executions — query params: workflowDefinitionId?, status?, projectId? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({ workflowDefinitionId: uuidParam.optional(), status: workflowExecutionStatusSchema.optional(), projectId: uuidParam.optional() })
      .parse({ workflowDefinitionId: url.searchParams.get("workflowDefinitionId") ?? undefined, status: url.searchParams.get("status") ?? undefined, projectId: url.searchParams.get("projectId") ?? undefined });

    const executions = await listWorkflowExecutionsForUser(db, { organizationId, actorUserId: user.userId, ...query });
    return jsonSuccess({ executions });
  } catch (err) {
    return handleRouteError(err);
  }
}
