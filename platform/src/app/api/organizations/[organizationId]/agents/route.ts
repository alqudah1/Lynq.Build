import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { agentDepartmentSchema, agentPermissionLevelSchema, agentNameSchema, agentAnatomyFieldSchema } from "@/lib/agents/validation";
import { registerAgent, listAgents } from "@/lib/agents/agents";

export const dynamic = "force-dynamic";

const registerAgentBodySchema = z
  .object({
    name: agentNameSchema,
    department: agentDepartmentSchema,
    purpose: agentAnatomyFieldSchema,
    responsibilities: agentAnatomyFieldSchema,
    goals: agentAnatomyFieldSchema,
    inputs: agentAnatomyFieldSchema,
    outputs: agentAnatomyFieldSchema,
    successCriteria: agentAnatomyFieldSchema,
    failureCriteria: agentAnatomyFieldSchema,
    retirementCriteria: agentAnatomyFieldSchema,
    humanOwnerUserId: uuidParam,
    permissionLevel: agentPermissionLevelSchema,
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * GET /api/organizations/{organizationId}/agents
 * Lists every registered agent for the organization (Agent Registry §14).
 *
 * Errors: 401 unauthenticated, 403 forbidden (not owner/admin), 404 not_found
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const result = await listAgents(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ agents: result });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/agents
 * Registers a new agent at the `idea` lifecycle stage (AGENT_FRAMEWORK §2,
 * §3). Every Anatomy field is required — an agent that can't be fully
 * specified isn't ready to exist. Requires organization owner/admin.
 *
 * Body: { name, department, purpose, responsibilities, goals, inputs, outputs, successCriteria, failureCriteria, retirementCriteria, humanOwnerUserId, permissionLevel }
 *
 * 201 response: { "data": { "id": "...", "lifecycleStage": "idea", ... } }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden, 404 not_found
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, registerAgentBodySchema);

    const agent = await registerAgent(db, { organizationId, ...body, actorUserId: user.userId });
    return jsonSuccess(agent, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
