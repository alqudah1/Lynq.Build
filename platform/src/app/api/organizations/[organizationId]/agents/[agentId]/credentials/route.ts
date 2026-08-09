import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { issueAgentCredential, listAgentCredentials } from "@/lib/agents/credentials";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; agentId: string }> };

/**
 * GET /api/organizations/{organizationId}/agents/{agentId}/credentials
 * Lists credential metadata (id, key prefix, issued/revoked info) — never
 * the secret or its hash, which are never retrievable after issuance.
 *
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

    const credentials = await listAgentCredentials(db, { organizationId, agentId, actorUserId: user.userId });
    return jsonSuccess({ credentials });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/agents/{agentId}/credentials
 * Issues a new credential. The plaintext secret is returned exactly once,
 * in this response, and is never stored or retrievable again — the caller
 * must copy it immediately.
 *
 * 201 response: { "data": { "credential": { "id": "...", "keyPrefix": "agt_..." }, "plaintextSecret": "agt_..." } }
 *
 * Errors: 401 unauthenticated, 403 forbidden, 404 not_found
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, agentId: rawAgentId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const agentId = parseUuidParam(rawAgentId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const result = await issueAgentCredential(db, { organizationId, agentId, actorUserId: user.userId });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
