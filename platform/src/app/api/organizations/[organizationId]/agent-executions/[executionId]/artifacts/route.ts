import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { agentArtifactTypeSchema, titleSchema, contentSchema } from "@/lib/agent-runtime/validation";
import { authenticateAgentForExecutionRoute } from "@/lib/agent-runtime/route-helpers";
import { getExecutionForUser } from "@/lib/agent-runtime/executions";
import { createArtifact, listArtifactsForExecution } from "@/lib/agent-runtime/artifacts";

export const dynamic = "force-dynamic";

const createArtifactBodySchema = z
  .object({
    artifactType: agentArtifactTypeSchema,
    title: titleSchema,
    content: contentSchema.optional(),
    externalRef: z.string().trim().max(2000).optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/**
 * GET .../{executionId}/artifacts
 * §13: task-execution-scoped outputs, structurally separate from Brain
 * Knowledge Items — never promoted automatically.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await getExecutionForUser(db, { organizationId, executionId, actorUserId: user.userId });

    const artifacts = await listArtifactsForExecution(db, organizationId, executionId);
    return jsonSuccess({ artifacts });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST .../{executionId}/artifacts — agent-authenticated. Never large binary content directly — `file_reference` artifacts require `externalRef`. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForExecutionRoute(db, request, organizationId);
    const body = await parseJsonBody(request, createArtifactBodySchema);

    const artifact = await createArtifact(db, {
      organizationId,
      executionId,
      artifactType: body.artifactType,
      title: body.title,
      content: body.content ?? null,
      externalRef: body.externalRef ?? null,
      actorAgentId: principal.agentId,
    });

    return jsonSuccess(artifact, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
