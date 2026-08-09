import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { agentAnatomyFieldSchema } from "@/lib/agents/validation";
import { getAgent, updateAgentAnatomy } from "@/lib/agents/agents";

export const dynamic = "force-dynamic";

const updateAgentAnatomyBodySchema = z
  .object({
    expectedVersionNumber: z.coerce.number().int().min(1),
    changeReason: z.string().trim().min(1).max(500).optional(),
    updates: z
      .object({
        purpose: agentAnatomyFieldSchema.optional(),
        responsibilities: agentAnatomyFieldSchema.optional(),
        goals: agentAnatomyFieldSchema.optional(),
        inputs: agentAnatomyFieldSchema.optional(),
        outputs: agentAnatomyFieldSchema.optional(),
        successCriteria: agentAnatomyFieldSchema.optional(),
        failureCriteria: agentAnatomyFieldSchema.optional(),
        retirementCriteria: agentAnatomyFieldSchema.optional(),
      })
      .strict(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; agentId: string }> };

/**
 * GET /api/organizations/{organizationId}/agents/{agentId}
 * Errors: 401 unauthenticated, 403 forbidden, 404 not_found
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, agentId: rawAgentId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const agentId = parseUuidParam(rawAgentId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const agent = await getAgent(db, { organizationId, agentId, actorUserId: user.userId });
    return jsonSuccess(agent);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/organizations/{organizationId}/agents/{agentId}
 * Edits an agent's Anatomy fields — always creates a new `agent_versions`
 * row (AGENT_FRAMEWORK §16), never a silent in-place edit. Optimistic
 * concurrency via `expectedVersionNumber`.
 *
 * Body: { expectedVersionNumber, changeReason?, updates: { <any Anatomy field except name/department> } }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden, 404 not_found, 409 agent_version_conflict
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, agentId: rawAgentId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const agentId = parseUuidParam(rawAgentId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateAgentAnatomyBodySchema);

    const agent = await updateAgentAnatomy(db, {
      organizationId,
      agentId,
      expectedVersionNumber: body.expectedVersionNumber,
      updates: body.updates,
      changeReason: body.changeReason ?? null,
      actorUserId: user.userId,
    });
    return jsonSuccess(agent);
  } catch (err) {
    return handleRouteError(err);
  }
}
