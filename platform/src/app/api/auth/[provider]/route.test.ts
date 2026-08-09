import { describe, it, expect, vi, beforeEach } from "vitest";

const loadAuthEnvMock = vi.fn();
const createDbClientMock = vi.fn();
const recordAttemptMock = vi.fn();
const setPreAuthCookieMock = vi.fn();
const createAuthorizationUrlMock = vi.fn();
const getProviderConfigsMock = vi.fn();
const readInvitationContinuationCookieMock = vi.fn();

vi.mock("@/lib/env", () => ({ loadEnv: vi.fn(() => ({})) }));
vi.mock("@/db/client", () => ({ createDbClient: (...a: unknown[]) => createDbClientMock(...a) }));
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
vi.mock("@/lib/invitations/continuation", () => ({
  readInvitationContinuationCookie: (...a: unknown[]) => readInvitationContinuationCookieMock(...a),
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

describe("GET /api/auth/[provider]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadAuthEnvMock.mockReturnValue(VALID_AUTH_ENV);
    recordAttemptMock.mockResolvedValue({ allowed: true, remaining: 9, resetAt: new Date() });
    getProviderConfigsMock.mockReturnValue({ google: { id: "google" }, microsoft: { id: "microsoft" } });
    createAuthorizationUrlMock.mockReturnValue(new URL("https://accounts.google.com/o/oauth2/v2/auth?x=1"));
    readInvitationContinuationCookieMock.mockResolvedValue(null);
  });

  it("returns 404 for an unsupported provider", async () => {
    const res = await GET(makeRequest("https://platform.example.com/api/auth/github"), makeParams("github"));
    expect(res.status).toBe(404);
  });

  it("returns 503 when auth environment configuration is invalid", async () => {
    loadAuthEnvMock.mockImplementation(() => {
      throw new AuthEnvValidationError(["AUTH_SECRET"]);
    });

    const res = await GET(makeRequest("https://platform.example.com/api/auth/google"), makeParams("google"));
    expect(res.status).toBe(503);
  });

  it("returns 429 when the per-IP rate limit is exceeded", async () => {
    recordAttemptMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date(Date.now() + 60_000) });

    const res = await GET(makeRequest("https://platform.example.com/api/auth/google"), makeParams("google"));
    expect(res.status).toBe(429);
  });

  it("redirects to the provider's authorization URL and sets the signed pre-auth cookie on success", async () => {
    const res = await GET(makeRequest("https://platform.example.com/api/auth/google"), makeParams("google"));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?x=1");
    expect(setPreAuthCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google", intent: "login", redirectTo: "/", nonce: "generated-nonce" }),
      VALID_AUTH_ENV.AUTH_SECRET
    );
    expect(createAuthorizationUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nonce: "generated-nonce" })
    );
  });

  it("falls back to '/' when an unsafe redirectTo query parameter is supplied", async () => {
    await GET(
      makeRequest("https://platform.example.com/api/auth/google?redirectTo=https://evil.example.com"),
      makeParams("google")
    );

    expect(setPreAuthCookieMock).toHaveBeenCalledWith(expect.objectContaining({ redirectTo: "/" }), expect.any(String));
  });

  it("preserves a safe internal redirectTo query parameter", async () => {
    await GET(
      makeRequest("https://platform.example.com/api/auth/google?redirectTo=/dashboard"),
      makeParams("google")
    );

    expect(setPreAuthCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({ redirectTo: "/dashboard" }),
      expect.any(String)
    );
  });

  it("folds a present invitation continuation cookie's hash into the pre-auth cookie", async () => {
    readInvitationContinuationCookieMock.mockResolvedValue({ invitationTokenHash: "abc123hash" });

    await GET(makeRequest("https://platform.example.com/api/auth/google"), makeParams("google"));

    expect(setPreAuthCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({ invitationTokenHash: "abc123hash" }),
      expect.any(String)
    );
  });

  it("omits invitationTokenHash entirely when no continuation cookie is present", async () => {
    await GET(makeRequest("https://platform.example.com/api/auth/google"), makeParams("google"));

    const call = setPreAuthCookieMock.mock.calls[0][0];
    expect(call.invitationTokenHash).toBeUndefined();
  });
});
