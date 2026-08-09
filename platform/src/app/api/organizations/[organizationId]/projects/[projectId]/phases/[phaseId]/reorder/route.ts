import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { reorderPhase } from "@/lib/projects/phases";

export const dynamic = "force-dynamic";

const reorderBodySchema = z.object({ targetIndex: z.number().int().min(0) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string; phaseId: string }> };

/** POST /api/organizations/{organizationId}/projects/{projectId}/phases/{phaseId}/reorder */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId, phaseId: rawPhaseId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);
    const phaseId = parseUuidParam(rawPhaseId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, reorderBodySchema);
    const phases = await reorderPhase(db, { organizationId, projectId, phaseId, targetIndex: body.targetIndex, actorUserId: user.userId });

    return jsonSuccess({ phases });
  } catch (err) {
    return handleRouteError(err);
  }
}
