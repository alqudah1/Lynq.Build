import { describe, it, expect, vi, beforeEach } from "vitest";

const loadAuthEnvMock = vi.fn();
const recordAttemptMock = vi.fn();
const readAndClearPreAuthCookieMock = vi.fn();
const assertStateMatchesMock = vi.fn();
const resolveProviderIdentityMock = vi.fn();
const completeLoginMock = vi.fn();
const completeLinkMock = vi.fn();
const setSessionCookieMock = vi.fn();
const getSessionCookieMock = vi.fn();
const validateSessionTokenMock = vi.fn();
const recordAuditEventMock = vi.fn();
const getProviderConfigsMock = vi.fn();
const acceptInvitationByHashMock = vi.fn();
const clearInvitationContinuationCookieMock = vi.fn();

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
vi.mock("@/lib/auth/state", () => ({
  readAndClearPreAuthCookie: (...a: unknown[]) => readAndClearPreAuthCookieMock(...a),
}));
vi.mock("@/lib/auth/callback", () => ({
  assertStateMatches: (...a: unknown[]) => assertStateMatchesMock(...a),
  resolveProviderIdentity: (...a: unknown[]) => resolveProviderIdentityMock(...a),
}));
vi.mock("@/lib/auth/account-linking", () => ({
  completeLogin: (...a: unknown[]) => completeLoginMock(...a),
  completeLink: (...a: unknown[]) => completeLinkMock(...a),
}));
vi.mock("@/lib/auth/session", () => ({
  validateSessionToken: (...a: unknown[]) => validateSessionTokenMock(...a),
}));
vi.mock("@/lib/auth/cookies", () => ({
  setSessionCookie: (...a: unknown[]) => setSessionCookieMock(...a),
  getSessionCookie: (...a: unknown[]) => getSessionCookieMock(...a),
}));
vi.mock("@/lib/audit", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a),
}));
vi.mock("@/lib/invitations/acceptance", () => ({
  acceptInvitationByHash: (...a: unknown[]) => acceptInvitationByHashMock(...a),
}));
vi.mock("@/lib/invitations/continuation", () => ({
  clearInvitationContinuationCookie: (...a: unknown[]) => clearInvitationContinuationCookieMock(...a),
}));

import { GET } from "./route";
import { AuthEnvValidationError } from "@/lib/auth/env";
import {
  PreAuthCookieInvalidError,
  OAuthStateMismatchError,
  NonceMismatchError,
  IdentityConflictError,
  TokenExchangeError,
} from "@/lib/auth/errors";
import { InvitationNotAvailableError } from "@/lib/invitations/errors";

const VALID_AUTH_ENV = { AUTH_SECRET: "s".repeat(32), AUTH_BASE_URL: "https://platform.example.com" };
const VALID_PAYLOAD = {
  provider: "google",
  state: "cookie-state",
  codeVerifier: "verifier",
  nonce: "expected-nonce",
  intent: "login" as const,
  redirectTo: "/dashboard",
};
const VALID_IDENTITY = {
  provider: "google",
  providerAccountId: "sub-1",
  email: "alice@example.com",
  emailVerified: true,
  name: "Alice",
  image: null,
};
const SESSION_RECORD = { id: "session-1", userId: "user-1", createdAt: new Date(), expiresAt: new Date(), lastActiveAt: new Date() };

function makeRequest(url: string) {
  return new Request(url);
}
function makeParams(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

describe("GET /api/auth/[provider]/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadAuthEnvMock.mockReturnValue(VALID_AUTH_ENV);
    recordAttemptMock.mockResolvedValue({ allowed: true, remaining: 9, resetAt: new Date() });
    getProviderConfigsMock.mockReturnValue({ google: { id: "google" }, microsoft: { id: "microsoft" } });
    readAndClearPreAuthCookieMock.mockResolvedValue(VALID_PAYLOAD);
    assertStateMatchesMock.mockReturnValue(undefined);
    resolveProviderIdentityMock.mockResolvedValue(VALID_IDENTITY);
    completeLoginMock.mockResolvedValue({
      outcome: "created",
      userId: "user-1",
      session: SESSION_RECORD,
      rawToken: "raw-token",
    });
  });

  it("returns 404 for an unsupported provider", async () => {
    const res = await GET(makeRequest("https://platform.example.com/api/auth/github/callback"), makeParams("github"));
    expect(res.status).toBe(404);
  });

  it("returns 503 when auth environment configuration is invalid", async () => {
    loadAuthEnvMock.mockImplementation(() => {
      throw new AuthEnvValidationError(["AUTH_SECRET"]);
    });
    const res = await GET(makeRequest("https://platform.example.com/api/auth/google/callback"), makeParams("google"));
    expect(res.status).toBe(503);
  });

  it("redirects to a generic failure page and audits oauth_login_failure when the pre-auth cookie is invalid", async () => {
    readAndClearPreAuthCookieMock.mockRejectedValue(new PreAuthCookieInvalidError("missing"));

    const res = await GET(
      makeRequest("https://platform.example.com/api/auth/google/callback?state=x&code=y"),
      makeParams("google")
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("auth_error=failed");
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "oauth_login_failure" })
    );
    expect(resolveProviderIdentityMock).not.toHaveBeenCalled();
  });

  it("redirects to a generic failure page when the cookie's provider doesn't match the URL's provider", async () => {
    readAndClearPreAuthCookieMock.mockResolvedValue({ ...VALID_PAYLOAD, provider: "microsoft" });

    const res = await GET(
      makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
      makeParams("google")
    );

    expect(res.headers.get("location")).toContain("auth_error=failed");
  });

  it("redirects to a generic failure page when state does not match — never proceeds to code exchange", async () => {
    assertStateMatchesMock.mockImplementation(() => {
      throw new OAuthStateMismatchError();
    });

    const res = await GET(
      makeRequest("https://platform.example.com/api/auth/google/callback?state=wrong&code=abc"),
      makeParams("google")
    );

    expect(res.headers.get("location")).toContain("auth_error=failed");
    expect(resolveProviderIdentityMock).not.toHaveBeenCalled();
  });

  it("redirects to a generic failure page when the code query parameter is missing", async () => {
    const res = await GET(
      makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state"),
      makeParams("google")
    );

    expect(res.headers.get("location")).toContain("auth_error=failed");
  });

  it("returns 429 when the per-IP rate limit is exceeded before the token exchange", async () => {
    recordAttemptMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() });

    const res = await GET(
      makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
      makeParams("google")
    );

    expect(res.status).toBe(429);
    expect(resolveProviderIdentityMock).not.toHaveBeenCalled();
  });

  it("redirects to a generic failure page and audits oauth_login_failure when provider identity resolution is rejected (not an outage)", async () => {
    resolveProviderIdentityMock.mockRejectedValue(new TokenExchangeError("google", "bad code", "rejected"));

    const res = await GET(
      makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
      makeParams("google")
    );

    expect(res.headers.get("location")).toContain("auth_error=failed");
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "oauth_login_failure" })
    );
  });

  it("audits oauth_provider_unavailable, distinctly, when the provider itself could not be reached", async () => {
    resolveProviderIdentityMock.mockRejectedValue(new TokenExchangeError("google", "network down", "unavailable"));

    const res = await GET(
      makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
      makeParams("google")
    );

    expect(res.headers.get("location")).toContain("auth_error=failed");
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "oauth_provider_unavailable" })
    );
  });

  it("redirects to a generic failure page and never logs the nonce value when the nonce mismatches", async () => {
    resolveProviderIdentityMock.mockRejectedValue(new NonceMismatchError());

    const res = await GET(
      makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
      makeParams("google")
    );

    expect(res.headers.get("location")).toContain("auth_error=failed");
    const call = recordAuditEventMock.mock.calls.find((c) => c[1].eventType === "oauth_login_failure");
    expect(call?.[1].metadata).toEqual({ provider: "google", reason: "nonce_mismatch" });
  });

  describe("anonymous login intent", () => {
    it("sets the session cookie and redirects on a brand-new user, without the route itself writing any audit event", async () => {
      const res = await GET(
        makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
        makeParams("google")
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://platform.example.com/dashboard");
      expect(setSessionCookieMock).toHaveBeenCalledWith("raw-token", SESSION_RECORD.expiresAt);
      // completeLogin itself is responsible for the sign_up/oauth_login_success
      // audit events, atomically with the write — the route doesn't duplicate them.
      expect(recordAuditEventMock).not.toHaveBeenCalled();
    });

    describe("invitation continuation (Step 4C.1 hardening pass)", () => {
      it("signals success generically and clears the continuation cookie on successful acceptance", async () => {
        readAndClearPreAuthCookieMock.mockResolvedValue({ ...VALID_PAYLOAD, invitationTokenHash: "hash-abc" });
        acceptInvitationByHashMock.mockResolvedValue({ outcome: "accepted", organizationMembership: {}, workspaceMembership: null });

        const res = await GET(
          makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
          makeParams("google")
        );

        // Login succeeds regardless — session cookie still set, still a redirect.
        expect(setSessionCookieMock).toHaveBeenCalledWith("raw-token", SESSION_RECORD.expiresAt);
        expect(acceptInvitationByHashMock).toHaveBeenCalledWith(expect.anything(), { tokenHash: "hash-abc", actorUserId: "user-1" });
        expect(res.headers.get("location")).toBe("https://platform.example.com/dashboard?invitation=accepted");
        expect(clearInvitationContinuationCookieMock).toHaveBeenCalled();
      });

      it("OAuth login succeeds even when invitation acceptance fails terminally, and the public signal stays generic while the cookie is cleared", async () => {
        readAndClearPreAuthCookieMock.mockResolvedValue({ ...VALID_PAYLOAD, invitationTokenHash: "hash-expired" });
        acceptInvitationByHashMock.mockRejectedValue(new InvitationNotAvailableError("expired"));

        const res = await GET(
          makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
          makeParams("google")
        );

        // The login is NOT rolled back by the invitation failure.
        expect(res.status).toBe(302);
        expect(setSessionCookieMock).toHaveBeenCalledWith("raw-token", SESSION_RECORD.expiresAt);
        // Public signal is the generic word "failed" — never the specific reason ("expired").
        expect(res.headers.get("location")).toBe("https://platform.example.com/dashboard?invitation=failed");
        expect(res.headers.get("location")).not.toContain("expired");
        // Terminal failure — the continuation cookie IS cleared, since retrying cannot help.
        expect(clearInvitationContinuationCookieMock).toHaveBeenCalled();
      });

      it("preserves the continuation cookie on a transient (unexpected) invitation failure, so it can be retried", async () => {
        readAndClearPreAuthCookieMock.mockResolvedValue({ ...VALID_PAYLOAD, invitationTokenHash: "hash-transient" });
        acceptInvitationByHashMock.mockRejectedValue(new Error("temporary database hiccup"));

        const res = await GET(
          makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
          makeParams("google")
        );

        expect(res.status).toBe(302);
        expect(setSessionCookieMock).toHaveBeenCalledWith("raw-token", SESSION_RECORD.expiresAt);
        expect(res.headers.get("location")).toBe("https://platform.example.com/dashboard?invitation=failed");
        // Transient — the continuation cookie is preserved for a same-session retry.
        expect(clearInvitationContinuationCookieMock).not.toHaveBeenCalled();
      });
    });

    it("sets the session cookie and redirects for an existing user the same way", async () => {
      completeLoginMock.mockResolvedValue({
        outcome: "existing",
        userId: "user-1",
        session: SESSION_RECORD,
        rawToken: "raw-token",
      });

      const res = await GET(
        makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
        makeParams("google")
      );

      expect(res.status).toBe(302);
      expect(setSessionCookieMock).toHaveBeenCalledWith("raw-token", SESSION_RECORD.expiresAt);
    });

    it("never sets a session cookie and redirects to the conflict page when the identity is ambiguous", async () => {
      completeLoginMock.mockRejectedValue(new IdentityConflictError("existing-user-1"));

      const res = await GET(
        makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
        makeParams("google")
      );

      expect(res.headers.get("location")).toContain("auth_error=conflict");
      expect(setSessionCookieMock).not.toHaveBeenCalled();
      expect(recordAuditEventMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: "oauth_link_conflict", targetId: "existing-user-1" })
      );
    });
  });

  describe("authenticated link intent", () => {
    const LINK_PAYLOAD = { ...VALID_PAYLOAD, intent: "link" as const, linkUserId: "user-1" };

    it("links successfully when the current session matches linkUserId, without setting a new session cookie", async () => {
      readAndClearPreAuthCookieMock.mockResolvedValue(LINK_PAYLOAD);
      getSessionCookieMock.mockResolvedValue("session-cookie-value");
      validateSessionTokenMock.mockResolvedValue({ id: "session-1", userId: "user-1" });
      completeLinkMock.mockResolvedValue({ outcome: "linked" });

      const res = await GET(
        makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
        makeParams("google")
      );

      expect(res.status).toBe(302);
      expect(setSessionCookieMock).not.toHaveBeenCalled(); // linking never issues a new session
      // completeLink itself writes the oauth_account_linked audit event atomically.
      expect(recordAuditEventMock).not.toHaveBeenCalled();
    });

    it("rejects the link when there is no valid current session — never trusts linkUserId alone", async () => {
      readAndClearPreAuthCookieMock.mockResolvedValue(LINK_PAYLOAD);
      getSessionCookieMock.mockResolvedValue(null);

      const res = await GET(
        makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
        makeParams("google")
      );

      expect(res.headers.get("location")).toContain("auth_error=failed");
      expect(completeLinkMock).not.toHaveBeenCalled();
    });

    it("rejects the link when the current session's user no longer matches linkUserId", async () => {
      readAndClearPreAuthCookieMock.mockResolvedValue(LINK_PAYLOAD);
      getSessionCookieMock.mockResolvedValue("session-cookie-value");
      validateSessionTokenMock.mockResolvedValue({ id: "session-2", userId: "a-different-user" });

      const res = await GET(
        makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
        makeParams("google")
      );

      expect(res.headers.get("location")).toContain("auth_error=failed");
      expect(completeLinkMock).not.toHaveBeenCalled();
    });

    it("redirects to the conflict page and audits oauth_link_conflict when the identity is already claimed", async () => {
      readAndClearPreAuthCookieMock.mockResolvedValue(LINK_PAYLOAD);
      getSessionCookieMock.mockResolvedValue("session-cookie-value");
      validateSessionTokenMock.mockResolvedValue({ id: "session-1", userId: "user-1" });
      completeLinkMock.mockRejectedValue(new IdentityConflictError("someone-else"));

      const res = await GET(
        makeRequest("https://platform.example.com/api/auth/google/callback?state=cookie-state&code=abc"),
        makeParams("google")
      );

      expect(res.headers.get("location")).toContain("auth_error=conflict");
      expect(recordAuditEventMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: "oauth_link_conflict", targetId: "someone-else" })
      );
    });
  });
});
