/**
 * Session signing and verification, with no Next.js request context.
 *
 * Kept separate from admin-auth.ts on purpose: src/proxy.ts has to verify a
 * session before any render, and it cannot import a module marked
 * `server-only` that also pulls in next/headers. This file is pure crypto over
 * a string, so both the proxy and the Server Components can use it.
 */
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const COOKIE = "arcubed_admin";
const MAX_AGE = 60 * 60 * 12;

function secret(): string | null {
  return process.env.ARCUBED_ADMIN_PASSPHRASE || null;
}

/** Configured at all? Used to show a clear message instead of a dead login. */
export function adminConfigured(): boolean {
  return Boolean(secret());
}

function sign(issuedAt: string): string {
  return createHmac("sha256", secret() ?? "").update(issuedAt).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Length is compared separately because timingSafeEqual throws on a mismatch;
  // the random fallback keeps the comparison itself constant time.
  if (ab.length !== bb.length) {
    timingSafeEqual(randomBytes(32), randomBytes(32));
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Value for the session cookie, or null when the passphrase is wrong. */
export function issueSession(passphrase: string): string | null {
  const s = secret();
  if (!s) return null;
  if (!safeEqual(passphrase, s)) return null;
  const issuedAt = String(Date.now());
  return `${issuedAt}.${sign(issuedAt)}`;
}

export function verifySession(value: string | undefined | null): boolean {
  if (!value || !secret()) return false;
  const [issuedAt, mac] = value.split(".");
  if (!issuedAt || !mac) return false;
  if (!safeEqual(mac, sign(issuedAt))) return false;
  const age = (Date.now() - Number(issuedAt)) / 1000;
  return Number.isFinite(age) && age >= 0 && age < MAX_AGE;
}


export const ADMIN_COOKIE = COOKIE;
export const ADMIN_MAX_AGE = MAX_AGE;
