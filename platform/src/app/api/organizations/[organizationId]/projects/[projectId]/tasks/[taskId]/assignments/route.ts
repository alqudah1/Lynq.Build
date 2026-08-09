import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { assignTask, listTaskAssignments } from "@/lib/projects/tasks";

export const dynamic = "force-dynamic";

const assignBodySchema = z.object({ userId: uuidParam }).strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string; taskId: string }> };

/** GET /api/organizations/{organizationId}/projects/{projectId}/tasks/{taskId}/assignments */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { taskId: rawTaskId } = await params;
    const taskId = parseUuidParam(rawTaskId);

    const env = loadEnv();
    const db = createDbClient(env);
    await getAuthenticatedUser(db);

    const assignments = await listTaskAssignments(db, taskId);
    return jsonSuccess({ assignments });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/projects/{projectId}/tasks/{taskId}/assignments — human assignment only; agent involvement is `.../agent-execution`. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, taskId: rawTaskId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const taskId = parseUuidParam(rawTaskId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, assignBodySchema);
    const assignment = await assignTask(db, { organizationId, taskId, targetUserId: body.userId, actorUserId: user.userId });

    return jsonSuccess(assignment, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
