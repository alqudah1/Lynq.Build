import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { qualifyLead } from "@/lib/crm/leads";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; leadId: string }> };

/** POST /api/organizations/{organizationId}/crm/leads/{leadId}/qualify — explicit, auditable qualification; never performed by an agent. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, leadId: rawLeadId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const leadId = parseUuidParam(rawLeadId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, bodySchema);
    const lead = await qualifyLead(db, { organizationId, leadId, expectedRevision: body.expectedRevision, actorUserId: user.userId });
    return jsonSuccess(lead);
  } catch (err) {
    return handleRouteError(err);
  }
}
