import "server-only";

import { after } from "next/server";
import { neon } from "@neondatabase/serverless";
import { createDbClient } from "@/db/client";
import { loadEnv } from "@/lib/env";
import { timingSafeEqualStrings } from "@/lib/communications-os/secrets";
import { pollAndProcess } from "@/lib/runtime/worker";
import { createTelegramTransport } from "@/lib/telegram/api";
import { resolveTelegramConfig } from "@/lib/telegram/config";
import { handleTelegramUpdate } from "@/lib/telegram/control";
import { claimTelegramEvent } from "@/lib/telegram/link";
import { normalizeTelegramUpdate, redactForEventLog } from "@/lib/telegram/updates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_UPDATE_BYTES = 200_000;

/**
 * The founder's phone, talking to his company.
 *
 * Telegram delivers every update here and retries until it gets a 200, so
 * this route answers 200 for everything it has safely handled — including
 * everything it refuses. Returning an error to Telegram only produces the
 * same refused update again, forever.
 *
 * Three things happen before any work does:
 *
 *  1. The secret token header must match, compared in constant time. It is
 *     the only thing that proves the request came from Telegram at all.
 *  2. The lane must be configured. An unconfigured deployment accepts
 *     nothing rather than accepting an update into a guessed tenant.
 *  3. The update id must be new. Telegram redelivers; the uniqueness
 *     constraint on the event log is what makes "acted on once" true
 *     rather than intended.
 */
export async function POST(request: Request) {
  const acknowledge = () => Response.json({ ok: true });

  try {
    const resolution = resolveTelegramConfig();
    if (!resolution.ok) return acknowledge();
    const config = resolution.config;

    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    if (!provided || !timingSafeEqualStrings(provided, config.webhookSecret)) {
      return Response.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
    }

    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_UPDATE_BYTES) return acknowledge();
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_UPDATE_BYTES) return acknowledge();

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return acknowledge();
    }

    const update = normalizeTelegramUpdate(payload);
    if (!update) return acknowledge();

    const env = loadEnv();
    const db = createDbClient(env);

    // Claimed before the work, not after: a redelivery that arrives while
    // the first is still running must not open a second project.
    const first = await claimTelegramEvent(db, {
      eventId: update.eventId,
      organizationId: config.organizationId,
      chatId: update.chatId,
      kind: update.callbackId ? "callback" : "message",
      outcome: "claimed",
      detail: redactForEventLog(update.action),
    });
    if (!first) return acknowledge();

    const result = await handleTelegramUpdate(db, {
      update,
      config,
      transport: createTelegramTransport(config.botToken),
    });

    if (result.launched > 0) {
      const rawSql = neon(env.DATABASE_URL);
      after(async () => {
        await pollAndProcess(db, rawSql, {
          leaseOwner: `telegram-directive:${result.projectId ?? update.eventId}`,
          jobTypes: ["execution_run"],
          maxJobs: result.launched,
        });
      });
    }

    return acknowledge();
  } catch (error) {
    // A crash must not make Telegram retry the same update forever. It is
    // already recorded as claimed, and the founder gets no silent success:
    // the failure is logged with the update it belonged to.
    console.error("[jarvis-telegram] update handling failed:", error instanceof Error ? error.message : "unknown error");
    return acknowledge();
  }
}
