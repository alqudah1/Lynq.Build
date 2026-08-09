import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { revokeAgentCredential } from "@/lib/agents/credentials";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; agentId: string; credentialId: string }> };

/**
 * POST /api/organizations/{organizationId}/agents/{agentId}/credentials/{credentialId}/revoke
 * One-way; an already-revoked credential cannot be revoked again.
 *
 * Errors: 401 unauthenticated, 403 forbidden, 404 not_found, 409 credential_already_revoked
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, agentId: rawAgentId, credentialId: rawCredentialId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const agentId = parseUuidParam(rawAgentId);
    const credentialId = parseUuidParam(rawCredentialId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const credential = await revokeAgentCredential(db, { organizationId, agentId, credentialId, actorUserId: user.userId });
    return jsonSuccess(credential);
  } catch (err) {
    return handleRouteError(err);
  }
}
