import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, uuidParam } from "@/lib/http/validation";
import { authenticateWorkerFromHeader } from "@/lib/runtime/worker-auth";
import { heartbeatJob } from "@/lib/runtime/queue";

export const dynamic = "force-dynamic";

const heartbeatBodySchema = z.object({ jobId: uuidParam }).strict();

type RouteParams = { params: Promise<{ workerId: string }> };

/**
 * POST /api/internal/runtime/worker/{workerId}/heartbeat
 * Extends the lease for one in-progress job — only honored if this
 * exact `(workerCredentialId, workerId)` pair currently holds it.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { workerId } = await params;

    const env = loadEnv();
    const db = createDbClient(env);
    const worker = await authenticateWorkerFromHeader(db, request);

    const body = await parseJsonBody(request, heartbeatBodySchema);
    const leaseOwner = `${worker.workerCredentialId}:${workerId}`;

    const job = await heartbeatJob(db, { jobId: body.jobId, leaseOwner });
    return jsonSuccess({ jobId: job.id, leaseExpiresAt: job.leaseExpiresAt });
  } catch (err) {
    return handleRouteError(err);
  }
}
