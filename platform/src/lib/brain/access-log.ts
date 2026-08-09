import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { accessLogEntries } from "@/db/schema";
import type { KnowledgeDomain } from "./knowledge-items";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Brain access log — Module 15 (Audit Integration)
 * ============================================================================
 *
 * The separate, higher-volume READ log `MODULE_3_BRAIN_ARCHITECTURE.md` §11
 * describes — `audit_logs` (Module 2's existing infrastructure) stays
 * exactly what it already meant: every mutation, at full fidelity, never
 * sampled. This file is the one write path for the other half: reads.
 *
 * **Logging policy** (§15.6, deliberately left open by the architecture,
 * not resolved here): every AGENT read is logged at full fidelity
 * (AGENT_FRAMEWORK §11's non-negotiable requirement); human reads are
 * deferred entirely for now rather than silently sampled at an arbitrary
 * rate this document has no real volume data to justify. `shouldLogAccess`
 * is the one function this policy lives in — a future module tightening
 * or replacing it (e.g. adding real human-read sampling) changes one
 * function, not every call site.
 *
 * No agent identity concept exists anywhere in this codebase yet (Brain
 * Modules 16/17) — every real caller today passes `actorType: "human"`,
 * so `recordAccessLogEntry` currently never actually writes a row via
 * `shouldLogAccess`'s policy. The function and table both exist now so
 * Module 16's agent read API has exactly one thing to call, not a new
 * table to design under time pressure later.
 *
 * Write-only: there is no `updateAccessLogEntry`/`deleteAccessLogEntry`
 * function anywhere in this module, and no PATCH/DELETE route will ever
 * exist for this data — proven directly by a structural test, the same
 * "absence of a mutating code path is the immutability guarantee" pattern
 * already established for `knowledge_item_versions` (Module 2) and
 * `audit_logs` itself.
 */

export type AccessActorType = "human" | "agent";

export interface RecordAccessLogEntryInput {
  organizationId: string;
  actorUserId: string | null;
  actorType: AccessActorType;
  targetType?: string | null;
  targetId?: string | null;
  domain?: KnowledgeDomain | null;
  workspaceId?: string | null;
}

/** §15.6's interim policy: agent reads always logged; human reads deferred. */
export function shouldLogAccess(actorType: AccessActorType): boolean {
  return actorType === "agent";
}

/**
 * Writes one access-log row if `shouldLogAccess` says this read is worth
 * recording — never throws on a "not logged" decision (logging a read is
 * observability, not authorization; a policy choice to skip it must never
 * become a request failure). Returns whether a row was actually written,
 * so a caller in a hot read path can cheaply confirm the no-op case in
 * tests without inspecting the database.
 */
export async function recordAccessLogEntry(db: Db, input: RecordAccessLogEntryInput): Promise<boolean> {
  if (!shouldLogAccess(input.actorType)) {
    return false;
  }

  await db.insert(accessLogEntries).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorType: input.actorType,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    domain: input.domain ?? null,
    workspaceId: input.workspaceId ?? null,
  });

  return true;
}
