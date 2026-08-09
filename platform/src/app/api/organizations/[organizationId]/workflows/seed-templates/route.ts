import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationMembership, requireOrganizationRole } from "@/lib/authz/helpers";
import { seedStarterTemplates } from "@/lib/workflows/templates";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** POST /api/organizations/{organizationId}/workflows/seed-templates — org owner/admin only; requires the Company Knowledge Analyst to already be seeded. Idempotent. */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const membership = await requireOrganizationMembership(db, organizationId, user.userId);
    requireOrganizationRole(membership, ["owner", "admin"]);

    const result = await seedStarterTemplates(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
