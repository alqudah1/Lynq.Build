import { describe, expect, it } from "vitest";
import {
  collapseSpokenDigits,
  maskPhoneNumber,
  phoneNumberLastFour,
  redactLogFields,
  redactSensitiveText,
  redactTranscriptText,
} from "./redaction";
import { normalizeSpokenPasscode } from "./founder-verification";

describe("collapseSpokenDigits", () => {
  it("collapses a spoken run of three or more digits", () => {
    expect(collapseSpokenDigits("the code is four one seven two nine six")).toContain("417296");
  });

  it("leaves short number words alone so ordinary speech survives", () => {
    expect(collapseSpokenDigits("build two pages")).toBe("build two pages");
  });
});

describe("redactSensitiveText", () => {
  it("removes a provider API key", () => {
    const result = redactSensitiveText("use sk-live-9f2b7c1d4e6a8b0c2d4e");
    expect(result.text).not.toContain("9f2b7c1d");
    expect(result.text).toContain("[redacted-secret]");
    expect(result.redactedKinds).toContain("secret");
  });

  it("removes a value that follows a secret lead-in word, keeping the sentence readable", () => {
    const result = redactSensitiveText("the password is hunter2please");
    expect(result.text).toContain("the password is [redacted-secret]");
    expect(result.text).not.toContain("hunter2please");
  });

  it("removes a card number spoken with separators", () => {
    const result = redactSensitiveText("charge 4111 1111 1111 1111 today");
    expect(result.text).not.toMatch(/4111/);
    expect(result.redactedKinds).toContain("card");
  });

  it("removes an email address", () => {
    expect(redactTranscriptText("email owner@restaurant.example")).not.toContain("owner@restaurant.example");
  });

  it("removes a phone number in E.164 and North American formats", () => {
    expect(redactTranscriptText("call +14165551234")).not.toContain("4165551234");
    expect(redactTranscriptText("call (416) 555-1234")).not.toContain("555-1234");
  });

  it("removes a six-digit verification code even when it was spoken as words", () => {
    const result = redactSensitiveText("my code is four one seven two nine six");
    expect(result.text).not.toContain("417296");
  });

  it("keeps ordinary business language intact", () => {
    const text = "Research three restaurants in Brampton and compare their websites";
    expect(redactTranscriptText(text)).toBe(text);
  });

  it("is idempotent — redacting an already-redacted string changes nothing", () => {
    const once = redactTranscriptText("the api key is abcdef123456789012345");
    expect(redactTranscriptText(once)).toBe(once);
  });

  it("returns an empty result for empty input rather than throwing", () => {
    expect(redactSensitiveText("")).toEqual({ text: "", redactedKinds: [] });
  });

  /**
   * The lead-in rule used to fire without an explicit connector, which ate
   * ordinary speech — and the redacted text is what reaches the Office
   * planner, so this was never merely cosmetic.
   */
  it.each([
    "Pin the launch note in Slack for the team.",
    "Review the design token system before Friday.",
    "The secret sauce recipe needs a rewrite.",
    "Drop a pin on the map for the new office.",
  ])("leaves ordinary speech alone: %s", (text) => {
    expect(redactTranscriptText(text)).toBe(text);
  });

  it("still catches a secret introduced with a real connector", () => {
    expect(redactTranscriptText("the api key is abc123def456")).toContain("[redacted-secret]");
    expect(redactTranscriptText("password: swordfish99")).toContain("[redacted-secret]");
    expect(redactTranscriptText("the token = zx9k2m4p8q")).toContain("[redacted-secret]");
  });

  it("stays fast on a hostile payload instead of stalling on backtracking", () => {
    // A 1 MB body is within what the webhook accepts. An ambiguous whitespace
    // rule made this quadratic; it must now complete promptly.
    const hostile = `password${" ".repeat(200_000)}`;
    const started = Date.now();
    redactSensitiveText(hostile);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("bounds the text it scans rather than trusting the caller", () => {
    expect(redactSensitiveText("a".repeat(100_000)).text.length).toBeLessThanOrEqual(40_000);
  });
});

describe("maskPhoneNumber and phoneNumberLastFour", () => {
  it("masks to the last four digits", () => {
    expect(maskPhoneNumber("+14165551234")).toBe("••• ••• 1234");
    expect(phoneNumberLastFour("+14165551234")).toBe("1234");
  });

  it("never returns digits it does not have", () => {
    expect(maskPhoneNumber("+1")).toBe("••••");
    expect(phoneNumberLastFour(null)).toBeNull();
    expect(maskPhoneNumber(undefined)).toBe("unknown");
  });
});

describe("redactLogFields", () => {
  it("drops the value of any field whose name names a secret or identifier", () => {
    const safe = redactLogFields({ apiKey: "sk-live-abc", callerNumber: "+14165551234", transcript: "hello" });
    expect(safe.apiKey).toBe("[redacted]");
    expect(safe.callerNumber).toBe("[redacted]");
    expect(safe.transcript).toBe("[redacted]");
  });

  it("keeps booleans and counts derived from sensitive fields, which carry no secret", () => {
    const safe = redactLogFields({ callerNumberMatched: true, transcriptTurnCount: 4 });
    expect(safe.callerNumberMatched).toBe(true);
    expect(safe.transcriptTurnCount).toBe(4);
  });

  it("still redacts a secret that appears inside an innocuously named field", () => {
    const safe = redactLogFields({ note: "the password is swordfish99" });
    expect(safe.note).toContain("[redacted-secret]");
  });
});

describe("redaction and verification cannot disagree about a spoken code", () => {
  /**
   * The leak this suite exists for, found by review round six.
   *
   * `normalizeSpokenPasscode` concatenates digits across ANY separator — it
   * exists because transcribers split codes — while redaction merged only runs
   * of three or more consecutive digit WORDS, and otherwise needed one unbroken
   * numeric token. So the most natural utterance of all, "the code is 417 296",
   * authenticated the caller AND was stored verbatim in the transcript, which
   * `listPhoneCallsForUser` shows to any member of the organization, next to
   * the last four digits of the founder's number, for as long as the code stays
   * valid. Reading it there is a straight escalation from member to founder.
   *
   * The property under test is not "these strings are redacted" — it is that
   * the two functions cannot drift apart again. They now share one vocabulary
   * and one scanner.
   */
  const spokenForms = [
    "417 296",
    "4 1 7 2 9 6",
    "the code is 417 296",
    "It's 417 then 296",
    "code 417 296 okay",
    "four one seven um two nine six",
    "o four one seven two six",
    "four one seven two nine six",
    "my code is 417296",
    "417-296",
    "four one seven, two nine six",
  ];

  it.each(spokenForms)("does not store a code it would accept: %s", (spoken) => {
    expect(normalizeSpokenPasscode(spoken).length).toBeGreaterThanOrEqual(6);
    expect(redactTranscriptText(spoken)).toContain("[redacted-");
  });

  it("no longer authenticates digits scattered across a sentence", () => {
    // Concatenating every digit in the string meant this normalized to 417296
    // and could verify. A code is a contiguous run, not an arithmetic sum of a
    // sentence.
    expect(normalizeSpokenPasscode("my code is 417, and I need 296 units")).not.toBe("417296");
  });
});

describe("redaction preserves the meaning of ordinary speech", () => {
  /**
   * Redaction used to REWRITE the text, collapsing any three adjacent number
   * words into digits. The rewritten string is what reaches the risk
   * classifier and the Office planner, so "we lost one, oh, two clients" was
   * planned from as "we lost 102 clients". Detection and rewriting are
   * different jobs; the scanner now returns spans and only spans long enough
   * to be a code are replaced.
   */
  it.each([
    "we lost one, oh, two clients last month",
    "phase one two three of the rebuild",
    "we need one, two, three things done",
    "build a two three four bedroom listing page",
    "the password, which we rotate monthly, lives in a manager",
  ])("leaves it exactly as spoken: %s", (text) => {
    expect(redactTranscriptText(text)).toBe(text);
  });
});

describe("redaction catches a secret however the sentence is built", () => {
  /**
   * The lead-in rule bound its connector directly to the noun, so a single
   * intervening word leaked the credential verbatim — into the transcript, and
   * through `redactLogFields` into the logs.
   */
  it.each([
    "the password for the admin account is swordfish99",
    "my api key for stripe is sk1234liveabcd",
    "the access code you need is hunter2please",
    "the passcode to get in is hunter2please",
    "the password is: swordfish99",
    "the password's swordfish99",
    "the password, swordfish99",
    "the password - swordfish99",
    "the password is\nswordfish99",
    "use swordfish99 as the password",
    "the key is A B C D E F G H",
  ])("removes the value in: %s", (text) => {
    const result = redactSensitiveText(text);
    expect(result.text).toContain("[redacted-secret]");
    expect(result.text).not.toMatch(/swordfish99|hunter2please|sk1234liveabcd/);
  });

  it("redacts a secret inside an innocuously named log field, with words in between", () => {
    const safe = redactLogFields({ note: "the password for the admin account is swordfish99" });
    expect(String(safe.note)).not.toContain("swordfish99");
  });
});

describe("redaction stays linear on a hostile payload", () => {
  /**
   * The regexes were quadratic on a long unbroken token: the email rule's
   * `[A-Za-z0-9._%+-]+@` consumes to the end, fails on `@`, backtracks and
   * restarts one position later. At the input cap that was ~1.9s of blocked
   * event loop per webhook, reachable with a plain run of digits — something a
   * real end-of-call summary can contain. The earlier regression test used
   * `password` plus 200k SPACES, which the bounded-whitespace fix had already
   * made linear, so it passed in 1ms and gave false assurance.
   */
  it.each([
    ["a run of digits", "1".repeat(40_000)],
    ["a dashed run", "a-".repeat(20_000)],
    ["a mixed run", "aB0-".repeat(10_000)],
    ["a dotted run", `one${".".repeat(39_000)}one`],
    ["an unterminated address", `${"a".repeat(19_000)}@${"b".repeat(19_000)}`],
    ["trailing whitespace", `password${" ".repeat(200_000)}`],
  ])("completes promptly on %s", (_name, payload) => {
    const started = Date.now();
    redactSensitiveText(payload);
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("classifies an opaque 200-character token as a secret rather than scanning it", () => {
    const result = redactSensitiveText(`the value is ${"a1".repeat(200)}`);
    expect(result.redactedKinds).toContain("secret");
    expect(result.text).not.toContain("a1a1a1");
  });
});
