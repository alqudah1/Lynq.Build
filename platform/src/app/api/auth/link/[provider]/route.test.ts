import { describe, it, expect, vi, beforeEach } from "vitest";

const loadAuthEnvMock = vi.fn();
const recordAttemptMock = vi.fn();
const setPreAuthCookieMock = vi.fn();
const createAuthorizationUrlMock = vi.fn();
const getProviderConfigsMock = vi.fn();
const getSessionCookieMock = vi.fn();
const validateSessionTokenMock = vi.fn();

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
  createAuthorizationUrl: (...a: unknown[]) => createAuthorizationUrlMock(...a),
}));
vi.mock("@/lib/auth/state", () => ({
  generateState: () => "generated-state",
  generateCodeVerifier: () => "generated-verifier",
  generateNonce: () => "generated-nonce",
  createS256CodeChallenge: () => "generated-challenge",
  setPreAuthCookie: (...a: unknown[]) => setPreAuthCookieMock(...a),
}));
vi.mock("@/lib/auth/cookies", () => ({
  getSessionCookie: (...a: unknown[]) => getSessionCookieMock(...a),
}));
vi.mock("@/lib/auth/session", () => ({
  validateSessionToken: (...a: unknown[]) => validateSessionTokenMock(...a),
}));

import { GET } from "./route";
import { AuthEnvValidationError } from "@/lib/auth/env";

const VALID_AUTH_ENV = { AUTH_SECRET: "s".repeat(32), AUTH_BASE_URL: "https://platform.example.com" };

function makeRequest(url: string) {
  return new Request(url);
}
function makeParams(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

describe("GET /api/auth/link/[provider]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadAuthEnvMock.mockReturnValue(VALID_AUTH_ENV);
    recordAttemptMock.mockResolvedValue({ allowed: true, remaining: 9, resetAt: new Date() });
    getProviderConfigsMock.mockReturnValue({ google: { id: "google" }, microsoft: { id: "microsoft" } });
    createAuthorizationUrlMock.mockReturnValue(new URL("https://accounts.google.com/o/oauth2/v2/auth?x=1"));
  });

  it("returns 404 for an unsupported provider", async () => {
    const res = await GET(makeRequest("https://platform.example.com/api/auth/link/github"), makeParams("github"));
    expect(res.status).toBe(404);
  });

  it("returns 503 when auth environment configuration is invalid", async () => {
    loadAuthEnvMock.mockImplementation(() => {
      throw new AuthEnvValidationError(["AUTH_SECRET"]);
    });
    const res = await GET(makeRequest("https://platform.example.com/api/auth/link/google"), makeParams("google"));
    expect(res.status).toBe(503);
  });

  it("returns 401 when there is no valid current session", async () => {
    getSessionCookieMock.mockResolvedValue(null);
    const res = await GET(makeRequest("https://platform.example.com/api/auth/link/google"), makeParams("google"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session cookie doesn't validate", async () => {
    getSessionCookieMock.mockResolvedValue("stale-token");
    validateSessionTokenMock.mockResolvedValue(null);
    const res = await GET(makeRequest("https://platform.example.com/api/auth/link/google"), makeParams("google"));
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    getSessionCookieMock.mockResolvedValue("valid-token");
    validateSessionTokenMock.mockResolvedValue({ id: "session-1", userId: "user-1" });
    recordAttemptMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() });

    const res = await GET(makeRequest("https://platform.example.com/api/auth/link/google"), makeParams("google"));
    expect(res.status).toBe(429);
  });

  it("redirects to the authorization URL and signs the pre-auth cookie with intent=link and the current user's id", async () => {
    getSessionCookieMock.mockResolvedValue("valid-token");
    validateSessionTokenMock.mockResolvedValue({ id: "session-1", userId: "user-1" });

    const res = await GET(makeRequest("https://platform.example.com/api/auth/link/google"), makeParams("google"));

    expect(res.status).toBe(302);
    expect(setPreAuthCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        intent: "link",
        linkUserId: "user-1",
        nonce: "generated-nonce",
      }),
      VALID_AUTH_ENV.AUTH_SECRET
    );
  });
});
