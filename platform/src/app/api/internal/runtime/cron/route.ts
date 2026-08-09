import "server-only";

import { neon } from "@neondatabase/serverless";
import { createDbClient } from "@/db/client";
import { loadEnv } from "@/lib/env";
import { pollAndProcess } from "@/lib/runtime/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function GET(request: Request) {
  const env = loadEnv();
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const processed: string[] = [];
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const result = await pollAndProcess(db, rawSql, { leaseOwner: `office-cron:${crypto.randomUUID()}`, maxJobs: 4 });
    processed.push(...result.processed.map((job) => job.id));
    if (result.processed.length === 0) break;
  }
  return Response.json({ ok: true, processed: processed.length });
}
