import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingCampaignRuns, marketingCampaignRunItems, marketingPlaybookSteps } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveMarketingAuthContext, requireMarketingManageCampaignsAuthority, requireMarketingViewAuthority } from "./authz";
import { resolveCampaignById } from "./campaigns";
import { resolvePlaybookVersionById, listPlaybookSteps, type MarketingPlaybookStep } from "./playbooks";
import { DuplicateActiveRunError, StaleMarketingUpdateError, InvalidMarketingTransitionError, PlaybookNotPublishedError, CampaignRequirementsIncompleteError } from "./errors";
import type { MarketingRunStatus, MarketingRunItemStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingCampaignRun {
  id: string;
  organizationId: string;
  campaignId: string;
  playbookVersionId: string;
  ownerUserId: string | null;
  status: MarketingRunStatus;
  missingRequirements: string[];
  workflowExecutionId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketingCampaignRunItem {
  id: string;
  organizationId: string;
  campaignRunId: string;
  playbookStepId: string;
  status: MarketingRunItemStatus;
  completedByUserId: string | null;
  completedAt: Date | null;
  evidenceArtifactId: string | null;
  evidenceContentItemId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

async function refreshMissingRequirements(db: Db, organizationId: string, runId: string): Promise<void> {
  const items = await db
    .select({ status: marketingCampaignRunItems.status, stepKey: marketingPlaybookSteps.stepKey, required: marketingPlaybookSteps.required })
    .from(marketingCampaignRunItems)
    .innerJoin(marketingPlaybookSteps, eq(marketingPlaybookSteps.id, marketingCampaignRunItems.playbookStepId))
    .where(and(eq(marketingCampaignRunItems.organizationId, organizationId), eq(marketingCampaignRunItems.campaignRunId, runId)));

  const missing = items.filter((i) => i.required && i.status === "pending").map((i) => i.stepKey);
  await db.update(marketingCampaignRuns).set({ missingRequirements: missing, updatedAt: new Date() }).where(eq(marketingCampaignRuns.id, runId));
}

export interface StartCampaignRunInput {
  organizationId: string;
  campaignId: string;
  playbookVersionId: string;
  ownerUserId?: string | null;
  actorUserId: string;
}

/** Opens a new campaign run against a published playbook version and seeds one run item per playbook step. The campaign's own `status` is untouched — only an explicit `transitionCampaignStatus` call ever changes it. */
export async function startCampaignRun(db: Db, input: StartCampaignRunInput): Promise<{ run: MarketingCampaignRun; items: MarketingCampaignRunItem[] }> {
  const campaign = await resolveCampaignById(db, input.organizationId, input.campaignId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_campaign", campaign.id);

  const version = await resolvePlaybookVersionById(db, input.organizationId, input.playbookVersionId);
  if (version.status !== "published") throw new PlaybookNotPublishedError();

  let run: MarketingCampaignRun;
  try {
    [run] = (await db
      .insert(marketingCampaignRuns)
      .values({ organizationId: input.organizationId, campaignId: campaign.id, playbookVersionId: version.id, ownerUserId: input.ownerUserId ?? campaign.ownerUserId ?? input.actorUserId, status: "in_progress", startedAt: new Date() })
      .returning()) as unknown as MarketingCampaignRun[];
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateActiveRunError("campaign");
    throw err;
  }

  const steps = await listPlaybookSteps(db, { organizationId: input.organizationId, playbookVersionId: version.id, actorUserId: input.actorUserId });
  const items: MarketingCampaignRunItem[] = [];
  for (const step of steps) {
    const [item] = await db.insert(marketingCampaignRunItems).values({ organizationId: input.organizationId, campaignRunId: run.id, playbookStepId: step.id }).returning();
    items.push(item as MarketingCampaignRunItem);
  }
  await refreshMissingRequirements(db, input.organizationId, run.id);

  await recordAuditEvent(db, { eventType: "marketing_campaign_run_started", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: campaign.id, metadata: { runId: run.id, playbookVersionId: version.id, stepCount: steps.length } });

  const [refreshed] = await db.select().from(marketingCampaignRuns).where(eq(marketingCampaignRuns.id, run.id));
  return { run: refreshed as unknown as MarketingCampaignRun, items };
}

export async function resolveCampaignRunById(db: Db, organizationId: string, runId: string): Promise<MarketingCampaignRun> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingCampaignRuns).where(and(eq(marketingCampaignRuns.id, runId), eq(marketingCampaignRuns.organizationId, organizationId)));
    return row as unknown as MarketingCampaignRun | undefined;
  });
}

export async function listCampaignRunItems(db: Db, organizationId: string, runId: string): Promise<(MarketingCampaignRunItem & { step: MarketingPlaybookStep })[]> {
  const rows = await db
    .select({ item: marketingCampaignRunItems, step: marketingPlaybookSteps })
    .from(marketingCampaignRunItems)
    .innerJoin(marketingPlaybookSteps, eq(marketingPlaybookSteps.id, marketingCampaignRunItems.playbookStepId))
    .where(and(eq(marketingCampaignRunItems.organizationId, organizationId), eq(marketingCampaignRunItems.campaignRunId, runId)))
    .orderBy(marketingPlaybookSteps.sequence);
  return rows.map((r) => ({ ...(r.item as unknown as MarketingCampaignRunItem), step: r.step as unknown as MarketingPlaybookStep }));
}

export async function listCampaignRunsForCampaign(db: Db, input: { organizationId: string; campaignId: string; actorUserId: string }): Promise<MarketingCampaignRun[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_campaign", input.campaignId);
  const rows = await db.select().from(marketingCampaignRuns).where(and(eq(marketingCampaignRuns.organizationId, input.organizationId), eq(marketingCampaignRuns.campaignId, input.campaignId)));
  return rows as unknown as MarketingCampaignRun[];
}

/** Marks one run item complete/skipped — the run must still be open. Evidence is a loose pointer to a real artifact or content item, never copied content. */
export async function completeCampaignRunItem(db: Db, input: { organizationId: string; itemId: string; status: Exclude<MarketingRunItemStatus, "pending">; evidenceArtifactId?: string; evidenceContentItemId?: string; actorUserId: string }): Promise<MarketingCampaignRunItem> {
  const [existingItem] = await db.select().from(marketingCampaignRunItems).where(and(eq(marketingCampaignRunItems.id, input.itemId), eq(marketingCampaignRunItems.organizationId, input.organizationId)));
  if (!existingItem) throw new StaleMarketingUpdateError("campaign run item");

  const run = await resolveCampaignRunById(db, input.organizationId, existingItem.campaignRunId);
  if (run.status !== "in_progress" && run.status !== "waiting") throw new InvalidMarketingTransitionError("campaign run", run.status, "item update");

  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_campaign", run.campaignId);

  const [item] = await db
    .update(marketingCampaignRunItems)
    .set({ status: input.status, completedByUserId: input.actorUserId, completedAt: new Date(), evidenceArtifactId: input.evidenceArtifactId ?? null, evidenceContentItemId: input.evidenceContentItemId ?? null, updatedAt: new Date() })
    .where(eq(marketingCampaignRunItems.id, input.itemId))
    .returning();

  await refreshMissingRequirements(db, input.organizationId, run.id);
  return item as unknown as MarketingCampaignRunItem;
}

/** Marks the run complete — requires every mandatory requirement to be satisfied first. Never changes the campaign's own lifecycle status (a separate, explicit `transitionCampaignStatus` call does that). */
export async function completeCampaignRun(db: Db, input: { organizationId: string; runId: string; expectedRevision: number; actorUserId: string }): Promise<MarketingCampaignRun> {
  const run = await resolveCampaignRunById(db, input.organizationId, input.runId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_campaign", run.campaignId);

  if (run.missingRequirements.length > 0) throw new CampaignRequirementsIncompleteError(run.missingRequirements);

  const [updated] = await db
    .update(marketingCampaignRuns)
    .set({ status: "completed", completedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(marketingCampaignRuns.id, run.id), eq(marketingCampaignRuns.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleMarketingUpdateError("campaign run");

  await recordAuditEvent(db, { eventType: "marketing_campaign_run_completed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: run.campaignId, metadata: { runId: run.id } });
  return updated as unknown as MarketingCampaignRun;
}

export async function abandonCampaignRun(db: Db, input: { organizationId: string; runId: string; expectedRevision: number; actorUserId: string }): Promise<MarketingCampaignRun> {
  const run = await resolveCampaignRunById(db, input.organizationId, input.runId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_campaign", run.campaignId);

  if (!["not_started", "in_progress", "waiting"].includes(run.status)) throw new InvalidMarketingTransitionError("campaign run", run.status, "abandoned");

  const [updated] = await db
    .update(marketingCampaignRuns)
    .set({ status: "abandoned", completedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(marketingCampaignRuns.id, run.id), eq(marketingCampaignRuns.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleMarketingUpdateError("campaign run");
  return updated as unknown as MarketingCampaignRun;
}

/** Links this run to the real Workflow Engine execution driving it (e.g. the Campaign Planning Workflow template) — a trusted id reference only. */
export async function linkCampaignRunToWorkflowExecution(db: Db, input: { organizationId: string; runId: string; workflowExecutionId: string; expectedRevision: number; actorUserId: string }): Promise<MarketingCampaignRun> {
  const run = await resolveCampaignRunById(db, input.organizationId, input.runId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_campaign", run.campaignId);

  const [updated] = await db
    .update(marketingCampaignRuns)
    .set({ workflowExecutionId: input.workflowExecutionId, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(marketingCampaignRuns.id, run.id), eq(marketingCampaignRuns.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleMarketingUpdateError("campaign run");
  return updated as unknown as MarketingCampaignRun;
}
