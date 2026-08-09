import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody } from "@/lib/http/validation";
import { issueWorkerCredential } from "@/lib/runtime/worker-auth";

export const dynamic = "force-dynamic";

const issueBodySchema = z.object({ workerName: z.string().trim().min(1).max(200), bootstrapSecret: z.string().min(1) }).strict();

/**
 * POST /api/internal/runtime/worker/credentials
 *
 * Mints a new worker identity — gated by `WORKER_BOOTSTRAP_SECRET`
 * (deploy-time operational secret), never a human session or an
 * organization role. This is the ONE ops action this secret authorizes;
 * it grants no business-data access on its own.
 */
export async function POST(request: Request) {
  try {
    const env = loadEnv();
    const db = createDbClient(env);

    const body = await parseJsonBody(request, issueBodySchema);
    const { credential, plaintextSecret } = await issueWorkerCredential(db, { workerName: body.workerName, bootstrapSecret: body.bootstrapSecret });

    return jsonSuccess({ credential, secret: plaintextSecret }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
