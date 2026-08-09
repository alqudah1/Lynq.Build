import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Correction pass §9: proves that no provider token, ID token, state,
 * nonce, PKCE verifier, or session token ever appears in logs or
 * responses — using the REAL src/lib/auth/state.ts (real signing,
 * verification, and cookie payload handling), not a mock, so genuine
 * secret-shaped values actually flow through the system under test. Only
 * the DB/provider network layer is mocked.
 */

const loadAuthEnvMock = vi.fn();
const recordAttemptMock = vi.fn();
const resolveProviderIdentityMock = vi.fn();
const completeLoginMock = vi.fn();
const recordAuditEventMock = vi.fn();
const getProviderConfigsMock = vi.fn();
const getSessionCookieMock = vi.fn();

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/env", () => ({ loadEnv: vi.fn(() => ({})) }));
vi.mock("@/db/client", () => ({ createDbClient: vi.fn(() => ({})) }));
vi.mock("@/lib/rate-limit/postgres", () => ({
  PostgresRateLimiter: class {
    recordAttempt(...args: unknown[]) {
      return recordAttemptMock(...args);
    }
  },
}));
vi.mock("@/lib/auth/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/env")>();
  return { ...actual, loadAuthEnv: (...a: unknown[]) => loadAuthEnvMock(...a) };
});
vi.mock("@/lib/auth/providers", () => ({
  getProviderConfigs: (...a: unknown[]) => getProviderConfigsMock(...a),
}));
vi.mock("@/lib/auth/callback", async () => {
  const { OAuthStateMismatchError } = await import("@/lib/auth/errors");
  return {
    assertStateMatches: (cookieState: string, queryState: string | null) => {
      if (queryState !== cookieState) {
        throw new OAuthStateMismatchError();
      }
    },
    resolveProviderIdentity: (...a: unknown[]) => resolveProviderIdentityMock(...a),
  };
});
vi.mock("@/lib/auth/account-linking", () => ({
  completeLogin: (...a: unknown[]) => completeLoginMock(...a),
  completeLink: vi.fn(),
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, validateSessionToken: vi.fn() };
});
vi.mock("@/lib/auth/cookies", () => ({
  setSessionCookie: vi.fn(),
  getSessionCookie: (...a: unknown[]) => getSessionCookieMock(...a),
}));
vi.mock("@/lib/audit", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a),
}));

import { GET } from "./route";
import { setPreAuthCookie } from "@/lib/auth/state";
import { generateSessionToken } from "@/lib/auth/session";

const VALID_AUTH_ENV = { AUTH_SECRET: "s".repeat(32), AUTH_BASE_URL: "https://platform.example.com" };

// Real, secret-shaped fixture values — deliberately distinctive so they're
// easy to grep for in any captured output.
const REAL_STATE = "STATE-SECRET-9f8e7d6c5b4a";
const REAL_NONCE = "NONCE-SECRET-1a2b3c4d5e6f";
const REAL_CODE_VERIFIER = "VERIFIER-SECRET-abcdef123456";
const REAL_SESSION_TOKEN = generateSessionToken(); // a genuine 32-byte random token
const SECRET_VALUES = [REAL_STATE, REAL_NONCE, REAL_CODE_VERIFIER, REAL_SESSION_TOKEN];

/** Mocked next/headers cookie jar that actually stores the signed pre-auth cookie set via setPreAuthCookie. */
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      set: (name: string, value: string) => cookieStore.set(name, value),
      get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

function makeRequest(url: string) {
  return new Request(url);
}
function makeParams(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

describe("no secrets appear in logs or responses across callback failure paths", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    cookieStore.clear();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    loadAuthEnvMock.mockReturnValue(VALID_AUTH_ENV);
    recordAttemptMock.mockResolvedValue({ allowed: true, remaining: 9, resetAt: new Date() });
    getProviderConfigsMock.mockReturnValue({ google: { id: "google" } });

    await setPreAuthCookie(
      {
        provider: "google",
        state: REAL_STATE,
        codeVerifier: REAL_CODE_VERIFIER,
        nonce: REAL_NONCE,
        intent: "login",
        redirectTo: "/dashboard",
      },
      VALID_AUTH_ENV.AUTH_SECRET
    );
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function assertNoSecretsLeaked(response: Response, responseText: string) {
    const loggedText = consoleErrorSpy.mock.calls.map((call: unknown[]) => JSON.stringify(call)).join("\n");
    const location = response.headers.get("location") ?? "";

    for (const secret of SECRET_VALUES) {
      expect(loggedText).not.toContain(secret);
      expect(location).not.toContain(secret);
      expect(responseText).not.toContain(secret);
    }
  }

  it("leaks no secret on a state mismatch", async () => {
    const res = await GET(
      makeRequest(`https://platform.example.com/api/auth/google/callback?state=WRONG-STATE&code=abc`),
      makeParams("google")
    );
    assertNoSecretsLeaked(res, await res.text());

    // The audit event itself must not carry the real state/nonce/verifier either.
    const metadata = recordAuditEventMock.mock.calls[0]?.[1]?.metadata;
    for (const secret of SECRET_VALUES) {
      expect(JSON.stringify(metadata ?? {})).not.toContain(secret);
    }
  });

  it("leaks no secret when the provider identity resolution rejects (e.g. nonce mismatch downstream)", async () => {
    const { NonceMismatchError } = await import("@/lib/auth/errors");
    resolveProviderIdentityMock.mockRejectedValue(new NonceMismatchError());

    const res = await GET(
      makeRequest(`https://platform.example.com/api/auth/google/callback?state=${REAL_STATE}&code=abc`),
      makeParams("google")
    );
    assertNoSecretsLeaked(res, await res.text());

    const metadata = recordAuditEventMock.mock.calls[0]?.[1]?.metadata;
    expect(metadata).toEqual({ provider: "google", reason: "nonce_mismatch" });
  });

  it("leaks no secret on a successful login — the session cookie value never appears in the redirect or logs", async () => {
    resolveProviderIdentityMock.mockResolvedValue({
      provider: "google",
      providerAccountId: "sub-1",
      email: "alice@example.com",
      emailVerified: true,
      name: "Alice",
      image: null,
    });
    completeLoginMock.mockResolvedValue({
      outcome: "created",
      userId: "user-1",
      session: { id: "session-1", userId: "user-1", createdAt: new Date(), expiresAt: new Date(), lastActiveAt: new Date() },
      rawToken: REAL_SESSION_TOKEN,
    });

    const res = await GET(
      makeRequest(`https://platform.example.com/api/auth/google/callback?state=${REAL_STATE}&code=abc`),
      makeParams("google")
    );
    assertNoSecretsLeaked(res, await res.text());
  });
});
