/**
 * Typed errors for the OAuth/session flow (Step 3 design §5, §6). Each
 * carries a stable machine-readable `reason`, used both by callers deciding
 * what to do and by audit-event metadata (src/lib/auth/audit.ts) — never by
 * anything shown directly to the end user, which is always a single,
 * deliberately generic message regardless of which of these was thrown.
 */

export abstract class AuthFlowError extends Error {
  abstract readonly reason: string;
}

/** The pre-auth OAuth state/PKCE cookie was missing, expired, or failed signature verification. */
export class PreAuthCookieInvalidError extends AuthFlowError {
  readonly reason = "state_cookie_invalid";
  constructor(detail: string) {
    super(`Pre-auth cookie invalid: ${detail}`);
    this.name = "PreAuthCookieInvalidError";
  }
}

/** The `state` query parameter on the callback did not match the value stored in the pre-auth cookie. */
export class OAuthStateMismatchError extends AuthFlowError {
  readonly reason = "state_mismatch";
  constructor() {
    super("OAuth state parameter mismatch");
    this.name = "OAuthStateMismatchError";
  }
}

/**
 * The provider rejected the authorization-code exchange, or could not be
 * reached at all. `classification` distinguishes the two for audit-taxonomy
 * purposes (Module 2 §19 correction, §8 of this pass): "unavailable" means
 * a network failure or 5xx from the provider itself — audited as
 * `oauth_provider_unavailable`, never conflated with an actively invalid or
 * suspicious request ("rejected" — a 4xx, or a structurally invalid
 * response — audited as `oauth_login_failure`).
 */
export class TokenExchangeError extends AuthFlowError {
  readonly reason = "token_exchange_failed";
  constructor(
    provider: string,
    detail: string,
    public readonly classification: "unavailable" | "rejected" = "rejected"
  ) {
    super(`Token exchange failed for provider "${provider}": ${detail}`);
    this.name = "TokenExchangeError";
  }
}

/**
 * The decoded ID token's claims (aud/iss/exp) failed validation, or the
 * identity independently reported by the provider's userinfo endpoint did
 * not match the ID token — treated as a forgery/tampering signal (Step 3
 * design §5 step 5, §6 "Protection against account-linking attacks").
 */
export class ProviderResponseMismatchError extends AuthFlowError {
  readonly reason = "identity_mismatch";
  constructor(detail: string) {
    super(`Provider identity verification failed: ${detail}`);
    this.name = "ProviderResponseMismatchError";
  }
}

/**
 * An unauthenticated login attempt's verified email matched an existing
 * user via a different provider than the one used today. Never resolved
 * automatically — requires the human-safe resolution path (Step 3 design
 * §6): sign in with the original method, then explicitly link.
 */
export class IdentityConflictError extends AuthFlowError {
  readonly reason = "identity_conflict";
  constructor(public readonly matchedUserId: string) {
    super("Verified email matches an existing account via a different provider");
    this.name = "IdentityConflictError";
  }
}

/** A rate limit (§11) was exceeded for the relevant key. */
export class RateLimitExceededError extends AuthFlowError {
  readonly reason = "rate_limited";
  constructor(public readonly resetAt: Date) {
    super("Rate limit exceeded");
    this.name = "RateLimitExceededError";
  }
}

/**
 * The ID token's `nonce` claim was missing or did not match the value
 * generated for this specific authorization attempt (correction pass §2).
 * The nonce VALUE itself is never included in this error's message or in
 * any audit metadata derived from it — only the fact of a mismatch.
 */
export class NonceMismatchError extends AuthFlowError {
  readonly reason = "nonce_mismatch";
  constructor() {
    super("OAuth nonce mismatch");
    this.name = "NonceMismatchError";
  }
}
