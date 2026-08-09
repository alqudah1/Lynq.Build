import "server-only";
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";
import { PreAuthCookieInvalidError } from "./errors";

/**
 * OAuth state and PKCE storage strategy (Step 3 design §7): cookies, not the
 * database. `state` and `codeVerifier` are single-use, short-lived, and
 * meaningful only to the one browser that initiated the flow. `HttpOnly`
 * already blocks both JS reads and writes; the HMAC signature below is
 * defense-in-depth so tampering is detected explicitly rather than failing
 * in some less obvious way.
 */
export const PRE_AUTH_COOKIE_NAME = "lynq_oauth_pending";
export const PRE_AUTH_COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes

const preAuthPayloadSchema = z.object({
  provider: z.enum(["google", "microsoft"]),
  state: z.string().min(1),
  codeVerifier: z.string().min(1),
  // A fresh, cryptographically random value per attempt, sent as the OIDC
  // `nonce` authorization parameter and required to appear, unmodified, in
  // the ID token's own `nonce` claim — binds the ID token to this specific
  // authorization request, distinct from `state` (which binds the callback
  // to this browser/CSRF-wise) and from PKCE (which binds the code
  // exchange to this client) — correction pass §2.
  nonce: z.string().min(1),
  // "login": the anonymous /api/auth/[provider] entry point.
  // "link": the authenticated /api/auth/link/[provider] entry point — only
  // this value, combined with a matching current session, authorizes the
  // account-linking branch (Step 3 design §6).
  intent: z.enum(["login", "link"]),
  linkUserId: z.string().optional(),
  redirectTo: z.string(),
  expiresAt: z.number(),
  /**
   * Invitation-continuation binding (Step 4C hardening pass): present only
   * when this specific OAuth attempt was started to complete an invitation
   * acceptance for a not-yet-authenticated user. Carrying it INSIDE this
   * already state/nonce-protected payload — rather than relying solely on
   * the separately-plantable standalone continuation cookie — is what
   * "binds the continuation context to the intended OAuth flow": an
   * attacker cannot forge a valid pre-auth cookie (it must both be signed
   * with AUTH_SECRET and have its `state` match what Google/Microsoft
   * redirect back with), so this value can only reach the callback as part
   * of a genuine, CSRF-protected OAuth round trip that was explicitly
   * started with it present. Only ever the token HASH, never the raw
   * token — see `@/lib/invitations/continuation` for why.
   */
  invitationTokenHash: z.string().min(1).optional(),
});

export type PreAuthPayload = z.infer<typeof preAuthPayloadSchema>;
export type NewPreAuthPayload = Omit<PreAuthPayload, "expiresAt">;

/** 32 random bytes, base64url-encoded — used for the OAuth `state` parameter. */
export function generateState(): string {
  return randomBytes(32).toString("base64url");
}

/** 32 random bytes, base64url-encoded — the PKCE code verifier (RFC 7636). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** 32 random bytes, base64url-encoded — a fresh OIDC nonce for a single authorization attempt. */
export function generateNonce(): string {
  return randomBytes(32).toString("base64url");
}

/** RFC 7636 S256 code challenge: base64url(sha256(codeVerifier)). */
export function createS256CodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/** Signs the payload with HMAC-SHA256 using AUTH_SECRET, producing the cookie's value. */
export function signPreAuthPayload(payload: PreAuthPayload, secret: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verifies signature, schema, and expiry — in that order — throwing
 * PreAuthCookieInvalidError on any failure. Never throws a different error
 * type, so callers can treat every failure mode identically (Step 3 design
 * §5 step 1).
 */
export function verifyPreAuthPayload(cookieValue: string, secret: string): PreAuthPayload {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) {
    throw new PreAuthCookieInvalidError("malformed cookie value");
  }
  const [payloadB64, signature] = parts;

  const expectedSignature = sign(payloadB64, secret);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    throw new PreAuthCookieInvalidError("signature mismatch");
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new PreAuthCookieInvalidError("malformed payload JSON");
  }

  const parsed = preAuthPayloadSchema.safeParse(json);
  if (!parsed.success) {
    throw new PreAuthCookieInvalidError("payload failed schema validation");
  }

  if (parsed.data.expiresAt <= Date.now()) {
    throw new PreAuthCookieInvalidError("expired");
  }

  return parsed.data;
}

export async function setPreAuthCookie(payload: NewPreAuthPayload, secret: string): Promise<void> {
  const fullPayload: PreAuthPayload = {
    ...payload,
    expiresAt: Date.now() + PRE_AUTH_COOKIE_MAX_AGE_SECONDS * 1000,
  };
  const value = signPreAuthPayload(fullPayload, secret);
  const store = await cookies();
  store.set(PRE_AUTH_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: PRE_AUTH_COOKIE_MAX_AGE_SECONDS,
  });
}

/**
 * Reads and immediately clears the pre-auth cookie — single-use, whether
 * the flow ultimately succeeds or fails (Step 3 design §5 step 6, §7).
 */
export async function readAndClearPreAuthCookie(secret: string): Promise<PreAuthPayload> {
  const store = await cookies();
  const raw = store.get(PRE_AUTH_COOKIE_NAME)?.value;
  store.delete(PRE_AUTH_COOKIE_NAME);

  if (!raw) {
    throw new PreAuthCookieInvalidError("missing");
  }

  return verifyPreAuthPayload(raw, secret);
}
