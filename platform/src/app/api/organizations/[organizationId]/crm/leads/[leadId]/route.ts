import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { getLeadForUser, updateLead } from "@/lib/crm/leads";
import { crmScoreSchema, crmAmountSchema, crmCurrencySchema, crmBoundedTextSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const updateLeadBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    status: z.enum(["contacted", "engaged"]).optional(),
    contactId: uuidParam.nullable().optional(),
    companyId: uuidParam.nullable().optional(),
    ownerUserId: uuidParam.nullable().optional(),
    sourceId: uuidParam.nullable().optional(),
    score: crmScoreSchema.nullable().optional(),
    estimatedValueAmount: crmAmountSchema.nullable().optional(),
    estimatedValueCurrency: crmCurrencySchema.nullable().optional(),
    qualificationNotes: crmBoundedTextSchema.nullable().optional(),
    nextAction: crmBoundedTextSchema.nullable().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; leadId: string }> };

/** GET /api/organizations/{organizationId}/crm/leads/{leadId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, leadId: rawLeadId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const leadId = parseUuidParam(rawLeadId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const lead = await getLeadForUser(db, { organizationId, leadId, actorUserId: user.userId });
    return jsonSuccess(lead);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/crm/leads/{leadId} — general field update plus the two soft in-progress transitions (contacted/engaged). Use /qualify, /disqualify, /convert for the dedicated, separately-audited operations. */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, leadId: rawLeadId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const leadId = parseUuidParam(rawLeadId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateLeadBodySchema);
    const updated = await updateLead(db, { organizationId, leadId, actorUserId: user.userId, ...body });
    return jsonSuccess(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
