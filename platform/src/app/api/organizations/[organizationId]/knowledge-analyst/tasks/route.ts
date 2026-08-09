import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { knowledgeDomainSchema } from "@/lib/brain/validation";
import { resolveKnowledgeAnalystAgent, createKnowledgeAnalystTask } from "@/lib/agents/knowledge-analyst";

export const dynamic = "force-dynamic";

const startTaskBodySchema = z
  .object({
    workspaceId: uuidParam.optional(),
    topic: z.string().trim().min(1).max(500),
    allowedDomains: z.array(knowledgeDomainSchema).min(1).max(8),
    maxResults: z.coerce.number().int().min(1).max(50).optional(),
    // Only "structured" (deterministic JSON) is implemented in this phase —
    // accepted explicitly rather than silently ignored, so a caller asking
    // for something else gets a clear 400 instead of a silent substitution.
    reportFormat: z.literal("structured").optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * POST /api/organizations/{organizationId}/knowledge-analyst/tasks
 *
 * Module 9: creates the execution and its plan, enqueues the job that
 * will actually run it, and returns immediately (202) — HTTP request
 * lifetime is never what keeps the execution alive. A background worker
 * (`POST /api/internal/runtime/worker/poll`) claims and drives the job
 * independently; poll `GET .../tasks/{executionId}/report` for status
 * and, once complete, the final report.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, startTaskBodySchema);
    const agent = await resolveKnowledgeAnalystAgent(db, organizationId);

    const { execution, job } = await createKnowledgeAnalystTask(db, {
      organizationId,
      workspaceId: body.workspaceId ?? null,
      ownerUserId: user.userId,
      agentId: agent.id,
      topic: body.topic,
      allowedDomains: body.allowedDomains,
      maxResults: body.maxResults,
      actorUserId: user.userId,
    });

    return jsonSuccess({ executionId: execution.id, status: execution.status, jobId: job.id }, 202);
  } catch (err) {
    return handleRouteError(err);
  }
}
