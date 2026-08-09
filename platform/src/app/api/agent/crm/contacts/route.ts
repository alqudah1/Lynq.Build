import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { authenticateAgentFromHeader } from "@/lib/agents/authentication";
import { listContactsForAgent } from "@/lib/crm/agent-reads";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/crm/contacts
 * Agent-authenticated (`Authorization: Bearer <agent credential>`, never a
 * human session). Requires an active `crm_contact_read` grant — this
 * agent's Brain domain grants are never consulted. Returns up to 50 active
 * contacts in this agent's organization.
 */
export async function GET(request: Request) {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentFromHeader(db, request);

    const contacts = await listContactsForAgent(db, principal);
    return jsonSuccess({ contacts });
  } catch (err) {
    return handleRouteError(err);
  }
}
