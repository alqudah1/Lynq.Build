import "server-only";
import { z } from "zod";

/**
 * Server-only environment validation. Pattern copied from
 * platform/src/lib/env.ts — validation exposed as a function, not run at
 * import time, so callers control what (if anything) a client ever sees on
 * failure.
 */

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_URL_UNPOOLED: z.string().min(1, "DATABASE_URL_UNPOOLED is required"),
  // Distinct Postgres ROLE from DATABASE_URL, same pooled Neon endpoint —
  // see docs/adr/0001-vow-tier-isolation.md and src/db/client.ts's
  // createVowReaderDbClient(). Pooled, not DATABASE_URL_UNPOOLED: this
  // connection is read at request time from getVowData(), the same usage
  // pattern as DATABASE_URL, not the migration-only, long-lived,
  // low-concurrency usage DATABASE_URL_UNPOOLED exists for. Optional at
  // the env level so the rest of the app boots without it; getVowData()
  // itself throws a clear, specific error if it's missing when actually
  // needed, rather than the whole app failing to start over one gated
  // feature.
  DATABASE_URL_VOW_READER: z.string().min(1).optional(),
  // TRREB/PropTx credentials — read only by the sync stub
  // (src/lib/sync/trebb-sync.ts), which makes no live calls yet. Optional
  // for the same reason: nothing else in the app depends on them existing.
  TREBB_API_TOKEN: z.string().min(1).optional(),
  TREBB_VOW_TOKEN: z.string().min(1).optional(),
  TREBB_BASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  public readonly missingOrInvalidKeys: string[];

  constructor(missingOrInvalidKeys: string[]) {
    super(`Server misconfiguration: missing or invalid environment variables (${missingOrInvalidKeys.join(", ")}).`);
    this.name = "EnvValidationError";
    this.missingOrInvalidKeys = missingOrInvalidKeys;
  }
}

export function loadEnv(): Env {
  const parsed = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    DATABASE_URL_VOW_READER: process.env.DATABASE_URL_VOW_READER,
    TREBB_API_TOKEN: process.env.TREBB_API_TOKEN,
    TREBB_VOW_TOKEN: process.env.TREBB_VOW_TOKEN,
    TREBB_BASE_URL: process.env.TREBB_BASE_URL,
  });

  if (!parsed.success) {
    const keys = Object.keys(parsed.error.flatten().fieldErrors);
    console.error("[env] invalid or missing configuration:", keys);
    throw new EnvValidationError(keys);
  }

  return parsed.data;
}

/**
 * Reads DATABASE_URL_VOW_READER specifically, throwing a distinct,
 * intention-revealing error if it's absent — called only from
 * src/lib/listings/vow-gate.ts. Separate from loadEnv() so a missing VOW
 * credential fails at the one call site that actually needs it, not at
 * app boot.
 *
 * Also asserts the two connection strings are not literally identical.
 * This is the one misconfiguration that would silently defeat the entire
 * tier-isolation design without producing any error anywhere: if an
 * operator pastes DATABASE_URL's value into DATABASE_URL_VOW_READER (copy-
 * paste mistake, or "I'll just use the same one for now, I'll fix it
 * later"), the app boots fine, getVowData() runs fine, RLS still holds
 * (queries are running under whatever role DATABASE_URL actually
 * authenticates as — if that role is the normal, non-vow_reader role, the
 * RLS policy will correctly deny the read and getVowData() will simply
 * fail; if by some misconfiguration DATABASE_URL's role happens to BE
 * vow_reader, the "normal" client would also have VOW access, which is
 * the exact isolation failure this whole design exists to prevent) — and
 * nothing about that failure mode is loud or obvious from application
 * behavior alone. Failing fast on string equality here catches the most
 * common, most silent version of that mistake at the one call site that
 * would otherwise mask it.
 */
export function requireVowReaderDatabaseUrl(env: Env): string {
  if (!env.DATABASE_URL_VOW_READER) {
    throw new Error(
      "DATABASE_URL_VOW_READER is not configured — the VOW-tier database role has not " +
        "been provisioned yet. See byoot/README.md. Refusing to fall back to DATABASE_URL."
    );
  }
  if (env.DATABASE_URL_VOW_READER === env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL_VOW_READER is identical to DATABASE_URL — this defeats the vow_reader " +
        "role-separation design entirely (see docs/adr/0001-vow-tier-isolation.md). " +
        "They must be two distinct Postgres roles on the same database, not the same " +
        "connection string used twice. Refusing to proceed."
    );
  }
  return env.DATABASE_URL_VOW_READER;
}
