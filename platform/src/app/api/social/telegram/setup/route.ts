import "server-only";
import { loadTelegramEnv, registerTelegramWebhook, telegramEnabled } from "@/lib/social-os/telegram";

export const dynamic = "force-dynamic";

/**
 * GET /api/social/telegram/setup — points the bot at this deployment. No
 * sign-in needed: it can only ever target this deployment's own AUTH_BASE_URL
 * with a secret derived from AUTH_SECRET, it is a no-op once already set, and
 * it returns nothing secret. Approvals themselves stay locked to
 * TELEGRAM_CHAT_ID + TELEGRAM_APPROVER_EMAIL.
 */
export async function GET() {
  const tg = loadTelegramEnv();
  if (!telegramEnabled(tg)) return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN is missing or malformed on this deployment." }, { status: 503 });
  try {
    const status = await registerTelegramWebhook(tg);
    const protectedPreview = /401|403|authentication|unauthorized|forbidden/i.test(status.lastError ?? "");
    return Response.json({
      ok: !status.lastError,
      connected: true,
      webhookHost: new URL(status.url).host,
      bypassConfigured: Boolean(process.env.VERCEL_AUTOMATION_BYPASS_SECRET),
      telegramLastError: status.lastError,
      waitingMessages: status.pendingUpdates,
      next: status.lastError
        ? protectedPreview && !process.env.VERCEL_AUTOMATION_BYPASS_SECRET
          ? "Telegram is being blocked by Vercel Deployment Protection. Enable 'Protection Bypass for Automation' in Vercel → Settings → Deployment Protection, redeploy, then open this link again."
          : "Telegram can't deliver to this site yet — see telegramLastError."
        : tg.TELEGRAM_CHAT_ID ? "All set. Send /pending to the bot." : "Bot connected. Send /start to the bot to get your chat id, then add it as TELEGRAM_CHAT_ID.",
    });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message.replace(/bot\d+:[^/]+/g, "bot***") : "Telegram rejected the setup." }, { status: 502 });
  }
}
