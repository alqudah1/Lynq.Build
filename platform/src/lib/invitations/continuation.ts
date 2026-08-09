import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";

/**
 * The "safe continuation mechanism" for a new (not-yet-authenticated) user
 * accepting an invitation (Step 4C, hardened in the Step 4C.1 pass): since
 * no temporary user is ever created and OAuth is never bypassed, the
 * invited person must complete a real Google/Microsoft sign-in first. This
 * cookie is what survives that round trip — signed (HMAC-SHA256 with
 * `AUTH_SECRET`, same construction as `@/lib/auth/state`'s pre-auth cookie),
 * HttpOnly, Secure, SameSite=Lax, and short-lived (10 minutes).
 *
 * Deliberately carries ONLY the invitation's token HASH, never the raw
 * token — the raw token must exist only during invitation creation, email
 * rendering, and the single raw-token exchange request (see
 * `src/app/invite/[rawToken]/route.ts`); this cookie is one more storage
 * and transmission channel that invariant must not be relaxed for. Treat
 * the hash itself as sensitive bearer-equivalent material too (hardening
 * pass requirement): never logged, never returned in any HTTP response,
 * never included in audit metadata — it is read only by this module and by
 * the domain functions it's handed to directly.
 *
 * Binding to a specific OAuth attempt does NOT happen through this cookie
 * alone — see `@/lib/auth/state`'s `invitationTokenHash` field, folded into
 * the state/nonce-protected pre-auth cookie by the login-initiation route.
 * This standalone cookie's remaining job, once an OAuth attempt is
 * underway, is only to survive a *transient* acceptance failure so the
 * now-authenticated user can retry via `POST /api/invitations/current/accept`
 * directly, without a second OAuth round trip.
 */
export const INVITATION_CONTINUATION_COOKIE_NAME = "lynq_invitation_continuation";
export const INVITATION_CONTINUATION_MAX_AGE_SECONDS = 600; // 10 minutes

const continuationPayloadSchema = z.object({
  invitationTokenHash: z.string().min(1),
  expiresAt: z.number(),
});

type ContinuationPayload = z.infer<typeof continuationPayloadSchema>;

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function signPayload(payload: ContinuationPayload, secret: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Returns `null` on ANY problem (missing, malformed, tampered, expired) — this mechanism is best-effort by design; a broken continuation must never block or corrupt an otherwise-successful login, and must never be partially trusted. */
function verifyPayload(cookieValue: string, secret: string): ContinuationPayload | null {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expectedSignature = sign(payloadB64, secret);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const parsed = continuationPayloadSchema.safeParse(json);
  if (!parsed.success) return null;
  if (parsed.data.expiresAt <= Date.now()) return null;

  return parsed.data;
}

/**
 * Reads only `AUTH_SECRET`, independent of the full OAuth environment
 * schema (`@/lib/auth/env`'s `loadAuthEnv`, which additionally requires
 * Google/Microsoft client credentials that have nothing to do with signing
 * this cookie). Keeps every invitation route from requiring full,
 * currently-unconfigured OAuth credentials just to exercise its own
 * cookie-signing logic.
 */
export function loadInvitationContinuationSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is not configured");
  }
  return secret;
}

/** Set once, by the single raw-token exchange endpoint, after it has validated the raw token. Never called anywhere else. */
export async function setInvitationContinuationCookie(invitationTokenHash: string, secret: string): Promise<void> {
  const payload: ContinuationPayload = {
    invitationTokenHash,
    expiresAt: Date.now() + INVITATION_CONTINUATION_MAX_AGE_SECONDS * 1000,
  };
  const value = signPayload(payload, secret);
  const store = await cookies();
  store.set(INVITATION_CONTINUATION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: INVITATION_CONTINUATION_MAX_AGE_SECONDS,
  });
}

/**
 * Read-only — does NOT clear the cookie. Used by `GET /api/invitations/current`
 * (a preview shouldn't destroy the context a subsequent accept call needs)
 * and by the login-initiation route (to decide whether to fold this
 * invitation's hash into a fresh, state/nonce-protected pre-auth cookie).
 * Returns `null` for anything not currently usable (absent, tampered,
 * expired) — never partially trusts a malformed value.
 */
export async function readInvitationContinuationCookie(secret: string): Promise<{ invitationTokenHash: string } | null> {
  const store = await cookies();
  const raw = store.get(INVITATION_CONTINUATION_COOKIE_NAME)?.value;
  if (!raw) return null;
  const payload = verifyPayload(raw, secret);
  return payload ? { invitationTokenHash: payload.invitationTokenHash } : null;
}

/**
 * Explicit clear — called after a successful acceptance, after a *terminal*
 * failure (expired/revoked/already-used/email-mismatch, none of which can
 * ever succeed on retry), and once its value has been folded into a fresh
 * pre-auth cookie at OAuth-login-initiation time (its job for that flow is
 * done; the pre-auth cookie now carries the binding). Deliberately NOT
 * called after a *transient* failure (an unexpected error, or a rate-limit
 * backend outage) — the continuation context must survive that so the
 * now-authenticated user can retry via `POST /api/invitations/current/accept`.
 */
export async function clearInvitationContinuationCookie(): Promise<void> {
  const store = await cookies();
  store.delete(INVITATION_CONTINUATION_COOKIE_NAME);
}
