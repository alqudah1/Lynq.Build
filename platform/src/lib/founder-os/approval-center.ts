import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import { salesApprovalLinks, marketingApprovalLinks, communicationApprovalLinks, projectApprovalLinks, agentApprovalRequests, socialContentVariants, socialAdChangeRequests } from "@/db/schema";
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

/**
 * Module 19 approvals (a social post variant or an ad change request) are
 * decided through the Social service, which calls the same
 * `approveRequest`/`rejectRequest`/`requestRevision` AND moves the linked
 * record (approved → scheduled/publish job, changes requested, ad change
 * queued for execution). Deciding only the runtime approval here would
 * leave the post "in review" with an already-approved request. The Social
 * service enforces its own Marketing OS capability on top of the Founder
 * view check above. Returns null for every other approval.
 */
async function decideLinkedSocialApproval(
  db: Db,
  input: { organizationId: string; approvalId: string; decision: "approve" | "reject" | "request_revision"; decisionNote?: string | null; actorUserId: string }
): Promise<AgentApprovalRequest | null> {
  const [link] = await db
    .select()
    .from(marketingApprovalLinks)
    .where(and(eq(marketingApprovalLinks.organizationId, input.organizationId), eq(marketingApprovalLinks.approvalRequestId, input.approvalId)));
  if (!link || (link.linkedEntityType !== "content_variant" && link.linkedEntityType !== "ad_change_request")) return null;
  const note = input.decisionNote ?? undefined;
  if (link.linkedEntityType === "content_variant") {
    const [variant] = await db.select({ revision: socialContentVariants.revision }).from(socialContentVariants).where(and(eq(socialContentVariants.id, link.linkedEntityId), eq(socialContentVariants.organizationId, input.organizationId)));
    if (!variant) return null;
    const { decideVariantApproval } = await import("@/lib/social-os/content");
    await decideVariantApproval(db, { organizationId: input.organizationId, contentVariantId: link.linkedEntityId, actorUserId: input.actorUserId, expectedRevision: variant.revision, decision: input.decision === "request_revision" ? "request_changes" : input.decision, note });
  } else {
    const [change] = await db.select({ revision: socialAdChangeRequests.revision }).from(socialAdChangeRequests).where(and(eq(socialAdChangeRequests.id, link.linkedEntityId), eq(socialAdChangeRequests.organizationId, input.organizationId)));
    if (!change) return null;
    const { InvalidSocialTransitionError } = await import("@/lib/social-os/errors");
    // An ad change executes exactly the approved payload — there is no "revise in place"; reject it and propose a new one.
    if (input.decision === "request_revision") throw new InvalidSocialTransitionError("advertising change", "pending_approval", "revision_requested");
    const { decideAdChange } = await import("@/lib/social-os/advertising");
    await decideAdChange(db, { organizationId: input.organizationId, changeRequestId: link.linkedEntityId, actorUserId: input.actorUserId, expectedRevision: change.revision, decision: input.decision, note });
  }
  const [decided] = await db.select().from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, input.approvalId), eq(agentApprovalRequests.organizationId, input.organizationId)));
  return {
    id: decided.id,
    executionId: decided.executionId,
    requestingAgentId: decided.requestingAgentId,
    requestedAction: decided.requestedAction,
    summary: decided.summary,
    riskLevel: decided.riskLevel,
    artifactId: decided.artifactId,
    proposedActionRef: decided.proposedActionRef,
    status: decided.status,
    decidedByUserId: decided.decidedByUserId,
    decisionNote: decided.decisionNote,
    decidedAt: decided.decidedAt,
    expiresAt: decided.expiresAt,
    revision: decided.revision,
    createdAt: decided.createdAt,
  };
}

export async function decideFounderApproval(
  db: Db,
  input: { organizationId: string; approvalId: string; decision: "approve" | "reject" | "request_revision"; decisionNote?: string | null; severe?: boolean; actorUserId: string }
): Promise<AgentApprovalRequest> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, ctx, "founder_approval_center", input.organizationId);

  const social = await decideLinkedSocialApproval(db, input);
  if (social) {
    await recordFounderApprovalDecision(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, approvalId: input.approvalId, decision: input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "revision_requested" });
    return social;
  }

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
