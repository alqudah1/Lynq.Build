import "server-only";
import { eq } from "drizzle-orm";
import { createDbClient } from "@/db/client";
import { users } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { loadTelegramEnv, registerTelegramWebhook, telegramEnabled } from "@/lib/social-os/telegram";

export const dynamic = "force-dynamic";

/**
 * GET /api/social/telegram/setup — the signed-in approver opens this once to
 * point the bot at this deployment. Only the TELEGRAM_APPROVER_EMAIL user may
 * run it. Nothing secret is returned.
 */
export async function GET() {
  const tg = loadTelegramEnv();
  if (!telegramEnabled(tg)) return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN is missing or malformed on this deployment." }, { status: 503 });
  const db = createDbClient(loadEnv());
  let userId: string;
  try {
    userId = (await getAuthenticatedUser(db)).userId;
  } catch {
    return Response.json({ ok: false, error: "Sign in to LYNQ first, then open this link again." }, { status: 401 });
  }
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const approver = tg.TELEGRAM_APPROVER_EMAIL?.trim().toLowerCase();
  if (!approver || user?.email.toLowerCase() !== approver) return Response.json({ ok: false, error: "Only the TELEGRAM_APPROVER_EMAIL user can set up the bot." }, { status: 403 });
  try {
    const webhook = await registerTelegramWebhook(tg);
    return Response.json({ ok: true, webhook, next: tg.TELEGRAM_CHAT_ID ? "Send /pending to the bot." : "Send /start to the bot to get your chat id, then add it as TELEGRAM_CHAT_ID and redeploy." });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message.replace(/bot\d+:[^/]+/g, "bot***") : "Telegram rejected the setup." }, { status: 502 });
  }
}
