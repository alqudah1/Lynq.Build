import "server-only";

import { randomUUID } from "node:crypto";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationAdminOverride } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import type { RateLimitConfig } from "@/lib/rate-limit/types";
import {
  deriveFounderPasscode,
  passcodeMillisecondsRemaining,
  FounderVerificationUnavailableError,
} from "@/lib/voice/founder-verification";
import { PasscodeRateLimitedError } from "@/lib/voice/errors";
import { resolveJarvisPhoneCommandConfig } from "@/lib/voice/phone-config";
import { clearVerificationBudget, readVerificationBudget } from "@/lib/voice/verification-budget";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * A route handler gets no automatic `Cache-Control`, so a secret-bearing
 * response must set one explicitly — the same reasoning `api/health` and the
 * invitation-exchange route already state, and the same pair of headers the
 * other secret-bearing route in this codebase sets. The client's own
 * `cache: "no-store"` governs only the browser's HTTP cache; it constrains no
 * intermediary and no back-forward cache.
 */
const NO_STORE_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

function noStoreJson<T>(data: T): Response {
  return Response.json({ data }, { status: 200, headers: NO_STORE_HEADERS });
}

/**
 * Deliberately generous — the code is time-derived, so repetition leaks
 * nothing extra and a founder refreshing a slow page must not be locked out.
 * It exists to stop an automated client drowning the `jarvis_phone_passcode_issued`
 * audit trail, which is the record this route exists to produce.
 */
const PASSCODE_RATE_LIMIT: RateLimitConfig = { limit: 30, windowSeconds: 300 };

/**
 * The rotating numeric code the founder reads to Jarvis on a call.
 *
 * This route IS the second authentication factor. Everything about it is
 * therefore deliberately strict:
 *
 * - It requires a validated database session (`getAuthenticatedUser`) — the
 *   code is never derivable from the phone side alone.
 * - It requires organization owner/admin, via the existing
 *   `requireOrganizationAdminOverride`, so a cross-tenant caller gets the same
 *   404 every other tenant-scoped read returns...
 * - ...and then narrows further to the CONFIGURED FOUNDER. The passcode is
 *   scoped by time only, not by user, so any admin who could mint it would
 *   hold the second factor for a first factor (the founder's number) that this
 *   lane's own design notes describe as spoofable. The configuration already
 *   names exactly one `JARVIS_PHONE_FOUNDER_USER_ID`, so the tighter floor
 *   costs nothing. Anyone else is told plainly that it is not their code
 *   rather than being shown a "not set up" message that is untrue.
 * - It only ever returns a code for the organization phone control is
 *   actually configured for; any other organization is told so, never given a
 *   code that would silently never work.
 * - Every issuance is audited. The code itself is never audited or logged.
 * - Every response is `no-store` and `no-referrer`.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await requireOrganizationAdminOverride(db, organizationId, user.userId);

    // Fails closed: an unreachable rate-limit backend refuses the issuance
    // rather than waving it through, matching `enforceRateLimit`'s posture for
    // every other credential-adjacent endpoint here.
    const limiter = new PostgresRateLimiter(db);
    try {
      const result = await limiter.recordAttempt(`jarvis-phone:passcode:${organizationId}:${user.userId}`, PASSCODE_RATE_LIMIT);
      if (!result.allowed) throw new PasscodeRateLimitedError();
    } catch (limitError) {
      if (limitError instanceof PasscodeRateLimitedError) throw limitError;
      throw new PasscodeRateLimitedError();
    }

    const resolution = resolveJarvisPhoneCommandConfig();
    if (!resolution.ok) {
      // Honest, non-leaking, and in words rather than in the enum: says it is
      // unavailable and why in category terms, never which secret is missing or
      // what its value looks like. The raw reason is rendered verbatim on the
      // screen, so "incomplete_configuration" would have reached a founder.
      return noStoreJson({
        available: false,
        reason:
          resolution.reason === "disabled"
            ? "Phone control is switched off for this deployment."
            : "Phone control is not finished being set up yet. Ask whoever set up LYNQ to finish it.",
        passcode: null,
        expiresInMs: null,
      });
    }
    if (resolution.config.organizationId !== organizationId) {
      return noStoreJson({ available: false, reason: "Phone control is not set up for this organization.", passcode: null, expiresInMs: null });
    }
    if (resolution.config.founderUserId !== user.userId) {
      return noStoreJson({
        available: false,
        reason: "This code belongs to the founder's account. Sign in as that account to see it.",
        passcode: null,
        expiresInMs: null,
      });
    }

    const now = Date.now();
    const passcode = deriveFounderPasscode(resolution.config.verificationSecret, now);

    // Whether any of the caller budgets is currently spent. The founder-line
    // budgets are charged on a caller ID that asserts the founder's number, and
    // caller ID is spoofable, so someone else can spend them from a spoofed line
    // and the founder is then refused before their correct code is ever checked.
    // The refused-call budget is read here too, because a founder call the
    // provider sent no number for lands in THAT one — and leaving it out was
    // the same invisible wall in a different bucket. That used to be invisible: the only
    // evidence was Jarvis saying "there have been too many code attempts from
    // this number" on a call the founder had not made before. Reading it here
    // costs two selects and spends nothing, and it gives the screen something
    // true to say — with a time, and a way out.
    const lockout = await readVerificationBudget(db, {
      verificationSecret: resolution.config.verificationSecret,
      organizationId,
    }).catch(() => null);

    await recordAuditEvent(db, {
      // Deliberately its own event type, not `jarvis_phone_founder_verified`:
      // "a code was displayed in a browser" and "a caller authenticated on a
      // call" are different facts, and an auditor must be able to tell them
      // apart.
      eventType: "jarvis_phone_passcode_issued",
      organizationId,
      actorUserId: user.userId,
      targetType: "jarvis_phone_passcode",
      // No target id and no code — only the fact that one was issued.
      metadata: { issued: true, channel: "command_center" },
    });

    return Response.json(
      { data: { available: true, passcode, expiresInMs: passcodeMillisecondsRemaining(now), lockout } },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    return passcodeErrorResponse(err);
  }
}

/**
 * Clears the caller budgets for the founder's own number.
 *
 * Necessary because both budgets are keyed on an asserted, spoofable caller ID,
 * which makes them a denial-of-service primitive aimed at the person they
 * protect: someone spoofing the founder's line can keep both spent
 * indefinitely, and the founder is then refused on a call they did make, before
 * their correct code is checked. Without a way to clear it, the answer would be
 * "wait, and hope they stop" — or a redeploy.
 *
 * Safe to expose, because it grants nothing. A cleared budget still leaves the
 * caller facing the rotating passcode, the three-attempt per-call cap, and the
 * caller-number precondition; this only undoes a throttle. It is nonetheless
 * held to exactly the same floor as reading the code — a validated session,
 * owner/admin, the configured organization, and the configured founder account
 * — because the person who should decide to reopen the door is the one it
 * belongs to.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await requireOrganizationAdminOverride(db, organizationId, user.userId);

    const resolution = resolveJarvisPhoneCommandConfig();
    if (!resolution.ok || resolution.config.organizationId !== organizationId || resolution.config.founderUserId !== user.userId) {
      // The same answer for all three, and deliberately so: "not set up", "not
      // your organization" and "not your account" are already distinguished by
      // the GET above for a caller who is allowed to know. This one changes
      // state, so it says only that it did not.
      return noStoreJson({ cleared: false, reason: "This is not available for your account.", lockout: null });
    }

    await clearVerificationBudget(db, {
      verificationSecret: resolution.config.verificationSecret,
      organizationId,
    });

    await recordAuditEvent(db, {
      eventType: "jarvis_phone_verification_lockout_cleared",
      organizationId,
      actorUserId: user.userId,
      targetType: "jarvis_phone_passcode",
      metadata: { channel: "command_center" },
    });

    const lockout = await readVerificationBudget(db, {
      verificationSecret: resolution.config.verificationSecret,
      organizationId,
    }).catch(() => null);

    return noStoreJson({ cleared: true, reason: null, lockout });
  } catch (err) {
    return passcodeErrorResponse(err);
  }
}

function passcodeErrorResponse(err: unknown): Response {
  if (err instanceof PasscodeRateLimitedError) {
    return Response.json(
      { error: { code: err.code, message: err.message, requestId: randomUUID() } },
      { status: err.httpStatus, headers: NO_STORE_HEADERS }
    );
  }
  if (err instanceof FounderVerificationUnavailableError) {
    return noStoreJson({ available: false, reason: "Phone control is not fully set up yet.", passcode: null, expiresInMs: null });
  }
  // Even an unexpected error carries the headers: every response from this
  // route is uncacheable, without exception.
  const response = handleRouteError(err);
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}
