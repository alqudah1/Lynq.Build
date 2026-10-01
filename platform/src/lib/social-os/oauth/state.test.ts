import { describe, it, expect, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { signSocialOAuthPayload, verifySocialOAuthPayload, generateState, SocialOAuthCookieInvalidError, type SocialOAuthPayload } from "./state";
import { SocialOAuthStateError } from "../errors";

const SECRET = "x".repeat(40);

function payload(overrides: Partial<SocialOAuthPayload> = {}): SocialOAuthPayload {
  return {
    provider: "meta",
    state: generateState(),
    organizationId: "11111111-1111-4111-8111-111111111111",
    brandProfileId: "22222222-2222-4222-8222-222222222222",
    actorUserId: "33333333-3333-4333-8333-333333333333",
    redirectTo: "/app/acme/social/connections",
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("social OAuth state cookie", () => {
  it("round-trips a signed payload", () => {
    const p = payload();
    expect(verifySocialOAuthPayload(signSocialOAuthPayload(p, SECRET), SECRET)).toEqual(p);
  });

  it("rejects a tampered payload or signature", () => {
    const value = signSocialOAuthPayload(payload(), SECRET);
    const [body, sig] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload(), organizationId: "44444444-4444-4444-8444-444444444444" })).toString("base64url");
    expect(() => verifySocialOAuthPayload(`${forged}.${sig}`, SECRET)).toThrow(SocialOAuthCookieInvalidError);
    expect(() => verifySocialOAuthPayload(`${body}.${sig.slice(0, -2)}xx`, SECRET)).toThrow(SocialOAuthCookieInvalidError);
    expect(() => verifySocialOAuthPayload(value, "y".repeat(40))).toThrow(/could not be verified/);
    expect(() => verifySocialOAuthPayload("garbage", SECRET)).toThrow(SocialOAuthCookieInvalidError);
  });

  it("rejects an expired payload", () => {
    const value = signSocialOAuthPayload(payload({ expiresAt: Date.now() - 1 }), SECRET);
    try {
      verifySocialOAuthPayload(value, SECRET);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SocialOAuthCookieInvalidError);
      expect(err).toBeInstanceOf(SocialOAuthStateError);
      expect((err as SocialOAuthCookieInvalidError).detail).toBe("expired");
    }
  });

  it("rejects off-site redirect targets and unknown providers inside a validly signed payload", () => {
    for (const bad of [payload({ redirectTo: "https://evil.example" }), payload({ redirectTo: "//evil.example" }), { ...payload(), provider: "tiktok" } as unknown as SocialOAuthPayload]) {
      expect(() => verifySocialOAuthPayload(signSocialOAuthPayload(bad, SECRET), SECRET)).toThrow(SocialOAuthCookieInvalidError);
    }
  });

  it("generates high-entropy unique states", () => {
    const a = generateState();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateState()).not.toBe(a);
  });
});
