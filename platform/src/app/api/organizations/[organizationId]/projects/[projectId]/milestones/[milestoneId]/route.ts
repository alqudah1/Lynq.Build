import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { updateMilestone } from "@/lib/projects/milestones";
import { projectNameSchema, projectDescriptionSchema, projectMilestoneStatusSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const updateMilestoneBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    title: projectNameSchema.optional(),
    description: projectDescriptionSchema,
    status: projectMilestoneStatusSchema.optional(),
    targetDate: z.string().datetime().nullable().optional(),
    phaseId: uuidParam.nullable().optional(),
    ownerUserId: uuidParam.nullable().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string; milestoneId: string }> };

/** PATCH /api/organizations/{organizationId}/projects/{projectId}/milestones/{milestoneId} */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId, milestoneId: rawMilestoneId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);
    const milestoneId = parseUuidParam(rawMilestoneId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateMilestoneBodySchema);
    const { expectedRevision, targetDate, ...rest } = body;

    const milestone = await updateMilestone(db, {
      organizationId,
      projectId,
      milestoneId,
      expectedRevision,
      actorUserId: user.userId,
      updates: { ...rest, targetDate: targetDate === undefined ? undefined : targetDate ? new Date(targetDate) : null },
    });

    return jsonSuccess(milestone);
  } catch (err) {
    return handleRouteError(err);
  }
}
