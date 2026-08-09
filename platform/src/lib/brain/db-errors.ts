const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * True if `err` is (or wraps) a Postgres unique-constraint violation
 * (`23505`) — the final concurrency/duplicate guard this module relies on
 * in several places (Brain Module 2's version-number uniqueness, Brain
 * Module 3's active-relationship uniqueness). Checks both error shapes
 * this codebase's two different DB call styles actually produce:
 *
 * - `rawSql\`...\`` (the raw `@neondatabase/serverless` tagged-template
 *   client, e.g. `organizations.ts`'s `createOrganization`) throws the
 *   Postgres error directly, with `.code` at the top level.
 * - `db.insert(...)` / `db.execute(...)` (Drizzle's query builder) wraps
 *   it in a `DrizzleQueryError`, with the real Postgres error nested at
 *   `.cause.code` instead.
 *
 * Originally two separate, narrower copies of this check existed in
 * `knowledge-items.ts` (Module 2) and this module's own first draft, each
 * checking only `err.code` — correct for the raw-client shape, but silently
 * never matching the wrapped `db.insert()`/`db.execute()` shape. Discovered
 * here because Module 3's `createRelationship` has no application-level
 * pre-check before its insert (unlike Module 2's update path, which usually
 * short-circuits via its own `expectedVersionNumber` check first, masking
 * the same latent gap in all but a genuine race). Factored into this one
 * shared helper — used by both modules — rather than fixing it twice.
 */
export function isPostgresUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ("code" in err && err.code === POSTGRES_UNIQUE_VIOLATION) return true;
  if ("cause" in err && typeof err.cause === "object" && err.cause !== null && "code" in err.cause && err.cause.code === POSTGRES_UNIQUE_VIOLATION) {
    return true;
  }
  return false;
}
