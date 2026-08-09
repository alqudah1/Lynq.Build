import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { authenticateAgentFromHeader } from "@/lib/agents/authentication";
import { getContactForAgent } from "@/lib/crm/agent-reads";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ contactId: string }> };

/** GET /api/agent/crm/contacts/{contactId} — agent-authenticated; requires an active `crm_contact_read` grant. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { contactId: rawContactId } = await params;
    const contactId = parseUuidParam(rawContactId);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentFromHeader(db, request);

    const contact = await getContactForAgent(db, principal, contactId);
    if (!contact) throw new TenantResourceNotFoundError();
    return jsonSuccess(contact);
  } catch (err) {
    return handleRouteError(err);
  }
}
