import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createProject, listProjectsForUser } from "@/lib/projects/projects";
import { calculateProjectProgress } from "@/lib/projects/progress";
import { projectKeySchema, projectNameSchema, projectDescriptionSchema, projectPrioritySchema, projectStatusSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const createProjectBodySchema = z
  .object({
    workspaceId: uuidParam.optional(),
    name: projectNameSchema,
    projectKey: projectKeySchema,
    description: projectDescriptionSchema,
    objective: z.string().trim().max(2000).optional(),
    priority: projectPrioritySchema.optional(),
    startDate: z.string().datetime().optional(),
    targetDate: z.string().datetime().optional(),
    ownerUserId: uuidParam.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/projects — query params: workspaceId?, status? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({ workspaceId: uuidParam.optional(), status: projectStatusSchema.optional() })
      .parse({ workspaceId: url.searchParams.get("workspaceId") ?? undefined, status: url.searchParams.get("status") ?? undefined });

    const list = await listProjectsForUser(db, { organizationId, actorUserId: user.userId, workspaceId: query.workspaceId, status: query.status });
    const withProgress = await Promise.all(list.map(async (project) => ({ ...project, progress: await calculateProjectProgress(db, organizationId, project.id) })));

    return jsonSuccess({ projects: withProgress });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/projects */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createProjectBodySchema);

    const project = await createProject(db, {
      organizationId,
      workspaceId: body.workspaceId ?? null,
      name: body.name,
      projectKey: body.projectKey,
      description: body.description ?? null,
      objective: body.objective ?? null,
      priority: body.priority,
      startDate: body.startDate ? new Date(body.startDate) : null,
      targetDate: body.targetDate ? new Date(body.targetDate) : null,
      ownerUserId: body.ownerUserId,
      actorUserId: user.userId,
    });

    return jsonSuccess(project, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
