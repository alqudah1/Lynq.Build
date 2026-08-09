import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createLead, listLeadsForUser } from "@/lib/crm/leads";
import { crmLeadStatusSchema, crmScoreSchema, crmAmountSchema, crmCurrencySchema, crmBoundedTextSchema, crmIdempotencyKeySchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createLeadBodySchema = z
  .object({
    contactId: uuidParam.optional(),
    companyId: uuidParam.optional(),
    ownerUserId: uuidParam.optional(),
    sourceId: uuidParam.optional(),
    score: crmScoreSchema.optional(),
    estimatedValueAmount: crmAmountSchema.optional(),
    estimatedValueCurrency: crmCurrencySchema.optional(),
    qualificationNotes: crmBoundedTextSchema.optional(),
    nextAction: crmBoundedTextSchema.optional(),
    idempotencyKey: crmIdempotencyKeySchema.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/leads — query params: status?, ownerUserId?, contactId?, companyId?, limit? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({ status: crmLeadStatusSchema.optional(), ownerUserId: uuidParam.optional(), contactId: uuidParam.optional(), companyId: uuidParam.optional(), limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse({
        status: url.searchParams.get("status") ?? undefined,
        ownerUserId: url.searchParams.get("ownerUserId") ?? undefined,
        contactId: url.searchParams.get("contactId") ?? undefined,
        companyId: url.searchParams.get("companyId") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      });

    const leads = await listLeadsForUser(db, { organizationId, actorUserId: user.userId, ...query });
    return jsonSuccess({ leads });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/leads */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createLeadBodySchema);
    const lead = await createLead(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(lead, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
