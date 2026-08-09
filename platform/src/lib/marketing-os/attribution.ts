import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingAttributionRecords } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveMarketingAuthContext, requireMarketingViewAuthority, requireMarketingManageCampaignsAuthority } from "./authz";
import type { MarketingAttributionTouchType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingAttributionRecord {
  id: string;
  organizationId: string;
  campaignId: string | null;
  destinationId: string | null;
  crmLeadId: string | null;
  crmContactId: string | null;
  sourceId: string | null;
  touchType: MarketingAttributionTouchType;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  externalClickId: string | null;
  capturedAt: Date;
  createdAt: Date;
}

export interface RecordAttributionInput {
  organizationId: string;
  campaignId?: string | null;
  destinationId?: string | null;
  crmLeadId?: string | null;
  crmContactId?: string | null;
  sourceId?: string | null;
  touchType: MarketingAttributionTouchType;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  externalClickId?: string | null;
  capturedAt?: Date;
  actorUserId: string;
}

/**
 * Deterministic first-touch/latest-touch storage — never full multi-touch
 * modeling. `first_touch` is write-once and idempotent (a duplicate
 * submission for the same lead/contact is a safe no-op, never a second
 * row); `last_touch` is always upserted to the newest observed touch. No
 * PII is ever written here — `crmLeadId`/`crmContactId` are bare id
 * pointers, `externalClickId` is an opaque reference id, never a name,
 * email, or phone number.
 */
export async function recordAttribution(db: Db, input: RecordAttributionInput): Promise<MarketingAttributionRecord> {
  if (!input.crmLeadId && !input.crmContactId) throw new Error("recordAttribution requires at least one of crmLeadId/crmContactId");

  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_attribution_record", "new");

  const values = {
    organizationId: input.organizationId,
    campaignId: input.campaignId ?? null,
    destinationId: input.destinationId ?? null,
    crmLeadId: input.crmLeadId ?? null,
    crmContactId: input.crmLeadId ? null : (input.crmContactId ?? null),
    sourceId: input.sourceId ?? null,
    touchType: input.touchType,
    utmSource: input.utmSource ?? null,
    utmMedium: input.utmMedium ?? null,
    utmCampaign: input.utmCampaign ?? null,
    utmContent: input.utmContent ?? null,
    utmTerm: input.utmTerm ?? null,
    externalClickId: input.externalClickId ?? null,
    capturedAt: input.capturedAt ?? new Date(),
  };

  let row: MarketingAttributionRecord;
  if (input.touchType === "first_touch") {
    try {
      [row] = (await db.insert(marketingAttributionRecords).values(values).returning()) as unknown as MarketingAttributionRecord[];
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        const existing = await resolveExistingTouch(db, input.organizationId, "first_touch", input.crmLeadId ?? null, input.crmContactId ?? null);
        if (!existing) throw err;
        return existing;
      }
      throw err;
    }
  } else {
    const existing = await resolveExistingTouch(db, input.organizationId, "last_touch", input.crmLeadId ?? null, input.crmContactId ?? null);
    if (existing) {
      await db.delete(marketingAttributionRecords).where(eq(marketingAttributionRecords.id, existing.id));
    }
    [row] = (await db.insert(marketingAttributionRecords).values(values).returning()) as unknown as MarketingAttributionRecord[];
  }

  await recordAuditEvent(db, { eventType: "marketing_attribution_recorded", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_attribution_record", targetId: row.id, metadata: { touchType: row.touchType, campaignId: row.campaignId, hasLead: Boolean(row.crmLeadId), hasContact: Boolean(row.crmContactId) } });
  return row;
}

async function resolveExistingTouch(db: Db, organizationId: string, touchType: MarketingAttributionTouchType, crmLeadId: string | null, crmContactId: string | null): Promise<MarketingAttributionRecord | null> {
  if (crmLeadId) {
    const [row] = await db.select().from(marketingAttributionRecords).where(and(eq(marketingAttributionRecords.organizationId, organizationId), eq(marketingAttributionRecords.crmLeadId, crmLeadId), eq(marketingAttributionRecords.touchType, touchType)));
    return (row as unknown as MarketingAttributionRecord) ?? null;
  }
  if (crmContactId) {
    const [row] = await db
      .select()
      .from(marketingAttributionRecords)
      .where(and(eq(marketingAttributionRecords.organizationId, organizationId), eq(marketingAttributionRecords.crmContactId, crmContactId), eq(marketingAttributionRecords.touchType, touchType), isNull(marketingAttributionRecords.crmLeadId)));
    return (row as unknown as MarketingAttributionRecord) ?? null;
  }
  return null;
}

export async function listAttributionForLead(db: Db, input: { organizationId: string; crmLeadId: string; actorUserId: string }): Promise<MarketingAttributionRecord[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_attribution_record", "list");
  return (await db.select().from(marketingAttributionRecords).where(and(eq(marketingAttributionRecords.organizationId, input.organizationId), eq(marketingAttributionRecords.crmLeadId, input.crmLeadId)))) as unknown as MarketingAttributionRecord[];
}

export async function listAttributionForCampaign(db: Db, input: { organizationId: string; campaignId: string; actorUserId: string }): Promise<MarketingAttributionRecord[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_campaign", input.campaignId);
  return (await db.select().from(marketingAttributionRecords).where(and(eq(marketingAttributionRecords.organizationId, input.organizationId), eq(marketingAttributionRecords.campaignId, input.campaignId)))) as unknown as MarketingAttributionRecord[];
}
