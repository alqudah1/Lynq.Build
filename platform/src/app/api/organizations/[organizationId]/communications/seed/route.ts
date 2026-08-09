import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationMembership, requireOrganizationRole } from "@/lib/authz/helpers";
import { seedCommunicationsAgent } from "@/lib/communications-os/agents";
import { seedCommunicationsTools } from "@/lib/communications-os/tools-seed";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** POST /api/organizations/{organizationId}/communications/seed — org owner/admin only. Seeds the Communications Assistant agent and the 4 Tool Runtime tools. Idempotent. */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const membership = await requireOrganizationMembership(db, organizationId, user.userId);
    requireOrganizationRole(membership, ["owner", "admin"]);

    const agent = await seedCommunicationsAgent(db, { organizationId, humanOwnerUserId: user.userId, actorUserId: user.userId });
    await seedCommunicationsTools(db);
    return jsonSuccess({ agentId: agent.id }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
