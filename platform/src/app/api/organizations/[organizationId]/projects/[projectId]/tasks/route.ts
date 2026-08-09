import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createTask, listTasks } from "@/lib/projects/tasks";
import { taskTitleSchema, projectDescriptionSchema, projectPrioritySchema, projectTaskTypeSchema, projectTaskStatusSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const createTaskBodySchema = z
  .object({
    phaseId: uuidParam.optional(),
    milestoneId: uuidParam.optional(),
    parentTaskId: uuidParam.optional(),
    title: taskTitleSchema,
    description: projectDescriptionSchema,
    priority: projectPrioritySchema.optional(),
    taskType: projectTaskTypeSchema.optional(),
    startDate: z.string().datetime().optional(),
    dueDate: z.string().datetime().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string }> };

/** GET /api/organizations/{organizationId}/projects/{projectId}/tasks — query params: status?, phaseId?, milestoneId?, topLevelOnly? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({ status: projectTaskStatusSchema.optional(), phaseId: uuidParam.optional(), milestoneId: uuidParam.optional(), topLevelOnly: z.coerce.boolean().optional() })
      .parse({
        status: url.searchParams.get("status") ?? undefined,
        phaseId: url.searchParams.get("phaseId") ?? undefined,
        milestoneId: url.searchParams.get("milestoneId") ?? undefined,
        topLevelOnly: url.searchParams.get("topLevelOnly") ?? undefined,
      });

    const tasks = await listTasks(db, { organizationId, projectId, actorUserId: user.userId, ...query });
    return jsonSuccess({ tasks });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/projects/{projectId}/tasks — also creates a subtask when `parentTaskId` is given. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createTaskBodySchema);
    const task = await createTask(db, {
      organizationId,
      projectId,
      phaseId: body.phaseId ?? null,
      milestoneId: body.milestoneId ?? null,
      parentTaskId: body.parentTaskId ?? null,
      title: body.title,
      description: body.description ?? null,
      priority: body.priority,
      taskType: body.taskType,
      startDate: body.startDate ? new Date(body.startDate) : null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      actorUserId: user.userId,
    });

    return jsonSuccess(task, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
