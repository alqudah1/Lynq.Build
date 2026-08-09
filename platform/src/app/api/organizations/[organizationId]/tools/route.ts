import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { listTools } from "@/lib/tools/definitions";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * GET /api/organizations/{organizationId}/tools
 * Query params: onlyEnabled?
 *
 * Tool definitions are global, not per-organization (§5's versioned
 * Registry, never a tool-management UI in this phase) — the path is
 * nested under the organization purely for consistent authentication and
 * route-shape convention, matching every other route in this codebase.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await requireOrganizationMembership(db, organizationId, user.userId);

    const url = new URL(request.url);
    const onlyEnabled = url.searchParams.get("onlyEnabled") === "true";

    const tools = await listTools(db, { onlyEnabled });
    return jsonSuccess({ tools });
  } catch (err) {
    return handleRouteError(err);
  }
}
