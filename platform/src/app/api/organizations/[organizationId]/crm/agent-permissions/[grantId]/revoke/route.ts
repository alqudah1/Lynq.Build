import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { revokeCrmAgentPermission } from "@/lib/crm/agent-permissions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; grantId: string }> };

/** POST /api/organizations/{organizationId}/crm/agent-permissions/{grantId}/revoke — org owner/admin only. Soft-revoke; the grant row is never deleted. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, grantId: rawGrantId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const grantId = parseUuidParam(rawGrantId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, bodySchema);
    const grant = await revokeCrmAgentPermission(db, { organizationId, grantId, expectedRevision: body.expectedRevision, actorUserId: user.userId });
    return jsonSuccess(grant);
  } catch (err) {
    return handleRouteError(err);
  }
}
