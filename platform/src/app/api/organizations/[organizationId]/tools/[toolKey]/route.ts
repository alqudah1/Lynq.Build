import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { toolKeySchema } from "@/lib/tools/validation";
import { getCurrentToolVersion } from "@/lib/tools/definitions";
import { ToolNotFoundError } from "@/lib/tools/errors";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; toolKey: string }> };

/** GET /api/organizations/{organizationId}/tools/{toolKey} — current version only. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, toolKey: rawToolKey } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const toolKey = toolKeySchema.parse(decodeURIComponent(rawToolKey));

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await requireOrganizationMembership(db, organizationId, user.userId);

    const tool = await getCurrentToolVersion(db, toolKey);
    if (!tool) throw new ToolNotFoundError(toolKey);

    return jsonSuccess(tool);
  } catch (err) {
    return handleRouteError(err);
  }
}
