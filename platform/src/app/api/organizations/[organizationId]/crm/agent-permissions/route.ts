import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { grantCrmAgentPermission, listCrmAgentPermissionGrants } from "@/lib/crm/agent-permissions";
import { crmAgentPermissionSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const grantBodySchema = z.object({ agentId: uuidParam, permission: crmAgentPermissionSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/agent-permissions — query params: agentId?. Org owner/admin only. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId") ? uuidParam.parse(url.searchParams.get("agentId")) : undefined;

    const grants = await listCrmAgentPermissionGrants(db, { organizationId, agentId, actorUserId: user.userId });
    return jsonSuccess({ grants });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/agent-permissions — grants an agent one narrow CRM read permission. Default deny otherwise. Org owner/admin only. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, grantBodySchema);
    const grant = await grantCrmAgentPermission(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(grant, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
