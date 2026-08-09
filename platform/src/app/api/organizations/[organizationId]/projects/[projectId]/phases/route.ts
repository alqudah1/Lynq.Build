import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createPhase, listPhases } from "@/lib/projects/phases";
import { projectNameSchema, projectDescriptionSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const createPhaseBodySchema = z.object({ name: projectNameSchema, description: projectDescriptionSchema, startDate: z.string().datetime().optional(), targetDate: z.string().datetime().optional() }).strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string }> };

/** GET /api/organizations/{organizationId}/projects/{projectId}/phases */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const phases = await listPhases(db, { organizationId, projectId, actorUserId: user.userId });
    return jsonSuccess({ phases });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/projects/{projectId}/phases */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createPhaseBodySchema);
    const phase = await createPhase(db, {
      organizationId,
      projectId,
      name: body.name,
      description: body.description ?? null,
      startDate: body.startDate ? new Date(body.startDate) : null,
      targetDate: body.targetDate ? new Date(body.targetDate) : null,
      actorUserId: user.userId,
    });

    return jsonSuccess(phase, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
