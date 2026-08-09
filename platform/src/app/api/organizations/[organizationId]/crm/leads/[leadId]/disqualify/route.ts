import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { disqualifyLead } from "@/lib/crm/leads";
import { crmBoundedTextSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ expectedRevision: z.number().int().min(1), reason: crmBoundedTextSchema.optional() }).strict();

type RouteParams = { params: Promise<{ organizationId: string; leadId: string }> };

/** POST /api/organizations/{organizationId}/crm/leads/{leadId}/disqualify */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, leadId: rawLeadId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const leadId = parseUuidParam(rawLeadId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, bodySchema);
    const lead = await disqualifyLead(db, { organizationId, leadId, expectedRevision: body.expectedRevision, reason: body.reason, actorUserId: user.userId });
    return jsonSuccess(lead);
  } catch (err) {
    return handleRouteError(err);
  }
}
