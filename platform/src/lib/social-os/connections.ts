import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

type Db = NeonHttpDatabase<Record<string, unknown>>;

// Module 19 — placeholder; implemented by the corresponding vertical slice.
export async function watchConnectionTokens(_db: Db, _input: { organizationId: string }): Promise<Record<string, unknown>> {
  throw new Error("watchConnectionTokens is not implemented yet");
}
