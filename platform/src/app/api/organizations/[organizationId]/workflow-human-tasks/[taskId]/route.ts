import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { getWorkflowHumanTaskForUser, completeWorkflowHumanTask } from "@/lib/workflows/human-tasks";

export const dynamic = "force-dynamic";

const completeBodySchema = z.object({ expectedRevision: z.number().int().min(1), outputData: z.record(z.string(), z.unknown()).optional() }).strict();

type RouteParams = { params: Promise<{ organizationId: string; taskId: string }> };

/** GET /api/organizations/{organizationId}/workflow-human-tasks/{taskId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, taskId: rawTaskId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const taskId = parseUuidParam(rawTaskId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const task = await getWorkflowHumanTaskForUser(db, { organizationId, taskId, actorUserId: user.userId });
    return jsonSuccess(task);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/workflow-human-tasks/{taskId} — completes the task. */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, taskId: rawTaskId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const taskId = parseUuidParam(rawTaskId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, completeBodySchema);
    const task = await completeWorkflowHumanTask(db, { organizationId, taskId, expectedRevision: body.expectedRevision, outputData: body.outputData, actorUserId: user.userId });

    return jsonSuccess(task);
  } catch (err) {
    return handleRouteError(err);
  }
}
