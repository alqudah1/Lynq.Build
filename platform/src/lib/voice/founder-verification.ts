import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Founder verification for inbound phone control.
 *
 * ---------------------------------------------------------------------------
 * Why caller ID is not enough
 * ---------------------------------------------------------------------------
 * Caller ID is asserted by the originating carrier and is trivially spoofable
 * from any SIP trunk. Treating it as authentication would mean anyone who
 * knows Mustafa's mobile number could open Office projects in his name. So the
 * caller number is used only as a NECESSARY precondition (a call from any other
 * number is refused outright and never reaches command capture), never as a
 * sufficient one.
 *
 * ---------------------------------------------------------------------------
 * The second factor
 * ---------------------------------------------------------------------------
 * A rotating six-digit passcode, derived by HMAC-SHA256 from a server-only
 * secret and the current time step. The founder reads it from the Jarvis
 * Command Center — a page that already requires a validated database session
 * and an owner/admin organization membership. So a successful verification
 * proves possession of BOTH the enrolled phone AND a live authenticated LYNQ
 * session, which is materially stronger than either alone and needs no new
 * provider, no new stored credential, and no new third party.
 *
 * The step is deliberately long enough to read aloud (see `PASSCODE_STEP_MS`)
 * and a one-step skew on either side is accepted, so a code read at the very
 * end of a window still works. Verification is constant-time, attempt-capped
 * per call, and the passcode itself is redacted out of the transcript before
 * anything is stored.
 *
 * Not `server-only`: pure crypto over its arguments, unit-tested in the node
 * environment. The secret is read from the environment by `phone-config.ts`,
 * never here.
 */

/** Five minutes. Long enough for a founder to read a code from a phone screen mid-call; short enough that a shoulder-surfed code expires quickly. */
export const PASSCODE_STEP_MS = 5 * 60 * 1000;

/** How many steps on either side of "now" are accepted. One step of skew covers a code read just before a rollover. */
export const PASSCODE_SKEW_STEPS = 1;

export const PASSCODE_DIGITS = 6;

/** A call gets three tries. After that the session is refused and must be re-established by calling back. */
export const MAX_VERIFICATION_ATTEMPTS = 3;

export class FounderVerificationUnavailableError extends Error {
  constructor() {
    super("Founder phone verification is not configured — JARVIS_PHONE_VERIFICATION_SECRET is missing.");
    this.name = "FounderVerificationUnavailableError";
  }
}

function requireSecret(secret: string | undefined): string {
  const value = secret?.trim();
  // Fails closed by construction: with no secret there is no way to verify a
  // founder, so there is no way to accept a phone command either.
  if (!value || value.length < 32) throw new FounderVerificationUnavailableError();
  return value;
}

export function passcodeStepFor(atMs: number): number {
  return Math.floor(atMs / PASSCODE_STEP_MS);
}

/** Milliseconds until the current passcode rolls over — shown next to the code so the founder knows whether to wait. */
export function passcodeMillisecondsRemaining(atMs: number): number {
  return PASSCODE_STEP_MS - (atMs % PASSCODE_STEP_MS);
}

/**
 * Derives the passcode for one time step. The scope string is part of the
 * HMAC input so the same secret can never produce a valid code for a
 * different purpose if one is ever added.
 */
export function deriveFounderPasscode(secret: string | undefined, atMs: number, scope = "jarvis-phone-founder"): string {
  const key = requireSecret(secret);
  const digest = createHmac("sha256", key).update(`${scope}:${passcodeStepFor(atMs)}`).digest();
  // Truncation identical in shape to RFC 4226's dynamic truncation.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** PASSCODE_DIGITS).padStart(PASSCODE_DIGITS, "0");
}

const SPOKEN_DIGITS: Record<string, string> = {
  zero: "0", oh: "0", o: "0", one: "1", two: "2", to: "2", too: "2", three: "3", four: "4", for: "4",
  five: "5", six: "6", seven: "7", eight: "8", ate: "8", nine: "9",
};

/**
 * A founder reading a code aloud produces "four one seven", "417", or
 * "four-one-seven" depending on the transcriber. This normalizes all three to
 * bare digits before comparison. Anything that is not a digit or a recognized
 * digit word is discarded, so "the code is 417 296" still resolves.
 */
export function normalizeSpokenPasscode(value: string): string {
  const tokens = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let digits = "";
  for (const token of tokens) {
    if (/^\d+$/.test(token)) digits += token;
    else if (SPOKEN_DIGITS[token] !== undefined) digits += SPOKEN_DIGITS[token];
  }
  return digits;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type FounderVerificationOutcome =
  | { verified: true }
  | { verified: false; reason: "unreadable" | "mismatch" | "attempts_exhausted" };

export interface VerifyFounderPasscodeInput {
  secret: string | undefined;
  spoken: string;
  atMs: number;
  /** Attempts already used on this call session, before this one. */
  priorAttempts: number;
  scope?: string;
}

/**
 * Verifies one spoken passcode attempt. Never throws on a bad code — a wrong
 * code is an expected, recordable outcome, not an exception. It throws only
 * when verification is structurally impossible (no configured secret), which
 * is a deployment error the caller must surface honestly rather than treat as
 * a failed attempt.
 */
export function verifyFounderPasscode(input: VerifyFounderPasscodeInput): FounderVerificationOutcome {
  requireSecret(input.secret);
  if (input.priorAttempts >= MAX_VERIFICATION_ATTEMPTS) return { verified: false, reason: "attempts_exhausted" };

  const normalized = normalizeSpokenPasscode(input.spoken);
  if (normalized.length !== PASSCODE_DIGITS) return { verified: false, reason: "unreadable" };

  // Compare against every accepted step. The loop runs to completion
  // regardless of an early match so the number of HMAC computations does not
  // depend on which step matched.
  let matched = false;
  for (let offset = -PASSCODE_SKEW_STEPS; offset <= PASSCODE_SKEW_STEPS; offset += 1) {
    const candidate = deriveFounderPasscode(input.secret, input.atMs + offset * PASSCODE_STEP_MS, input.scope);
    if (constantTimeEquals(candidate, normalized)) matched = true;
  }

  return matched ? { verified: true } : { verified: false, reason: "mismatch" };
}

/**
 * Caller-number check. E.164 string equality after stripping formatting — a
 * necessary precondition only; `verifyFounderPasscode` is what authenticates.
 */
export function callerNumberMatchesFounder(caller: string | null | undefined, founderNumber: string): boolean {
  if (!caller) return false;
  const normalize = (value: string) => value.replace(/[^\d+]/g, "");
  const a = normalize(caller);
  const b = normalize(founderNumber);
  if (!a || !b) return false;
  return constantTimeEquals(a, b);
}
