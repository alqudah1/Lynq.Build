import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  getProviderConfigs,
  createAuthorizationUrl,
  exchangeAuthorizationCode,
  fetchProviderUserInfo,
  verifyIdToken,
} from "./providers";
import { TokenExchangeError, ProviderResponseMismatchError } from "./errors";
import type { AuthEnv } from "./env";

const TEST_ENV: AuthEnv = {
  GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
  MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
  MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-client-secret",
  MICROSOFT_OAUTH_TENANT_ID: "organizations",
  AUTH_SECRET: "a".repeat(32),
  AUTH_BASE_URL: "https://platform.example.com",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getProviderConfigs", () => {
  const configs = getProviderConfigs(TEST_ENV);

  it("builds Google's config from fixed, published endpoints and env credentials, including jwksUri", () => {
    expect(configs.google.authorizationEndpoint).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(configs.google.tokenEndpoint).toBe("https://oauth2.googleapis.com/token");
    expect(configs.google.jwksUri).toBe("https://www.googleapis.com/oauth2/v3/certs");
    expect(configs.google.expectedIssuer).toBe("https://accounts.google.com");
    expect(configs.google.redirectUri).toBe("https://platform.example.com/api/auth/google/callback");
  });

  it("builds Microsoft's config with a tenant-agnostic JWKS endpoint and no fixed expectedIssuer", () => {
    expect(configs.microsoft.jwksUri).toBe("https://login.microsoftonline.com/organizations/discovery/v2.0/keys");
    expect(configs.microsoft.expectedIssuer).toBeUndefined();
  });
});

describe("createAuthorizationUrl", () => {
  it("builds a URL with PKCE, state, and nonce parameters against the provider's authorization endpoint", () => {
    const configs = getProviderConfigs(TEST_ENV);
    const url = createAuthorizationUrl(configs.google, {
      state: "state-123",
      codeChallenge: "challenge-abc",
      nonce: "nonce-xyz",
    });

    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBe("nonce-xyz");
  });
});

describe("exchangeAuthorizationCode", () => {
  const configs = getProviderConfigs(TEST_ENV);

  it("returns a normalized token response on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "access-token-value",
          id_token: "id-token-value",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      })
    );

    const result = await exchangeAuthorizationCode(configs.google, { code: "auth-code", codeVerifier: "verifier" });

    expect(result).toEqual({
      accessToken: "access-token-value",
      idToken: "id-token-value",
      tokenType: "Bearer",
      expiresIn: 3600,
    });
  });

  it("classifies a 5xx response as 'unavailable' (provider outage), distinct from a 4xx rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));

    try {
      await exchangeAuthorizationCode(configs.google, { code: "auth-code", codeVerifier: "verifier" });
      expect.unreachable("expected exchangeAuthorizationCode to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TokenExchangeError);
      expect((err as TokenExchangeError).classification).toBe("unavailable");
    }
  });

  it("classifies a network failure as 'unavailable'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    try {
      await exchangeAuthorizationCode(configs.google, { code: "auth-code", codeVerifier: "verifier" });
      expect.unreachable("expected exchangeAuthorizationCode to throw");
    } catch (err) {
      expect((err as TokenExchangeError).classification).toBe("unavailable");
    }
  });

  it("classifies a 4xx response as 'rejected' (invalid request), distinct from an outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) })
    );

    try {
      await exchangeAuthorizationCode(configs.google, { code: "bad-code", codeVerifier: "verifier" });
      expect.unreachable("expected exchangeAuthorizationCode to throw");
    } catch (err) {
      expect((err as TokenExchangeError).classification).toBe("rejected");
    }
  });

  it("throws 'rejected' when the response is missing access_token or id_token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));

    try {
      await exchangeAuthorizationCode(configs.google, { code: "auth-code", codeVerifier: "verifier" });
      expect.unreachable("expected exchangeAuthorizationCode to throw");
    } catch (err) {
      expect((err as TokenExchangeError).classification).toBe("rejected");
    }
  });
});

describe("fetchProviderUserInfo", () => {
  const configs = getProviderConfigs(TEST_ENV);

  it("returns sub/email/name/picture without any emailVerified field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ sub: "google-sub-1", email: "alice@example.com", name: "Alice" }),
      })
    );

    const result = await fetchProviderUserInfo(configs.google, "access-token");

    expect(result).toEqual({ sub: "google-sub-1", email: "alice@example.com", name: "Alice", picture: null });
    expect(result).not.toHaveProperty("emailVerified");
  });

  it("throws ProviderResponseMismatchError on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

    await expect(fetchProviderUserInfo(configs.google, "bad-token")).rejects.toThrow(ProviderResponseMismatchError);
  });

  it("throws ProviderResponseMismatchError when sub is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));

    await expect(fetchProviderUserInfo(configs.google, "access-token")).rejects.toThrow(ProviderResponseMismatchError);
  });
});

describe("verifyIdToken — full cryptographic OIDC verification", () => {
  const configs = getProviderConfigs(TEST_ENV);
  let googleKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;
  let attackerKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;
  let microsoftKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;

  beforeAll(async () => {
    googleKeyPair = await generateKeyPair("RS256", { extractable: true });
    attackerKeyPair = await generateKeyPair("RS256", { extractable: true });
    microsoftKeyPair = await generateKeyPair("RS256", { extractable: true });
  });

  async function mockJwksFor(kid: string, publicKey: CryptoKey, jwksUri: string) {
    const jwk = await exportJWK(publicKey);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (url.toString() === jwksUri) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] }),
          } as Response;
        }
        throw new Error(`unexpected fetch to ${url}`);
      })
    );
  }

  async function signToken(
    privateKey: CryptoKey,
    kid: string,
    claims: Record<string, unknown>,
    expSecondsFromNow = 3600
  ) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expSecondsFromNow)
      .sign(privateKey);
  }

  it("verifies a correctly signed Google ID token and returns its claims", async () => {
    await mockJwksFor("google-kid-1", googleKeyPair.publicKey, configs.google.jwksUri);
    const token = await signToken(googleKeyPair.privateKey, "google-kid-1", {
      iss: "https://accounts.google.com",
      aud: "google-client-id",
      sub: "google-sub-1",
      email: "alice@example.com",
      email_verified: true,
      nonce: "nonce-value",
    });

    const claims = await verifyIdToken(configs.google, token);

    expect(claims.sub).toBe("google-sub-1");
    expect(claims.iss).toBe("https://accounts.google.com");
  });

  it("rejects a token signed by a key not in the provider's JWKS (forged signature)", async () => {
    await mockJwksFor("google-kid-1", googleKeyPair.publicKey, configs.google.jwksUri);
    const forgedToken = await signToken(attackerKeyPair.privateKey, "google-kid-1", {
      iss: "https://accounts.google.com",
      aud: "google-client-id",
      sub: "google-sub-1",
      nonce: "nonce-value",
    });

    await expect(verifyIdToken(configs.google, forgedToken)).rejects.toThrow(ProviderResponseMismatchError);
  });

  it("rejects a correctly-signed token with the wrong issuer", async () => {
    await mockJwksFor("google-kid-1", googleKeyPair.publicKey, configs.google.jwksUri);
    const token = await signToken(googleKeyPair.privateKey, "google-kid-1", {
      iss: "https://evil.example.com",
      aud: "google-client-id",
      sub: "google-sub-1",
    });

    await expect(verifyIdToken(configs.google, token)).rejects.toThrow(ProviderResponseMismatchError);
  });

  it("rejects a correctly-signed token with the wrong audience", async () => {
    await mockJwksFor("google-kid-1", googleKeyPair.publicKey, configs.google.jwksUri);
    const token = await signToken(googleKeyPair.privateKey, "google-kid-1", {
      iss: "https://accounts.google.com",
      aud: "someone-elses-client-id",
      sub: "google-sub-1",
    });

    await expect(verifyIdToken(configs.google, token)).rejects.toThrow(ProviderResponseMismatchError);
  });

  it("rejects an expired token", async () => {
    await mockJwksFor("google-kid-1", googleKeyPair.publicKey, configs.google.jwksUri);
    const token = await signToken(
      googleKeyPair.privateKey,
      "google-kid-1",
      { iss: "https://accounts.google.com", aud: "google-client-id", sub: "google-sub-1" },
      -3600 // expired an hour ago
    );

    await expect(verifyIdToken(configs.google, token)).rejects.toThrow(ProviderResponseMismatchError);
  });

  describe("Microsoft tenant-binding (correction pass §1, Gate 1) — exact tid-to-issuer binding, never a general pattern match alone", () => {
    const TID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
    const OTHER_TID = "11111111-2222-3333-4444-555555555555";
    const OID = "abc12345-0000-1111-2222-333344445555";

    it("accepts a token whose issuer exactly binds to its own tid claim", async () => {
      await mockJwksFor("ms-kid-1", microsoftKeyPair.publicKey, configs.microsoft.jwksUri);
      const token = await signToken(microsoftKeyPair.privateKey, "ms-kid-1", {
        iss: `https://login.microsoftonline.com/${TID}/v2.0`,
        aud: "microsoft-client-id",
        sub: "ms-sub-1",
        tid: TID,
        oid: OID,
      });

      const claims = await verifyIdToken(configs.microsoft, token);
      expect(claims.tid).toBe(TID);
      expect(claims.oid).toBe(OID);
    });

    it("rejects a valid-looking, correctly GUID-shaped issuer whose embedded tenant differs from the token's own tid claim", async () => {
      await mockJwksFor("ms-kid-1", microsoftKeyPair.publicKey, configs.microsoft.jwksUri);
      // iss is well-formed and GUID-shaped — a general regex would accept
      // it — but it names a DIFFERENT tenant than the tid claim itself.
      const token = await signToken(microsoftKeyPair.privateKey, "ms-kid-1", {
        iss: `https://login.microsoftonline.com/${OTHER_TID}/v2.0`,
        aud: "microsoft-client-id",
        sub: "ms-sub-1",
        tid: TID,
        oid: OID,
      });

      await expect(verifyIdToken(configs.microsoft, token)).rejects.toThrow(ProviderResponseMismatchError);
    });

    it("rejects a token with no tid claim at all", async () => {
      await mockJwksFor("ms-kid-1", microsoftKeyPair.publicKey, configs.microsoft.jwksUri);
      const token = await signToken(microsoftKeyPair.privateKey, "ms-kid-1", {
        iss: `https://login.microsoftonline.com/${TID}/v2.0`,
        aud: "microsoft-client-id",
        sub: "ms-sub-1",
        oid: OID,
      });

      await expect(verifyIdToken(configs.microsoft, token)).rejects.toThrow(ProviderResponseMismatchError);
    });

    it("rejects a token with no oid claim at all", async () => {
      await mockJwksFor("ms-kid-1", microsoftKeyPair.publicKey, configs.microsoft.jwksUri);
      const token = await signToken(microsoftKeyPair.privateKey, "ms-kid-1", {
        iss: `https://login.microsoftonline.com/${TID}/v2.0`,
        aud: "microsoft-client-id",
        sub: "ms-sub-1",
        tid: TID,
      });

      await expect(verifyIdToken(configs.microsoft, token)).rejects.toThrow(ProviderResponseMismatchError);
    });

    it("rejects a malformed (non-GUID-shaped) tid, even if the issuer is constructed to match it", async () => {
      await mockJwksFor("ms-kid-1", microsoftKeyPair.publicKey, configs.microsoft.jwksUri);
      const malformedTid = "not-a-real-guid";
      const token = await signToken(microsoftKeyPair.privateKey, "ms-kid-1", {
        iss: `https://login.microsoftonline.com/${malformedTid}/v2.0`,
        aud: "microsoft-client-id",
        sub: "ms-sub-1",
        tid: malformedTid,
        oid: OID,
      });

      await expect(verifyIdToken(configs.microsoft, token)).rejects.toThrow(ProviderResponseMismatchError);
    });

    it("rejects a malformed (non-GUID-shaped) oid", async () => {
      await mockJwksFor("ms-kid-1", microsoftKeyPair.publicKey, configs.microsoft.jwksUri);
      const token = await signToken(microsoftKeyPair.privateKey, "ms-kid-1", {
        iss: `https://login.microsoftonline.com/${TID}/v2.0`,
        aud: "microsoft-client-id",
        sub: "ms-sub-1",
        tid: TID,
        oid: "not-a-real-guid",
      });

      await expect(verifyIdToken(configs.microsoft, token)).rejects.toThrow(ProviderResponseMismatchError);
    });

    it.each(["common", "organizations", "consumers"])(
      "rejects an issuer using the literal '%s' alias instead of a resolved tenant-specific GUID",
      async (alias) => {
        await mockJwksFor("ms-kid-1", microsoftKeyPair.publicKey, configs.microsoft.jwksUri);
        const token = await signToken(microsoftKeyPair.privateKey, "ms-kid-1", {
          iss: `https://login.microsoftonline.com/${alias}/v2.0`,
          aud: "microsoft-client-id",
          sub: "ms-sub-1",
          tid: TID,
          oid: OID,
        });

        await expect(verifyIdToken(configs.microsoft, token)).rejects.toThrow(ProviderResponseMismatchError);
      }
    );

    it("rejects a token whose issuer doesn't match the tenant-shaped format at all", async () => {
      await mockJwksFor("ms-kid-1", microsoftKeyPair.publicKey, configs.microsoft.jwksUri);
      const token = await signToken(microsoftKeyPair.privateKey, "ms-kid-1", {
        iss: "https://evil.example.com/not-a-tenant/v2.0",
        aud: "microsoft-client-id",
        sub: "ms-sub-1",
        tid: TID,
        oid: OID,
      });

      await expect(verifyIdToken(configs.microsoft, token)).rejects.toThrow(ProviderResponseMismatchError);
    });
  });
});
