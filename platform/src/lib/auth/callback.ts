import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { ProviderConfig, OAuthProviderId, VerifiedIdTokenClaims } from "./providers";
import { exchangeAuthorizationCode, fetchProviderUserInfo, verifyIdToken } from "./providers";
import { OAuthStateMismatchError, ProviderResponseMismatchError, NonceMismatchError } from "./errors";

export interface ProviderIdentity {
  provider: OAuthProviderId;
  /**
   * The stable provider identifier — see `resolveProviderAccountId` below
   * for the exact, provider-specific format (correction pass §3).
   */
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
}

/**
 * Exact match only, against the value stored in the signed pre-auth cookie
 * — the §2 "OAuth state parameter CSRF" mitigation (Step 3 design §5 step 2).
 */
export function assertStateMatches(cookieState: string, queryState: string | null): void {
  if (!queryState || queryState !== cookieState) {
    throw new OAuthStateMismatchError();
  }
}

/**
 * Safe (constant-time) comparison of the expected nonce (from the signed
 * pre-auth cookie) against the ID token's own `nonce` claim (correction
 * pass §2). Never logs either value — callers must only ever record the
 * fact of a mismatch, never the values themselves.
 */
export function assertNonceMatches(expectedNonce: string, tokenNonce: unknown): void {
  if (typeof tokenNonce !== "string") {
    throw new NonceMismatchError();
  }
  const expectedBuf = Buffer.from(expectedNonce);
  const actualBuf = Buffer.from(tokenNonce);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new NonceMismatchError();
  }
}

/**
 * The stable provider identifier, per correction pass §3:
 *
 * - Google: the validated `sub` claim directly — Google's own stable,
 *   immutable per-application account identifier. Never the email.
 * - Microsoft: `{tid}.{oid}` — tenant ID plus object ID, both taken only
 *   from the cryptographically validated ID token, never from
 *   `email`/`preferred_username`/UPN, none of which are stable identities
 *   (a user's UPN or email can change; `oid` is immutable within a tenant,
 *   and qualifying it with `tid` guards against the rare cross-tenant-guest
 *   scenario where an `oid` could otherwise be ambiguous on its own).
 */
export function resolveProviderAccountId(provider: ProviderConfig, claims: VerifiedIdTokenClaims): string {
  if (provider.id === "google") {
    return claims.sub;
  }

  // providers.ts's verifyIdToken already validated (via
  // assertMicrosoftTenantBinding) that tid/oid are present, GUID-shaped,
  // and that `iss` was constructed exactly from this same `tid` — by the
  // time claims reach here they are guaranteed valid. This check is kept
  // as a second, harmless defense-in-depth layer, not the primary guard.
  const tid = claims.tid;
  const oid = claims.oid;
  if (typeof tid !== "string" || tid.length === 0 || typeof oid !== "string" || oid.length === 0) {
    throw new ProviderResponseMismatchError("Microsoft ID token is missing tid or oid claim");
  }
  return `${tid}.${oid}`;
}

/**
 * Whether the identity's email may be treated as verified, per correction
 * pass §3:
 *
 * - Google: only when the validated ID token's own `email_verified` claim
 *   is explicitly `true` — never assumed.
 * - Microsoft: always `false`. Standard Microsoft Entra ID v2.0 ID tokens
 *   carry no claim that gives a real assurance equivalent to Google's
 *   `email_verified` — `email`, `preferred_username`, and UPN are all
 *   organizationally-assigned but not a cryptographic verification
 *   assertion. Marking it verified without such a claim would be an
 *   unsupported assumption, and — critically — is exactly what the
 *   account-linking policy (account-linking.ts) depends on to decide
 *   whether an email may ever be used to match against an existing user:
 *   `emailVerified: false` here means a Microsoft identity is *never*
 *   auto-linked or auto-matched by email, satisfying that requirement
 *   directly through this one signal rather than a separate rule.
 */
function resolveEmailVerified(provider: ProviderConfig, claims: VerifiedIdTokenClaims): boolean {
  if (provider.id === "google") {
    return claims.email_verified === true;
  }
  return false;
}

/** Contact-only email value — never used as an identity signal for Microsoft (see resolveEmailVerified). */
function resolveContactEmail(provider: ProviderConfig, claims: VerifiedIdTokenClaims): string {
  if (typeof claims.email === "string" && claims.email.length > 0) {
    return claims.email;
  }
  if (provider.id === "microsoft" && typeof claims.preferred_username === "string") {
    return claims.preferred_username;
  }
  throw new ProviderResponseMismatchError("ID token has no usable email or username claim for contact info");
}

/**
 * Exchanges the authorization code, cryptographically verifies the ID
 * token (JWKS signature, algorithm, audience, issuer, expiry — via
 * providers.ts's `verifyIdToken`), verifies the nonce, and independently
 * cross-checks the result against the provider's live userinfo endpoint —
 * a supplementary consistency check, never a replacement for the
 * cryptographic verification above (§1 correction). Any failure throws —
 * never a partial or best-effort identity.
 */
export async function resolveProviderIdentity(
  provider: ProviderConfig,
  params: { code: string; codeVerifier: string; nonce: string }
): Promise<ProviderIdentity> {
  const tokens = await exchangeAuthorizationCode(provider, params);
  const claims = await verifyIdToken(provider, tokens.idToken);

  assertNonceMatches(params.nonce, claims.nonce);

  const userInfo = await fetchProviderUserInfo(provider, tokens.accessToken);
  if (userInfo.sub !== claims.sub) {
    throw new ProviderResponseMismatchError("ID token subject does not match the userinfo endpoint response");
  }

  return {
    provider: provider.id,
    providerAccountId: resolveProviderAccountId(provider, claims),
    email: resolveContactEmail(provider, claims),
    emailVerified: resolveEmailVerified(provider, claims),
    name: typeof claims.name === "string" ? claims.name : userInfo.name,
    image: typeof claims.picture === "string" ? claims.picture : userInfo.picture,
  };
}
