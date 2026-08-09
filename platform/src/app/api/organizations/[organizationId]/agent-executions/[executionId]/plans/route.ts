import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { changeReasonSchema } from "@/lib/agent-runtime/validation";
import { authenticateAgentForExecutionRoute } from "@/lib/agent-runtime/route-helpers";
import { getExecutionForUser } from "@/lib/agent-runtime/executions";
import { createPlan, getLatestPlan, getPlanSteps } from "@/lib/agent-runtime/plans";

export const dynamic = "force-dynamic";

const createPlanBodySchema = z
  .object({
    steps: z.array(z.string().trim().min(1).max(2000)).min(1).max(50),
    changeReason: changeReasonSchema.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** GET .../{executionId}/plans — the current (latest-version) plan and its steps. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await getExecutionForUser(db, { organizationId, executionId, actorUserId: user.userId });

    const plan = await getLatestPlan(db, executionId);
    const steps = plan ? await getPlanSteps(db, plan.id) : [];
    return jsonSuccess({ plan, steps });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST .../{executionId}/plans — agent-authenticated. §4's versioned Plan: always a NEW version, never an in-place edit. A re-plan (version > 1) requires `changeReason`. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForExecutionRoute(db, request, organizationId);
    const body = await parseJsonBody(request, createPlanBodySchema);

    const result = await createPlan(db, { organizationId, executionId, steps: body.steps, changeReason: body.changeReason ?? null, actorAgentId: principal.agentId });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
