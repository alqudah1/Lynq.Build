import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { authenticateAgentForExecutionRoute } from "@/lib/agent-runtime/route-helpers";
import { completePlanStep, failPlanStep } from "@/lib/agent-runtime/plans";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ outcome: z.enum(["completed", "failed"]), relatedExecutionId: z.string().uuid().optional() }).strict();
const stepNumberSchema = z.coerce.number().int().min(1);

type RouteParams = { params: Promise<{ organizationId: string; executionId: string; planId: string; stepNumber: string }> };

/** POST .../plans/{planId}/steps/{stepNumber} — agent-authenticated. Marks one plan step completed or failed; feeds directly into `completeExecution`'s own completion-evidence gate. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId, planId: rawPlanId, stepNumber: rawStepNumber } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);
    const planId = parseUuidParam(rawPlanId);
    const stepNumber = stepNumberSchema.parse(rawStepNumber);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForExecutionRoute(db, request, organizationId);
    const body = await parseJsonBody(request, bodySchema);

    const step =
      body.outcome === "completed"
        ? await completePlanStep(db, { organizationId, executionId, planId, stepNumber, actorAgentId: principal.agentId, relatedExecutionId: body.relatedExecutionId ?? null })
        : await failPlanStep(db, { organizationId, executionId, planId, stepNumber, actorAgentId: principal.agentId });

    return jsonSuccess(step);
  } catch (err) {
    return handleRouteError(err);
  }
}
