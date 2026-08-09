import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderConfig } from "./providers";

const exchangeAuthorizationCodeMock = vi.fn();
const fetchProviderUserInfoMock = vi.fn();
const verifyIdTokenMock = vi.fn();

vi.mock("./providers", () => ({
  exchangeAuthorizationCode: (...args: unknown[]) => exchangeAuthorizationCodeMock(...args),
  fetchProviderUserInfo: (...args: unknown[]) => fetchProviderUserInfoMock(...args),
  verifyIdToken: (...args: unknown[]) => verifyIdTokenMock(...args),
}));

import {
  assertStateMatches,
  assertNonceMatches,
  resolveProviderAccountId,
  resolveProviderIdentity,
} from "./callback";
import { OAuthStateMismatchError, NonceMismatchError, ProviderResponseMismatchError } from "./errors";

const GOOGLE_PROVIDER: ProviderConfig = {
  id: "google",
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  userinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  clientId: "google-client-id",
  clientSecret: "google-client-secret",
  scopes: ["openid", "email", "profile"],
  redirectUri: "https://platform.example.com/api/auth/google/callback",
  expectedIssuer: "https://accounts.google.com",
};

const MICROSOFT_PROVIDER: ProviderConfig = {
  id: "microsoft",
  authorizationEndpoint: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
  tokenEndpoint: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
  userinfoEndpoint: "https://graph.microsoft.com/oidc/userinfo",
  jwksUri: "https://login.microsoftonline.com/organizations/discovery/v2.0/keys",
  clientId: "microsoft-client-id",
  clientSecret: "microsoft-client-secret",
  scopes: ["openid", "email", "profile"],
  redirectUri: "https://platform.example.com/api/auth/microsoft/callback",
};

const VALID_GOOGLE_CLAIMS = {
  aud: "google-client-id",
  iss: "https://accounts.google.com",
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub: "provider-sub-1",
  email: "alice@example.com",
  email_verified: true,
  nonce: "expected-nonce",
  name: "Alice",
};

const VALID_USERINFO = { sub: "provider-sub-1", email: "alice@example.com", name: "Alice", picture: null };

beforeEach(() => {
  vi.clearAllMocks();
  exchangeAuthorizationCodeMock.mockResolvedValue({
    accessToken: "access-token",
    idToken: "id-token",
    tokenType: "Bearer",
    expiresIn: 3600,
  });
  verifyIdTokenMock.mockResolvedValue(VALID_GOOGLE_CLAIMS);
  fetchProviderUserInfoMock.mockResolvedValue(VALID_USERINFO);
});

describe("assertStateMatches", () => {
  it("passes silently when the query state matches the cookie state", () => {
    expect(() => assertStateMatches("state-abc", "state-abc")).not.toThrow();
  });

  it("throws OAuthStateMismatchError when the query state differs", () => {
    expect(() => assertStateMatches("state-abc", "state-different")).toThrow(OAuthStateMismatchError);
  });

  it("throws OAuthStateMismatchError when the query state is missing entirely", () => {
    expect(() => assertStateMatches("state-abc", null)).toThrow(OAuthStateMismatchError);
  });
});

describe("assertNonceMatches", () => {
  it("passes silently when the nonce matches", () => {
    expect(() => assertNonceMatches("expected-nonce", "expected-nonce")).not.toThrow();
  });

  it("throws NonceMismatchError when the nonce differs", () => {
    expect(() => assertNonceMatches("expected-nonce", "different-nonce")).toThrow(NonceMismatchError);
  });

  it("throws NonceMismatchError when the token's nonce claim is missing", () => {
    expect(() => assertNonceMatches("expected-nonce", undefined)).toThrow(NonceMismatchError);
  });

  it("throws NonceMismatchError when the token's nonce claim is not a string", () => {
    expect(() => assertNonceMatches("expected-nonce", 12345)).toThrow(NonceMismatchError);
  });

  it("never includes the nonce value itself in the thrown error's message", () => {
    try {
      assertNonceMatches("super-secret-nonce-value", "wrong-nonce-value");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("super-secret-nonce-value");
      expect((err as Error).message).not.toContain("wrong-nonce-value");
    }
  });
});

describe("resolveProviderAccountId", () => {
  it("uses Google's validated sub claim directly", () => {
    expect(resolveProviderAccountId(GOOGLE_PROVIDER, { sub: "google-sub-1" } as never)).toBe("google-sub-1");
  });

  it("uses Microsoft's tenant-qualified tid.oid, never email/UPN", () => {
    const claims = {
      sub: "opaque-pairwise-id",
      tid: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      oid: "abc12345-0000-1111-2222-333344445555",
      email: "bob@example.com",
      preferred_username: "bob@example.com",
    } as never;

    const id = resolveProviderAccountId(MICROSOFT_PROVIDER, claims);

    expect(id).toBe("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.abc12345-0000-1111-2222-333344445555");
    expect(id).not.toContain("bob@example.com");
  });

  it("throws when a Microsoft token is missing tid or oid", () => {
    expect(() => resolveProviderAccountId(MICROSOFT_PROVIDER, { sub: "x" } as never)).toThrow(
      ProviderResponseMismatchError
    );
  });
});

describe("resolveProviderIdentity", () => {
  it("returns a normalized Google identity, with emailVerified strictly from the validated claim", async () => {
    const identity = await resolveProviderIdentity(GOOGLE_PROVIDER, {
      code: "code",
      codeVerifier: "verifier",
      nonce: "expected-nonce",
    });

    expect(identity).toEqual({
      provider: "google",
      providerAccountId: "provider-sub-1",
      email: "alice@example.com",
      emailVerified: true,
      name: "Alice",
      image: null,
    });
  });

  it("never marks a Google identity verified when email_verified is not explicitly true", async () => {
    verifyIdTokenMock.mockResolvedValue({ ...VALID_GOOGLE_CLAIMS, email_verified: false });

    const identity = await resolveProviderIdentity(GOOGLE_PROVIDER, {
      code: "code",
      codeVerifier: "verifier",
      nonce: "expected-nonce",
    });

    expect(identity.emailVerified).toBe(false);
  });

  it("never marks a Microsoft identity's email as verified, regardless of any claim present", async () => {
    verifyIdTokenMock.mockResolvedValue({
      sub: "ms-opaque-sub",
      tid: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      oid: "abc12345-0000-1111-2222-333344445555",
      email: "bob@example.com",
      nonce: "expected-nonce",
    });
    fetchProviderUserInfoMock.mockResolvedValue({ sub: "ms-opaque-sub", email: "bob@example.com", name: null, picture: null });

    const identity = await resolveProviderIdentity(MICROSOFT_PROVIDER, {
      code: "code",
      codeVerifier: "verifier",
      nonce: "expected-nonce",
    });

    expect(identity.emailVerified).toBe(false);
    expect(identity.providerAccountId).toBe("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.abc12345-0000-1111-2222-333344445555");
  });

  it("falls back to preferred_username as contact email for Microsoft when email claim is absent", async () => {
    verifyIdTokenMock.mockResolvedValue({
      sub: "ms-opaque-sub",
      tid: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      oid: "abc12345-0000-1111-2222-333344445555",
      preferred_username: "bob@company.example.com",
      nonce: "expected-nonce",
    });
    fetchProviderUserInfoMock.mockResolvedValue({ sub: "ms-opaque-sub", email: null, name: null, picture: null });

    const identity = await resolveProviderIdentity(MICROSOFT_PROVIDER, {
      code: "code",
      codeVerifier: "verifier",
      nonce: "expected-nonce",
    });

    expect(identity.email).toBe("bob@company.example.com");
  });

  it("rejects when the nonce does not match, before returning any identity", async () => {
    await expect(
      resolveProviderIdentity(GOOGLE_PROVIDER, { code: "code", codeVerifier: "verifier", nonce: "wrong-nonce" })
    ).rejects.toThrow(NonceMismatchError);
  });

  it("rejects when the userinfo endpoint's sub does not match the ID token's sub — the forgery cross-check", async () => {
    fetchProviderUserInfoMock.mockResolvedValue({ ...VALID_USERINFO, sub: "a-different-sub" });

    await expect(
      resolveProviderIdentity(GOOGLE_PROVIDER, { code: "code", codeVerifier: "verifier", nonce: "expected-nonce" })
    ).rejects.toThrow(ProviderResponseMismatchError);
  });

  it("propagates a token-exchange failure without attempting the userinfo cross-check", async () => {
    exchangeAuthorizationCodeMock.mockRejectedValue(new Error("token exchange failed"));

    await expect(
      resolveProviderIdentity(GOOGLE_PROVIDER, { code: "bad-code", codeVerifier: "verifier", nonce: "expected-nonce" })
    ).rejects.toThrow("token exchange failed");
    expect(fetchProviderUserInfoMock).not.toHaveBeenCalled();
  });

  it("propagates an ID-token verification failure without attempting the userinfo cross-check", async () => {
    verifyIdTokenMock.mockRejectedValue(new ProviderResponseMismatchError("signature invalid"));

    await expect(
      resolveProviderIdentity(GOOGLE_PROVIDER, { code: "code", codeVerifier: "verifier", nonce: "expected-nonce" })
    ).rejects.toThrow(ProviderResponseMismatchError);
    expect(fetchProviderUserInfoMock).not.toHaveBeenCalled();
  });
});
