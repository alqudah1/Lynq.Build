import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { resolveEffectiveBrainCapabilitiesForAgent, type BrainCapability } from "@/lib/brain/authz";
import type { KnowledgeDomain } from "@/lib/brain/knowledge-items";
import type { AgentPermissionLevel, AgentDepartment } from "@/lib/agents/types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Execution Context — §3
 * ============================================================================
 *
 * Assembled ONCE, at the `gathering_context` transition, as an explicit,
 * immutable snapshot — never reassembled piecemeal, never silently mutated
 * later. Closed field list, deliberately excluding everything §3 forbids:
 * no raw credentials, session tokens, OAuth tokens, secrets, or hidden
 * reasoning anywhere in this shape.
 *
 * **The one deliberate exception, restated from §3 itself**: `grantedCapabilities`
 * here is a snapshot for PLANNING/REASONING purposes only — it is never
 * consulted to authorize a gated action. Every gated action re-validates
 * live, via `resolveEffectiveBrainCapabilitiesForAgent`/
 * `revalidateAgentEligibility` fresh, every time (see `authz.ts`). A
 * revoked grant must stop an in-flight action, not merely future ones.
 *
 * Deliberately NOT included in this phase (see `MODULE_7_AGENT_RUNTIME_CORE.md`'s
 * "Deferred" section): Conversation Memory reference (no conversation
 * system exists yet), external tool availability (no tool registry exists
 * yet — this phase is internal-actions-and-test-executors only, per the
 * task's own explicit scope), Working Memory/Temporary Reasoning (Module
 * 3.1 concepts not yet built).
 */
export interface ExecutionContextSnapshot {
  organizationId: string;
  workspaceId: string | null;
  initiatingUserId: string | null;
  ownerUserId: string;
  assignedAgentId: string;
  assignedAgentVersionNumber: number;
  assignedAgentPermissionLevel: AgentPermissionLevel;
  assignedAgentDepartment: AgentDepartment;
  goal: string;
  domainsRequested: KnowledgeDomain[];
  /** Snapshot only — see this file's own top-level comment. Keyed by `${domain}:${workspaceId ?? "org"}`. */
  grantedCapabilitiesAtAssignment: Record<string, BrainCapability[]>;
  parentExecutionId: string | null;
  rootExecutionId: string;
  delegationDepth: number;
  /** Prior execution history relevant to a resume — populated only when this context is (re)assembled after an interruption; empty for a fresh execution. */
  priorEventCount: number;
  assembledAt: string;
}

export interface AssembleExecutionContextInput {
  organizationId: string;
  workspaceId: string | null;
  initiatingUserId: string | null;
  ownerUserId: string;
  assignedAgentId: string;
  assignedAgentVersionNumber: number;
  assignedAgentPermissionLevel: AgentPermissionLevel;
  assignedAgentDepartment: AgentDepartment;
  goal: string;
  domainsRequested: KnowledgeDomain[];
  parentExecutionId: string | null;
  rootExecutionId: string;
  delegationDepth: number;
  priorEventCount: number;
}

/**
 * §3's ordered assembly process, collapsed to what this phase actually
 * needs: resolve identity/tenant scope (already done by the caller,
 * `lifecycle.ts`'s `startExecution`) → resolve the agent's own registered
 * Brain capabilities per requested domain (org-scoped, plus
 * workspace-scoped if this execution itself is workspace-scoped) →
 * assemble the closed snapshot.
 */
export async function assembleExecutionContext(db: Db, input: AssembleExecutionContextInput): Promise<ExecutionContextSnapshot> {
  const grantedCapabilitiesAtAssignment: Record<string, BrainCapability[]> = {};

  for (const domain of input.domainsRequested) {
    const orgScoped = await resolveEffectiveBrainCapabilitiesForAgent(db, { organizationId: input.organizationId, domain, workspaceId: null }, input.assignedAgentId);
    grantedCapabilitiesAtAssignment[`${domain}:org`] = [...orgScoped];

    if (input.workspaceId) {
      const workspaceScoped = await resolveEffectiveBrainCapabilitiesForAgent(
        db,
        { organizationId: input.organizationId, domain, workspaceId: input.workspaceId },
        input.assignedAgentId
      );
      grantedCapabilitiesAtAssignment[`${domain}:${input.workspaceId}`] = [...workspaceScoped];
    }
  }

  return {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    initiatingUserId: input.initiatingUserId,
    ownerUserId: input.ownerUserId,
    assignedAgentId: input.assignedAgentId,
    assignedAgentVersionNumber: input.assignedAgentVersionNumber,
    assignedAgentPermissionLevel: input.assignedAgentPermissionLevel,
    assignedAgentDepartment: input.assignedAgentDepartment,
    goal: input.goal,
    domainsRequested: input.domainsRequested,
    grantedCapabilitiesAtAssignment,
    parentExecutionId: input.parentExecutionId,
    rootExecutionId: input.rootExecutionId,
    delegationDepth: input.delegationDepth,
    priorEventCount: input.priorEventCount,
    assembledAt: new Date().toISOString(),
  };
}
