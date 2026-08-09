import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentDelegations, agentExecutions } from "@/db/schema";
import type { KnowledgeDomain } from "@/lib/brain/knowledge-items";
import { resolveEffectiveBrainCapabilitiesForAgent } from "@/lib/brain/authz";
import { resolveAgentById } from "@/lib/agents/agents";
import { requireAssignedAgent, revalidateAgentEligibility } from "./authz";
import { resolveExecutionById, transitionExecutionStatus, type AgentExecution } from "./executions";
import { recordExecutionEvent } from "./events";
import { DelegationCycleError, DelegationDepthExceededError, DelegatorLacksCapabilityError, InvalidExecutionTransitionError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const MAX_DELEGATION_DEPTH = 5;
const DEFAULT_DELEGATION_TIMEOUT_HOURS = 48;

export type AgentDelegationStatus = "active" | "completed" | "failed" | "cancelled" | "timed_out";

export interface AgentDelegation {
  id: string;
  parentExecutionId: string;
  childExecutionId: string;
  delegatingAgentId: string;
  delegateAgentId: string;
  ancestryPath: string[];
  depth: number;
  timeoutAt: Date;
  status: AgentDelegationStatus;
  createdAt: Date;
}

function toDelegation(row: typeof agentDelegations.$inferSelect): AgentDelegation {
  return {
    id: row.id,
    parentExecutionId: row.parentExecutionId,
    childExecutionId: row.childExecutionId,
    delegatingAgentId: row.delegatingAgentId,
    delegateAgentId: row.delegateAgentId,
    ancestryPath: (row.ancestryPath ?? []) as string[],
    depth: row.depth,
    timeoutAt: row.timeoutAt,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export interface DelegateExecutionInput {
  organizationId: string;
  parentExecutionId: string;
  delegateAgentId: string;
  goal: string;
  successCriteria: string;
  failureCriteria: string;
  domainsRequested: KnowledgeDomain[];
  ownerUserId?: string;
  timeoutHours?: number;
  actorAgentId: string;
}

/**
 * §6: "Delegation creates a new, first-class Task, never a hidden
 * sub-process." §6/§12: "ownership passes work, never permission" —
 * enforced two ways here: (1) the delegating agent must itself hold at
 * least `read` for every requested domain BEFORE it may delegate work
 * touching that domain (never delegating into a capability it doesn't
 * have), and (2) the child execution independently re-validates its OWN
 * grants on every gated action it takes (Brain Module 16/17's existing
 * agent-gates, unchanged) — it never inherits or "trusts" the parent's
 * authorization.
 */
export async function delegateExecution(db: Db, input: DelegateExecutionInput): Promise<{ delegation: AgentDelegation; child: AgentExecution; parent: AgentExecution }> {
  const parent = await resolveExecutionById(db, input.organizationId, input.parentExecutionId);
  requireAssignedAgent(parent, input.actorAgentId);
  await revalidateAgentEligibility(db, input.organizationId, input.actorAgentId);

  const delegate = await resolveAgentById(db, input.delegateAgentId);
  if (!delegate || delegate.organizationId !== input.organizationId || delegate.lifecycleStage === "retired") {
    throw new Error("Delegate agent is not eligible");
  }

  const depth = parent.delegationDepth + 1;
  if (depth > MAX_DELEGATION_DEPTH) {
    throw new DelegationDepthExceededError(MAX_DELEGATION_DEPTH);
  }

  // Ancestry: the parent's own ancestry (if it was itself a delegation
  // child) plus the delegating agent — §6's exact "ordered ancestry of
  // [agents] that led to it" check, O(1) via a `.includes` on the
  // already-loaded array rather than a recursive query per attempt.
  const [parentDelegation] = await db.select().from(agentDelegations).where(eq(agentDelegations.childExecutionId, input.parentExecutionId));
  const parentAncestry = parentDelegation ? ((parentDelegation.ancestryPath ?? []) as string[]) : [];
  const ancestryPath = [...new Set([...parentAncestry, input.actorAgentId])];

  if (ancestryPath.includes(input.delegateAgentId)) {
    await recordExecutionEvent(db, {
      organizationId: input.organizationId,
      executionId: input.parentExecutionId,
      eventType: "agent_delegation_cycle_rejected",
      actorAgentId: input.actorAgentId,
      metadata: { attemptedDelegateAgentId: input.delegateAgentId, ancestryPath },
    });
    throw new DelegationCycleError();
  }

  for (const domain of input.domainsRequested) {
    const capabilities = await resolveEffectiveBrainCapabilitiesForAgent(db, { organizationId: input.organizationId, domain, workspaceId: parent.workspaceId }, input.actorAgentId);
    if (!capabilities.has("read")) {
      throw new DelegatorLacksCapabilityError();
    }
  }

  const childId = randomUUID();
  const now = new Date();
  await db
    .insert(agentExecutions)
    .values({
      id: childId,
      organizationId: input.organizationId,
      workspaceId: parent.workspaceId,
      initiatingUserId: null,
      ownerUserId: input.ownerUserId ?? parent.ownerUserId,
      assignedAgentId: input.delegateAgentId,
      assignedAgentVersionNumber: delegate.currentVersionNumber,
      parentExecutionId: input.parentExecutionId,
      rootExecutionId: parent.rootExecutionId,
      delegationDepth: depth,
      goal: input.goal,
      successCriteria: input.successCriteria,
      failureCriteria: input.failureCriteria,
      domainsRequested: input.domainsRequested,
      status: "assigned",
      createdAt: now,
      updatedAt: now,
    });

  const timeoutAt = new Date(Date.now() + (input.timeoutHours ?? DEFAULT_DELEGATION_TIMEOUT_HOURS) * 60 * 60 * 1000);
  const [delegationRow] = await db
    .insert(agentDelegations)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      parentExecutionId: input.parentExecutionId,
      childExecutionId: childId,
      delegatingAgentId: input.actorAgentId,
      delegateAgentId: input.delegateAgentId,
      ancestryPath,
      depth,
      timeoutAt,
    })
    .returning();

  const delegating = await transitionExecutionStatus(db, { executionId: input.parentExecutionId, organizationId: input.organizationId, expectedRevision: parent.revision, fromStatuses: ["executing"], toStatus: "delegating" });
  if (!delegating) throw new InvalidExecutionTransitionError(parent.status, "delegating");

  const waiting = await transitionExecutionStatus(db, {
    executionId: input.parentExecutionId,
    organizationId: input.organizationId,
    expectedRevision: delegating.revision,
    fromStatuses: ["delegating"],
    toStatus: "waiting",
    extraSet: { waitReason: `delegation:${childId}` },
  });
  if (!waiting) throw new InvalidExecutionTransitionError("delegating", "waiting");

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.parentExecutionId,
    eventType: "agent_delegation_created",
    fromStatus: "executing",
    toStatus: "waiting",
    actorAgentId: input.actorAgentId,
    metadata: { childExecutionId: childId, delegateAgentId: input.delegateAgentId, depth },
  });
  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: childId,
    eventType: "agent_execution_created",
    toStatus: "assigned",
    actorAgentId: input.actorAgentId,
    metadata: { delegatedFrom: input.parentExecutionId },
  });

  const child = await resolveExecutionById(db, input.organizationId, childId);

  return { delegation: toDelegation(delegationRow), child, parent: waiting };
}

/** §6: "Timeouts: every delegation carries an explicit deadline; an unresponsive delegate escalates to a human rather than blocking the delegator indefinitely." A sweep function, invoked the same way `expirePendingApprovals` is — only rows genuinely past `timeoutAt` are touched. */
export async function timeoutExpiredDelegations(db: Db, organizationId: string): Promise<number> {
  const rows = await db
    .update(agentDelegations)
    .set({ status: "timed_out", updatedAt: new Date() })
    .where(and(eq(agentDelegations.organizationId, organizationId), eq(agentDelegations.status, "active"), lt(agentDelegations.timeoutAt, new Date())))
    .returning();

  for (const row of rows) {
    await recordExecutionEvent(db, { organizationId, executionId: row.parentExecutionId, eventType: "agent_execution_failed", metadata: { reason: "delegation_timeout", childExecutionId: row.childExecutionId } });
  }

  return rows.length;
}

/** §6: "the delegate's completed artifact/outcome returns via the Dependency edge that made the delegator Waiting; the delegator re-enters Reasoning to incorporate it." Checked explicitly (never an automatic wake-up in this phase — deterministic, test-executor-driven, per the task's own scope). */
export async function checkDelegationResult(db: Db, organizationId: string, delegationId: string): Promise<{ delegation: AgentDelegation; childStatus: string }> {
  const [row] = await db.select().from(agentDelegations).where(and(eq(agentDelegations.id, delegationId), eq(agentDelegations.organizationId, organizationId)));
  if (!row) throw new Error("Delegation not found");

  const child = await resolveExecutionById(db, organizationId, row.childExecutionId);

  if (row.status === "active" && (child.status === "completed" || child.status === "failed" || child.status === "cancelled")) {
    const newStatus: AgentDelegationStatus = child.status === "completed" ? "completed" : child.status === "failed" ? "failed" : "cancelled";
    await db.update(agentDelegations).set({ status: newStatus, updatedAt: new Date() }).where(eq(agentDelegations.id, delegationId));
    return { delegation: { ...toDelegation(row), status: newStatus }, childStatus: child.status };
  }

  return { delegation: toDelegation(row), childStatus: child.status };
}

export async function listDelegationsForExecution(db: Db, organizationId: string, parentExecutionId: string): Promise<AgentDelegation[]> {
  const rows = await db.select().from(agentDelegations).where(and(eq(agentDelegations.organizationId, organizationId), eq(agentDelegations.parentExecutionId, parentExecutionId)));
  return rows.map(toDelegation);
}
