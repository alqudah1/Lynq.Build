import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationMembership, requireOrganizationRole } from "@/lib/authz/helpers";
import { seedLeadGenAgent } from "@/lib/lead-gen/agent";
import { seedLeadGenTools } from "@/lib/lead-gen/tools/seed";
import { ensureOutreachTemplate } from "@/lib/lead-gen/comms-templates";
import { OUTREACH_TEMPLATE_NAMES } from "@/lib/lead-gen/outreach";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * POST /api/organizations/{organizationId}/lead-gen/seed — org owner/admin only.
 *
 * Registers the Lead Generation Assistant, the lead-gen tool policies and
 * the two Communications OS outreach templates. Idempotent: safe to re-run,
 * and it never rewrites a policy an operator has tightened by hand.
 *
 * This seeds LYNQ. It does not touch Meta: the matching WhatsApp templates
 * still have to be submitted and approved in WhatsApp Manager, which is a
 * manual step no API call here can stand in for.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const membership = await requireOrganizationMembership(db, organizationId, user.userId);
    requireOrganizationRole(membership, ["owner", "admin"]);

    const agent = await seedLeadGenAgent(db, { organizationId, humanOwnerUserId: user.userId, actorUserId: user.userId });
    const tools = await seedLeadGenTools(db);

    const templates = [];
    for (const templateName of Object.values(OUTREACH_TEMPLATE_NAMES)) {
      const template = await ensureOutreachTemplate(db, { organizationId, templateName, actorUserId: user.userId });
      templates.push({ templateKey: template.templateKey, templateId: template.id, published: Boolean(template.currentPublishedVersionId) });
    }

    return jsonSuccess(
      {
        agentId: agent.id,
        tools,
        templates,
        metaTemplateApproval: "Not done by this endpoint. Submit the identical bodies in WhatsApp Manager and wait for Meta approval before sending.",
      },
      201
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
