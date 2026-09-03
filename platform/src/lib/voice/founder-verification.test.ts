import { describe, expect, it } from "vitest";
import {
  callerNumberMatchesFounder,
  deriveFounderPasscode,
  FounderVerificationUnavailableError,
  MAX_VERIFICATION_ATTEMPTS,
  normalizeSpokenPasscode,
  PASSCODE_DIGITS,
  PASSCODE_SKEW_STEPS,
  PASSCODE_STEP_MS,
  passcodeMillisecondsRemaining,
  verifyFounderPasscode,
} from "./founder-verification";

const SECRET = "a-test-secret-that-is-at-least-32-characters-long";
const NOW = 1_800_000_000_000;

describe("deriveFounderPasscode", () => {
  it("produces a stable code of the configured length for a time step", () => {
    const code = deriveFounderPasscode(SECRET, NOW);
    expect(code).toMatch(new RegExp(`^\\d{${PASSCODE_DIGITS}}$`));
    expect(deriveFounderPasscode(SECRET, NOW + 1000)).toBe(code);
  });

  it("is long enough that guessing it within the attempt budgets is not worth trying", () => {
    // Three codes are live at once (PASSCODE_SKEW_STEPS = 1), so one guess wins
    // with probability 3/10^digits. The budgets around this — three attempts a
    // call, six calls an hour from one number — allow roughly 1.6e5 guesses a
    // year, and six digits put that at about a two-in-five chance of a hit.
    const guessesPerYear = 3 * 6 * 24 * 365;
    const perGuess = (2 * PASSCODE_SKEW_STEPS + 1) / 10 ** PASSCODE_DIGITS;
    expect(1 - (1 - perGuess) ** guessesPerYear).toBeLessThan(0.01);
  });

  it("changes when the step changes", () => {
    expect(deriveFounderPasscode(SECRET, NOW + PASSCODE_STEP_MS)).not.toBe(deriveFounderPasscode(SECRET, NOW));
  });

  it("differs per secret, so one deployment's code never works on another", () => {
    const other = "a-different-secret-that-is-also-at-least-32-chars";
    expect(deriveFounderPasscode(other, NOW)).not.toBe(deriveFounderPasscode(SECRET, NOW));
  });

  it("fails closed when no secret is configured", () => {
    expect(() => deriveFounderPasscode(undefined, NOW)).toThrow(FounderVerificationUnavailableError);
    expect(() => deriveFounderPasscode("too-short", NOW)).toThrow(FounderVerificationUnavailableError);
  });
});

describe("passcodeMillisecondsRemaining", () => {
  it("counts down within the step", () => {
    expect(passcodeMillisecondsRemaining(NOW)).toBeGreaterThan(0);
    expect(passcodeMillisecondsRemaining(NOW)).toBeLessThanOrEqual(PASSCODE_STEP_MS);
  });
});

describe("normalizeSpokenPasscode", () => {
  it("reads digits, spoken words, and mixtures the same way", () => {
    expect(normalizeSpokenPasscode("417296")).toBe("417296");
    expect(normalizeSpokenPasscode("four one seven two nine six")).toBe("417296");
    expect(normalizeSpokenPasscode("the code is 417-296")).toBe("417296");
    expect(normalizeSpokenPasscode("four one seven, two nine six.")).toBe("417296");
  });

  it("ignores words that are not digits", () => {
    expect(normalizeSpokenPasscode("um okay it's one two three four five six")).toBe("123456");
  });
});

describe("verifyFounderPasscode", () => {
  it("accepts the current code", () => {
    const code = deriveFounderPasscode(SECRET, NOW);
    expect(verifyFounderPasscode({ secret: SECRET, spoken: code, atMs: NOW, priorAttempts: 0 })).toEqual({ verified: true });
  });

  it("accepts a code read one step late, so a rollover mid-sentence still works", () => {
    const previous = deriveFounderPasscode(SECRET, NOW - PASSCODE_STEP_MS);
    expect(verifyFounderPasscode({ secret: SECRET, spoken: previous, atMs: NOW, priorAttempts: 0 })).toEqual({ verified: true });
  });

  it("rejects a code from outside the accepted window", () => {
    const stale = deriveFounderPasscode(SECRET, NOW - 5 * PASSCODE_STEP_MS);
    expect(verifyFounderPasscode({ secret: SECRET, spoken: stale, atMs: NOW, priorAttempts: 0 })).toEqual({
      verified: false,
      reason: "mismatch",
    });
  });

  it("accepts the code spoken as words", () => {
    const code = deriveFounderPasscode(SECRET, NOW);
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    const spoken = code.split("").map((digit) => words[Number(digit)]).join(" ");
    expect(verifyFounderPasscode({ secret: SECRET, spoken, atMs: NOW, priorAttempts: 0 })).toEqual({ verified: true });
  });

  it("reports an unreadable code separately from a wrong one", () => {
    expect(verifyFounderPasscode({ secret: SECRET, spoken: "four one", atMs: NOW, priorAttempts: 0 })).toEqual({
      verified: false,
      reason: "unreadable",
    });
  });

  it("refuses once the attempt budget is spent, even with the correct code", () => {
    const code = deriveFounderPasscode(SECRET, NOW);
    expect(verifyFounderPasscode({ secret: SECRET, spoken: code, atMs: NOW, priorAttempts: MAX_VERIFICATION_ATTEMPTS })).toEqual({
      verified: false,
      reason: "attempts_exhausted",
    });
  });

  it("fails closed with no configured secret rather than accepting anything", () => {
    expect(() => verifyFounderPasscode({ secret: undefined, spoken: "123456", atMs: NOW, priorAttempts: 0 })).toThrow(
      FounderVerificationUnavailableError
    );
  });
});

describe("callerNumberMatchesFounder", () => {
  const founder = "+14165551234";

  it("matches the enrolled number regardless of formatting", () => {
    expect(callerNumberMatchesFounder("+14165551234", founder)).toBe(true);
    expect(callerNumberMatchesFounder("+1 (416) 555-1234", founder)).toBe(true);
  });

  it("rejects any other number, and a missing one", () => {
    expect(callerNumberMatchesFounder("+14165559999", founder)).toBe(false);
    expect(callerNumberMatchesFounder(null, founder)).toBe(false);
    expect(callerNumberMatchesFounder("", founder)).toBe(false);
  });
});
