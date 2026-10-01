import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

type Db = NeonHttpDatabase<Record<string, unknown>>;

// Module 19 — placeholder; implemented by the corresponding vertical slice.
export async function runAutomationRule(_db: Db, _input: { organizationId: string; ruleId: string; runtimeJobId?: string }): Promise<Record<string, unknown>> {
  throw new Error("runAutomationRule is not implemented yet");
}
