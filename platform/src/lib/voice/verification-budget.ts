import "server-only";

import { createHmac } from "node:crypto";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import type { RateLimitConfig } from "@/lib/rate-limit/types";

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

/**
 * How many calls from a number that is NOT the founder's may open a refused
 * session in an hour.
 *
 * A refused call still costs a row: `refuseCall` records the session and a
 * `jarvis_phone_call_refused` audit entry, deliberately, because a call that
 * was turned away is exactly the kind of thing a later review wants to find.
 * But the cost has to be bounded, and it cannot be bounded per caller — the
 * number is asserted, so an attacker rotates it and gets a fresh bucket every
 * time. So this one is keyed on the tenant alone, which is the only thing in
 * the request an attacker cannot vary.
 *
 * Twenty an hour keeps the forensic value of recording wrong-number calls (a
 * handful of genuine misdials, and the leading edge of any campaign, are all
 * recorded) while capping what a flood can write. Past it the caller still
 * gets the same closed twenty-second assistant; nothing further is stored, and
 * the fact that the cap was reached is logged.
 *
 * It is deliberately NOT shared with the founder-line budget: an attacker
 * filling this one must not be able to stop the founder from calling.
 */
export const REFUSED_CALL_RATE_LIMIT: RateLimitConfig = { limit: 20, windowSeconds: 3600 };

/** Where refused, non-founder calls are counted. Keyed on the tenant only — see above. */
export function refusedCallBudgetIdentity(input: { verificationSecret: string; organizationId: string }): string {
  return createHmac("sha256", input.verificationSecret).update(`jarvis-phone-refused:${input.organizationId}`).digest("hex");
}

export const refusedBudgetKey = (identity: string) => `jarvis-phone:refused:${identity}`;

/**
 * The identity both budgets are spent against.
 *
 * It identifies THE FOUNDER'S LINE within one tenant, not "whoever is calling",
 * and both budgets are charged only on a call that asserts exactly that number.
 * That is a correction, and the reason is worth stating plainly.
 *
 * The first version keyed on the caller's last four digits. Two things were
 * wrong with it, in opposite directions. All ten thousand numbers sharing the
 * founder's last four mapped to one bucket, and the charge happened before the
 * caller-number precondition was consulted — so six calls from an unrelated
 * number ending 0142 exhausted the founder's budget, and the founder, dialling
 * from the real phone, was then told "I'll only work with the founder's
 * registered line, and this isn't it" by a branch that had not looked at their
 * number. And in the other direction it bounded nothing: an attacker rotating
 * the asserted last four got a fresh six-per-hour bucket per suffix.
 *
 * Keyed on the tenant and charged only on an exact match, it is what calls
 * CLAIMING to be the founder may cost. Not "only the founder can spend it" —
 * the match is against an asserted caller ID, which this file's own header
 * calls spoofable, so anyone able to spoof the number can spend all six units
 * and the real founder then hears `FOUNDER_LINE_BUSY_SPOKEN`. What the key buys
 * is that no OTHER number can reach that budget by accident or by rotation, and
 * what makes the residual survivable is the refund on verification plus a
 * lockout the founder can see and clear. Calls from any other number are
 * bounded separately by `REFUSED_CALL_RATE_LIMIT`, which no rotation can escape
 * because it is not keyed on anything the caller controls.
 */
export function founderLineBudgetIdentity(input: { verificationSecret: string; organizationId: string }): string {
  return createHmac("sha256", input.verificationSecret).update(`jarvis-phone-founder-line:${input.organizationId}`).digest("hex");
}

export const verifyBudgetKey = (identity: string) => `jarvis-phone:verify:${identity}`;
export const callBudgetKey = (identity: string) => `jarvis-phone:call:${identity}`;

export interface VerificationBudgetState {
  /**
   * True when one of the FOUNDER'S OWN budgets is spent — their calls, or their
   * code attempts.
   *
   * Deliberately not "any of the three". The refused-call budget is tenant-wide
   * and is spent by calls from OTHER numbers, so folding it in here made the
   * screen announce "Jarvis is turning down calls from your number" after
   * twenty wrong numbers reached the tenant, when the founder's own calls were
   * working perfectly — and invited them to clear a cost control that is not
   * theirs, without saying that is what the button would do.
   */
  locked: boolean;
  /** When the last of the spent budgets frees itself, if any is spent. */
  resetAt: string | null;
  callsRemaining: number;
  attemptsRemaining: number;
  /**
   * True when the tenant-wide budget for calls from other numbers is spent.
   *
   * Reported separately from `locked` because it means something different and
   * has a different remedy — the founder's own calls still work, unless their
   * phone does not send its number, in which case they land in this bucket too.
   */
  refusedCallsSpent: boolean;
  /**
   * How many more calls from OTHER numbers may be recorded this hour.
   *
   * Reported because it can turn a founder away too. A call whose caller number
   * the provider never sent is not proved to be the founder, so it spends this
   * budget rather than theirs — and if an attacker has filled it, that founder
   * hears a refusal with nothing on screen to explain it. Leaving it out of
   * this state was the same invisible wall the founder-line split was meant to
   * remove, moved to the other budget.
   */
  refusedCallsRemaining: number;
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
  input: { verificationSecret: string; organizationId: string }
): Promise<VerificationBudgetState> {
  const identity = founderLineBudgetIdentity(input);
  const refusedIdentity = refusedCallBudgetIdentity(input);
  const limiter = new PostgresRateLimiter(db);
  const [calls, attempts, refused] = await Promise.all([
    limiter.checkLimit(callBudgetKey(identity), INBOUND_CALL_RATE_LIMIT),
    limiter.checkLimit(verifyBudgetKey(identity), VERIFICATION_RATE_LIMIT),
    limiter.checkLimit(refusedBudgetKey(refusedIdentity), REFUSED_CALL_RATE_LIMIT),
  ]);

  const own = [calls, attempts].filter((result) => !result.allowed);
  const spent = [...own, ...(refused.allowed ? [] : [refused])];
  return {
    locked: own.length > 0,
    refusedCallsSpent: !refused.allowed,
    // The latest of whichever are spent, so the screen never promises it will
    // clear before it actually does.
    resetAt: spent.length > 0 ? new Date(Math.max(...spent.map((result) => result.resetAt.getTime()))).toISOString() : null,
    callsRemaining: calls.remaining,
    attemptsRemaining: attempts.remaining,
    refusedCallsRemaining: refused.remaining,
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
export async function clearVerificationBudget(db: Db, input: { verificationSecret: string; organizationId: string }): Promise<void> {
  const identity = founderLineBudgetIdentity(input);
  const limiter = new PostgresRateLimiter(db);
  await limiter.resetLimit(callBudgetKey(identity));
  await limiter.resetLimit(verifyBudgetKey(identity));
  // The refused-call budget too. It is a cost control rather than a security
  // control — clearing it grants nobody anything the passcode does not still
  // stand in front of — and leaving it out meant a founder whose own call
  // landed in it (because the provider sent no caller number) had no way out
  // at all.
  await limiter.resetLimit(refusedBudgetKey(refusedCallBudgetIdentity(input)));
}
