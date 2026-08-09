import { describe, it, expect } from "vitest";
import {
  generateState,
  generateCodeVerifier,
  generateNonce,
  createS256CodeChallenge,
  signPreAuthPayload,
  verifyPreAuthPayload,
  type PreAuthPayload,
} from "./state";
import { PreAuthCookieInvalidError } from "./errors";

const SECRET = "test-auth-secret-value";

function makePayload(overrides: Partial<PreAuthPayload> = {}): PreAuthPayload {
  return {
    provider: "google",
    state: generateState(),
    codeVerifier: generateCodeVerifier(),
    nonce: generateNonce(),
    intent: "login",
    redirectTo: "/",
    expiresAt: Date.now() + 600_000,
    ...overrides,
  };
}

describe("generateState / generateCodeVerifier", () => {
  it("produce unique, base64url-safe values across many calls", () => {
    const states = new Set(Array.from({ length: 100 }, () => generateState()));
    const verifiers = new Set(Array.from({ length: 100 }, () => generateCodeVerifier()));

    expect(states.size).toBe(100);
    expect(verifiers.size).toBe(100);
    for (const v of [...states, ...verifiers]) {
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("createS256CodeChallenge", () => {
  it("matches the known RFC 7636 Appendix B.1 test vector", () => {
    const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    expect(createS256CodeChallenge(codeVerifier)).toBe(expectedChallenge);
  });
});

describe("signPreAuthPayload / verifyPreAuthPayload", () => {
  it("round-trips a valid payload", () => {
    const payload = makePayload();
    const signed = signPreAuthPayload(payload, SECRET);

    const verified = verifyPreAuthPayload(signed, SECRET);

    expect(verified).toEqual(payload);
  });

  it("round-trips a payload carrying an invitation-continuation token hash (Step 4C.1 hardening pass binding)", () => {
    const payload = makePayload({ invitationTokenHash: "abc123deadbeef" });
    const signed = signPreAuthPayload(payload, SECRET);

    const verified = verifyPreAuthPayload(signed, SECRET);

    expect(verified.invitationTokenHash).toBe("abc123deadbeef");
    // Tampering with the hash is caught exactly like tampering with any other field — see the dedicated tamper test below.
  });

  it("rejects a payload signed with a different secret", () => {
    const payload = makePayload();
    const signed = signPreAuthPayload(payload, "a-different-secret");

    expect(() => verifyPreAuthPayload(signed, SECRET)).toThrow(PreAuthCookieInvalidError);
  });

  it("rejects a tampered payload even if the signature format still parses", () => {
    const payload = makePayload();
    const signed = signPreAuthPayload(payload, SECRET);
    const [, signature] = signed.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...payload, intent: "link" }),
      "utf8"
    ).toString("base64url");
    const tampered = `${tamperedPayload}.${signature}`;

    expect(() => verifyPreAuthPayload(tampered, SECRET)).toThrow(PreAuthCookieInvalidError);
  });

  it("rejects a malformed cookie value (no signature segment)", () => {
    expect(() => verifyPreAuthPayload("not-a-signed-value", SECRET)).toThrow(
      PreAuthCookieInvalidError
    );
  });

  it("rejects an expired payload", () => {
    const payload = makePayload({ expiresAt: Date.now() - 1000 });
    const signed = signPreAuthPayload(payload, SECRET);

    expect(() => verifyPreAuthPayload(signed, SECRET)).toThrow(PreAuthCookieInvalidError);
  });

  it("rejects a properly-signed payload that fails schema validation (invalid provider)", () => {
    const invalidPayload = {
      ...makePayload(),
      provider: "not-a-real-provider",
    } as unknown as PreAuthPayload;
    const properlySigned = signPreAuthPayload(invalidPayload, SECRET);

    expect(() => verifyPreAuthPayload(properlySigned, SECRET)).toThrow(PreAuthCookieInvalidError);
  });
});
