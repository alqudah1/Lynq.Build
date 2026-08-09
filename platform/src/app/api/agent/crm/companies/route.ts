import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { authenticateAgentFromHeader } from "@/lib/agents/authentication";
import { listCompaniesForAgent } from "@/lib/crm/agent-reads";

export const dynamic = "force-dynamic";

/** GET /api/agent/crm/companies — agent-authenticated; requires an active `crm_company_read` grant. */
export async function GET(request: Request) {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentFromHeader(db, request);

    const companies = await listCompaniesForAgent(db, principal);
    return jsonSuccess({ companies });
  } catch (err) {
    return handleRouteError(err);
  }
}
