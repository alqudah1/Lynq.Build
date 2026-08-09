import "server-only";
import { jwtVerify, createRemoteJWKSet, errors as joseErrors } from "jose";
import type { JWTPayload } from "jose";
import type { AuthEnv } from "./env";
import { TokenExchangeError, ProviderResponseMismatchError } from "./errors";

export type OAuthProviderId = "google" | "microsoft";

export interface ProviderConfig {
  id: OAuthProviderId;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  /** OIDC discovery's jwks_uri — used for cryptographic ID-token signature verification (§1 correction). */
  jwksUri: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
  /**
   * Exact expected `iss` value, passed directly to jose's `jwtVerify`, for
   * providers with a single fixed issuer (Google). `undefined` for
   * Microsoft, whose per-tenant issuer is instead verified by exact
   * construction from the token's own validated `tid` claim — see
   * `assertMicrosoftTenantBinding` below, not a general pattern match.
   */
  expectedIssuer?: string;
}

export interface TokenResponse {
  accessToken: string;
  idToken: string;
  tokenType: string;
  expiresIn: number;
}

export interface ProviderUserInfo {
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

/** Verified ID token claims, after full JWKS-backed signature and standard-claims verification. */
export interface VerifiedIdTokenClaims extends JWTPayload {
  sub: string;
}

/**
 * Azure AD/Entra ID tenant IDs and object IDs are standard GUIDs. Used to
 * validate `tid`/`oid` shape before they're trusted for anything —
 * correction pass §1 (Gate 1): a general issuer-shape regex alone is not
 * sufficient; the token's own `tid` must be well-formed AND must be the
 * exact value the issuer was constructed from.
 */
const GUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Builds both provider configs from validated env (Step 3 design §5, §10).
 * No arctic, no Auth.js, no openid-client — see §1's correction note in the
 * Step 3 design doc for why openid-client's high-level discovery +
 * authorizationCodeGrant flow does not cleanly fit Microsoft's multi-tenant
 * issuer templating without a fragile, unverifiable workaround. `jose`
 * (also by openid-client's maintainer) is used instead for exactly the
 * cryptographic primitives that must never be hand-rolled — JWKS
 * retrieval/caching/rotation and JWT signature verification — while
 * authorization-URL construction and token exchange remain the same
 * hand-rolled, well-documented REST calls from Step 3 (never flagged as a
 * concern; these aren't cryptographic operations).
 */
export function getProviderConfigs(env: AuthEnv): Record<OAuthProviderId, ProviderConfig> {
  return {
    google: {
      id: "google",
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      userinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      scopes: ["openid", "email", "profile"],
      redirectUri: `${env.AUTH_BASE_URL}/api/auth/google/callback`,
      expectedIssuer: "https://accounts.google.com",
    },
    microsoft: {
      id: "microsoft",
      authorizationEndpoint: `https://login.microsoftonline.com/${env.MICROSOFT_OAUTH_TENANT_ID}/oauth2/v2.0/authorize`,
      tokenEndpoint: `https://login.microsoftonline.com/${env.MICROSOFT_OAUTH_TENANT_ID}/oauth2/v2.0/token`,
      // Microsoft Graph's OIDC-compliant userinfo endpoint — not tenant-specific.
      userinfoEndpoint: "https://graph.microsoft.com/oidc/userinfo",
      // Tenant-agnostic JWKS endpoint — valid for tokens from any tenant,
      // confirmed live: https://login.microsoftonline.com/organizations/discovery/v2.0/keys
      jwksUri: "https://login.microsoftonline.com/organizations/discovery/v2.0/keys",
      clientId: env.MICROSOFT_OAUTH_CLIENT_ID,
      clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET,
      scopes: ["openid", "email", "profile"],
      redirectUri: `${env.AUTH_BASE_URL}/api/auth/microsoft/callback`,
      // No expectedIssuer — see the field's own doc comment above.
    },
  };
}

export function createAuthorizationUrl(
  provider: ProviderConfig,
  params: { state: string; codeChallenge: string; nonce: string }
): URL {
  const url = new URL(provider.authorizationEndpoint);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", provider.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

/** One POST to the provider's fixed, published token endpoint (Step 3 design §5 step 3). */
export async function exchangeAuthorizationCode(
  provider: ProviderConfig,
  params: { code: string; codeVerifier: string }
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: provider.redirectUri,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code_verifier: params.codeVerifier,
  });

  let response: Response;
  try {
    response = await fetch(provider.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
  } catch (err) {
    // Network-level failure reaching the provider at all — classified as a
    // provider-availability problem (audited as oauth_provider_unavailable),
    // distinct from the provider actively rejecting the request.
    throw new TokenExchangeError(provider.id, `network error: ${(err as Error).message}`, "unavailable");
  }

  if (response.status >= 500) {
    throw new TokenExchangeError(provider.id, `provider returned HTTP ${response.status}`, "unavailable");
  }
  if (!response.ok) {
    throw new TokenExchangeError(provider.id, `provider returned HTTP ${response.status}`, "rejected");
  }

  const json = (await response.json()) as Record<string, unknown>;
  if (typeof json.access_token !== "string" || typeof json.id_token !== "string") {
    throw new TokenExchangeError(provider.id, "response missing access_token or id_token", "rejected");
  }

  return {
    accessToken: json.access_token,
    idToken: json.id_token,
    tokenType: typeof json.token_type === "string" ? json.token_type : "Bearer",
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : 0,
  };
}

/**
 * Independent, supplementary consistency check against the provider's live
 * userinfo endpoint — used ALONGSIDE full ID-token verification
 * (verifyIdToken below), never as a replacement for it (§1's explicit
 * requirement). No longer a source of truth for `emailVerified` — that now
 * comes only from verified ID token claims.
 */
export async function fetchProviderUserInfo(
  provider: ProviderConfig,
  accessToken: string
): Promise<ProviderUserInfo> {
  let response: Response;
  try {
    response = await fetch(provider.userinfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  } catch (err) {
    throw new ProviderResponseMismatchError(`userinfo network error: ${(err as Error).message}`);
  }

  if (!response.ok) {
    throw new ProviderResponseMismatchError(`userinfo endpoint returned HTTP ${response.status}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  if (typeof json.sub !== "string") {
    throw new ProviderResponseMismatchError("userinfo response missing sub");
  }

  return {
    sub: json.sub,
    email: typeof json.email === "string" ? json.email : null,
    name: typeof json.name === "string" ? json.name : null,
    picture: typeof json.picture === "string" ? json.picture : null,
  };
}

// One long-lived JWKS resolver per provider, reused across requests within
// the same server process/function instance — createRemoteJWKSet's own
// internal caching is what makes this cheap; recreating it per-request
// would defeat that caching and hit the JWKS endpoint on every login.
const jwksResolvers = new Map<OAuthProviderId, ReturnType<typeof createRemoteJWKSet>>();

function getJwksResolver(provider: ProviderConfig): ReturnType<typeof createRemoteJWKSet> {
  let resolver = jwksResolvers.get(provider.id);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(provider.jwksUri));
    jwksResolvers.set(provider.id, resolver);
  }
  return resolver;
}

/**
 * Microsoft-specific post-signature-verification binding check (correction
 * pass §1, Gate 1). Deliberately NOT a general issuer-shape regex — this
 * documents real, current Microsoft Entra ID provider behavior: the
 * `organizations`/`common` discovery document's own `issuer` field is a
 * literal `{tenantid}` template (confirmed live against
 * https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration),
 * and Microsoft's own guidance is that an application must substitute the
 * token's own validated `tid` into that template and require an *exact*
 * match — not merely confirm the issuer merely *looks* tenant-shaped.
 * Requires, in order, after jose has already cryptographically verified
 * the signature, algorithm, audience, and expiry:
 *
 * 1. `tid` is present and is a well-formed GUID.
 * 2. `oid` is present and is a well-formed GUID.
 * 3. `iss` exactly equals `https://login.microsoftonline.com/${tid}/v2.0`
 *    — constructed from the token's OWN validated `tid`, then compared
 *    with `===`, never a pattern match against `iss` alone. A validly
 *    GUID-shaped issuer whose embedded tenant differs from the token's own
 *    `tid` claim is rejected here, even though a general regex would have
 *    accepted it.
 *
 * `tid` and `oid` are read only from `payload` — the cryptographically
 * verified JWT Claims Set — never from any query parameter, cookie,
 * userinfo response, or other client-controllable input.
 */
function assertMicrosoftTenantBinding(payload: JWTPayload): { tid: string; oid: string } {
  const { tid, oid, iss } = payload;

  if (typeof tid !== "string" || !GUID_PATTERN.test(tid)) {
    throw new ProviderResponseMismatchError("ID token tid claim is missing or malformed");
  }
  if (typeof oid !== "string" || !GUID_PATTERN.test(oid)) {
    throw new ProviderResponseMismatchError("ID token oid claim is missing or malformed");
  }

  const expectedIssuer = `https://login.microsoftonline.com/${tid}/v2.0`;
  if (iss !== expectedIssuer) {
    throw new ProviderResponseMismatchError("ID token issuer does not exactly bind to the token's own tid");
  }

  return { tid, oid };
}

/**
 * Full cryptographic OIDC ID-token validation (§1 correction) — JWKS
 * retrieval/rotation and JWT signature verification are handled entirely
 * by `jose`, never hand-rolled. Validates: signature, allowed algorithm
 * (RS256 only), audience, expiration, issued-at freshness (via
 * `maxTokenAge`, bounded to the same 10-minute window as the pre-auth
 * cookie itself). For Google, `issuer` is passed directly to jose as a
 * fixed expected string. For Microsoft, `issuer` is deliberately omitted
 * from jose's own check (jose only accepts a fixed string or array) and
 * instead bound exactly to the token's own `tid` claim immediately
 * afterward via `assertMicrosoftTenantBinding` — this is not a hand-rolled
 * substitute for cryptographic verification (the signature itself is still
 * fully verified via JWKS first), only for the one claim value jose's API
 * cannot express as a per-token-dependent pattern.
 *
 * Does NOT check `nonce` — that is the caller's responsibility
 * (callback.ts's `assertNonceMatches`), since it depends on per-request
 * state this function has no access to.
 */
export async function verifyIdToken(provider: ProviderConfig, idToken: string): Promise<VerifiedIdTokenClaims> {
  const jwks = getJwksResolver(provider);

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(idToken, jwks, {
      algorithms: ["RS256"],
      audience: provider.clientId,
      issuer: provider.expectedIssuer,
      maxTokenAge: "10 minutes",
      clockTolerance: 5,
    });
    payload = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new ProviderResponseMismatchError("ID token is expired");
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      throw new ProviderResponseMismatchError(`ID token claim validation failed: ${err.claim}`);
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new ProviderResponseMismatchError("ID token signature verification failed");
    }
    throw new ProviderResponseMismatchError(`ID token verification failed: ${(err as Error).message}`);
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new ProviderResponseMismatchError("ID token is missing a subject claim");
  }

  if (provider.id === "microsoft") {
    assertMicrosoftTenantBinding(payload);
  }

  return payload as VerifiedIdTokenClaims;
}
