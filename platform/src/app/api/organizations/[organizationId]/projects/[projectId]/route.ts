import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { getProjectForUser, updateProject } from "@/lib/projects/projects";
import { calculateProjectProgress } from "@/lib/projects/progress";
import { projectNameSchema, projectDescriptionSchema, projectPrioritySchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const updateProjectBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    name: projectNameSchema.optional(),
    description: projectDescriptionSchema,
    objective: z.string().trim().max(2000).nullable().optional(),
    priority: projectPrioritySchema.optional(),
    startDate: z.string().datetime().nullable().optional(),
    targetDate: z.string().datetime().nullable().optional(),
    ownerUserId: uuidParam.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string }> };

/** GET /api/organizations/{organizationId}/projects/{projectId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const project = await getProjectForUser(db, { organizationId, projectId, actorUserId: user.userId });
    const progress = await calculateProjectProgress(db, organizationId, projectId);

    return jsonSuccess({ ...project, progress });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/projects/{projectId} — `projectKey`/`status` are never accepted here (immutable / transition-only, respectively). */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateProjectBodySchema);
    const { expectedRevision, startDate, targetDate, ...rest } = body;

    const project = await updateProject(db, {
      organizationId,
      projectId,
      actorUserId: user.userId,
      expectedRevision,
      updates: { ...rest, startDate: startDate === undefined ? undefined : startDate ? new Date(startDate) : null, targetDate: targetDate === undefined ? undefined : targetDate ? new Date(targetDate) : null },
    });

    return jsonSuccess(project);
  } catch (err) {
    return handleRouteError(err);
  }
}
