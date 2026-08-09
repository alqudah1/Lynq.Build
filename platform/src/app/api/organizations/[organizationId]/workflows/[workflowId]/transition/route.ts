import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { transitionWorkflowDefinitionStatus } from "@/lib/workflows/definitions";
import { workflowDefinitionStatusSchema } from "@/lib/workflows/validation";

export const dynamic = "force-dynamic";

const transitionBodySchema = z.object({ toStatus: workflowDefinitionStatusSchema, expectedRevision: z.number().int().min(1) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; workflowId: string }> };

/** POST /api/organizations/{organizationId}/workflows/{workflowId}/transition */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workflowId: rawWorkflowId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const definitionId = parseUuidParam(rawWorkflowId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, transitionBodySchema);
    const definition = await transitionWorkflowDefinitionStatus(db, { organizationId, definitionId, toStatus: body.toStatus, expectedRevision: body.expectedRevision, actorUserId: user.userId });

    return jsonSuccess(definition);
  } catch (err) {
    return handleRouteError(err);
  }
}
