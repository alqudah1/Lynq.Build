import "server-only";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { knowledgeDomainSchema } from "@/lib/brain/validation";
import { launchKnowledgeAnalystForTask, listExecutionLinksForTask } from "@/lib/projects/links";

export const dynamic = "force-dynamic";

const launchBodySchema = z
  .object({
    topic: z.string().trim().min(1).max(500),
    allowedDomains: z.array(knowledgeDomainSchema).min(1).max(8),
    maxResults: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string; taskId: string }> };

/** GET /api/organizations/{organizationId}/projects/{projectId}/tasks/{taskId}/agent-execution — every execution ever launched for this task. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, taskId: rawTaskId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const taskId = parseUuidParam(rawTaskId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const links = await listExecutionLinksForTask(db, { organizationId, taskId, actorUserId: user.userId });
    return jsonSuccess({ links });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/projects/{projectId}/tasks/{taskId}/agent-execution
 * Launches the Company Knowledge Analyst against this task — the only
 * agent this phase supports. Task state is never auto-changed by this
 * call; human project status remains authoritative.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId, taskId: rawTaskId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);
    const taskId = parseUuidParam(rawTaskId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, launchBodySchema);
    const link = await launchKnowledgeAnalystForTask(db, rawSql, { organizationId, projectId, taskId, topic: body.topic, allowedDomains: body.allowedDomains, maxResults: body.maxResults, actorUserId: user.userId });

    return jsonSuccess(link, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
