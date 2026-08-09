import "server-only";
import { randomBytes, createHash } from "node:crypto";

/**
 * Invitation token model (Step 4C, approved): 32 cryptographically random
 * bytes, base64url-encoded — same shape and same justification as session
 * tokens (`@/lib/auth/session`'s `generateSessionToken`/`hashSessionToken`):
 * plain SHA-256 is safe here specifically because the input is 256 bits of
 * CSPRNG output, not a low-entropy secret, so a slow KDF buys nothing. Only
 * the hash is ever persisted (`invitations.token_hash`) — the raw token
 * exists only transiently, during invitation creation/refresh (to build the
 * email's accept URL) and is never logged, never returned from any HTTP
 * route, and never stored anywhere else, including the OAuth continuation
 * cookie (which carries only the hash — see `./continuation.ts`).
 */
export const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
