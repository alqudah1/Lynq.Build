import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getSessionCookie } from "@/lib/auth/cookies";
import { requireAuthenticatedUser, type AuthenticatedUser } from "@/lib/authz/helpers";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Copied verbatim (in behavior) from platform/src/lib/http/auth.ts. Every
 * route calls this first, and only this, to learn who's asking — no
 * header, query parameter, or request body field is ever consulted for
 * identity.
 */
export async function getAuthenticatedUser(db: Db): Promise<AuthenticatedUser> {
  const token = await getSessionCookie();
  return requireAuthenticatedUser(db, token);
}
