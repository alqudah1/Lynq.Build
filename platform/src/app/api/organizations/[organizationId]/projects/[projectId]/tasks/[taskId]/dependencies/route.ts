import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { addDependency, listDependenciesForTask } from "@/lib/projects/dependencies";

export const dynamic = "force-dynamic";

const addDependencyBodySchema = z.object({ blockingTaskId: uuidParam }).strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string; taskId: string }> };

/** GET /api/organizations/{organizationId}/projects/{projectId}/tasks/{taskId}/dependencies — `{ blocks, blockedBy }`. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, taskId: rawTaskId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const taskId = parseUuidParam(rawTaskId);

    const env = loadEnv();
    const db = createDbClient(env);
    await getAuthenticatedUser(db);

    const dependencies = await listDependenciesForTask(db, organizationId, taskId);
    return jsonSuccess(dependencies);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/projects/{projectId}/tasks/{taskId}/dependencies — `taskId` (from the path) is blocked by `blockingTaskId` (from the body). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, taskId: rawTaskId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const taskId = parseUuidParam(rawTaskId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, addDependencyBodySchema);
    const dependency = await addDependency(db, { organizationId, blockedTaskId: taskId, blockingTaskId: body.blockingTaskId, actorUserId: user.userId });

    return jsonSuccess(dependency, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
