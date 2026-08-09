import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingCampaigns } from "@/db/schema";
import { requireOrganizationMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveMarketingAuthContext, requireMarketingViewAuthority, requireMarketingCreateCampaignsAuthority, requireMarketingManageCampaignsAuthority } from "./authz";
import { MarketingKeyAlreadyTakenError, InvalidMarketingTransitionError, StaleMarketingUpdateError } from "./errors";
import { marketingObjectiveTargetsSchema, type MarketingCampaignStatus, type MarketingObjectiveType, type MarketingObjectiveTargets } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingCampaign {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  campaignKey: string;
  name: string;
  description: string | null;
  objectiveType: MarketingObjectiveType;
  objectiveTargets: MarketingObjectiveTargets;
  status: MarketingCampaignStatus;
  ownerUserId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  budgetAmount: string | null;
  currency: string | null;
  primaryAudienceId: string | null;
  sourceId: string | null;
  projectId: string | null;
  workflowDefinitionId: string | null;
  createdByUserId: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ============================================================================
 * Campaign lifecycle — one explicit transition map, never arbitrary direct
 * status mutation
 * ============================================================================
 * `draft` → `planning` → `ready` → `active` ⇄ `paused`; `active`/`paused` →
 * `completed`/`cancelled`; any pre-active state → `cancelled`;
 * `completed`/`cancelled` → `archived` (terminal). `archived` has no
 * outgoing edge. This campaign row is the sole source of truth for
 * lifecycle status — a campaign run (`campaign-runs.ts`) tracks process
 * compliance against a playbook, never a second status truth.
 */
const ALLOWED_TRANSITIONS: Record<MarketingCampaignStatus, MarketingCampaignStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["ready", "draft", "cancelled"],
  ready: ["active", "planning", "cancelled"],
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "cancelled"],
  completed: ["archived"],
  cancelled: ["archived"],
  archived: [],
};

export interface CreateCampaignInput {
  organizationId: string;
  workspaceId?: string | null;
  campaignKey: string;
  name: string;
  description?: string;
  objectiveType?: MarketingObjectiveType;
  objectiveTargets?: MarketingObjectiveTargets;
  ownerUserId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  budgetAmount?: number | null;
  currency?: string | null;
  primaryAudienceId?: string | null;
  sourceId?: string | null;
  actorUserId: string;
}

export async function createCampaign(db: Db, input: CreateCampaignInput): Promise<MarketingCampaign> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingCreateCampaignsAuthority(db, ctx, "marketing_campaign", "new");
  if (input.ownerUserId) await requireOrganizationMembership(db, input.organizationId, input.ownerUserId);

  const objectiveTargets = marketingObjectiveTargetsSchema.parse(input.objectiveTargets ?? {});

  let row: MarketingCampaign;
  try {
    [row] = (await db
      .insert(marketingCampaigns)
      .values({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        campaignKey: input.campaignKey,
        name: input.name,
        description: input.description ?? null,
        objectiveType: input.objectiveType ?? "other",
        objectiveTargets,
        ownerUserId: input.ownerUserId ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        budgetAmount: input.budgetAmount != null ? String(input.budgetAmount) : null,
        currency: input.currency ?? null,
        primaryAudienceId: input.primaryAudienceId ?? null,
        sourceId: input.sourceId ?? null,
        createdByUserId: input.actorUserId,
      })
      .returning()) as unknown as MarketingCampaign[];
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new MarketingKeyAlreadyTakenError("marketing campaign", input.campaignKey);
    throw err;
  }

  await recordAuditEvent(db, { eventType: "marketing_campaign_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: row.id, metadata: { campaignKey: row.campaignKey, objectiveType: row.objectiveType } });
  return row;
}

export async function resolveCampaignById(db: Db, organizationId: string, campaignId: string): Promise<MarketingCampaign> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.organizationId, organizationId)));
    return row as unknown as MarketingCampaign | undefined;
  });
}

export async function getCampaignForUser(db: Db, input: { organizationId: string; campaignId: string; actorUserId: string }): Promise<MarketingCampaign> {
  const campaign = await resolveCampaignById(db, input.organizationId, input.campaignId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_campaign", campaign.id);
  return campaign;
}

export interface ListCampaignsInput {
  organizationId: string;
  actorUserId: string;
  status?: MarketingCampaignStatus;
  ownerUserId?: string;
  limit?: number;
}

export async function listCampaignsForUser(db: Db, input: ListCampaignsInput): Promise<MarketingCampaign[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_campaign", "list");

  const conditions = [eq(marketingCampaigns.organizationId, input.organizationId)];
  if (input.status) conditions.push(eq(marketingCampaigns.status, input.status));
  if (input.ownerUserId) conditions.push(eq(marketingCampaigns.ownerUserId, input.ownerUserId));

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db.select().from(marketingCampaigns).where(and(...conditions)).limit(limit);
  return rows as unknown as MarketingCampaign[];
}

export interface UpdateCampaignInput {
  organizationId: string;
  campaignId: string;
  expectedRevision: number;
  actorUserId: string;
  name?: string;
  description?: string | null;
  objectiveType?: MarketingObjectiveType;
  objectiveTargets?: MarketingObjectiveTargets;
  ownerUserId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  budgetAmount?: number | null;
  currency?: string | null;
  primaryAudienceId?: string | null;
  sourceId?: string | null;
}

/** General field update — lifecycle status changes only ever go through `transitionCampaignStatus`, never through here. */
export async function updateCampaign(db: Db, input: UpdateCampaignInput): Promise<MarketingCampaign> {
  const existing = await resolveCampaignById(db, input.organizationId, input.campaignId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_campaign", existing.id);
  if (input.ownerUserId) await requireOrganizationMembership(db, input.organizationId, input.ownerUserId);

  const values: Record<string, unknown> = { updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values.description = input.description;
  if (input.objectiveType !== undefined) values.objectiveType = input.objectiveType;
  if (input.objectiveTargets !== undefined) values.objectiveTargets = marketingObjectiveTargetsSchema.parse(input.objectiveTargets);
  if (input.ownerUserId !== undefined) values.ownerUserId = input.ownerUserId;
  if (input.startDate !== undefined) values.startDate = input.startDate;
  if (input.endDate !== undefined) values.endDate = input.endDate;
  if (input.budgetAmount !== undefined) values.budgetAmount = input.budgetAmount != null ? String(input.budgetAmount) : null;
  if (input.currency !== undefined) values.currency = input.currency;
  if (input.primaryAudienceId !== undefined) values.primaryAudienceId = input.primaryAudienceId;
  if (input.sourceId !== undefined) values.sourceId = input.sourceId;

  const [updated] = await db
    .update(marketingCampaigns)
    .set(values)
    .where(and(eq(marketingCampaigns.id, input.campaignId), eq(marketingCampaigns.organizationId, input.organizationId), eq(marketingCampaigns.revision, input.expectedRevision)))
    .returning();

  if (!updated) throw new StaleMarketingUpdateError("campaign");
  await recordAuditEvent(db, { eventType: "marketing_campaign_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: updated.id, metadata: { fields: Object.keys(values).filter((k) => k !== "updatedAt" && k !== "revision") } });
  return updated as unknown as MarketingCampaign;
}

export interface TransitionCampaignStatusInput {
  organizationId: string;
  campaignId: string;
  toStatus: MarketingCampaignStatus;
  expectedRevision: number;
  actorUserId: string;
}

/** The one path a campaign's `status` may ever change through — a revision-guarded compare-and-set against the explicit `ALLOWED_TRANSITIONS` map. */
export async function transitionCampaignStatus(db: Db, input: TransitionCampaignStatusInput): Promise<MarketingCampaign> {
  const existing = await resolveCampaignById(db, input.organizationId, input.campaignId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_campaign", existing.id);

  if (!ALLOWED_TRANSITIONS[existing.status].includes(input.toStatus)) {
    throw new InvalidMarketingTransitionError("campaign", existing.status, input.toStatus);
  }

  const values: Record<string, unknown> = { status: input.toStatus, updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.toStatus === "archived") values.archivedAt = new Date();

  const [updated] = await db
    .update(marketingCampaigns)
    .set(values)
    .where(and(eq(marketingCampaigns.id, input.campaignId), eq(marketingCampaigns.organizationId, input.organizationId), eq(marketingCampaigns.revision, input.expectedRevision), eq(marketingCampaigns.status, existing.status)))
    .returning();

  if (!updated) throw new StaleMarketingUpdateError("campaign");
  await recordAuditEvent(db, { eventType: "marketing_campaign_status_changed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: updated.id, metadata: { from: existing.status, to: input.toStatus } });
  if (input.toStatus === "archived") {
    await recordAuditEvent(db, { eventType: "marketing_campaign_archived", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: updated.id, metadata: {} });
  }
  return updated as unknown as MarketingCampaign;
}

/** Links this campaign to a real Projects Core project (the campaign's own denormalized primary pointer) — never creates a project automatically; a Workflow may be configured to do so explicitly. */
export async function linkCampaignToProject(db: Db, input: { organizationId: string; campaignId: string; projectId: string; expectedRevision: number; actorUserId: string }): Promise<MarketingCampaign> {
  const existing = await resolveCampaignById(db, input.organizationId, input.campaignId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_campaign", existing.id);

  const [updated] = await db
    .update(marketingCampaigns)
    .set({ projectId: input.projectId, updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(marketingCampaigns.id, input.campaignId), eq(marketingCampaigns.organizationId, input.organizationId), eq(marketingCampaigns.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleMarketingUpdateError("campaign");

  await recordAuditEvent(db, { eventType: "marketing_project_linked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: updated.id, metadata: { projectId: input.projectId } });
  return updated as unknown as MarketingCampaign;
}

/** Links this campaign to a published Workflow definition (a trusted id reference only — never copies workflow configuration). */
export async function linkCampaignToWorkflow(db: Db, input: { organizationId: string; campaignId: string; workflowDefinitionId: string; expectedRevision: number; actorUserId: string }): Promise<MarketingCampaign> {
  const existing = await resolveCampaignById(db, input.organizationId, input.campaignId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_campaign", existing.id);

  const [updated] = await db
    .update(marketingCampaigns)
    .set({ workflowDefinitionId: input.workflowDefinitionId, updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(marketingCampaigns.id, input.campaignId), eq(marketingCampaigns.organizationId, input.organizationId), eq(marketingCampaigns.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleMarketingUpdateError("campaign");
  return updated as unknown as MarketingCampaign;
}
