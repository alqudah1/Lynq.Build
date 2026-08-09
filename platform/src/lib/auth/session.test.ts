import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  generateSessionToken,
  hashSessionToken,
  computeExpiresAt,
  SESSION_IDLE_LIFETIME_MS,
  SESSION_ABSOLUTE_LIFETIME_MS,
} from "./session";

describe("generateSessionToken", () => {
  it("produces a sufficiently long, base64url-safe, unique value on every call", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken()));

    expect(tokens.size).toBe(200); // no collisions across 200 calls
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet only, no padding
      expect(token.length).toBeGreaterThanOrEqual(40); // 32 random bytes base64url-encoded
    }
  });
});

describe("hashSessionToken", () => {
  it("matches an independently computed sha256 hex digest of the raw token", () => {
    const rawToken = generateSessionToken();
    const expected = createHash("sha256").update(rawToken).digest("hex");

    expect(hashSessionToken(rawToken)).toBe(expected);
  });

  it("is deterministic — the same input always hashes to the same output", () => {
    const rawToken = "fixed-test-token-value";
    expect(hashSessionToken(rawToken)).toBe(hashSessionToken(rawToken));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashSessionToken("token-a")).not.toBe(hashSessionToken("token-b"));
  });
});

describe("computeExpiresAt (correction pass §4: idle 7d / absolute 30d from created_at)", () => {
  it("at session creation (createdAt === now), returns now + 7 days — the idle bound, since it's smaller than the 30-day absolute bound", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const result = computeExpiresAt(now, now);
    expect(result.getTime()).toBe(now.getTime() + SESSION_IDLE_LIFETIME_MS);
  });

  it("renewal well before the absolute cap extends by the idle window from now", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days later
    const result = computeExpiresAt(createdAt, now);
    expect(result.getTime()).toBe(now.getTime() + SESSION_IDLE_LIFETIME_MS);
  });

  it("renewal near the absolute cap is capped at created_at + 30 days, not extended a full 7 days from now", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + 25 * 24 * 60 * 60 * 1000); // 25 days later
    const result = computeExpiresAt(createdAt, now);
    const absoluteBound = createdAt.getTime() + SESSION_ABSOLUTE_LIFETIME_MS;
    expect(result.getTime()).toBe(absoluteBound);
    expect(result.getTime()).toBeLessThan(now.getTime() + SESSION_IDLE_LIFETIME_MS);
  });

  it("never returns a value past created_at + 30 days, no matter how far in the future 'now' is", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + 29 * 24 * 60 * 60 * 1000);
    const result = computeExpiresAt(createdAt, now);
    expect(result.getTime()).toBe(createdAt.getTime() + SESSION_ABSOLUTE_LIFETIME_MS);
  });
});
