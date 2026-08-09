import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { getTaskForUser, updateTask, listTaskAssignments } from "@/lib/projects/tasks";
import { listDependenciesForTask } from "@/lib/projects/dependencies";
import { taskTitleSchema, projectDescriptionSchema, projectPrioritySchema, projectTaskTypeSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const updateTaskBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    title: taskTitleSchema.optional(),
    description: projectDescriptionSchema,
    priority: projectPrioritySchema.optional(),
    taskType: projectTaskTypeSchema.optional(),
    phaseId: uuidParam.nullable().optional(),
    milestoneId: uuidParam.nullable().optional(),
    parentTaskId: uuidParam.nullable().optional(),
    startDate: z.string().datetime().nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
    position: z.number().int().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string; taskId: string }> };

/** GET /api/organizations/{organizationId}/projects/{projectId}/tasks/{taskId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, taskId: rawTaskId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const taskId = parseUuidParam(rawTaskId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const task = await getTaskForUser(db, { organizationId, taskId, actorUserId: user.userId });
    const [assignments, dependencies] = await Promise.all([listTaskAssignments(db, task.id), listDependenciesForTask(db, organizationId, task.id)]);

    return jsonSuccess({ ...task, assignments, dependencies });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/projects/{projectId}/tasks/{taskId} — also covers "move task" (phase/milestone/parent/position are just fields). */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, taskId: rawTaskId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const taskId = parseUuidParam(rawTaskId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateTaskBodySchema);
    const { expectedRevision, startDate, dueDate, ...rest } = body;

    const task = await updateTask(db, {
      organizationId,
      taskId,
      expectedRevision,
      actorUserId: user.userId,
      updates: { ...rest, startDate: startDate === undefined ? undefined : startDate ? new Date(startDate) : null, dueDate: dueDate === undefined ? undefined : dueDate ? new Date(dueDate) : null },
    });

    return jsonSuccess(task);
  } catch (err) {
    return handleRouteError(err);
  }
}
