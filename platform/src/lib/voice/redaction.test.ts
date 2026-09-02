import { describe, expect, it } from "vitest";
import {
  collapseSpokenDigits,
  maskPhoneNumber,
  phoneNumberLastFour,
  redactLogFields,
  redactSensitiveText,
  redactTranscriptText,
} from "./redaction";

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
