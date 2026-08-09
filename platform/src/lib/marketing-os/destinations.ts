import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingCampaignDestinations } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveMarketingAuthContext, requireMarketingViewAuthority, requireMarketingManageCampaignsAuthority } from "./authz";
import { resolveCampaignById } from "./campaigns";
import { MarketingKeyAlreadyTakenError, StaleMarketingUpdateError } from "./errors";
import type { MarketingDestinationType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingCampaignDestination {
  id: string;
  organizationId: string;
  campaignId: string;
  label: string;
  url: string;
  destinationType: MarketingDestinationType;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  isActive: boolean;
  createdByUserId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDestinationInput {
  organizationId: string;
  campaignId: string;
  label: string;
  url: string;
  destinationType?: MarketingDestinationType;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent?: string;
  utmTerm?: string;
  actorUserId: string;
}

/** Canonical destination/UTM reference layer only — no page builder, no hosting. A duplicate UTM combination for the same campaign is rejected, never silently duplicated. */
export async function createDestination(db: Db, input: CreateDestinationInput): Promise<MarketingCampaignDestination> {
  const campaign = await resolveCampaignById(db, input.organizationId, input.campaignId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_campaign", campaign.id);

  let row: MarketingCampaignDestination;
  try {
    [row] = (await db
      .insert(marketingCampaignDestinations)
      .values({
        organizationId: input.organizationId,
        campaignId: campaign.id,
        label: input.label,
        url: input.url,
        destinationType: input.destinationType ?? "external_url",
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
        utmContent: input.utmContent ?? "",
        utmTerm: input.utmTerm ?? "",
        createdByUserId: input.actorUserId,
      })
      .returning()) as unknown as MarketingCampaignDestination[];
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new MarketingKeyAlreadyTakenError("destination UTM combination", `${input.utmSource}/${input.utmMedium}/${input.utmCampaign}`);
    throw err;
  }

  await recordAuditEvent(db, { eventType: "marketing_destination_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: campaign.id, metadata: { destinationId: row.id, utmSource: row.utmSource, utmMedium: row.utmMedium } });
  return row;
}

export async function resolveDestinationById(db: Db, organizationId: string, destinationId: string): Promise<MarketingCampaignDestination> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingCampaignDestinations).where(and(eq(marketingCampaignDestinations.id, destinationId), eq(marketingCampaignDestinations.organizationId, organizationId)));
    return row as unknown as MarketingCampaignDestination | undefined;
  });
}

export async function listDestinationsForCampaign(db: Db, input: { organizationId: string; campaignId: string; actorUserId: string }): Promise<MarketingCampaignDestination[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_campaign", input.campaignId);
  return (await db.select().from(marketingCampaignDestinations).where(and(eq(marketingCampaignDestinations.organizationId, input.organizationId), eq(marketingCampaignDestinations.campaignId, input.campaignId)))) as unknown as MarketingCampaignDestination[];
}

export async function deactivateDestination(db: Db, input: { organizationId: string; destinationId: string; expectedRevision: number; actorUserId: string }): Promise<MarketingCampaignDestination> {
  const existing = await resolveDestinationById(db, input.organizationId, input.destinationId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, "marketing_campaign", existing.campaignId);

  const [updated] = await db
    .update(marketingCampaignDestinations)
    .set({ isActive: false, updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(marketingCampaignDestinations.id, input.destinationId), eq(marketingCampaignDestinations.organizationId, input.organizationId), eq(marketingCampaignDestinations.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleMarketingUpdateError("destination");
  return updated as unknown as MarketingCampaignDestination;
}
