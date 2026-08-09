import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingApprovalLinks, agentApprovalRequests } from "@/db/schema";
import { listPendingApprovalsForApprover, type AgentApprovalRequest } from "@/lib/agent-runtime/approvals";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "./authz";
import type { MarketingApprovalLinkedEntityType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingApprovalLink {
  id: string;
  organizationId: string;
  approvalRequestId: string;
  linkedEntityType: MarketingApprovalLinkedEntityType;
  linkedEntityId: string;
  purpose: string;
  createdByUserId: string | null;
  createdAt: Date;
}

/** Reads only — every `marketing_approval_links` row is created by a real approval-gated action (`agents.ts`'s `requestContentReviewApproval`), never by this module. Approval decisions still go through the existing Runtime `approveRequest`/`rejectRequest` — Marketing OS never duplicates that decision logic. */
export async function listApprovalLinksForEntity(db: Db, input: { organizationId: string; linkedEntityType: MarketingApprovalLinkedEntityType; linkedEntityId: string; actorUserId: string }): Promise<(MarketingApprovalLink & { approval: AgentApprovalRequest })[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, input.linkedEntityType, input.linkedEntityId);

  const rows = await db
    .select({ link: marketingApprovalLinks, approval: agentApprovalRequests })
    .from(marketingApprovalLinks)
    .innerJoin(agentApprovalRequests, eq(agentApprovalRequests.id, marketingApprovalLinks.approvalRequestId))
    .where(and(eq(marketingApprovalLinks.organizationId, input.organizationId), eq(marketingApprovalLinks.linkedEntityType, input.linkedEntityType), eq(marketingApprovalLinks.linkedEntityId, input.linkedEntityId)))
    .orderBy(marketingApprovalLinks.createdAt);

  return rows.map((r) => ({ ...(r.link as unknown as MarketingApprovalLink), approval: r.approval as unknown as AgentApprovalRequest }));
}

/** All pending approvals this user could decide that are also linked from Marketing OS. */
export async function listPendingMarketingApprovalsForApprover(db: Db, input: { organizationId: string; actorUserId: string }): Promise<AgentApprovalRequest[]> {
  const allPending = await listPendingApprovalsForApprover(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  const marketingApprovalRequestIds = new Set((await db.select({ approvalRequestId: marketingApprovalLinks.approvalRequestId }).from(marketingApprovalLinks).where(eq(marketingApprovalLinks.organizationId, input.organizationId))).map((r) => r.approvalRequestId));
  return allPending.filter((a) => marketingApprovalRequestIds.has(a.id));
}
