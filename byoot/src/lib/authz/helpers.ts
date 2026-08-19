import "server-only";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { users } from "@/db/schema";
import { validateSessionToken } from "@/lib/auth/session";
import { UnauthenticatedError, TenantResourceNotFoundError, BonaFideConsumerRequiredError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
}

/**
 * Copied verbatim (in behavior) from platform/src/lib/authz/helpers.ts's
 * `requireAuthenticatedUser`: identity always comes from a validated
 * database session — never a client-supplied header, cookie payload field,
 * query parameter, or request body value.
 */
export async function requireAuthenticatedUser(db: Db, sessionToken: string | null): Promise<AuthenticatedUser> {
  if (!sessionToken) {
    throw new UnauthenticatedError();
  }
  const session = await validateSessionToken(db, sessionToken);
  if (!session) {
    throw new UnauthenticatedError();
  }
  return { userId: session.userId, sessionId: session.id };
}

/**
 * Generic "fetch or report not found" helper, copied verbatim from
 * platform/'s requireTenantScopedResource. `queryFn` must already scope its
 * own WHERE clause appropriately before calling this — this helper only
 * turns "no matching row" into one consistent error.
 */
export async function requireTenantScopedResource<T>(queryFn: () => Promise<T | undefined | null>): Promise<T> {
  const row = await queryFn();
  if (!row) {
    throw new TenantResourceNotFoundError();
  }
  return row;
}

export interface BonaFideConsumer {
  userId: string;
  sessionId: string;
  bonaFideConsumerAckAt: Date;
}

/**
 * BYOOT-specific — the one authz helper platform/ has no equivalent of,
 * because platform/ has no VOW-gate concept. This is deliberately the ONLY
 * function in this codebase that resolves whether a user may see VOW-tier
 * data; src/lib/listings/vow-gate.ts's getVowData() is the only caller.
 *
 * Checks authentication first (reusing requireAuthenticatedUser unmodified
 * above), then loads the user's own `bonaFideConsumerAckAt` from the same
 * verified session's userId — never from a client-supplied field. Throws
 * BonaFideConsumerRequiredError, not TenantResourceNotFoundError, when the
 * ack is missing: this is a real, known state (an authenticated user who
 * simply hasn't acknowledged yet), not a resource-existence question, so it
 * gets its own explicit error rather than being disguised as a 404.
 */
export async function requireBonaFideConsumer(db: Db, sessionToken: string | null): Promise<BonaFideConsumer> {
  const authed = await requireAuthenticatedUser(db, sessionToken);

  const [row] = await db
    .select({ bonaFideConsumerAckAt: users.bonaFideConsumerAckAt })
    .from(users)
    .where(eq(users.id, authed.userId));

  if (!row || !row.bonaFideConsumerAckAt) {
    throw new BonaFideConsumerRequiredError();
  }

  return { ...authed, bonaFideConsumerAckAt: row.bonaFideConsumerAckAt };
}
