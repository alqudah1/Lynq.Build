import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { convertLead } from "@/lib/crm/leads";
import { crmNameSchema, crmAmountSchema, crmCurrencySchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    pipelineId: uuidParam,
    stageId: uuidParam,
    opportunityName: crmNameSchema.optional(),
    amount: crmAmountSchema.nullable().optional(),
    currency: crmCurrencySchema.nullable().optional(),
    expectedCloseDate: z.coerce.date().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; leadId: string }> };

/** POST /api/organizations/{organizationId}/crm/leads/{leadId}/convert — idempotent: repeated calls after the first return the same, already-created opportunity. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, leadId: rawLeadId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const leadId = parseUuidParam(rawLeadId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, bodySchema);
    const result = await convertLead(db, { organizationId, leadId, actorUserId: user.userId, ...body });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
