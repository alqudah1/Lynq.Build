import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { cancelWorkflowExecution } from "@/lib/workflows/executions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** POST /api/organizations/{organizationId}/workflow-executions/{executionId}/cancel */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, bodySchema);
    const execution = await cancelWorkflowExecution(db, { organizationId, executionId, expectedRevision: body.expectedRevision, actorUserId: user.userId });

    return jsonSuccess(execution);
  } catch (err) {
    return handleRouteError(err);
  }
}
