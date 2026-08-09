import "server-only";
import { sql } from "drizzle-orm";
import { createDbClient } from "@/db/client";
import { loadEnv, EnvValidationError } from "./env";

const DB_TIMEOUT_MS = 5000;

export type HealthResult =
  | { status: "ok"; database: "connected" }
  | { status: "error"; database: "unknown"; reason: "configuration" }
  | { status: "error"; database: "unreachable" };

/**
 * Runs a real, uncached database round-trip on every call. Never returns
 * connection strings, hostnames, SQL text, driver messages, or stack
 * traces — only the generic shape above. Full error detail is written to
 * server-side logs only (console.error), which the caller (route/page)
 * does not forward to the client.
 */
export async function checkHealth(): Promise<HealthResult> {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error("[health] environment validation failed:", err.missingOrInvalidKeys);
    } else {
      console.error("[health] unexpected error during environment validation:", err);
    }
    return { status: "error", database: "unknown", reason: "configuration" };
  }

  try {
    const db = createDbClient(env, { timeoutMs: DB_TIMEOUT_MS });
    await db.execute(sql`SELECT 1`);
    return { status: "ok", database: "connected" };
  } catch (err) {
    console.error("[health] database check failed:", err);
    return { status: "error", database: "unreachable" };
  }
}
