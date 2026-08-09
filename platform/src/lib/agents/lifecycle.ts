import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agents, agentVersions } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireAgentRegistryManagementAuthority } from "./authz";
import { getAgent, type Agent } from "./agents";
import { InvalidAgentLifecycleTransitionError, AgentAlreadyRetiredError, AgentNotLiveError, FounderLevelNotAssignableError } from "./errors";
import type { AgentLifecycleStage, AgentPermissionLevel, AgentHealthStatus } from "./types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * AGENT_FRAMEWORK §2's existence-lifecycle, forward-only, one stage at a
 * time. `retired` is deliberately excluded from this sequence — it is
 * reachable from ANY of these stages (see `retireAgent`), not only from
 * `improvement`, so it is handled as its own dedicated transition rather
 * than "the 9th step everyone must pass through in order."
 */
const LIFECYCLE_ORDER: AgentLifecycleStage[] = [
  "idea",
  "specification",
  "development",
  "testing",
  "approval",
  "deployment",
  "monitoring",
  "improvement",
];

const LIVE_STAGES: AgentLifecycleStage[] = ["deployment", "monitoring", "improvement"];

async function recordLifecycleConflict(db: Db, input: { actorUserId: string; organizationId: string; agentId: string; from: string; to: string }): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "agent_lifecycle_conflict",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "agent",
    targetId: input.agentId,
    metadata: { from: input.from, to: input.to },
  });
}

async function bumpAgentVersion(
  db: Db,
  input: { agent: Agent; permissionLevel: AgentPermissionLevel; changeReason: string | null; actorUserId: string }
): Promise<number> {
  const newVersionNumber = input.agent.currentVersionNumber + 1;
  const now = new Date();

  await db
    .update(agents)
    .set({ permissionLevel: input.permissionLevel, currentVersionNumber: newVersionNumber, updatedAt: now })
    .where(eq(agents.id, input.agent.id));

  await db.insert(agentVersions).values({
    id: randomUUID(),
    agentId: input.agent.id,
    versionNumber: newVersionNumber,
    purpose: input.agent.purpose,
    responsibilities: input.agent.responsibilities,
    goals: input.agent.goals,
    inputs: input.agent.inputs,
    outputs: input.agent.outputs,
    successCriteria: input.agent.successCriteria,
    failureCriteria: input.agent.failureCriteria,
    retirementCriteria: input.agent.retirementCriteria,
    permissionLevel: input.permissionLevel,
    changeReason: input.changeReason,
    createdByUserId: input.actorUserId,
    createdAt: now,
  });

  return newVersionNumber;
}

export interface AdvanceAgentLifecycleStageInput {
  organizationId: string;
  agentId: string;
  toStage: Exclude<AgentLifecycleStage, "retired">;
  actorUserId: string;
}

/**
 * Moves an agent exactly one step forward through §2's sequence. The
 * `testing → approval` step carries §2's own explicit override: "Approval
 * at this stage grants only the lowest permission level — every
 * subsequent increase in authority is its own, separate approval, not
 * implied by this one." Enforced here structurally (forced to `observer`,
 * a new version recorded), never left to the caller to remember.
 */
export async function advanceAgentLifecycleStage(db: Db, input: AdvanceAgentLifecycleStageInput): Promise<Agent> {
  await requireAgentRegistryManagementAuthority(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, targetId: input.agentId });
  const existing = await getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });

  const currentIndex = LIFECYCLE_ORDER.indexOf(existing.lifecycleStage);
  const targetIndex = LIFECYCLE_ORDER.indexOf(input.toStage);
  if (currentIndex === -1 || targetIndex !== currentIndex + 1) {
    await recordLifecycleConflict(db, { actorUserId: input.actorUserId, organizationId: input.organizationId, agentId: existing.id, from: existing.lifecycleStage, to: input.toStage });
    throw new InvalidAgentLifecycleTransitionError(existing.lifecycleStage, input.toStage);
  }

  const now = new Date();
  const [updated] = await db
    .update(agents)
    .set({ lifecycleStage: input.toStage, updatedAt: now })
    .where(and(eq(agents.id, existing.id), eq(agents.lifecycleStage, existing.lifecycleStage)))
    .returning();

  if (!updated) {
    await recordLifecycleConflict(db, { actorUserId: input.actorUserId, organizationId: input.organizationId, agentId: existing.id, from: existing.lifecycleStage, to: input.toStage });
    throw new InvalidAgentLifecycleTransitionError(existing.lifecycleStage, input.toStage);
  }

  if (input.toStage === "approval" && existing.permissionLevel !== "observer") {
    await bumpAgentVersion(db, { agent: existing, permissionLevel: "observer", changeReason: "Approval forces the lowest permission level (AGENT_FRAMEWORK §2)", actorUserId: input.actorUserId });
  }

  await recordAuditEvent(db, {
    eventType: input.toStage === "approval" ? "agent_approved" : "agent_lifecycle_advanced",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "agent",
    targetId: existing.id,
    metadata: { from: existing.lifecycleStage, to: input.toStage },
  });

  return getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });
}

export interface ChangeAgentPermissionLevelInput {
  organizationId: string;
  agentId: string;
  newPermissionLevel: AgentPermissionLevel;
  reason: string;
  actorUserId: string;
}

/**
 * §5: "only a human approval moves an agent up." Every caller of this
 * module is a human actor (no agent-actor invocation path exists anywhere
 * in this codebase yet), so that rule is satisfied structurally for now —
 * the same kind of interim, honestly-documented guarantee as `access-log.ts`'s
 * `shouldLogAccess` policy. Only legal while the agent is actually live
 * (§5's authority only means something once the agent is running).
 */
export async function changeAgentPermissionLevel(db: Db, input: ChangeAgentPermissionLevelInput): Promise<Agent> {
  await requireAgentRegistryManagementAuthority(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, targetId: input.agentId });
  const existing = await getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });

  if (existing.lifecycleStage === "retired") {
    throw new AgentAlreadyRetiredError();
  }
  if (!LIVE_STAGES.includes(existing.lifecycleStage)) {
    throw new AgentNotLiveError(existing.lifecycleStage);
  }
  // Defense in depth: `agentPermissionLevelSchema`/`agentPermissionLevelEnum`
  // already exclude "founder" at the type/DB level — this catches any
  // caller that bypasses Zod validation (e.g. a future internal script).
  if ((input.newPermissionLevel as string) === "founder") {
    throw new FounderLevelNotAssignableError();
  }

  await bumpAgentVersion(db, { agent: existing, permissionLevel: input.newPermissionLevel, changeReason: input.reason, actorUserId: input.actorUserId });

  await recordAuditEvent(db, {
    eventType: "agent_permission_level_changed",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "agent",
    targetId: existing.id,
    metadata: { from: existing.permissionLevel, to: input.newPermissionLevel },
  });

  return getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });
}

export interface RetireAgentInput {
  organizationId: string;
  agentId: string;
  reason: string;
  actorUserId: string;
}

/**
 * §17 Retirement — the one-way terminal transition, legal from ANY
 * non-retired stage (an idea abandoned before Specification is retired
 * exactly like a deployed agent being decommissioned; the framework
 * doesn't distinguish). Mandatory `reason`, matching `retireKnowledgeItem`'s
 * exact precedent. Lesson-extraction into the Brain's Wisdom domain (§17's
 * "everything it learned is preserved before it stops running") is
 * explicitly NOT implemented here — it depends on Brain Modules 16/17
 * (Agent Attribution) existing first, the same "not implementable today,
 * not silently skipped" honesty already applied to `Purged` in Module 8/9.
 */
export async function retireAgent(db: Db, input: RetireAgentInput): Promise<Agent> {
  await requireAgentRegistryManagementAuthority(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, targetId: input.agentId });
  const existing = await getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });

  if (existing.lifecycleStage === "retired") {
    throw new AgentAlreadyRetiredError();
  }

  const now = new Date();
  const [updated] = await db
    .update(agents)
    .set({ lifecycleStage: "retired", retiredAt: now, retiredByUserId: input.actorUserId, retirementReason: input.reason, updatedAt: now })
    .where(and(eq(agents.id, existing.id), ne(agents.lifecycleStage, "retired")))
    .returning();

  if (!updated) {
    throw new AgentAlreadyRetiredError();
  }

  await recordAuditEvent(db, {
    eventType: "agent_retired",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "agent",
    targetId: existing.id,
    metadata: { fromStage: existing.lifecycleStage, reason: input.reason },
  });

  return getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });
}

export interface RecordAgentHealthInput {
  organizationId: string;
  agentId: string;
  healthStatus: AgentHealthStatus;
  actorUserId: string;
}

/**
 * §13 Agent Health — a coarse status signal, not versioned anatomy (health
 * reflects observed runtime behavior, not a specification change). Human-
 * recorded today as an interim proxy for what will eventually be the Agent
 * Runtime's own automated observability writing this same field.
 */
export async function recordAgentHealth(db: Db, input: RecordAgentHealthInput): Promise<Agent> {
  await requireAgentRegistryManagementAuthority(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, targetId: input.agentId });
  const existing = await getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });

  await db.update(agents).set({ healthStatus: input.healthStatus, updatedAt: new Date() }).where(eq(agents.id, existing.id));

  await recordAuditEvent(db, {
    eventType: "agent_health_recorded",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "agent",
    targetId: existing.id,
    metadata: { from: existing.healthStatus, to: input.healthStatus },
  });

  return getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });
}
