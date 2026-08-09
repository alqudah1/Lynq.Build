import "server-only";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, uuidParam } from "@/lib/http/validation";
import { authenticateWorkerFromHeader } from "@/lib/runtime/worker-auth";
import { reconcileExecutions } from "@/lib/runtime/reconciliation-executions";
import { reconcileToolInvocations } from "@/lib/runtime/reconciliation-tool-invocations";
import { cleanupExpiredSessions, cleanupStaleRateLimitCounters, cleanupOldCompletedJobs } from "@/lib/runtime/cleanup";

export const dynamic = "force-dynamic";

const reconcileBodySchema = z.object({ organizationId: uuidParam.optional() }).strict();

/**
 * POST /api/internal/runtime/reconcile
 *
 * The one general housekeeping sweep: execution reconciliation, tool-
 * invocation reconciliation, and every cleanup job — session/rate-limit
 * expiry plus queue-row retention. Server-to-server only, meant to be
 * triggered on a schedule (e.g. a platform cron), never by a human
 * session. Scoped to one organization if given, otherwise global.
 */
export async function POST(request: Request) {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    await authenticateWorkerFromHeader(db, request);

    const body = await parseJsonBody(request, reconcileBodySchema);

    const [executionResult, toolResult, sessionsResult, rateLimitResult, jobRetentionResult] = await Promise.all([
      reconcileExecutions(db, { organizationId: body.organizationId }),
      reconcileToolInvocations(db, rawSql, { organizationId: body.organizationId }),
      cleanupExpiredSessions(db),
      cleanupStaleRateLimitCounters(db),
      cleanupOldCompletedJobs(db),
    ]);

    return jsonSuccess({
      executionReconciliation: { outcomeCount: executionResult.outcomes.length, recordsExamined: executionResult.recordsExamined },
      toolInvocationReconciliation: { outcomeCount: toolResult.outcomes.length, recordsExamined: toolResult.recordsExamined },
      cleanup: { sessions: sessionsResult, rateLimitCounters: rateLimitResult, oldJobs: jobRetentionResult },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
