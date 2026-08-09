import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { agentArtifactStatusSchema } from "@/lib/agent-runtime/validation";
import { updateArtifactStatus } from "@/lib/agent-runtime/artifacts";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ toStatus: agentArtifactStatusSchema, expectedRevision: z.coerce.number().int().min(1) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; executionId: string; artifactId: string }> };

/** POST .../artifacts/{artifactId}/status — §13's Draft→Review→Approved→Published→Archived progression. Human-driven (moving an artifact toward Published/promotion is a human decision). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId, artifactId: rawArtifactId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);
    const artifactId = parseUuidParam(rawArtifactId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);

    const artifact = await updateArtifactStatus(db, { organizationId, executionId, artifactId, toStatus: body.toStatus, expectedRevision: body.expectedRevision, actorUserId: user.userId });
    return jsonSuccess(artifact);
  } catch (err) {
    return handleRouteError(err);
  }
}
