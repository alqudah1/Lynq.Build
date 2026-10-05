import { describe, it, expect } from "vitest";
import { boundJson, canonicalJson, dailyBudgetUsd, requestFingerprint, videoFormatFor, withPrimaryMedia } from "./generation";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("generation pure helpers", () => {
  it("canonical JSON sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}');
  });

  it("fingerprint is stable under key order and changes with any input", () => {
    const base = { organizationId: A, generationType: "text" as const, provider: "anthropic", model: "m", request: { prompt: "p", system: "s" } };
    const f = requestFingerprint(base);
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(requestFingerprint({ ...base, request: { system: "s", prompt: "p" } })).toBe(f);
    expect(requestFingerprint({ ...base, request: { system: "s", prompt: "p2" } })).not.toBe(f);
    expect(requestFingerprint({ ...base, organizationId: B })).not.toBe(f);
    expect(requestFingerprint({ ...base, model: "m2" })).not.toBe(f);
    expect(requestFingerprint({ ...base, generationType: "image" })).not.toBe(f);
  });

  it("boundJson keeps small values and truncates big ones under the byte limit", () => {
    expect(boundJson({ a: "x" })).toEqual({ a: "x" });
    const big = { prompt: "y".repeat(100_000), nested: { more: "z".repeat(50_000) } };
    const bounded = boundJson(big, 32 * 1024);
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(32 * 1024);
    expect(JSON.stringify(bounded)).toContain("truncated");
    const many = { list: Array.from({ length: 5000 }, (_, i) => `item-${i}-${"q".repeat(50)}`) };
    expect(Buffer.byteLength(JSON.stringify(boundJson(many, 4096)))).toBeLessThanOrEqual(4096);
  });

  it("withPrimaryMedia replaces the primary and keeps the rest in order", () => {
    const media = [
      { assetId: A, position: 0, role: "primary" as const },
      { assetId: B, position: 1, role: "carousel_item" as const },
      { assetId: C, position: 2, role: "thumbnail" as const },
    ];
    expect(withPrimaryMedia(media, C)).toEqual([
      { assetId: C, position: 0, role: "primary" },
      { assetId: B, position: 1, role: "carousel_item" },
    ]);
    expect(withPrimaryMedia([], A)).toEqual([{ assetId: A, position: 0, role: "primary" }]);
  });

  it("videoFormatFor picks the platform's video format", () => {
    expect(videoFormatFor("instagram", "image")).toBe("reel");
    expect(videoFormatFor("instagram", "story")).toBe("story");
    expect(videoFormatFor("tiktok", "short_video")).toBe("short_video");
    expect(videoFormatFor("linkedin", "text")).toBe("video");
    expect(videoFormatFor("youtube", "video")).toBe("video");
  });

  it("daily budget defaults to $25 and honours the env", () => {
    expect(dailyBudgetUsd({})).toBe(25);
    expect(dailyBudgetUsd({ SOCIAL_AI_DAILY_BUDGET_USD: 3 })).toBe(3);
    expect(dailyBudgetUsd({ SOCIAL_AI_DAILY_BUDGET_USD: 0 })).toBe(0);
  });
});
