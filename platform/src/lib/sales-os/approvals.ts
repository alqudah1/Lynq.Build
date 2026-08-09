import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { salesApprovalLinks, agentApprovalRequests } from "@/db/schema";
import { listPendingApprovalsForApprover, type AgentApprovalRequest } from "@/lib/agent-runtime/approvals";
import { resolveSalesAuthContext, requireSalesViewAuthority } from "./authz";
import type { SalesApprovalLinkedEntityType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface SalesApprovalLink {
  id: string;
  organizationId: string;
  approvalRequestId: string;
  linkedEntityType: SalesApprovalLinkedEntityType;
  linkedEntityId: string;
  purpose: string;
  createdByUserId: string | null;
  createdAt: Date;
}

/**
 * Reads only — every `sales_approval_links` row is created by a real
 * approval-gated action (`agents.ts`'s `requestOpportunityContinuationApproval`/
 * `requestLeadReviewApproval`, or a future one following the same shape),
 * never by this module. Approval decisions themselves still go through
 * the existing Runtime `approveRequest`/`rejectRequest` — Sales OS never
 * duplicates that decision logic.
 */
export async function listApprovalLinksForEntity(db: Db, input: { organizationId: string; linkedEntityType: SalesApprovalLinkedEntityType; linkedEntityId: string; actorUserId: string }): Promise<(SalesApprovalLink & { approval: AgentApprovalRequest })[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, input.linkedEntityType, input.linkedEntityId);

  const rows = await db
    .select({ link: salesApprovalLinks, approval: agentApprovalRequests })
    .from(salesApprovalLinks)
    .innerJoin(agentApprovalRequests, eq(agentApprovalRequests.id, salesApprovalLinks.approvalRequestId))
    .where(and(eq(salesApprovalLinks.organizationId, input.organizationId), eq(salesApprovalLinks.linkedEntityType, input.linkedEntityType), eq(salesApprovalLinks.linkedEntityId, input.linkedEntityId)))
    .orderBy(salesApprovalLinks.createdAt);

  return rows.map((r) => ({ ...(r.link as unknown as SalesApprovalLink), approval: r.approval as unknown as AgentApprovalRequest }));
}

/** All pending approvals this user could decide that are also linked from Sales OS — the same derivation `work-queue.ts` uses, exposed here for reuse and for the dedicated approvals UI. */
export async function listPendingSalesApprovalsForApprover(db: Db, input: { organizationId: string; actorUserId: string }): Promise<AgentApprovalRequest[]> {
  const allPending = await listPendingApprovalsForApprover(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  const salesApprovalRequestIds = new Set((await db.select({ approvalRequestId: salesApprovalLinks.approvalRequestId }).from(salesApprovalLinks).where(eq(salesApprovalLinks.organizationId, input.organizationId))).map((r) => r.approvalRequestId));
  return allPending.filter((a) => salesApprovalRequestIds.has(a.id));
}
