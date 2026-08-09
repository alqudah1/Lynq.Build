import "server-only";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { users } from "@/db/schema";
import { getSessionCookie } from "@/lib/auth/cookies";
import { validateSessionToken } from "@/lib/auth/session";
import { resolveSafeRedirectTarget } from "@/lib/auth/redirects";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const SIGN_IN_REQUIRED_PATH = "/sign-in-required";

/** The only display-safe fields a dashboard route needs about the current user — never the session token, its hash, or any other row. */
export interface DashboardUser {
  userId: string;
  email: string;
  name: string | null;
}

/**
 * Builds the sign-in-required redirect target, re-validating `returnTo`
 * against the existing internal-relative-only allow-list
 * (`resolveSafeRedirectTarget`, Step 3) regardless of where the caller got
 * it from — a route param, a query string, anything. This is what makes
 * "invalid return path cannot create an open redirect" true regardless of
 * the call site.
 */
export function buildSignInRequiredUrl(returnTo?: string | null): string {
  const safeReturnTo = resolveSafeRedirectTarget(returnTo, "/app");
  return `${SIGN_IN_REQUIRED_PATH}?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

/**
 * The reusable server-side dashboard guard (Step 5A). Every protected
 * layout/page calls this itself, independently — never relies on a parent
 * layout having already checked, matching this project's standing
 * "never chain trust, always re-verify at the point of use" discipline
 * (the same principle behind Step 4A's tenant-scoped queries and Step 4C's
 * per-route rate limiting).
 *
 * Reads the `__Host-lynq_session` cookie via the existing `getSessionCookie`
 * and validates it through the existing, unmodified `validateSessionToken`
 * — the exact same primitives a real OAuth-issued session goes through.
 * No bypass, no test-only mode: this function cannot distinguish a session
 * created via `createSession` (as tests do, per Step 4A's established
 * pattern) from one created by a real OAuth login — the validation path is
 * identical either way.
 *
 * Redirects (never throws a catchable error to the caller — `redirect()`
 * itself throws a Next.js-internal signal that halts rendering) to the
 * sign-in-required page when: no cookie is present, the cookie fails to
 * validate (expired, revoked, tampered — `validateSessionToken` already
 * treats all three identically), or — defensively — the session's own user
 * row is somehow missing.
 */
export async function requireDashboardUser(db: Db, currentPath?: string | null): Promise<DashboardUser> {
  const token = await getSessionCookie();
  const session = token ? await validateSessionToken(db, token) : null;

  if (!session) {
    redirect(buildSignInRequiredUrl(currentPath));
  }

  const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, session.userId));
  if (!user) {
    redirect(buildSignInRequiredUrl(currentPath));
  }

  return { userId: session.userId, email: user.email, name: user.name };
}
