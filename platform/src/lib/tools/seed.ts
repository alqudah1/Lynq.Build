import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { registerTool, getCurrentToolVersion } from "./definitions";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Registers this phase's 3 initial internal tools if they don't already
 * exist — idempotent (checks `getCurrentToolVersion` first), safe to call
 * on every deploy/test-setup rather than requiring a one-time manual step.
 * These are the "intentionally registered global tool definitions"
 * permanent seed data this module's own tests expect to survive cleanup.
 */
export async function seedInitialTools(db: Db): Promise<void> {
  if (!(await getCurrentToolVersion(db, "brain.search"))) {
    await registerTool(db, {
      toolKey: "brain.search",
      name: "Brain Search",
      description: "Keyword search over Brain knowledge the calling agent is permitted to read.",
      category: "brain",
      inputSchema: { query: "string", domain: "KnowledgeDomain?", workspaceId: "uuid?", limit: "number?" },
      outputSchema: { results: "BrainSearchResultItem[]", nextCursor: "string | null" },
      riskLevel: "low",
      sideEffectClass: "read_only",
      requiredCapabilities: ["read"],
      minimumPermissionLevel: "observer",
      idempotencyRequired: false,
    });
  }

  if (!(await getCurrentToolVersion(db, "brain.get_context"))) {
    await registerTool(db, {
      toolKey: "brain.get_context",
      name: "Brain Get Context",
      description: "Retrieves one knowledge item's citation-ready context: version, trust, source, evidence, and relationships.",
      category: "brain",
      inputSchema: { knowledgeItemId: "uuid", versionNumber: "number" },
      outputSchema: { title: "string", content: "string", source: "object | null", trust: "object", evidence: "array", relationships: "array" },
      riskLevel: "low",
      sideEffectClass: "read_only",
      requiredCapabilities: ["read"],
      minimumPermissionLevel: "observer",
      idempotencyRequired: false,
    });
  }

  if (!(await getCurrentToolVersion(db, "artifact.create_report"))) {
    await registerTool(db, {
      toolKey: "artifact.create_report",
      name: "Create Report Artifact",
      description: "Creates a structured report artifact from retrieved Brain knowledge, scoped to the calling execution.",
      category: "artifact",
      inputSchema: { title: "string", summary: "string", keyFindings: "string[]", supportingReferences: "Citation[]", contradictions: "string[]?", missingInformation: "string[]?" },
      outputSchema: { artifactId: "uuid", reusedFromPriorAttempt: "boolean" },
      riskLevel: "low",
      sideEffectClass: "internal_write",
      requiredCapabilities: [],
      minimumPermissionLevel: "assistant",
      idempotencyRequired: true,
    });
  }
}
