import "server-only";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody } from "@/lib/http/validation";
import { authenticateWorkerFromHeader } from "@/lib/runtime/worker-auth";
import { pollAndProcess } from "@/lib/runtime/worker";
import { RUNTIME_JOB_TYPES, runtimeJobTypeSchema } from "@/lib/runtime/validation";
import { RUNTIME_CONFIG } from "@/lib/runtime/config";

export const dynamic = "force-dynamic";

const pollBodySchema = z
  .object({
    workerId: z.string().trim().min(1).max(100),
    jobTypes: z.array(runtimeJobTypeSchema).min(1).max(RUNTIME_JOB_TYPES.length).optional(),
    maxJobs: z.coerce.number().int().min(1).max(20).optional(),
  })
  .strict();

/**
 * POST /api/internal/runtime/worker/poll
 *
 * Server-to-server only (`Authorization: Bearer <worker credential>`,
 * never a human session or agent credential). Claims up to `maxJobs`
 * eligible jobs and processes each to a terminal outcome for this
 * attempt, then returns — suited to a serverless invocation triggered on
 * a schedule. `leaseOwner` is derived from the authenticated worker
 * credential plus the caller-supplied `workerId`, so a heartbeat call
 * using the same pair extends the exact same lease.
 */
export async function POST(request: Request) {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const worker = await authenticateWorkerFromHeader(db, request);

    const body = await parseJsonBody(request, pollBodySchema);
    const leaseOwner = `${worker.workerCredentialId}:${body.workerId}`;

    const result = await pollAndProcess(db, rawSql, { leaseOwner, jobTypes: body.jobTypes ?? [...RUNTIME_JOB_TYPES], maxJobs: body.maxJobs ?? RUNTIME_CONFIG.maxJobsPerPoll });

    return jsonSuccess({ leaseOwner: result.leaseOwner, processedCount: result.processed.length, processed: result.processed.map((j) => ({ id: j.id, jobType: j.jobType, status: j.status })) });
  } catch (err) {
    return handleRouteError(err);
  }
}
