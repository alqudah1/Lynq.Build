import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { advanceAgentLifecycleStage } from "@/lib/agents/lifecycle";

export const dynamic = "force-dynamic";

const advanceBodySchema = z
  .object({
    toStage: z.enum(["specification", "development", "testing", "approval", "deployment", "monitoring", "improvement"]),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; agentId: string }> };

/**
 * POST /api/organizations/{organizationId}/agents/{agentId}/advance
 * Moves an agent exactly one step forward through AGENT_FRAMEWORK §2's
 * lifecycle. `toStage: "approval"` also forces the permission level to
 * `observer`, per §2's explicit rule.
 *
 * Body: { "toStage": "specification" | "development" | "testing" | "approval" | "deployment" | "monitoring" | "improvement" }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden, 404 not_found, 409 invalid_agent_lifecycle_transition
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, agentId: rawAgentId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const agentId = parseUuidParam(rawAgentId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, advanceBodySchema);

    const agent = await advanceAgentLifecycleStage(db, { organizationId, agentId, toStage: body.toStage, actorUserId: user.userId });
    return jsonSuccess(agent);
  } catch (err) {
    return handleRouteError(err);
  }
}
