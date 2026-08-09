import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { knowledgeDomainSchema } from "@/lib/brain/validation";
import { goalSchema, criteriaSchema } from "@/lib/agent-runtime/validation";
import { authenticateAgentForExecutionRoute } from "@/lib/agent-runtime/route-helpers";
import { delegateExecution } from "@/lib/agent-runtime/delegation";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    delegateAgentId: uuidParam,
    goal: goalSchema,
    successCriteria: criteriaSchema,
    failureCriteria: criteriaSchema,
    domainsRequested: z.array(knowledgeDomainSchema).min(1).max(8),
    ownerUserId: uuidParam.optional(),
    timeoutHours: z.coerce.number().int().min(1).max(720).optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** POST .../{executionId}/delegate — agent-authenticated. §6: creates a new, first-class child execution; the delegating agent must itself hold `read` on every requested domain; ancestry-checked for cycles; hard-capped depth. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForExecutionRoute(db, request, organizationId);
    const body = await parseJsonBody(request, bodySchema);

    const result = await delegateExecution(db, {
      organizationId,
      parentExecutionId: executionId,
      delegateAgentId: body.delegateAgentId,
      goal: body.goal,
      successCriteria: body.successCriteria,
      failureCriteria: body.failureCriteria,
      domainsRequested: body.domainsRequested,
      ownerUserId: body.ownerUserId,
      timeoutHours: body.timeoutHours,
      actorAgentId: principal.agentId,
    });

    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
