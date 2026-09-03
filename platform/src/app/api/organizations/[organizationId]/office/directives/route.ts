import "server-only";

import { after } from "next/server";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError, jsonSuccess } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { pollAndProcess } from "@/lib/runtime/worker";
import { createDirectiveProject, DirectivePartiallyCreatedError } from "@/lib/office/directive-intake";
import { DirectiveHandoffIncompleteError } from "@/lib/voice/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z
  .object({
    instruction: z.string().trim().min(10).max(5000),
    workspaceId: uuidParam.optional(),
    preferredAgentId: uuidParam.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * Founder-facing office intake. One plain-language directive becomes a real
 * Project OS record, real tasks, and real Agent Runtime executions. The AI is
 * allowed to plan and route; every durable write still passes through the
 * existing human authorization, audit, tenant, and lifecycle gates.
 *
 * The orchestration itself now lives in `@/lib/office/directive-intake` so the
 * secure phone lane creates directives through this exact code rather than a
 * second implementation. This route remains the browser's entry point: it
 * authenticates the session, validates the body, and schedules the durable
 * worker drain after the response.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);

    const result = await createDirectiveProject(db, {
      organizationId,
      instruction: body.instruction,
      workspaceId: body.workspaceId ?? null,
      preferredAgentId: body.preferredAgentId ?? null,
      actorUserId: user.userId,
      source: "command_center",
    });

    if (result.assignments.length > 0) {
      const rawSql = neon(env.DATABASE_URL);
      after(async () => {
        await pollAndProcess(db, rawSql, {
          leaseOwner: `office-directive:${result.project.id}`,
          jobTypes: ["execution_run"],
          maxJobs: result.launchedCount,
        });
      });
    }

    return jsonSuccess(
      {
        assistantReply: result.assistantReply,
        plannedByAI: result.plannedByAI,
        executionMode: result.executionMode,
        project: {
          id: result.project.id,
          name: result.project.name,
          projectKey: result.project.projectKey,
          status: result.project.status,
        },
        assignments: result.assignments,
      },
      201
    );
  } catch (err) {
    // A partial creation must not be reported as a clean failure: the project
    // exists and its agents may be running. Translating it here keeps
    // `handleRouteError`'s typed-error contract intact (a raw wrapper would
    // fall through to a generic 500) and tells the caller what actually
    // happened.
    if (err instanceof DirectivePartiallyCreatedError) {
      // The wrapped error is logged too. `DirectiveHandoffIncompleteError` is a
      // domain rule violation, so `handleRouteError` answers 409 and never
      // reaches its own unexpected-error logging — which meant the only record
      // of WHY a handoff died was a project id, and the cause was unrecoverable
      // from the logs. The phone lane already unwraps `reason` to classify the
      // failure; the web route threw it away.
      console.error(
        "[office-directive]",
        JSON.stringify({
          event: "partially-created",
          projectId: err.projectId,
          reason: err.reason instanceof Error ? `${err.reason.name}: ${err.reason.message}` : String(err.reason),
        }),
        err.reason instanceof Error ? err.reason.stack : undefined
      );
      return handleRouteError(new DirectiveHandoffIncompleteError(err.projectId, err.projectName));
    }
    return handleRouteError(err);
  }
}
