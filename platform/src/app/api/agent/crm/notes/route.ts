import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { uuidParam } from "@/lib/http/validation";
import { authenticateAgentFromHeader } from "@/lib/agents/authentication";
import { listNotesForAgent } from "@/lib/crm/agent-reads";

export const dynamic = "force-dynamic";

/** GET /api/agent/crm/notes?contactId=&companyId=&leadId=&opportunityId= — agent-authenticated; requires an active `crm_note_read` grant. Never exposed to an unauthenticated caller. */
export async function GET(request: Request) {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentFromHeader(db, request);

    const url = new URL(request.url);
    const contactId = url.searchParams.get("contactId") ? uuidParam.parse(url.searchParams.get("contactId")) : undefined;
    const companyId = url.searchParams.get("companyId") ? uuidParam.parse(url.searchParams.get("companyId")) : undefined;
    const leadId = url.searchParams.get("leadId") ? uuidParam.parse(url.searchParams.get("leadId")) : undefined;
    const opportunityId = url.searchParams.get("opportunityId") ? uuidParam.parse(url.searchParams.get("opportunityId")) : undefined;

    const notes = await listNotesForAgent(db, principal, { contactId, companyId, leadId, opportunityId });
    return jsonSuccess({ notes });
  } catch (err) {
    return handleRouteError(err);
  }
}
