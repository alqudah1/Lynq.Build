import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

type Db = NeonHttpDatabase<Record<string, unknown>>;

// Module 19 — placeholder; implemented by the corresponding vertical slice.
export async function syncAccountEngagement(_db: Db, _input: { organizationId: string; channelAccountId: string; runtimeJobId?: string }): Promise<Record<string, unknown>> {
  throw new Error("syncAccountEngagement is not implemented yet");
}
