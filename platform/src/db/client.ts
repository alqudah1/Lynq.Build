import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { Env } from "@/lib/env";
import * as schema from "./schema";

export interface CreateDbClientOptions {
  /** Aborts the underlying HTTP request if it exceeds this duration. Omit for no timeout. */
  timeoutMs?: number;
}

/**
 * Creates a fresh Drizzle client backed by Neon's HTTP driver. Callers pass
 * an already-validated Env (see src/lib/env.ts) rather than this module
 * reading process.env itself, so error handling stays entirely in the
 * caller's control.
 */
export function createDbClient(env: Env, options: CreateDbClientOptions = {}) {
  const sql = neon(env.DATABASE_URL, {
    fetchOptions: options.timeoutMs
      ? { signal: AbortSignal.timeout(options.timeoutMs) }
      : undefined,
  });

  return drizzle(sql, { schema });
}
