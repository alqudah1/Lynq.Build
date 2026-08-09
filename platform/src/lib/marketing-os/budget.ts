import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingBudgetEntries } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveMarketingAuthContext, requireMarketingViewAuthority, requireMarketingManageBudgetAuthority } from "./authz";
import { resolveCampaignById } from "./campaigns";
import { MarketingKeyAlreadyTakenError, StaleMarketingUpdateError } from "./errors";
import type { MarketingSpendSource } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingBudgetEntry {
  id: string;
  organizationId: string;
  campaignId: string;
  category: string;
  plannedAmount: string | null;
  spendAmount: string | null;
  currency: string;
  spendSource: MarketingSpendSource;
  recordedByUserId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Manual budget planning/tracking only — no ad-platform spend sync. `spendSource` is always written as `"manual"` here; the row's own field still exists so a future integration can extend it without a migration. */
export async function createBudgetEntry(db: Db, input: { organizationId: string; campaignId: string; category?: string; plannedAmount?: number | null; spendAmount?: number | null; currency: string; actorUserId: string }): Promise<MarketingBudgetEntry> {
  const campaign = await resolveCampaignById(db, input.organizationId, input.campaignId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageBudgetAuthority(db, ctx, "marketing_campaign", campaign.id);

  let row: MarketingBudgetEntry;
  try {
    [row] = (await db
      .insert(marketingBudgetEntries)
      .values({
        organizationId: input.organizationId,
        campaignId: campaign.id,
        category: input.category ?? "general",
        plannedAmount: input.plannedAmount != null ? String(input.plannedAmount) : null,
        spendAmount: input.spendAmount != null ? String(input.spendAmount) : null,
        currency: input.currency,
        spendSource: "manual",
        recordedByUserId: input.actorUserId,
      })
      .returning()) as unknown as MarketingBudgetEntry[];
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new MarketingKeyAlreadyTakenError("budget category", input.category ?? "general");
    throw err;
  }

  await recordAuditEvent(db, { eventType: "marketing_budget_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: campaign.id, metadata: { budgetEntryId: row.id, category: row.category } });
  return row;
}

export async function listBudgetEntriesForCampaign(db: Db, input: { organizationId: string; campaignId: string; actorUserId: string }): Promise<MarketingBudgetEntry[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_campaign", input.campaignId);
  return (await db.select().from(marketingBudgetEntries).where(and(eq(marketingBudgetEntries.organizationId, input.organizationId), eq(marketingBudgetEntries.campaignId, input.campaignId)))) as unknown as MarketingBudgetEntry[];
}

export async function updateBudgetEntry(db: Db, input: { organizationId: string; budgetEntryId: string; expectedRevision: number; plannedAmount?: number | null; spendAmount?: number | null; actorUserId: string }): Promise<MarketingBudgetEntry> {
  const [existing] = await db.select().from(marketingBudgetEntries).where(and(eq(marketingBudgetEntries.id, input.budgetEntryId), eq(marketingBudgetEntries.organizationId, input.organizationId)));
  if (!existing) throw new StaleMarketingUpdateError("budget entry");

  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageBudgetAuthority(db, ctx, "marketing_campaign", existing.campaignId);

  const values: Record<string, unknown> = { updatedAt: new Date(), revision: input.expectedRevision + 1, recordedByUserId: input.actorUserId };
  if (input.plannedAmount !== undefined) values.plannedAmount = input.plannedAmount != null ? String(input.plannedAmount) : null;
  if (input.spendAmount !== undefined) values.spendAmount = input.spendAmount != null ? String(input.spendAmount) : null;

  const [updated] = await db
    .update(marketingBudgetEntries)
    .set(values)
    .where(and(eq(marketingBudgetEntries.id, input.budgetEntryId), eq(marketingBudgetEntries.organizationId, input.organizationId), eq(marketingBudgetEntries.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleMarketingUpdateError("budget entry");

  await recordAuditEvent(db, { eventType: "marketing_budget_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: existing.campaignId, metadata: { budgetEntryId: updated.id, category: updated.category } });
  return updated as unknown as MarketingBudgetEntry;
}
