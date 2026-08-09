import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingContentItems, marketingContentItemArtifacts, marketingApprovalLinks, agentApprovalRequests } from "@/db/schema";
import { requireOrganizationMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveMarketingAuthContext, requireMarketingViewAuthority, requireMarketingManageContentAuthority, requireMarketingApproveContentAuthority } from "./authz";
import { resolveCampaignById } from "./campaigns";
import { InvalidMarketingTransitionError, StaleMarketingUpdateError, ContentNotApprovableError } from "./errors";
import type { MarketingContentType, MarketingContentStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingContentItem {
  id: string;
  organizationId: string;
  campaignId: string;
  title: string;
  contentType: MarketingContentType;
  status: MarketingContentStatus;
  ownerUserId: string | null;
  currentArtifactId: string | null;
  intendedChannel: string | null;
  plannedPublishAt: Date | null;
  publishedAt: Date | null;
  projectTaskId: string | null;
  createdByUserId: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ============================================================================
 * Content lifecycle — one explicit transition map
 * ============================================================================
 * `draft` → `review` → `approved` → `scheduled` → `published`; `review` →
 * `rejected` → `draft` (revise and resubmit); any pre-published state →
 * `archived`. `published` requires real external evidence or an explicit
 * manual confirmation (`confirmPublished`) — never set because an agent
 * merely generated a draft.
 */
const ALLOWED_TRANSITIONS: Record<MarketingContentStatus, MarketingContentStatus[]> = {
  draft: ["review", "archived"],
  review: ["approved", "rejected", "archived"],
  approved: ["scheduled", "archived"],
  scheduled: ["published", "archived"],
  published: ["archived"],
  rejected: ["draft", "archived"],
  archived: [],
};

export interface CreateContentItemInput {
  organizationId: string;
  campaignId: string;
  title: string;
  contentType: MarketingContentType;
  ownerUserId?: string | null;
  intendedChannel?: string | null;
  plannedPublishAt?: Date | null;
  projectTaskId?: string | null;
  actorUserId: string;
}

export async function createContentItem(db: Db, input: CreateContentItemInput): Promise<MarketingContentItem> {
  const campaign = await resolveCampaignById(db, input.organizationId, input.campaignId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_campaign", campaign.id);
  if (input.ownerUserId) await requireOrganizationMembership(db, input.organizationId, input.ownerUserId);

  const [row] = (await db
    .insert(marketingContentItems)
    .values({
      organizationId: input.organizationId,
      campaignId: campaign.id,
      title: input.title,
      contentType: input.contentType,
      ownerUserId: input.ownerUserId ?? input.actorUserId,
      intendedChannel: input.intendedChannel ?? null,
      plannedPublishAt: input.plannedPublishAt ?? null,
      projectTaskId: input.projectTaskId ?? null,
      createdByUserId: input.actorUserId,
    })
    .returning()) as unknown as MarketingContentItem[];

  await recordAuditEvent(db, { eventType: "marketing_content_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_item", targetId: row.id, metadata: { campaignId: campaign.id, contentType: row.contentType } });
  return row;
}

export async function resolveContentItemById(db: Db, organizationId: string, contentItemId: string): Promise<MarketingContentItem> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingContentItems).where(and(eq(marketingContentItems.id, contentItemId), eq(marketingContentItems.organizationId, organizationId)));
    return row as unknown as MarketingContentItem | undefined;
  });
}

export async function getContentItemForUser(db: Db, input: { organizationId: string; contentItemId: string; actorUserId: string }): Promise<MarketingContentItem> {
  const item = await resolveContentItemById(db, input.organizationId, input.contentItemId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_content_item", item.id);
  return item;
}

export async function listContentItemsForCampaign(db: Db, input: { organizationId: string; campaignId: string; actorUserId: string; status?: MarketingContentStatus }): Promise<MarketingContentItem[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_campaign", input.campaignId);
  const conditions = [eq(marketingContentItems.organizationId, input.organizationId), eq(marketingContentItems.campaignId, input.campaignId)];
  if (input.status) conditions.push(eq(marketingContentItems.status, input.status));
  return (await db.select().from(marketingContentItems).where(and(...conditions))) as unknown as MarketingContentItem[];
}

export async function listContentItemsForUser(db: Db, input: { organizationId: string; actorUserId: string; status?: MarketingContentStatus; ownerUserId?: string; limit?: number }): Promise<MarketingContentItem[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_content_item", "list");
  const conditions = [eq(marketingContentItems.organizationId, input.organizationId)];
  if (input.status) conditions.push(eq(marketingContentItems.status, input.status));
  if (input.ownerUserId) conditions.push(eq(marketingContentItems.ownerUserId, input.ownerUserId));
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  return (await db.select().from(marketingContentItems).where(and(...conditions)).limit(limit)) as unknown as MarketingContentItem[];
}

export interface UpdateContentItemInput {
  organizationId: string;
  contentItemId: string;
  expectedRevision: number;
  actorUserId: string;
  title?: string;
  ownerUserId?: string | null;
  intendedChannel?: string | null;
  plannedPublishAt?: Date | null;
  projectTaskId?: string | null;
}

export async function updateContentItem(db: Db, input: UpdateContentItemInput): Promise<MarketingContentItem> {
  const existing = await resolveContentItemById(db, input.organizationId, input.contentItemId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_item", existing.id);

  const values: Record<string, unknown> = { updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.title !== undefined) values.title = input.title;
  if (input.ownerUserId !== undefined) values.ownerUserId = input.ownerUserId;
  if (input.intendedChannel !== undefined) values.intendedChannel = input.intendedChannel;
  if (input.plannedPublishAt !== undefined) values.plannedPublishAt = input.plannedPublishAt;
  if (input.projectTaskId !== undefined) values.projectTaskId = input.projectTaskId;

  const [updated] = await db
    .update(marketingContentItems)
    .set(values)
    .where(and(eq(marketingContentItems.id, input.contentItemId), eq(marketingContentItems.organizationId, input.organizationId), eq(marketingContentItems.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleMarketingUpdateError("content item");

  await recordAuditEvent(db, { eventType: "marketing_content_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_item", targetId: updated.id, metadata: { fields: Object.keys(values).filter((k) => k !== "updatedAt" && k !== "revision") } });
  return updated as unknown as MarketingContentItem;
}

/** Attaches a new (real, immutable) Runtime artifact as the content item's newest version — never copies the artifact's own content into this table. Safe to call from a human upload or an agent task (`createdByAgentId`). */
export async function attachArtifactVersion(db: Db, input: { organizationId: string; contentItemId: string; artifactId: string; actorUserId?: string; createdByAgentId?: string }): Promise<MarketingContentItem> {
  const item = await resolveContentItemById(db, input.organizationId, input.contentItemId);

  const existingVersions = await db.select({ versionNumber: marketingContentItemArtifacts.versionNumber }).from(marketingContentItemArtifacts).where(eq(marketingContentItemArtifacts.contentItemId, item.id));
  const nextVersionNumber = Math.max(0, ...existingVersions.map((v) => v.versionNumber)) + 1;

  await db.insert(marketingContentItemArtifacts).values({ organizationId: input.organizationId, contentItemId: item.id, artifactId: input.artifactId, versionNumber: nextVersionNumber, createdByUserId: input.actorUserId ?? null, createdByAgentId: input.createdByAgentId ?? null });

  const [updated] = await db.update(marketingContentItems).set({ currentArtifactId: input.artifactId, updatedAt: new Date(), revision: item.revision + 1 }).where(eq(marketingContentItems.id, item.id)).returning();
  return updated as unknown as MarketingContentItem;
}

export async function listContentItemVersions(db: Db, input: { organizationId: string; contentItemId: string; actorUserId: string }) {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_content_item", input.contentItemId);
  return db
    .select()
    .from(marketingContentItemArtifacts)
    .where(and(eq(marketingContentItemArtifacts.organizationId, input.organizationId), eq(marketingContentItemArtifacts.contentItemId, input.contentItemId)))
    .orderBy(desc(marketingContentItemArtifacts.versionNumber));
}

export interface TransitionContentStatusInput {
  organizationId: string;
  contentItemId: string;
  toStatus: MarketingContentStatus;
  expectedRevision: number;
  actorUserId: string;
}

async function transitionContentStatus(db: Db, input: TransitionContentStatusInput, eventType: "marketing_content_submitted_for_review" | "marketing_content_approved" | "marketing_content_rejected" | "marketing_content_published" | "marketing_content_updated"): Promise<MarketingContentItem> {
  const existing = await resolveContentItemById(db, input.organizationId, input.contentItemId);
  if (!ALLOWED_TRANSITIONS[existing.status].includes(input.toStatus)) {
    throw new InvalidMarketingTransitionError("content item", existing.status, input.toStatus);
  }

  const values: Record<string, unknown> = { status: input.toStatus, updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.toStatus === "published") values.publishedAt = new Date();
  if (input.toStatus === "archived") values.archivedAt = new Date();

  const [updated] = await db
    .update(marketingContentItems)
    .set(values)
    .where(and(eq(marketingContentItems.id, input.contentItemId), eq(marketingContentItems.organizationId, input.organizationId), eq(marketingContentItems.revision, input.expectedRevision), eq(marketingContentItems.status, existing.status)))
    .returning();
  if (!updated) throw new StaleMarketingUpdateError("content item");

  await recordAuditEvent(db, { eventType, actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_item", targetId: updated.id, metadata: { from: existing.status, to: input.toStatus } });
  return updated as unknown as MarketingContentItem;
}

/** Submits a draft content item for review — requires a real Runtime artifact to already exist on it (never an empty review request). Manage-content authority only; the actual approval request is created separately via `agents.ts`'s `requestContentReviewApproval`. */
export async function submitContentForReview(db: Db, input: TransitionContentStatusInput): Promise<MarketingContentItem> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_item", input.contentItemId);

  const existing = await resolveContentItemById(db, input.organizationId, input.contentItemId);
  if (!existing.currentArtifactId) throw new ContentNotApprovableError("this content item has no draft artifact yet");

  return transitionContentStatus(db, { ...input, toStatus: "review" }, "marketing_content_submitted_for_review");
}

/** Applies a real Runtime approval decision to the content item — called from the approval-decision route/action after `approveRequest`/`rejectRequest` already ran. Preserves history: a rejection returns the item to `draft` for revision, never deletes anything. */
export async function applyContentApprovalDecision(db: Db, input: { organizationId: string; contentItemId: string; approvalRequestId: string; decision: "approved" | "rejected"; expectedRevision: number; actorUserId: string }): Promise<MarketingContentItem> {
  const [approval] = await db.select().from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, input.approvalRequestId), eq(agentApprovalRequests.organizationId, input.organizationId)));
  if (!approval || approval.status !== (input.decision === "approved" ? "approved" : "rejected")) {
    throw new ContentNotApprovableError("the linked Runtime approval request has not reached the expected decision yet");
  }
  const [link] = await db.select().from(marketingApprovalLinks).where(and(eq(marketingApprovalLinks.approvalRequestId, input.approvalRequestId), eq(marketingApprovalLinks.organizationId, input.organizationId)));
  if (!link || link.linkedEntityId !== input.contentItemId) throw new ContentNotApprovableError("this approval request is not linked to this content item");

  if (input.decision === "approved") {
    const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
    await requireMarketingApproveContentAuthority(db, ctx, "marketing_content_item", input.contentItemId);
    return transitionContentStatus(db, { organizationId: input.organizationId, contentItemId: input.contentItemId, toStatus: "approved", expectedRevision: input.expectedRevision, actorUserId: input.actorUserId }, "marketing_content_approved");
  }
  return transitionContentStatus(db, { organizationId: input.organizationId, contentItemId: input.contentItemId, toStatus: "rejected", expectedRevision: input.expectedRevision, actorUserId: input.actorUserId }, "marketing_content_rejected");
}

export async function scheduleContent(db: Db, input: TransitionContentStatusInput): Promise<MarketingContentItem> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_item", input.contentItemId);
  return transitionContentStatus(db, { ...input, toStatus: "scheduled" }, "marketing_content_updated");
}

/** The ONLY path `status` may ever become `"published"` — an explicit, human-confirmed action. Never set because an agent generated a draft, and never inferred from any other event. */
export async function confirmContentPublished(db: Db, input: TransitionContentStatusInput): Promise<MarketingContentItem> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_item", input.contentItemId);
  return transitionContentStatus(db, { ...input, toStatus: "published" }, "marketing_content_published");
}

export async function archiveContentItem(db: Db, input: TransitionContentStatusInput): Promise<MarketingContentItem> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_item", input.contentItemId);
  return transitionContentStatus(db, { ...input, toStatus: "archived" }, "marketing_content_updated");
}
