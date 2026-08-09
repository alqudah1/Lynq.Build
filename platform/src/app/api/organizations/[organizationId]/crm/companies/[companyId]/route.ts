import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { getCompanyForUser, updateCompany, archiveCompany } from "@/lib/crm/companies";
import { crmNameSchema, crmLifecycleStageSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const updateCompanyBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    archive: z.boolean().optional(),
    name: crmNameSchema.optional(),
    legalName: z.string().trim().max(200).nullable().optional(),
    domain: z.string().trim().max(255).nullable().optional(),
    website: z.string().trim().max(500).nullable().optional(),
    industry: z.string().trim().max(200).nullable().optional(),
    employeeRange: z.string().trim().max(50).nullable().optional(),
    annualRevenueRange: z.string().trim().max(50).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    address: z.record(z.string(), z.unknown()).nullable().optional(),
    lifecycleStage: crmLifecycleStageSchema.optional(),
    ownerUserId: uuidParam.nullable().optional(),
    sourceId: uuidParam.nullable().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; companyId: string }> };

/** GET /api/organizations/{organizationId}/crm/companies/{companyId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, companyId: rawCompanyId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const companyId = parseUuidParam(rawCompanyId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const company = await getCompanyForUser(db, { organizationId, companyId, actorUserId: user.userId });
    return jsonSuccess(company);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/crm/companies/{companyId} — `archive: true` archives instead of updating fields. */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, companyId: rawCompanyId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const companyId = parseUuidParam(rawCompanyId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateCompanyBodySchema);

    if (body.archive) {
      const archived = await archiveCompany(db, { organizationId, companyId, expectedRevision: body.expectedRevision, actorUserId: user.userId });
      return jsonSuccess(archived);
    }

    const { archive: _archive, expectedRevision, ...fields } = body;
    void _archive;
    const updated = await updateCompany(db, { organizationId, companyId, expectedRevision, actorUserId: user.userId, ...fields });
    return jsonSuccess(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
