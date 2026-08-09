import "server-only";
import { cookies } from "next/headers";

/**
 * `__Host-` prefix enforces (browser-side, unconditionally): `Secure`,
 * `Path=/`, and no `Domain` attribute — never pass a `domain` option below,
 * or the browser silently refuses to set the cookie at all (Module 2 §5,
 * §17 item 11).
 */
export const SESSION_COOKIE_NAME = "__Host-lynq_session";

export async function setSessionCookie(rawToken: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
