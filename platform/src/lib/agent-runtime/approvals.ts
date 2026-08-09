import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentApprovalRequests, agentExecutions } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { requireApproverAuthority, requireAssignedAgent } from "./authz";
import { resolveExecutionById, transitionExecutionStatus, type AgentExecution } from "./executions";
import { recordExecutionEvent } from "./events";
import { ApprovalAlreadyDecidedError, InvalidExecutionTransitionError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * §7's full request/response/expiration state machine. Every request and
 * its resolution is permanent, append-only Historical Memory — there is
 * no update path beyond the single decide-once transition below, and no
 * delete path anywhere in this module.
 */
export type AgentApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled" | "revision_requested";
export type AgentApprovalRiskLevel = "low" | "medium" | "high" | "critical";

export interface AgentApprovalRequest {
  id: string;
  executionId: string;
  requestingAgentId: string;
  requestedAction: string;
  summary: string;
  riskLevel: AgentApprovalRiskLevel;
  artifactId: string | null;
  proposedActionRef: unknown;
  status: AgentApprovalStatus;
  decidedByUserId: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  expiresAt: Date;
  revision: number;
  createdAt: Date;
}

function toApproval(row: typeof agentApprovalRequests.$inferSelect): AgentApprovalRequest {
  return {
    id: row.id,
    executionId: row.executionId,
    requestingAgentId: row.requestingAgentId,
    requestedAction: row.requestedAction,
    summary: row.summary,
    riskLevel: row.riskLevel,
    artifactId: row.artifactId,
    proposedActionRef: row.proposedActionRef,
    status: row.status,
    decidedByUserId: row.decidedByUserId,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

const DEFAULT_EXPIRY_HOURS = 24;

export interface RequestApprovalInput {
  organizationId: string;
  executionId: string;
  requestedAction: string;
  summary: string;
  riskLevel: AgentApprovalRiskLevel;
  artifactId?: string | null;
  proposedActionRef?: unknown;
  expiresInHours?: number;
  actorAgentId: string;
}

/** Auto-generated the moment a plan step crosses into a gated band (§7). Pauses the execution at `human_approval` in the same call — a gated action never executes automatically regardless of the requesting agent's permission level or track record. */
export async function requestApproval(db: Db, input: RequestApprovalInput): Promise<{ request: AgentApprovalRequest; execution: AgentExecution }> {
  const existing = await resolveExecutionById(db, input.organizationId, input.executionId);
  requireAssignedAgent(existing, input.actorAgentId);

  const updatedExecution = await transitionExecutionStatus(db, {
    executionId: input.executionId,
    organizationId: input.organizationId,
    expectedRevision: existing.revision,
    fromStatuses: ["executing"],
    toStatus: "human_approval",
  });
  if (!updatedExecution) {
    throw new InvalidExecutionTransitionError(existing.status, "human_approval");
  }

  const expiresAt = new Date(Date.now() + (input.expiresInHours ?? DEFAULT_EXPIRY_HOURS) * 60 * 60 * 1000);

  const [row] = await db
    .insert(agentApprovalRequests)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      executionId: input.executionId,
      requestingAgentId: input.actorAgentId,
      requestedAction: input.requestedAction,
      summary: input.summary,
      riskLevel: input.riskLevel,
      artifactId: input.artifactId ?? null,
      proposedActionRef: input.proposedActionRef ?? null,
      expiresAt,
    })
    .returning();

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_approval_requested",
    fromStatus: "executing",
    toStatus: "human_approval",
    actorAgentId: input.actorAgentId,
    metadata: { approvalRequestId: row.id, riskLevel: input.riskLevel, requestedAction: input.requestedAction },
  });

  return { request: toApproval(row), execution: updatedExecution };
}

async function resolveApproval(db: Db, organizationId: string, approvalId: string): Promise<AgentApprovalRequest> {
  const [row] = await db.select().from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, approvalId), eq(agentApprovalRequests.organizationId, organizationId)));
  if (!row) throw new ApprovalAlreadyDecidedError();
  return toApproval(row);
}

async function decideOnce(
  db: Db,
  input: { organizationId: string; approvalId: string; expectedRevision: number; toStatus: Exclude<AgentApprovalStatus, "pending">; decidedByUserId: string | null; decisionNote?: string | null }
): Promise<AgentApprovalRequest> {
  const [row] = await db
    .update(agentApprovalRequests)
    .set({ status: input.toStatus, decidedByUserId: input.decidedByUserId, decisionNote: input.decisionNote ?? null, decidedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(agentApprovalRequests.id, input.approvalId), eq(agentApprovalRequests.organizationId, input.organizationId), eq(agentApprovalRequests.status, "pending"), eq(agentApprovalRequests.revision, input.expectedRevision)))
    .returning();

  if (!row) throw new ApprovalAlreadyDecidedError();
  return toApproval(row);
}

export interface DecideApprovalInput {
  organizationId: string;
  approvalId: string;
  decisionNote?: string | null;
  actorUserId: string;
}

/** §7: "Approved → action executes." Resumes the execution back to `executing`. */
export async function approveRequest(db: Db, input: DecideApprovalInput): Promise<AgentApprovalRequest> {
  const approval = await resolveApproval(db, input.organizationId, input.approvalId);
  const execution = await resolveExecutionById(db, input.organizationId, approval.executionId);
  await requireApproverAuthority(db, { organizationId: input.organizationId, workspaceId: execution.workspaceId, ownerUserId: execution.ownerUserId, actorUserId: input.actorUserId });

  const decided = await decideOnce(db, { organizationId: input.organizationId, approvalId: input.approvalId, expectedRevision: approval.revision, toStatus: "approved", decidedByUserId: input.actorUserId, decisionNote: input.decisionNote });

  const updatedExecution = await transitionExecutionStatus(db, { executionId: execution.id, organizationId: input.organizationId, expectedRevision: execution.revision, fromStatuses: ["human_approval"], toStatus: "executing" });
  if (!updatedExecution) throw new InvalidExecutionTransitionError(execution.status, "executing");

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: execution.id,
    eventType: "agent_approval_approved",
    fromStatus: "human_approval",
    toStatus: "executing",
    actorUserId: input.actorUserId,
    metadata: { approvalRequestId: input.approvalId },
  });

  return decided;
}

/** §7: "Rejected → task returns to Planning or Cancelled, depending on the human's own instruction." `severe: true` cancels; otherwise returns to Planning. */
export async function rejectRequest(db: Db, input: DecideApprovalInput & { severe?: boolean }): Promise<AgentApprovalRequest> {
  const approval = await resolveApproval(db, input.organizationId, input.approvalId);
  const execution = await resolveExecutionById(db, input.organizationId, approval.executionId);
  await requireApproverAuthority(db, { organizationId: input.organizationId, workspaceId: execution.workspaceId, ownerUserId: execution.ownerUserId, actorUserId: input.actorUserId });

  const decided = await decideOnce(db, { organizationId: input.organizationId, approvalId: input.approvalId, expectedRevision: approval.revision, toStatus: "rejected", decidedByUserId: input.actorUserId, decisionNote: input.decisionNote });

  const toStatus = input.severe ? "cancelled" : "planning";
  const updatedExecution = await transitionExecutionStatus(db, {
    executionId: execution.id,
    organizationId: input.organizationId,
    expectedRevision: execution.revision,
    fromStatuses: ["human_approval"],
    toStatus,
    extraSet: toStatus === "cancelled" ? { cancelledAt: new Date() } : {},
  });
  if (!updatedExecution) throw new InvalidExecutionTransitionError(execution.status, toStatus);

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: execution.id,
    eventType: "agent_approval_rejected",
    fromStatus: "human_approval",
    toStatus,
    actorUserId: input.actorUserId,
    metadata: { approvalRequestId: input.approvalId, severe: Boolean(input.severe) },
  });

  return decided;
}

/** §7: "Revision — the underlying task is still wanted, but this specific proposed action needs a change... routes back to Executing with the revision attached, not a full restart." */
export async function requestRevision(db: Db, input: DecideApprovalInput): Promise<AgentApprovalRequest> {
  const approval = await resolveApproval(db, input.organizationId, input.approvalId);
  const execution = await resolveExecutionById(db, input.organizationId, approval.executionId);
  await requireApproverAuthority(db, { organizationId: input.organizationId, workspaceId: execution.workspaceId, ownerUserId: execution.ownerUserId, actorUserId: input.actorUserId });

  const decided = await decideOnce(db, { organizationId: input.organizationId, approvalId: input.approvalId, expectedRevision: approval.revision, toStatus: "revision_requested", decidedByUserId: input.actorUserId, decisionNote: input.decisionNote });

  const updatedExecution = await transitionExecutionStatus(db, { executionId: execution.id, organizationId: input.organizationId, expectedRevision: execution.revision, fromStatuses: ["human_approval"], toStatus: "executing" });
  if (!updatedExecution) throw new InvalidExecutionTransitionError(execution.status, "executing");

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: execution.id,
    eventType: "agent_approval_revision_requested",
    fromStatus: "human_approval",
    toStatus: "executing",
    actorUserId: input.actorUserId,
    metadata: { approvalRequestId: input.approvalId, decisionNote: input.decisionNote ?? null },
  });

  return decided;
}

/** §7: "Expiration re-notifies/escalates; it never auto-approves and never auto-executes on timeout." A sweep function, not a per-request call — see `runtime cron/sweep` note in the module doc for how this is expected to be invoked. */
export async function expirePendingApprovals(db: Db, organizationId: string): Promise<number> {
  const rows = await db
    .update(agentApprovalRequests)
    .set({ status: "expired", decidedAt: new Date() })
    .where(and(eq(agentApprovalRequests.organizationId, organizationId), eq(agentApprovalRequests.status, "pending"), lt(agentApprovalRequests.expiresAt, new Date())))
    .returning();

  for (const row of rows) {
    await recordExecutionEvent(db, { organizationId, executionId: row.executionId, eventType: "agent_approval_expired", metadata: { approvalRequestId: row.id } });
  }

  return rows.length;
}

export async function listApprovalsForExecution(db: Db, organizationId: string, executionId: string): Promise<AgentApprovalRequest[]> {
  const rows = await db.select().from(agentApprovalRequests).where(and(eq(agentApprovalRequests.organizationId, organizationId), eq(agentApprovalRequests.executionId, executionId)));
  return rows.map(toApproval);
}

/**
 * "Pending approvals the user may decide" (Module 11's own "My Work"
 * requirement — the first cross-execution approval read this codebase
 * needed). Org owner/admin see every pending request; anyone else sees
 * only requests on executions they themselves own — mirroring
 * `requireApproverAuthority`'s own exact floor, applied as a list filter
 * instead of a per-request gate.
 */
export async function listPendingApprovalsForApprover(db: Db, input: { organizationId: string; actorUserId: string }): Promise<AgentApprovalRequest[]> {
  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  const isAdmin = membership.role === "owner" || membership.role === "admin";

  const rows = await db
    .select({ approval: agentApprovalRequests })
    .from(agentApprovalRequests)
    .innerJoin(agentExecutions, eq(agentExecutions.id, agentApprovalRequests.executionId))
    .where(and(eq(agentApprovalRequests.organizationId, input.organizationId), eq(agentApprovalRequests.status, "pending"), isAdmin ? undefined : eq(agentExecutions.ownerUserId, input.actorUserId)));

  return rows.map((r) => toApproval(r.approval));
}
