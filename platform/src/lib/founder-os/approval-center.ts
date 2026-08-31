import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { salesApprovalLinks, marketingApprovalLinks, communicationApprovalLinks, projectApprovalLinks } from "@/db/schema";
import { listPendingApprovalsForApprover, approveRequest, rejectRequest, requestRevision, type AgentApprovalRequest } from "@/lib/agent-runtime/approvals";
import { recordAuditEvent } from "@/lib/audit";
import { resolveFounderAuthContext, requireFounderViewAuthority } from "./authz";
import { enqueueJob } from "@/lib/runtime/queue";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface FounderApprovalItem extends AgentApprovalRequest {
  /** Which module originated this approval, resolved from the real `*_approval_links` join tables — `"agent_runtime"` when no domain link exists (a plain agent-runtime-native approval). */
  requestingSystem: "sales" | "marketing" | "communications" | "projects" | "agent_runtime";
  linkedEntityType: string | null;
  linkedEntityId: string | null;
}

/**
 * ============================================================================
 * Approval Center — Module 18
 * ============================================================================
 * NOT a second approval system — every read and every decision goes
 * through Agent Runtime's own real, unmodified approval functions
 * (`listPendingApprovalsForApprover`/`approveRequest`/`rejectRequest`/
 * `requestRevision`, Module 7). This file only adds Founder-permission
 * gating and cross-module context (which system requested it, and what
 * it's linked to) by joining the existing `sales_approval_links`/
 * `marketing_approval_links`/`communication_approval_links` tables —
 * never a parallel decision path.
 */
export async function listFounderApprovals(db: Db, input: { organizationId: string; actorUserId: string }): Promise<FounderApprovalItem[]> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, ctx, "founder_approval_center", input.organizationId);

  const approvals = await listPendingApprovalsForApprover(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  if (approvals.length === 0) return [];

  const [salesLinks, marketingLinks, commsLinks, projectLinks] = await Promise.all([
    db.select().from(salesApprovalLinks).where(eq(salesApprovalLinks.organizationId, input.organizationId)),
    db.select().from(marketingApprovalLinks).where(eq(marketingApprovalLinks.organizationId, input.organizationId)),
    db.select().from(communicationApprovalLinks).where(eq(communicationApprovalLinks.organizationId, input.organizationId)),
    db.select().from(projectApprovalLinks).where(eq(projectApprovalLinks.organizationId, input.organizationId)),
  ]);
  const salesByApproval = new Map(salesLinks.map((l) => [l.approvalRequestId, l]));
  const marketingByApproval = new Map(marketingLinks.map((l) => [l.approvalRequestId, l]));
  const commsByApproval = new Map(commsLinks.map((l) => [l.approvalRequestId, l]));
  const projectByApproval = new Map(projectLinks.map((l) => [l.approvalRequestId, l]));

  return approvals.map((approval) => {
    const salesLink = salesByApproval.get(approval.id);
    const marketingLink = marketingByApproval.get(approval.id);
    const commsLink = commsByApproval.get(approval.id);
    const projectLink = projectByApproval.get(approval.id);
    if (salesLink) return { ...approval, requestingSystem: "sales" as const, linkedEntityType: salesLink.linkedEntityType, linkedEntityId: salesLink.linkedEntityId };
    if (marketingLink) return { ...approval, requestingSystem: "marketing" as const, linkedEntityType: marketingLink.linkedEntityType, linkedEntityId: marketingLink.linkedEntityId };
    if (commsLink) return { ...approval, requestingSystem: "communications" as const, linkedEntityType: commsLink.linkedEntityType, linkedEntityId: commsLink.linkedEntityId };
    if (projectLink) return { ...approval, requestingSystem: "projects" as const, linkedEntityType: projectLink.linkedEntityType, linkedEntityId: projectLink.linkedEntityId };
    return { ...approval, requestingSystem: "agent_runtime" as const, linkedEntityType: null, linkedEntityId: null };
  });
}

async function recordFounderApprovalDecision(db: Db, input: { organizationId: string; actorUserId: string; approvalId: string; decision: "approved" | "rejected" | "revision_requested" }): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "founder_approval_decided",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    targetType: "agent_approval_request",
    targetId: input.approvalId,
    metadata: { decision: input.decision },
  });
}

export async function decideFounderApproval(
  db: Db,
  input: { organizationId: string; approvalId: string; decision: "approve" | "reject" | "request_revision"; decisionNote?: string | null; severe?: boolean; actorUserId: string }
): Promise<AgentApprovalRequest> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, ctx, "founder_approval_center", input.organizationId);

  let result: AgentApprovalRequest;
  if (input.decision === "approve") {
    result = await approveRequest(db, { organizationId: input.organizationId, approvalId: input.approvalId, decisionNote: input.decisionNote, actorUserId: input.actorUserId });
    await recordFounderApprovalDecision(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, approvalId: input.approvalId, decision: "approved" });
  } else if (input.decision === "reject") {
    result = await rejectRequest(db, { organizationId: input.organizationId, approvalId: input.approvalId, decisionNote: input.decisionNote, severe: input.severe, actorUserId: input.actorUserId });
    await recordFounderApprovalDecision(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, approvalId: input.approvalId, decision: "rejected" });
  } else {
    result = await requestRevision(db, { organizationId: input.organizationId, approvalId: input.approvalId, decisionNote: input.decisionNote, actorUserId: input.actorUserId });
    await recordFounderApprovalDecision(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, approvalId: input.approvalId, decision: "revision_requested" });
  }
  if (input.decision !== "reject" || !input.severe) {
    await enqueueJob(db, {
      organizationId: input.organizationId,
      jobType: "execution_resume",
      executionId: result.executionId,
      idempotencyKey: `founder-approval-resume:${result.id}`,
      priority: 100,
    });
  }
  return result;
}
