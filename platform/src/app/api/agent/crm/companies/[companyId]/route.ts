import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { authenticateAgentFromHeader } from "@/lib/agents/authentication";
import { getCompanyForAgent } from "@/lib/crm/agent-reads";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ companyId: string }> };

/** GET /api/agent/crm/companies/{companyId} — agent-authenticated; requires an active `crm_company_read` grant. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { companyId: rawCompanyId } = await params;
    const companyId = parseUuidParam(rawCompanyId);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentFromHeader(db, request);

    const company = await getCompanyForAgent(db, principal, companyId);
    if (!company) throw new TenantResourceNotFoundError();
    return jsonSuccess(company);
  } catch (err) {
    return handleRouteError(err);
  }
}
