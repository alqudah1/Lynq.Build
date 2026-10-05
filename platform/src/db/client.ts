import "server-only";
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { Env } from "@/lib/env";
import * as schema from "./schema";

export interface CreateDbClientOptions {
  /** Aborts the underlying HTTP request if it exceeds this duration. Omit for no timeout. */
  timeoutMs?: number;
}

/**
 * Local-development escape hatch. When `NEON_HTTP_FETCH_ENDPOINT` is set
 * (validated in `src/lib/env.ts` to be a loopback URL) every `neon()` client
 * in the process — including raw `neon(env.DATABASE_URL)` handles used for
 * batched transactions — sends its SQL-over-HTTP requests there instead of
 * the Neon host derived from the connection string. This lets the whole app
 * and its integration tests run against a plain local Postgres behind a
 * protocol shim, without any code path differing from production.
 */
export function configureNeonHttpEndpoint(env: Pick<Env, "NEON_HTTP_FETCH_ENDPOINT">): void {
  if (env.NEON_HTTP_FETCH_ENDPOINT) {
    neonConfig.fetchEndpoint = env.NEON_HTTP_FETCH_ENDPOINT;
  }
}

/**
 * Creates a fresh Drizzle client backed by Neon's HTTP driver. Callers pass
 * an already-validated Env (see src/lib/env.ts) rather than this module
 * reading process.env itself, so error handling stays entirely in the
 * caller's control.
 */
export function createDbClient(env: Env, options: CreateDbClientOptions = {}) {
  configureNeonHttpEndpoint(env);

  const sql = neon(env.DATABASE_URL, {
    fetchOptions: options.timeoutMs
      ? { signal: AbortSignal.timeout(options.timeoutMs) }
      : undefined,
  });

  return drizzle(sql, { schema });
}
