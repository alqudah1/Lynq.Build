import "server-only";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";
import { SocialOAuthStateError } from "../errors";

/**
 * Module 19 — signed, single-use, 10-minute cookie carrying a social
 * connection attempt (Meta / LinkedIn / Google Ads) from `/start` to
 * `/callback`. Modeled on the sign-in flow's `src/lib/auth/state.ts`, but
 * scoped to its own path (`/api/social/oauth`) and bound to the
 * organization, brand and actor that started it, so a callback can never
 * attach a grant to a different tenant or user.
 */
export const SOCIAL_OAUTH_COOKIE_NAME = "lynq_social_oauth";
export const SOCIAL_OAUTH_COOKIE_PATH = "/api/social/oauth";
export const SOCIAL_OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

const safeAppPath = z
  .string()
  .min(1)
  .max(2000)
  .refine((v) => v.startsWith("/") && !v.startsWith("//") && !v.includes("://") && !v.includes("\\"), "must be an app-relative path");

export const socialOAuthPayloadSchema = z
  .object({
    provider: z.enum(["meta", "linkedin", "google_ads"]),
    state: z.string().min(16).max(200),
    codeVerifier: z.string().min(1).max(200).optional(),
    organizationId: z.string().uuid(),
    brandProfileId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    redirectTo: safeAppPath,
    expiresAt: z.number(),
  })
  .strict();

export type SocialOAuthPayload = z.infer<typeof socialOAuthPayloadSchema>;
export type NewSocialOAuthPayload = Omit<SocialOAuthPayload, "expiresAt">;

export class SocialOAuthCookieInvalidError extends SocialOAuthStateError {
  readonly detail: string;
  constructor(detail: string) {
    super("the connection attempt could not be verified — start again");
    this.name = "SocialOAuthCookieInvalidError";
    this.detail = detail;
  }
}

/** 32 random bytes, base64url — the OAuth `state` parameter. */
export function generateState(): string {
  return randomBytes(32).toString("base64url");
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", `social-oauth:${secret}`).update(payloadB64).digest("base64url");
}

export function signSocialOAuthPayload(payload: SocialOAuthPayload, secret: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Verifies signature → schema → expiry. Every failure is a `SocialOAuthCookieInvalidError`. */
export function verifySocialOAuthPayload(cookieValue: string, secret: string, now: number = Date.now()): SocialOAuthPayload {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) throw new SocialOAuthCookieInvalidError("malformed cookie value");
  const [payloadB64, signature] = parts;
  const expected = Buffer.from(sign(payloadB64, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new SocialOAuthCookieInvalidError("signature mismatch");
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new SocialOAuthCookieInvalidError("malformed payload JSON");
  }
  const parsed = socialOAuthPayloadSchema.safeParse(json);
  if (!parsed.success) throw new SocialOAuthCookieInvalidError("payload failed schema validation");
  if (parsed.data.expiresAt <= now) throw new SocialOAuthCookieInvalidError("expired");
  return parsed.data;
}

function cookieIsSecure(authBaseUrl: string | undefined): boolean {
  return !(authBaseUrl ?? "").startsWith("http://localhost") && !(authBaseUrl ?? "").startsWith("http://127.0.0.1");
}

export async function setSocialOAuthCookie(payload: NewSocialOAuthPayload, secret: string, authBaseUrl?: string): Promise<void> {
  const full: SocialOAuthPayload = { ...payload, expiresAt: Date.now() + SOCIAL_OAUTH_COOKIE_MAX_AGE_SECONDS * 1000 };
  const value = signSocialOAuthPayload(socialOAuthPayloadSchema.parse(full), secret);
  const store = await cookies();
  store.set(SOCIAL_OAUTH_COOKIE_NAME, value, { httpOnly: true, secure: cookieIsSecure(authBaseUrl), sameSite: "lax", path: SOCIAL_OAUTH_COOKIE_PATH, maxAge: SOCIAL_OAUTH_COOKIE_MAX_AGE_SECONDS });
}

/** Reads and immediately clears the cookie — single use whether the flow succeeds or not. */
export async function readAndClearSocialOAuthCookie(secret: string): Promise<SocialOAuthPayload> {
  const store = await cookies();
  const raw = store.get(SOCIAL_OAUTH_COOKIE_NAME)?.value;
  store.set(SOCIAL_OAUTH_COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", path: SOCIAL_OAUTH_COOKIE_PATH, maxAge: 0 });
  if (!raw) throw new SocialOAuthCookieInvalidError("missing");
  return verifySocialOAuthPayload(raw, secret);
}
