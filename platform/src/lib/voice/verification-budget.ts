import "server-only";

import { createHmac } from "node:crypto";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import type { RateLimitConfig } from "@/lib/rate-limit/types";
import { phoneNumberLastFour } from "./redaction";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * What one caller number may spend, and how the founder gets it back
 * ============================================================================
 *
 * Two budgets, both keyed on the caller's number, both refunded the moment a
 * caller proves they are the founder:
 *
 *   - the CALL budget: how many command calls that number may open in an hour
 *   - the VERIFY budget: how many passcode attempts it may make in half an hour
 *
 * Both exist because caller ID is spoofable. Neither can be allowed to become a
 * weapon, and that is the part this module is really about. The key is derived
 * from the number the caller ASSERTS, so anyone who can spoof the founder's line
 * can spend both budgets to zero and keep them there — and the founder, calling
 * from the real phone, is then refused before their correct code is ever
 * checked. A rate limit that an attacker can hold down is a denial-of-service
 * primitive aimed at the person it was supposed to protect.
 *
 * Two things answer that. The refund on successful verification means an
 * attacker who cannot read the code never stops the founder who can, in any
 * window where the founder gets through. And when they do not get through,
 * `readVerificationBudget` and `clearVerificationBudget` make the state visible
 * on the Jarvis screen and clearable from an authenticated session, so a
 * lockout is a thing the founder can see and undo in one tap rather than a
 * silent wall they have no name for.
 *
 * The key is a one-way HMAC of the last four digits and the tenant. A
 * rate-limit table is not a place to keep a second copy of the founder's phone
 * number.
 */

/**
 * The cross-call ceiling on passcode attempts from one caller. The per-call cap
 * of three still applies; this is what a redial cannot reset. Generous enough
 * that a founder mistyping a rotating code a few times over a couple of calls is
 * unaffected.
 */
export const VERIFICATION_RATE_LIMIT: RateLimitConfig = { limit: 12, windowSeconds: 1800 };

/**
 * How many command CALLS one caller number may open in an hour before this lane
 * stops opening sessions for it.
 *
 * Everything before verification used to be free: a spoofed line matching the
 * founder's number was not refused, and each redial opened a session row, wrote
 * a start audit entry, was handed a ten-minute assistant, and could write
 * unbounded transcript turns that the Jarvis screen renders as the founder's own
 * words. The passcode budget did not bound any of it, because an attacker who
 * never guesses never spends a passcode attempt.
 *
 * Six an hour is far above real use and far below what makes flooding worth the
 * phone bill.
 */
export const INBOUND_CALL_RATE_LIMIT: RateLimitConfig = { limit: 6, windowSeconds: 3600 };

/** A one-way identifier for one caller within one tenant. Never the number itself. */
export function callerBudgetIdentity(input: { verificationSecret: string; callerNumberLastFour: string | null; organizationId: string }): string {
  return createHmac("sha256", input.verificationSecret)
    .update(`jarvis-phone-verify:${input.callerNumberLastFour ?? "unknown"}:${input.organizationId}`)
    .digest("hex");
}

/** The same identity, derived from a full number rather than its last four. */
export function callerBudgetIdentityForNumber(input: { verificationSecret: string; callerNumber: string | null | undefined; organizationId: string }): string {
  return callerBudgetIdentity({
    verificationSecret: input.verificationSecret,
    callerNumberLastFour: phoneNumberLastFour(input.callerNumber),
    organizationId: input.organizationId,
  });
}

export const verifyBudgetKey = (identity: string) => `jarvis-phone:verify:${identity}`;
export const callBudgetKey = (identity: string) => `jarvis-phone:call:${identity}`;

export interface VerificationBudgetState {
  /** True when either budget is spent, i.e. the next call or code would be refused. */
  locked: boolean;
  /** When the budget frees itself, if it is locked. */
  resetAt: string | null;
  callsRemaining: number;
  attemptsRemaining: number;
}

/**
 * Reads both budgets without spending either — `checkLimit` is a plain select.
 *
 * Shown on the Jarvis screen so a founder who is being refused sees WHY, with a
 * time and a button, rather than hearing "there have been too many code
 * attempts from this number" on a call they have not made before.
 */
export async function readVerificationBudget(
  db: Db,
  input: { verificationSecret: string; founderPhoneNumber: string; organizationId: string }
): Promise<VerificationBudgetState> {
  const identity = callerBudgetIdentityForNumber({
    verificationSecret: input.verificationSecret,
    callerNumber: input.founderPhoneNumber,
    organizationId: input.organizationId,
  });
  const limiter = new PostgresRateLimiter(db);
  const [calls, attempts] = await Promise.all([
    limiter.checkLimit(callBudgetKey(identity), INBOUND_CALL_RATE_LIMIT),
    limiter.checkLimit(verifyBudgetKey(identity), VERIFICATION_RATE_LIMIT),
  ]);

  const locked = !calls.allowed || !attempts.allowed;
  const resets = [!calls.allowed ? calls.resetAt : null, !attempts.allowed ? attempts.resetAt : null].filter(
    (value): value is Date => value instanceof Date
  );
  return {
    locked,
    // The later of the two, so the screen never promises it will clear before
    // it actually does.
    resetAt: resets.length > 0 ? new Date(Math.max(...resets.map((date) => date.getTime()))).toISOString() : null,
    callsRemaining: calls.remaining,
    attemptsRemaining: attempts.remaining,
  };
}

/**
 * Frees both budgets for the founder's number.
 *
 * Safe to expose to the founder, and only to the founder: it grants no access
 * on its own. Clearing the budget still leaves the caller facing the passcode,
 * the per-call attempt cap, and the caller-number precondition — it only undoes
 * a throttle. Refusing to offer it would mean someone able to spoof a phone
 * number could take phone control away from its owner until they noticed and
 * redeployed.
 */
export async function clearVerificationBudget(
  db: Db,
  input: { verificationSecret: string; founderPhoneNumber: string; organizationId: string }
): Promise<void> {
  const identity = callerBudgetIdentityForNumber({
    verificationSecret: input.verificationSecret,
    callerNumber: input.founderPhoneNumber,
    organizationId: input.organizationId,
  });
  const limiter = new PostgresRateLimiter(db);
  await limiter.resetLimit(callBudgetKey(identity));
  await limiter.resetLimit(verifyBudgetKey(identity));
}
