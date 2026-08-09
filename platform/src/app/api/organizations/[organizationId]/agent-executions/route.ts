import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { knowledgeDomainSchema } from "@/lib/brain/validation";
import { goalSchema, criteriaSchema, agentExecutionStatusSchema, listLimitSchema } from "@/lib/agent-runtime/validation";
import { createExecution, listExecutionsForUser } from "@/lib/agent-runtime/executions";

export const dynamic = "force-dynamic";

const createExecutionBodySchema = z
  .object({
    workspaceId: uuidParam.optional(),
    ownerUserId: uuidParam.optional(),
    goal: goalSchema,
    successCriteria: criteriaSchema,
    failureCriteria: criteriaSchema,
    domainsRequested: z.array(knowledgeDomainSchema).min(1).max(8),
    priority: z.coerce.number().int().min(0).max(100).optional(),
    deadline: z.string().datetime().optional(),
    maxRetries: z.coerce.number().int().min(0).max(10).optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * GET /api/organizations/{organizationId}/agent-executions
 * Query params: workspaceId?, status?, assignedAgentId?, cursor?, limit?
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({
        workspaceId: uuidParam.optional(),
        status: agentExecutionStatusSchema.optional(),
        assignedAgentId: uuidParam.optional(),
        cursor: z.string().optional(),
        limit: listLimitSchema.optional(),
      })
      .parse({
        workspaceId: url.searchParams.get("workspaceId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        assignedAgentId: url.searchParams.get("assignedAgentId") ?? undefined,
        cursor: url.searchParams.get("cursor") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      });

    const result = await listExecutionsForUser(db, {
      organizationId,
      workspaceId: query.workspaceId,
      status: query.status,
      assignedAgentId: query.assignedAgentId,
      cursor: query.cursor ?? null,
      limit: query.limit,
      actorUserId: user.userId,
    });

    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/agent-executions
 * Creates a new root execution (§2's Task). `ownerUserId` defaults to the
 * caller.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createExecutionBodySchema);

    const execution = await createExecution(db, {
      organizationId,
      workspaceId: body.workspaceId ?? null,
      ownerUserId: body.ownerUserId ?? user.userId,
      goal: body.goal,
      successCriteria: body.successCriteria,
      failureCriteria: body.failureCriteria,
      domainsRequested: body.domainsRequested,
      priority: body.priority,
      deadline: body.deadline ? new Date(body.deadline) : null,
      maxRetries: body.maxRetries,
      actorUserId: user.userId,
    });

    return jsonSuccess(execution, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
