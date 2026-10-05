import "server-only";
import { after } from "next/server";
import { neon } from "@neondatabase/serverless";
import { createDbClient } from "@/db/client";
import { loadEnv } from "@/lib/env";
import { pollAndProcess } from "@/lib/runtime/worker";
import { handleTelegramUpdate, loadTelegramEnv, telegramEnabled, verifyTelegramWebhookSecret } from "@/lib/social-os/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/social/telegram/webhook — Telegram delivers bot updates here.
 * Authenticated by the secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token
 * (derived from AUTH_SECRET and set by /api/social/telegram/setup); only
 * TELEGRAM_CHAT_ID is obeyed. Always 200 once authenticated so Telegram does
 * not redeliver a button tap that was already handled.
 */
export async function POST(request: Request) {
  const env = loadEnv();
  const tg = loadTelegramEnv();
  if (!telegramEnabled(tg)) return new Response("Not configured", { status: 503 });
  if (!verifyTelegramWebhookSecret(tg.AUTH_SECRET, request.headers.get("x-telegram-bot-api-secret-token"))) return new Response("Forbidden", { status: 403 });
  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return Response.json({ ok: true, action: "bad_json" });
  }
  const db = createDbClient(env);
  try {
    const result = await handleTelegramUpdate(db, tg, update as Parameters<typeof handleTelegramUpdate>[2]);
    if (result.action === "decided:publish:ok") {
      // Preview deployments get no Vercel cron, so run the publish job now instead of waiting for one.
      after(async () => {
        try {
          const rawSql = neon(env.DATABASE_URL);
          for (let cycle = 0; cycle < 4; cycle += 1) {
            const r = await pollAndProcess(db, rawSql, { leaseOwner: `telegram:${crypto.randomUUID()}`, maxJobs: 4 });
            if (r.processed.length === 0) break;
          }
        } catch (err) {
          console.error("[telegram] publish drain failed:", err instanceof Error ? err.name : "unknown");
        }
      });
    }
    return Response.json({ ok: true, action: result.action });
  } catch (err) {
    console.error("[telegram] update failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ ok: true, action: "error" });
  }
}
