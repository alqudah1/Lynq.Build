import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { authenticateAgentFromHeader } from "@/lib/agents/authentication";
import { listLeadsForAgent } from "@/lib/crm/agent-reads";

export const dynamic = "force-dynamic";

/** GET /api/agent/crm/leads — agent-authenticated; requires an active `crm_lead_read` grant. */
export async function GET(request: Request) {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentFromHeader(db, request);

    const leads = await listLeadsForAgent(db, principal);
    return jsonSuccess({ leads });
  } catch (err) {
    return handleRouteError(err);
  }
}
