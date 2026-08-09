import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { failureClassSchema } from "@/lib/agent-runtime/validation";
import { authenticateAgentFromHeader } from "@/lib/agents/authentication";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { failExecution } from "@/lib/agent-runtime/lifecycle";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ failureClass: failureClassSchema, reason: z.string().trim().min(1).max(1000) }).strict();

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/**
 * POST .../{executionId}/fail — either the assigned agent (`Authorization:
 * Bearer <agent credential>`) OR a human with management authority
 * (session cookie) may report a failure; whichever credential is present
 * is used, matching §11's "a genuine bug... escalated" path being
 * reachable by either party.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const body = await parseJsonBody(request, bodySchema);

    const hasAgentCredential = request.headers.has("authorization");
    if (hasAgentCredential) {
      const principal = await authenticateAgentFromHeader(db, request);
      if (principal.organizationId !== organizationId) {
        throw new TenantResourceNotFoundError();
      }
      const execution = await failExecution(db, { organizationId, executionId, failureClass: body.failureClass, reason: body.reason, actorAgentId: principal.agentId });
      return jsonSuccess(execution);
    }

    const user = await getAuthenticatedUser(db);
    const execution = await failExecution(db, { organizationId, executionId, failureClass: body.failureClass, reason: body.reason, actorUserId: user.userId });
    return jsonSuccess(execution);
  } catch (err) {
    return handleRouteError(err);
  }
}
