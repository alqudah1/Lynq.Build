import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

type Db = NeonHttpDatabase<Record<string, unknown>>;

// Module 19 — placeholder; implemented by the corresponding vertical slice.
export async function runGenerationJob(_db: Db, _input: { organizationId: string; generationId: string; runtimeJobId?: string }): Promise<Record<string, unknown>> {
  throw new Error("runGenerationJob is not implemented yet");
}
