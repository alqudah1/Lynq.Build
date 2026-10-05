import "server-only";

import { neon } from "@neondatabase/serverless";
import { createDbClient } from "@/db/client";
import { loadEnv } from "@/lib/env";
import { timingSafeEqualStrings } from "@/lib/communications-os/secrets";
import { pollAndProcess } from "@/lib/runtime/worker";
import { enqueueDueAutomationRules } from "@/lib/social-os/automation";
import { loadTelegramEnv, runMorningTelegramSend } from "@/lib/social-os/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function GET(request: Request) {
  const env = loadEnv();
  if (!env.CRON_SECRET || !timingSafeEqualStrings(request.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  // Module 19 — enqueue due Social automation rules first. A scheduler failure must never block job processing.
  let automationEnqueued = 0;
  try {
    automationEnqueued = (await enqueueDueAutomationRules(db, {})).enqueued;
  } catch (err) {
    console.error("social automation scheduler failed", err instanceof Error ? err.message : "unknown error");
  }
  // Social: from 8:00 (owner's timezone) today's planned posts are sent to Telegram for approval. Never blocks job processing.
  let telegramSent = 0;
  try {
    telegramSent = (await runMorningTelegramSend(db, loadTelegramEnv())).sent;
  } catch (err) {
    console.error("telegram morning send failed", err instanceof Error ? err.message.split(":")[0] : "unknown error");
  }
  const processed: string[] = [];
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const result = await pollAndProcess(db, rawSql, { leaseOwner: `office-cron:${crypto.randomUUID()}`, maxJobs: 4 });
    processed.push(...result.processed.map((job) => job.id));
    if (result.processed.length === 0) break;
  }
  return Response.json({ ok: true, processed: processed.length, automationEnqueued, telegramSent });
}
