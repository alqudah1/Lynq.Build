import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { updatePhase } from "@/lib/projects/phases";
import { projectNameSchema, projectDescriptionSchema, projectPhaseStatusSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const updatePhaseBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    name: projectNameSchema.optional(),
    description: projectDescriptionSchema,
    status: projectPhaseStatusSchema.optional(),
    startDate: z.string().datetime().nullable().optional(),
    targetDate: z.string().datetime().nullable().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string; phaseId: string }> };

/** PATCH /api/organizations/{organizationId}/projects/{projectId}/phases/{phaseId} */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId, phaseId: rawPhaseId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);
    const phaseId = parseUuidParam(rawPhaseId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updatePhaseBodySchema);
    const { expectedRevision, startDate, targetDate, ...rest } = body;

    const phase = await updatePhase(db, {
      organizationId,
      projectId,
      phaseId,
      expectedRevision,
      actorUserId: user.userId,
      updates: { ...rest, startDate: startDate === undefined ? undefined : startDate ? new Date(startDate) : null, targetDate: targetDate === undefined ? undefined : targetDate ? new Date(targetDate) : null },
    });

    return jsonSuccess(phase);
  } catch (err) {
    return handleRouteError(err);
  }
}
