import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { startWorkflowExecution } from "@/lib/workflows/executions";

export const dynamic = "force-dynamic";

const startExecutionBodySchema = z
  .object({
    projectId: uuidParam.optional(),
    projectTaskId: uuidParam.optional(),
    input: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; workflowId: string }> };

/** POST /api/organizations/{organizationId}/workflows/{workflowId}/executions — starts a new execution of the workflow's current published version. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, startExecutionBodySchema);
    const execution = await startWorkflowExecution(db, { organizationId, definitionId, projectId: body.projectId, projectTaskId: body.projectTaskId, input: body.input, actorUserId: user.userId });

    return jsonSuccess(execution, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
