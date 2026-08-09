import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { transitionTaskStatus } from "@/lib/projects/tasks";
import { projectTaskStatusSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const transitionBodySchema = z.object({ toStatus: projectTaskStatusSchema, expectedRevision: z.number().int().min(1) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string; taskId: string }> };

/** POST /api/organizations/{organizationId}/projects/{projectId}/tasks/{taskId}/transition — also covers "complete task"/"block/unblock task"/"cancel task" (all are just a `toStatus`). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, taskId: rawTaskId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const taskId = parseUuidParam(rawTaskId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, transitionBodySchema);
    const task = await transitionTaskStatus(db, { organizationId, taskId, toStatus: body.toStatus, expectedRevision: body.expectedRevision, actorUserId: user.userId });

    return jsonSuccess(task);
  } catch (err) {
    return handleRouteError(err);
  }
}
