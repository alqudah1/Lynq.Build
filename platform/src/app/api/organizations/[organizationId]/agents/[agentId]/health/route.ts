import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { agentHealthStatusSchema } from "@/lib/agents/validation";
import { recordAgentHealth } from "@/lib/agents/lifecycle";

export const dynamic = "force-dynamic";

const healthBodySchema = z.object({ healthStatus: agentHealthStatusSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string; agentId: string }> };

/**
 * POST /api/organizations/{organizationId}/agents/{agentId}/health
 * Records a coarse health signal (AGENT_FRAMEWORK §13). Human-recorded
 * today, an interim proxy for the Agent Runtime's future automated
 * observability.
 *
 * Body: { "healthStatus": "healthy" | "degraded" | "unhealthy" | "unknown" }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden, 404 not_found
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, agentId: rawAgentId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const agentId = parseUuidParam(rawAgentId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, healthBodySchema);

    const agent = await recordAgentHealth(db, { organizationId, agentId, healthStatus: body.healthStatus, actorUserId: user.userId });
    return jsonSuccess(agent);
  } catch (err) {
    return handleRouteError(err);
  }
}
