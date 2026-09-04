import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { jarvisTelegramEvents, jarvisTelegramLinks } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { verifyFounderPasscode, deriveFounderPasscode, passcodeMillisecondsRemaining } from "@/lib/voice/founder-verification";
import { MAX_LINK_ATTEMPTS_PER_HOUR, TELEGRAM_LINK_SCOPE, type JarvisTelegramConfig } from "./config";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Trusting one Telegram chat, once.
 *
 * A chat id is stable but not secret — anyone can message a bot, and the id
 * they arrive with is simply theirs. So it authenticates nothing on its own.
 * A chat becomes trusted by presenting a rotating code that only an
 * authenticated LYNQ session can display, which means a successful link
 * proves possession of both the Telegram account and a live founder
 * session. After that the stored link is the credential, and revoking it is
 * a single row.
 *
 * The same HMAC construction as the phone lane, under its own scope, so a
 * code read aloud on a call can never link a chat and vice versa.
 */

export type TelegramLink = {
  id: string;
  organizationId: string;
  userId: string;
  telegramChatId: string;
};

export type LinkOutcome =
  | { ok: true; link: TelegramLink; relinked: boolean }
  | { ok: false; reason: "bad_code" | "attempts_exhausted" };

/** The code the founder reads from the Command Center, and how long it lasts. */
export function currentTelegramLinkCode(config: JarvisTelegramConfig, atMs: number = Date.now()): { code: string; expiresInMs: number } {
  return {
    code: deriveFounderPasscode(config.linkSecret, atMs, TELEGRAM_LINK_SCOPE),
    expiresInMs: passcodeMillisecondsRemaining(atMs),
  };
}

export async function resolveActiveLink(db: Db, chatId: string): Promise<TelegramLink | null> {
  const [row] = await db
    .select({ id: jarvisTelegramLinks.id, organizationId: jarvisTelegramLinks.organizationId, userId: jarvisTelegramLinks.userId, telegramChatId: jarvisTelegramLinks.telegramChatId })
    .from(jarvisTelegramLinks)
    .where(and(eq(jarvisTelegramLinks.telegramChatId, chatId), eq(jarvisTelegramLinks.status, "active")));
  return row ?? null;
}

/**
 * How many pairing attempts this chat has already burned in the last hour.
 *
 * The event log is the counter: every refused attempt is written there
 * anyway for the audit trail, so the budget needs no second table and
 * survives a restart.
 */
export async function recentFailedLinkAttempts(db: Db, chatId: string, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ id: jarvisTelegramEvents.id })
    .from(jarvisTelegramEvents)
    .where(
      and(
        eq(jarvisTelegramEvents.chatId, chatId),
        eq(jarvisTelegramEvents.outcome, "link_refused"),
        gt(jarvisTelegramEvents.createdAt, new Date(now.getTime() - 3600_000)),
      ),
    );
  return rows.length;
}

export async function linkTelegramChat(
  db: Db,
  input: { config: JarvisTelegramConfig; chatId: string; username: string | null; code: string; now?: Date },
): Promise<LinkOutcome> {
  const now = input.now ?? new Date();
  const priorAttempts = await recentFailedLinkAttempts(db, input.chatId, now);
  if (priorAttempts >= MAX_LINK_ATTEMPTS_PER_HOUR) return { ok: false, reason: "attempts_exhausted" };

  const outcome = verifyFounderPasscode({
    secret: input.config.linkSecret,
    spoken: input.code,
    atMs: now.getTime(),
    // The hourly budget above is the real limit; this argument bounds a
    // single call, which does not apply to a chat message.
    priorAttempts: 0,
    scope: TELEGRAM_LINK_SCOPE,
  });
  if (!outcome.verified) return { ok: false, reason: "bad_code" };

  const existing = await resolveActiveLink(db, input.chatId);
  if (existing) {
    await db
      .update(jarvisTelegramLinks)
      .set({ lastSeenAt: now, telegramUsername: input.username, revision: sql`${jarvisTelegramLinks.revision} + 1` })
      .where(eq(jarvisTelegramLinks.id, existing.id));
    return { ok: true, link: existing, relinked: true };
  }

  const [created] = await db
    .insert(jarvisTelegramLinks)
    .values({
      organizationId: input.config.organizationId,
      userId: input.config.founderUserId,
      telegramChatId: input.chatId,
      telegramUsername: input.username,
      lastSeenAt: now,
    })
    .returning({ id: jarvisTelegramLinks.id, organizationId: jarvisTelegramLinks.organizationId, userId: jarvisTelegramLinks.userId, telegramChatId: jarvisTelegramLinks.telegramChatId });
  if (!created) return { ok: false, reason: "bad_code" };

  await recordAuditEvent(db, {
    eventType: "jarvis_telegram_linked",
    organizationId: input.config.organizationId,
    actorUserId: input.config.founderUserId,
    targetType: "jarvis_telegram_link",
    targetId: created.id,
    // The chat id is an identifier, never a credential; the code is not recorded.
    metadata: { telegramUsername: input.username },
  }).catch(() => undefined);

  return { ok: true, link: created, relinked: false };
}

export async function revokeTelegramLink(db: Db, input: { link: TelegramLink; actorUserId: string; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(jarvisTelegramLinks)
    .set({ status: "revoked", revokedAt: now, revokedByUserId: input.actorUserId, revision: sql`${jarvisTelegramLinks.revision} + 1` })
    .where(and(eq(jarvisTelegramLinks.id, input.link.id), eq(jarvisTelegramLinks.status, "active")));
  await recordAuditEvent(db, {
    eventType: "jarvis_telegram_revoked",
    organizationId: input.link.organizationId,
    actorUserId: input.actorUserId,
    targetType: "jarvis_telegram_link",
    targetId: input.link.id,
    metadata: {},
  }).catch(() => undefined);
}

export async function touchLink(db: Db, link: TelegramLink, now: Date = new Date()): Promise<void> {
  await db.update(jarvisTelegramLinks).set({ lastSeenAt: now }).where(eq(jarvisTelegramLinks.id, link.id));
}

/**
 * Record that one update was handled, and say whether this is the first
 * time. Telegram redelivers until the webhook answers 200, so "acted on
 * exactly once" has to be a uniqueness constraint rather than a hope.
 */
export async function claimTelegramEvent(
  db: Db,
  input: { eventId: string; organizationId: string | null; chatId: string | null; kind: string; outcome: string; detail: string | null },
): Promise<boolean> {
  const inserted = await db
    .insert(jarvisTelegramEvents)
    .values({
      externalEventId: input.eventId,
      organizationId: input.organizationId,
      chatId: input.chatId,
      kind: input.kind,
      outcome: input.outcome,
      detail: input.detail,
    })
    .onConflictDoNothing({ target: jarvisTelegramEvents.externalEventId })
    .returning({ id: jarvisTelegramEvents.id });
  return inserted.length > 0;
}

/** A refused attempt still needs a row, because the attempt budget counts rows. */
export async function recordLinkRefusal(db: Db, input: { eventId: string; chatId: string | null; reason: string }): Promise<void> {
  await db
    .insert(jarvisTelegramEvents)
    .values({ externalEventId: input.eventId, organizationId: null, chatId: input.chatId, kind: "message", outcome: "link_refused", detail: input.reason })
    .onConflictDoNothing({ target: jarvisTelegramEvents.externalEventId });
}
