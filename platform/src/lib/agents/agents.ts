import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agents, agentVersions } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { requireAgentRegistryManagementAuthority } from "./authz";
import { AgentVersionConflictError } from "./errors";
import type { AgentDepartment, AgentPermissionLevel, AgentLifecycleStage, AgentHealthStatus } from "./types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type { AgentDepartment, AgentPermissionLevel, AgentLifecycleStage, AgentHealthStatus };

export interface Agent {
  id: string;
  organizationId: string;
  name: string;
  department: AgentDepartment;
  purpose: string;
  responsibilities: string;
  goals: string;
  inputs: string;
  outputs: string;
  successCriteria: string;
  failureCriteria: string;
  retirementCriteria: string;
  humanOwnerUserId: string;
  permissionLevel: AgentPermissionLevel;
  lifecycleStage: AgentLifecycleStage;
  healthStatus: AgentHealthStatus;
  currentVersionNumber: number;
  registeredByUserId: string | null;
  retiredAt: Date | null;
  retiredByUserId: string | null;
  retirementReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toAgent(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    department: row.department,
    purpose: row.purpose,
    responsibilities: row.responsibilities,
    goals: row.goals,
    inputs: row.inputs,
    outputs: row.outputs,
    successCriteria: row.successCriteria,
    failureCriteria: row.failureCriteria,
    retirementCriteria: row.retirementCriteria,
    humanOwnerUserId: row.humanOwnerUserId,
    permissionLevel: row.permissionLevel,
    lifecycleStage: row.lifecycleStage,
    healthStatus: row.healthStatus,
    currentVersionNumber: row.currentVersionNumber,
    registeredByUserId: row.registeredByUserId,
    retiredAt: row.retiredAt,
    retiredByUserId: row.retiredByUserId,
    retirementReason: row.retirementReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface RegisterAgentInput {
  organizationId: string;
  name: string;
  department: AgentDepartment;
  purpose: string;
  responsibilities: string;
  goals: string;
  inputs: string;
  outputs: string;
  successCriteria: string;
  failureCriteria: string;
  retirementCriteria: string;
  humanOwnerUserId: string;
  permissionLevel: AgentPermissionLevel;
  actorUserId: string;
}

/**
 * AGENT_FRAMEWORK §2 "Specification" + §3 "Agent Anatomy" — every field is
 * required at birth, none improvised later. Registration itself only ever
 * creates an agent at the `idea` stage (schema default) — `lifecycle.ts`
 * owns every subsequent stage move, including the framework's own explicit
 * "permission requested is not permission granted" distinction (the
 * `permissionLevel` recorded here is the REQUESTED level; it takes effect
 * for real only once `approveAgent` deliberately overrides it to the
 * lowest level, per §2).
 */
export async function registerAgent(db: Db, input: RegisterAgentInput): Promise<Agent> {
  await requireAgentRegistryManagementAuthority(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });

  const agentId = randomUUID();
  const now = new Date();

  await db.insert(agents).values({
    id: agentId,
    organizationId: input.organizationId,
    name: input.name,
    department: input.department,
    purpose: input.purpose,
    responsibilities: input.responsibilities,
    goals: input.goals,
    inputs: input.inputs,
    outputs: input.outputs,
    successCriteria: input.successCriteria,
    failureCriteria: input.failureCriteria,
    retirementCriteria: input.retirementCriteria,
    humanOwnerUserId: input.humanOwnerUserId,
    permissionLevel: input.permissionLevel,
    registeredByUserId: input.actorUserId,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(agentVersions).values({
    id: randomUUID(),
    agentId,
    versionNumber: 1,
    purpose: input.purpose,
    responsibilities: input.responsibilities,
    goals: input.goals,
    inputs: input.inputs,
    outputs: input.outputs,
    successCriteria: input.successCriteria,
    failureCriteria: input.failureCriteria,
    retirementCriteria: input.retirementCriteria,
    permissionLevel: input.permissionLevel,
    changeReason: null,
    createdByUserId: input.actorUserId,
    createdAt: now,
  });

  await recordAuditEvent(db, {
    eventType: "agent_registered",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "agent",
    targetId: agentId,
    metadata: { name: input.name, department: input.department, permissionLevelRequested: input.permissionLevel },
  });

  return getAgent(db, { organizationId: input.organizationId, agentId, actorUserId: input.actorUserId });
}

export async function getAgent(db: Db, input: { organizationId: string; agentId: string; actorUserId: string }): Promise<Agent> {
  await requireAgentRegistryManagementAuthority(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, targetId: input.agentId });

  const row = await requireTenantScopedResource(async () => {
    const [found] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, input.agentId));
    return found && found.organizationId === input.organizationId ? found : undefined;
  });

  return toAgent(row);
}

export async function listAgents(db: Db, input: { organizationId: string; actorUserId: string }): Promise<Agent[]> {
  await requireAgentRegistryManagementAuthority(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });

  const rows = await db.select().from(agents).where(eq(agents.organizationId, input.organizationId));
  return rows.map(toAgent);
}

/**
 * Brain Module 16 (Agent Read API) — resolves an agent by id with NO human
 * management-authority check, deliberately. Every other lookup in this
 * file (`getAgent`, `listAgents`) is called BY a human managing the
 * registry and is gated accordingly; this one is called ON BEHALF OF the
 * agent itself, during its own request authentication
 * (`src/lib/agents/authentication.ts`), where there is no human actor to
 * check authority against. Returns `null` for "doesn't exist" rather than
 * throwing — the authentication layer decides how to report that (a
 * generic invalid-credential failure, never a distinct "agent not found"
 * signal that would leak which credentials are almost-valid).
 */
export async function resolveAgentById(db: Db, agentId: string): Promise<Agent | null> {
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
  return row ? toAgent(row) : null;
}

export interface UpdateAgentAnatomyInput {
  organizationId: string;
  agentId: string;
  expectedVersionNumber: number;
  updates: Partial<{
    purpose: string;
    responsibilities: string;
    goals: string;
    inputs: string;
    outputs: string;
    successCriteria: string;
    failureCriteria: string;
    retirementCriteria: string;
  }>;
  changeReason?: string | null;
  actorUserId: string;
}

/**
 * Any anatomy edit is itself a new version (§16 Versioning: "improvement
 * happens through explicit versioning, not silent, invisible tuning") —
 * there is no separate "trivial edit" path that skips `agent_versions`.
 * Optimistic-concurrency via `expectedVersionNumber`, the identical atomic
 * `UPDATE ... WHERE current_version_number = expected` pattern Brain's own
 * `updateKnowledgeItem` uses, for the same reason: two concurrent editors
 * must never silently overwrite one another.
 */
export async function updateAgentAnatomy(db: Db, input: UpdateAgentAnatomyInput): Promise<Agent> {
  await requireAgentRegistryManagementAuthority(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, targetId: input.agentId });

  const existing = await getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });

  const merged = {
    purpose: input.updates.purpose ?? existing.purpose,
    responsibilities: input.updates.responsibilities ?? existing.responsibilities,
    goals: input.updates.goals ?? existing.goals,
    inputs: input.updates.inputs ?? existing.inputs,
    outputs: input.updates.outputs ?? existing.outputs,
    successCriteria: input.updates.successCriteria ?? existing.successCriteria,
    failureCriteria: input.updates.failureCriteria ?? existing.failureCriteria,
    retirementCriteria: input.updates.retirementCriteria ?? existing.retirementCriteria,
  };

  const newVersionNumber = input.expectedVersionNumber + 1;
  const now = new Date();

  const [updated] = await db
    .update(agents)
    .set({ ...merged, currentVersionNumber: newVersionNumber, updatedAt: now })
    .where(and(eq(agents.id, input.agentId), eq(agents.currentVersionNumber, input.expectedVersionNumber)))
    .returning();

  if (!updated) {
    await recordAuditEvent(db, {
      eventType: "agent_version_conflict",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "agent",
      targetId: input.agentId,
      metadata: { expectedVersionNumber: input.expectedVersionNumber },
    });
    throw new AgentVersionConflictError();
  }

  await db.insert(agentVersions).values({
    id: randomUUID(),
    agentId: input.agentId,
    versionNumber: newVersionNumber,
    ...merged,
    permissionLevel: existing.permissionLevel,
    changeReason: input.changeReason ?? null,
    createdByUserId: input.actorUserId,
    createdAt: now,
  });

  await recordAuditEvent(db, {
    eventType: "agent_anatomy_updated",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "agent",
    targetId: input.agentId,
    metadata: { newVersionNumber, changedFields: Object.keys(input.updates) },
  });

  return getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });
}
