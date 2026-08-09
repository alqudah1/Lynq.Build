import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationMembership, requireOrganizationRole } from "@/lib/authz/helpers";
import { seedMarketingAgents } from "@/lib/marketing-os/agents";
import { seedMarketingWorkflowTemplates } from "@/lib/marketing-os/templates";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** POST /api/organizations/{organizationId}/marketing/seed — org owner/admin only. Seeds the three Marketing agents, then the three starter workflow templates that reference them. Idempotent. */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const membership = await requireOrganizationMembership(db, organizationId, user.userId);
    requireOrganizationRole(membership, ["owner", "admin"]);

    const agents = await seedMarketingAgents(db, { organizationId, humanOwnerUserId: user.userId, actorUserId: user.userId });
    const templates = await seedMarketingWorkflowTemplates(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ agents: { campaignBriefAgentId: agents.campaignBriefAgent.id, contentDraftAgentId: agents.contentDraftAgent.id, campaignSummaryAgentId: agents.campaignSummaryAgent.id }, templates }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
