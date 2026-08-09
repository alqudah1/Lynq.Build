import "server-only";
import { createHmac } from "node:crypto";
import type { RateLimiter, RateLimitConfig } from "@/lib/rate-limit/types";
import { InvitationRateLimitedError } from "./errors";

/**
 * Confirmed starting limits from Module 2 §11 ("Invitation creation: 20/hr,
 * organization"; "Invitation acceptance attempt: small fixed cap, IP"),
 * extended per Step 4C's instruction to key creation by BOTH organization
 * and actor, and to key exchange/lookup/acceptance by BOTH IP and a
 * token-derived identifier.
 */
export const INVITATION_CREATE_RATE_LIMIT: RateLimitConfig = { limit: 20, windowSeconds: 3600 };
export const INVITATION_ACCEPT_RATE_LIMIT: RateLimitConfig = { limit: 20, windowSeconds: 900 };

export function invitationCreateRateLimitKey(organizationId: string, actorUserId: string): string {
  return `invitation:create:org:${organizationId}:actor:${actorUserId}`;
}

/**
 * A rate-limit key must never be built from the raw token or its plain
 * SHA-256 hash directly (Step 4C.1 hardening pass requirement) — that hash
 * IS the database lookup key (`invitations.token_hash`) and is itself
 * treated as sensitive bearer-equivalent material; reusing it verbatim as a
 * rate-limit-table key would put a second, differently-access-controlled
 * copy of it at rest. This derives a SEPARATE, one-way identifier via
 * HMAC-SHA256 with an explicit domain-separation label, reusing
 * `AUTH_SECRET` deliberately rather than provisioning a third env var — the
 * label is exactly what keeps this "cryptographic responsibility"
 * explicitly separated from the pre-auth-cookie-signing and
 * continuation-cookie-signing uses of the same secret (HKDF-style domain
 * separation: same key material, different derived output per labeled
 * purpose, never reused verbatim across purposes).
 */
export function deriveRateLimitIdentifier(value: string, secret: string): string {
  return createHmac("sha256", secret).update("invitation-rate-limit:" + value).digest("hex");
}

export function invitationExchangeIpKey(ip: string): string {
  return `invitation:exchange:ip:${ip}`;
}

export function invitationExchangeTokenKey(derivedId: string): string {
  return `invitation:exchange:token:${derivedId}`;
}

/**
 * Lookup (`GET /api/invitations/current`) and acceptance
 * (`POST /api/invitations/current/accept`) are distinct rate-limited
 * actions with their own key namespaces — never shared — matching the
 * requirements' own framing ("continuation-cookie lookup AND acceptance")
 * and avoiding any possibility of one endpoint's traffic exhausting the
 * other's budget.
 */
export function invitationCurrentLookupIpKey(ip: string): string {
  return `invitation:current-lookup:ip:${ip}`;
}

export function invitationCurrentLookupTokenKey(derivedId: string): string {
  return `invitation:current-lookup:token:${derivedId}`;
}

export function invitationCurrentAcceptIpKey(ip: string): string {
  return `invitation:current-accept:ip:${ip}`;
}

export function invitationCurrentAcceptTokenKey(derivedId: string): string {
  return `invitation:current-accept:token:${derivedId}`;
}

/**
 * Enforces a rate limit and fails CLOSED if the backend itself is
 * unreachable (Step 4C: "Fail closed for acceptance if the rate-limit
 * backend is unavailable" — applied here to every invitation rate-limit
 * check, not only acceptance, consistent with Module 2 §11's general
 * default posture of fail-closed unless a specific endpoint has earned an
 * explicit fail-open exception, which none of these have). Throws
 * `InvitationRateLimitedError` (429) on either an exceeded limit or a
 * backend failure — the caller cannot tell the two apart from the response,
 * which is the correct fail-closed behavior.
 */
export async function enforceRateLimit(limiter: RateLimiter, key: string, config: RateLimitConfig): Promise<void> {
  let result;
  try {
    result = await limiter.recordAttempt(key, config);
  } catch {
    throw new InvitationRateLimitedError();
  }
  if (!result.allowed) {
    throw new InvitationRateLimitedError();
  }
}
