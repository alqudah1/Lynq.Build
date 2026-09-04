import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { jarvisTelegramLinks } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationAdminOverride } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import type { RateLimitConfig } from "@/lib/rate-limit/types";
import { PasscodeRateLimitedError } from "@/lib/voice/errors";
import { resolveTelegramConfig } from "@/lib/telegram/config";
import { currentTelegramLinkCode, revokeTelegramLink } from "@/lib/telegram/link";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** The pairing code is a live credential, so no intermediary may keep a copy. */
const NO_STORE_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

function noStoreJson<T>(data: T): Response {
  return Response.json({ data }, { status: 200, headers: NO_STORE_HEADERS });
}

/** Generous: the code is time-derived, so refreshing leaks nothing. This only stops an automated client flooding the audit trail. */
const PAIRING_RATE_LIMIT: RateLimitConfig = { limit: 30, windowSeconds: 300 };

/**
 * The pairing code that makes one Telegram chat trusted, and the list of
 * chats that already are.
 *
 * This route IS the second factor for the Telegram lane, so it is held to
 * the same floor as the phone lane's passcode: a validated session, an
 * owner/admin of the tenant, the organization Telegram is configured for,
 * and then the configured founder account specifically. The code is scoped
 * by time rather than by user, so anyone who could mint it would hold the
 * credential — and the configuration already names exactly one person.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await requireOrganizationAdminOverride(db, organizationId, user.userId);

    const limiter = new PostgresRateLimiter(db);
    try {
      const result = await limiter.recordAttempt(`jarvis-telegram:pairing:${organizationId}:${user.userId}`, PAIRING_RATE_LIMIT);
      if (!result.allowed) throw new PasscodeRateLimitedError();
    } catch (limitError) {
      if (limitError instanceof PasscodeRateLimitedError) throw limitError;
      throw new PasscodeRateLimitedError();
    }

    const resolution = resolveTelegramConfig();
    if (!resolution.ok) {
      return noStoreJson({
        available: false,
        reason:
          resolution.reason === "disabled"
            ? "Telegram control is switched off for this deployment."
            : "Telegram control is not finished being set up yet. Ask whoever set up LYNQ to finish it.",
        code: null,
        expiresInMs: null,
        links: [],
      });
    }
    if (resolution.config.organizationId !== organizationId) {
      return noStoreJson({ available: false, reason: "Telegram control is not set up for this organization.", code: null, expiresInMs: null, links: [] });
    }
    if (resolution.config.founderUserId !== user.userId) {
      return noStoreJson({ available: false, reason: "This code belongs to the founder's account. Sign in as that account to see it.", code: null, expiresInMs: null, links: [] });
    }

    const { code, expiresInMs } = currentTelegramLinkCode(resolution.config);
    const links = await db
      .select({ id: jarvisTelegramLinks.id, username: jarvisTelegramLinks.telegramUsername, linkedAt: jarvisTelegramLinks.linkedAt, lastSeenAt: jarvisTelegramLinks.lastSeenAt })
      .from(jarvisTelegramLinks)
      .where(and(eq(jarvisTelegramLinks.organizationId, organizationId), eq(jarvisTelegramLinks.status, "active")))
      .orderBy(desc(jarvisTelegramLinks.linkedAt));

    return Response.json({ data: { available: true, reason: null, code, expiresInMs, links } }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (err) {
    return telegramErrorResponse(err);
  }
}

/**
 * Cuts every linked chat off immediately.
 *
 * The link is the credential, so this is the revocation. It is deliberately
 * one action with no confirmation flow: a founder who thinks his phone is
 * compromised should not have to answer a dialog first.
 *
 * Minting a code is held to the founder's own account, because whoever can
 * mint it holds the credential. Destroying access is not held to anything
 * beyond being an admin of this workspace — the case that matters is the
 * founder's phone in someone else's hand, and refusing to help because the
 * person at the keyboard is the wrong admin, or because the lane has since
 * been switched off, would be failing closed in the direction that keeps
 * the attacker in.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await requireOrganizationAdminOverride(db, organizationId, user.userId);

    const links = await db
      .select({ id: jarvisTelegramLinks.id, organizationId: jarvisTelegramLinks.organizationId, userId: jarvisTelegramLinks.userId, telegramChatId: jarvisTelegramLinks.telegramChatId })
      .from(jarvisTelegramLinks)
      .where(and(eq(jarvisTelegramLinks.organizationId, organizationId), eq(jarvisTelegramLinks.status, "active")));
    for (const link of links) {
      await revokeTelegramLink(db, { link, actorUserId: user.userId });
    }
    await recordAuditEvent(db, {
      eventType: "jarvis_telegram_revoked",
      organizationId,
      actorUserId: user.userId,
      targetType: "jarvis_telegram_link",
      metadata: { revoked: links.length, channel: "command_center" },
    });

    return noStoreJson({ revoked: links.length, reason: null });
  } catch (err) {
    return telegramErrorResponse(err);
  }
}

function telegramErrorResponse(err: unknown): Response {
  if (err instanceof PasscodeRateLimitedError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.httpStatus, headers: NO_STORE_HEADERS });
  }
  const response = handleRouteError(err);
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}
