import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getSessionCookie } from "@/lib/auth/cookies";
import { requireAuthenticatedUser, type AuthenticatedUser } from "@/lib/authz/helpers";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Every Step 4B route calls this first, and only this, to learn who's
 * asking — the session cookie is read via Step 3's own `getSessionCookie`
 * and verified via Step 4A's own unmodified `requireAuthenticatedUser`.
 * There is no other source: no header, no query parameter, no request
 * body field is ever consulted for identity (Step 4A's standing rule,
 * unchanged here).
 */
export async function getAuthenticatedUser(db: Db): Promise<AuthenticatedUser> {
  const token = await getSessionCookie();
  return requireAuthenticatedUser(db, token);
}
