import "server-only";
import { cookies } from "next/headers";
import { verifySession, ADMIN_COOKIE } from "./admin-session";

/**
 * Order-management access.
 *
 * Rand needs to see and work her orders; the alternative today is reading raw
 * Supabase rows. This is the smallest boundary that is actually safe:
 *
 *  · the passphrase lives ONLY in ARCUBED_ADMIN_PASSPHRASE on the server and
 *    is never sent to the browser, never inlined into client JavaScript, and
 *    never compared with a short-circuiting `===`
 *  · what the browser holds is an HMAC-signed, httpOnly, sameSite=lax cookie
 *    that contains no secret and cannot be forged without the server key
 *  · every admin page is a Server Component, so the service-role Supabase
 *    client stays on the server exactly as it does everywhere else
 *  · src/proxy.ts refuses /admin/* outright when no valid session is present,
 *    so an unauthenticated request never reaches a render
 *
 * This is a shared passphrase, not per-user accounts. It is a deliberate
 * scope choice, and the next step is written down in
 * docs/order-management.md rather than implied.
 */
export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value);
}

export { issueSession, verifySession, adminConfigured, ADMIN_COOKIE, ADMIN_MAX_AGE } from "./admin-session";
