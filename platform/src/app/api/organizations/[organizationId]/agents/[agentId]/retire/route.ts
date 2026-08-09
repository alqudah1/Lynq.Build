import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { agentRetirementReasonSchema } from "@/lib/agents/validation";
import { retireAgent } from "@/lib/agents/lifecycle";

export const dynamic = "force-dynamic";

const retireBodySchema = z.object({ reason: agentRetirementReasonSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string; agentId: string }> };

/**
 * POST /api/organizations/{organizationId}/agents/{agentId}/retire
 * Terminal, one-way (AGENT_FRAMEWORK §17). Legal from any non-retired
 * stage. Mandatory reason.
 *
 * Body: { "reason": string }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden, 404 not_found, 409 agent_already_retired
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, agentId: rawAgentId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const agentId = parseUuidParam(rawAgentId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, retireBodySchema);

    const agent = await retireAgent(db, { organizationId, agentId, reason: body.reason, actorUserId: user.userId });
    return jsonSuccess(agent);
  } catch (err) {
    return handleRouteError(err);
  }
}
