import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createMilestone, listMilestones } from "@/lib/projects/milestones";
import { calculateMilestoneProgress } from "@/lib/projects/progress";
import { projectNameSchema, projectDescriptionSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const createMilestoneBodySchema = z.object({ phaseId: uuidParam.optional(), title: projectNameSchema, description: projectDescriptionSchema, targetDate: z.string().datetime().optional(), ownerUserId: uuidParam.optional() }).strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string }> };

/** GET /api/organizations/{organizationId}/projects/{projectId}/milestones */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const milestones = await listMilestones(db, { organizationId, projectId, actorUserId: user.userId });
    const withProgress = await Promise.all(milestones.map(async (m) => ({ ...m, progress: await calculateMilestoneProgress(db, organizationId, m.id) })));

    return jsonSuccess({ milestones: withProgress });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/projects/{projectId}/milestones */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createMilestoneBodySchema);
    const milestone = await createMilestone(db, {
      organizationId,
      projectId,
      phaseId: body.phaseId ?? null,
      title: body.title,
      description: body.description ?? null,
      targetDate: body.targetDate ? new Date(body.targetDate) : null,
      ownerUserId: body.ownerUserId ?? null,
      actorUserId: user.userId,
    });

    return jsonSuccess(milestone, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
