import "server-only";

import { neon } from "@neondatabase/serverless";
import { createDbClient } from "@/db/client";
import { loadEnv } from "@/lib/env";
import { timingSafeEqualStrings } from "@/lib/communications-os/secrets";
import { pollAndProcess } from "@/lib/runtime/worker";
import { enqueueDueAutomationRules } from "@/lib/social-os/automation";
import { loadTelegramEnv, resolveTelegramActor, runMorningTelegramSend } from "@/lib/social-os/telegram";
import { applyWeekPlan, currentWeekPlan, fillWeekPlanImages, generatePlanImages, getWeekPlanStatus } from "@/lib/social-os/week-plans";

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
  // Social: once an hour, re-apply the current week plan wherever it is already loaded, so caption, date, art and
  // highlight changes land on their own (nobody has to press Re-load). Never blocks job processing.
  let planApplied = 0;
  try {
    const plan = currentWeekPlan();
    const actor = await resolveTelegramActor(db, loadTelegramEnv());
    if (plan && actor && new Date().getMinutes() < 15) {
      for (const organizationId of actor.organizationIds) {
        const status = await getWeekPlanStatus(db, { organizationId, actorUserId: actor.userId, planKey: plan.key });
        if (!status.loaded) continue;
        const report = await applyWeekPlan(db, { organizationId, actorUserId: actor.userId, planKey: plan.key });
        planApplied++;
        if (report.imagesQueued.length) await generatePlanImages(db, { organizationId, actorUserId: actor.userId, queue: report.imagesQueued.slice(0, 3) });
      }
    }
  } catch (err) {
    console.error("week plan auto-apply failed", err instanceof Error ? err.message.slice(0, 200) : "unknown error");
  }
  // Social: finish week-plan images the load-time job didn't get to (a few per run). Never blocks job processing.
  let planImages = 0;
  try {
    const actor = await resolveTelegramActor(db, loadTelegramEnv());
    for (const organizationId of actor?.organizationIds ?? []) {
      const r = await fillWeekPlanImages(db, { organizationId, actorUserId: actor!.userId, limit: 3 });
      planImages += r.generated + r.copied;
    }
  } catch (err) {
    console.error("week plan image fill failed", err instanceof Error ? err.message.slice(0, 200) : "unknown error");
  }
  const processed: string[] = [];
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const result = await pollAndProcess(db, rawSql, { leaseOwner: `office-cron:${crypto.randomUUID()}`, maxJobs: 4 });
    processed.push(...result.processed.map((job) => job.id));
    if (result.processed.length === 0) break;
  }
  return Response.json({ ok: true, processed: processed.length, automationEnqueued, telegramSent, planApplied, planImages });
}
