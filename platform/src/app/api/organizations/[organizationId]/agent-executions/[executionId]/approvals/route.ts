import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { agentApprovalRiskLevelSchema, summarySchema } from "@/lib/agent-runtime/validation";
import { authenticateAgentForExecutionRoute } from "@/lib/agent-runtime/route-helpers";
import { getExecutionForUser } from "@/lib/agent-runtime/executions";
import { requestApproval, listApprovalsForExecution } from "@/lib/agent-runtime/approvals";

export const dynamic = "force-dynamic";

const requestApprovalBodySchema = z
  .object({
    requestedAction: z.string().trim().min(1).max(500),
    summary: summarySchema,
    riskLevel: agentApprovalRiskLevelSchema,
    artifactId: z.string().uuid().optional(),
    proposedActionRef: z.unknown().optional(),
    expiresInHours: z.coerce.number().int().min(1).max(720).optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** GET .../{executionId}/approvals */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await getExecutionForUser(db, { organizationId, executionId, actorUserId: user.userId });

    const approvals = await listApprovalsForExecution(db, organizationId, executionId);
    return jsonSuccess({ approvals });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST .../{executionId}/approvals — agent-authenticated. §7: auto-generated the moment a plan step crosses into a gated band; pauses the execution at `human_approval` in the same call. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForExecutionRoute(db, request, organizationId);
    const body = await parseJsonBody(request, requestApprovalBodySchema);

    const result = await requestApproval(db, {
      organizationId,
      executionId,
      requestedAction: body.requestedAction,
      summary: body.summary,
      riskLevel: body.riskLevel,
      artifactId: body.artifactId ?? null,
      proposedActionRef: body.proposedActionRef ?? null,
      expiresInHours: body.expiresInHours,
      actorAgentId: principal.agentId,
    });

    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
