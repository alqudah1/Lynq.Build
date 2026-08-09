import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, uuidParam } from "@/lib/http/validation";
import { searchContacts, searchCompanies, searchLeads, searchOpportunities } from "@/lib/crm/search";
import { crmLeadStatusSchema, crmOpportunityStatusSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/search?type={contacts|companies|leads|opportunities}&q=&limit=&offset= — deterministic keyword/exact-filter search, no semantic/vector search. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const type = z.enum(["contacts", "companies", "leads", "opportunities"]).parse(url.searchParams.get("type") ?? "contacts");
    const query = url.searchParams.get("q") ?? undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;
    const ownerUserId = url.searchParams.get("ownerUserId") ?? undefined;

    if (type === "contacts") {
      const companyId = url.searchParams.get("companyId") ?? undefined;
      const result = await searchContacts(db, { organizationId, actorUserId: user.userId, query, companyId, ownerUserId, limit, offset });
      return jsonSuccess(result);
    }
    if (type === "companies") {
      const result = await searchCompanies(db, { organizationId, actorUserId: user.userId, query, ownerUserId, limit, offset });
      return jsonSuccess(result);
    }
    if (type === "leads") {
      const status = url.searchParams.get("status") ? crmLeadStatusSchema.parse(url.searchParams.get("status")) : undefined;
      const contactId = url.searchParams.get("contactId") ? uuidParam.parse(url.searchParams.get("contactId")) : undefined;
      const companyId = url.searchParams.get("companyId") ? uuidParam.parse(url.searchParams.get("companyId")) : undefined;
      const result = await searchLeads(db, { organizationId, actorUserId: user.userId, status, ownerUserId, contactId, companyId, limit, offset });
      return jsonSuccess(result);
    }
    const status = url.searchParams.get("status") ? crmOpportunityStatusSchema.parse(url.searchParams.get("status")) : undefined;
    const stageId = url.searchParams.get("stageId") ? uuidParam.parse(url.searchParams.get("stageId")) : undefined;
    const pipelineId = url.searchParams.get("pipelineId") ? uuidParam.parse(url.searchParams.get("pipelineId")) : undefined;
    const companyId = url.searchParams.get("companyId") ? uuidParam.parse(url.searchParams.get("companyId")) : undefined;
    const contactId = url.searchParams.get("contactId") ? uuidParam.parse(url.searchParams.get("contactId")) : undefined;
    const result = await searchOpportunities(db, { organizationId, actorUserId: user.userId, query, status, stageId, pipelineId, companyId, contactId, limit, offset });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
