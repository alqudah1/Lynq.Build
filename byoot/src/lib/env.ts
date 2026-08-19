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
  // Distinct Postgres role from DATABASE_URL — see schema.ts's RLS policy
  // and src/db/client.ts's createVowReaderDbClient(). Optional at the env
  // level so the rest of the app boots without it; getVowData() itself
  // throws a clear, specific error if it's missing when actually needed,
  // rather than the whole app failing to start over one gated feature.
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
 */
export function requireVowReaderDatabaseUrl(env: Env): string {
  if (!env.DATABASE_URL_VOW_READER) {
    throw new Error(
      "DATABASE_URL_VOW_READER is not configured — the VOW-tier database role has not " +
        "been provisioned yet. See byoot/README.md. Refusing to fall back to DATABASE_URL."
    );
  }
  return env.DATABASE_URL_VOW_READER;
}
