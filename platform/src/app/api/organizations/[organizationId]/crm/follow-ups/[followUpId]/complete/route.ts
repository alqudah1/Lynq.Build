import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { completeFollowUp } from "@/lib/crm/follow-ups";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; followUpId: string }> };

/** POST /api/organizations/{organizationId}/crm/follow-ups/{followUpId}/complete */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, followUpId: rawFollowUpId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const followUpId = parseUuidParam(rawFollowUpId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, bodySchema);
    const followUp = await completeFollowUp(db, { organizationId, followUpId, expectedRevision: body.expectedRevision, actorUserId: user.userId });
    return jsonSuccess(followUp);
  } catch (err) {
    return handleRouteError(err);
  }
}
