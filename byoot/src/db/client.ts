import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { requireVowReaderDatabaseUrl, type Env } from "@/lib/env";
import * as schema from "./schema";

export interface CreateDbClientOptions {
  /** Aborts the underlying HTTP request if it exceeds this duration. Omit for no timeout. */
  timeoutMs?: number;
}

/**
 * Normal application connection — copied from platform/src/db/client.ts.
 * This role has NO grant on `listings_vow` (see schema.ts's RLS policy
 * comment and byoot/README.md's manual database setup steps). Every route,
 * component, and AI tool in this codebase uses this client.
 */
export function createDbClient(env: Env, options: CreateDbClientOptions = {}) {
  const sql = neon(env.DATABASE_URL, {
    fetchOptions: options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : undefined,
  });

  return drizzle(sql, { schema });
}

/**
 * The `vow_reader` connection — the only role with a matching RLS policy
 * on `listings_vow`. This function exists so there is exactly one place in
 * the codebase that can construct a client capable of reading that table.
 * It is called from exactly one place: src/lib/listings/vow-gate.ts's
 * `getVowData()`, after that function has already verified the requesting
 * user is authenticated and bona-fide-consumer-acknowledged. Do not call
 * this from anywhere else — doing so doesn't bypass the auth check (that
 * check still has to happen in the caller), but it does defeat the point
 * of keeping the credential's blast radius to one file.
 */
export function createVowReaderDbClient(env: Env, options: CreateDbClientOptions = {}) {
  const url = requireVowReaderDatabaseUrl(env);
  const sql = neon(url, {
    fetchOptions: options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : undefined,
  });

  return drizzle(sql, { schema });
}
