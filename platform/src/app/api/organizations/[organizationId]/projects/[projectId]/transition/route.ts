import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { transitionProjectStatus } from "@/lib/projects/projects";
import { projectStatusSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const transitionBodySchema = z.object({ toStatus: projectStatusSchema, expectedRevision: z.number().int().min(1) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string }> };

/** POST /api/organizations/{organizationId}/projects/{projectId}/transition */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, transitionBodySchema);
    const project = await transitionProjectStatus(db, { organizationId, projectId, toStatus: body.toStatus, expectedRevision: body.expectedRevision, actorUserId: user.userId });

    return jsonSuccess(project);
  } catch (err) {
    return handleRouteError(err);
  }
}
