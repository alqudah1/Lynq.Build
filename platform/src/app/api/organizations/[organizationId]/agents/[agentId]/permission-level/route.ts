import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { agentPermissionLevelSchema } from "@/lib/agents/validation";
import { changeAgentPermissionLevel } from "@/lib/agents/lifecycle";

export const dynamic = "force-dynamic";

const changePermissionLevelBodySchema = z
  .object({
    newPermissionLevel: agentPermissionLevelSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; agentId: string }> };

/**
 * POST /api/organizations/{organizationId}/agents/{agentId}/permission-level
 * Changes a live agent's permission level (AGENT_FRAMEWORK §5: "only a
 * human approval moves an agent up"). Only legal while the agent is
 * `deployment`/`monitoring`/`improvement` stage.
 *
 * Body: { "newPermissionLevel": "observer"|"assistant"|"operator"|"manager"|"executive"|"system", "reason": string }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden, 404 not_found, 409 agent_not_live
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, agentId: rawAgentId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const agentId = parseUuidParam(rawAgentId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, changePermissionLevelBodySchema);

    const agent = await changeAgentPermissionLevel(db, {
      organizationId,
      agentId,
      newPermissionLevel: body.newPermissionLevel,
      reason: body.reason,
      actorUserId: user.userId,
    });
    return jsonSuccess(agent);
  } catch (err) {
    return handleRouteError(err);
  }
}
