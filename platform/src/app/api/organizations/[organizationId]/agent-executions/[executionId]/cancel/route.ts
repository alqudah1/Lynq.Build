import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { cancelExecution } from "@/lib/agent-runtime/lifecycle";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** POST .../{executionId}/cancel — cascades to pending approvals and active delegations (best-effort). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);

    const execution = await cancelExecution(db, { organizationId, executionId, reason: body.reason, actorUserId: user.userId });
    return jsonSuccess(execution);
  } catch (err) {
    return handleRouteError(err);
  }
}
