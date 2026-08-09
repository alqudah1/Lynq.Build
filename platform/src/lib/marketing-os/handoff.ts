import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { createLead, type CrmLead } from "@/lib/crm/leads";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "./authz";
import { getCampaignForUser } from "./campaigns";
import { recordAttribution, type MarketingAttributionRecord } from "./attribution";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Marketing → Sales/CRM handoff — Module 15
 * ============================================================================
 * The CRM lead created here is created through CRM Core's own real
 * `createLead` — never a second, Marketing-specific lead entity. Its
 * `sourceId` is set to the campaign's own `sourceId` when present, so Sales
 * OS and CRM Core see the exact same `crm_sources` reference every other
 * lead uses. Campaign/audience/UTM attribution is recorded as a bounded,
 * typed `marketing_attribution_records` row pointing at the new lead — a
 * reference, never a duplicated record. This function never assigns the
 * lead to a Sales OS rep; automatic assignment only ever happens through an
 * explicitly configured Workflow, never as an implicit side effect of
 * marketing lead creation.
 */
export interface CreateLeadFromCampaignInput {
  organizationId: string;
  campaignId: string;
  contactId?: string | null;
  companyId?: string | null;
  estimatedValueAmount?: number | null;
  estimatedValueCurrency?: string | null;
  destinationId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  externalClickId?: string | null;
  idempotencyKey?: string | null;
  actorUserId: string;
}

export async function createLeadFromCampaign(db: Db, input: CreateLeadFromCampaignInput): Promise<{ lead: CrmLead; attribution: MarketingAttributionRecord }> {
  const campaign = await getCampaignForUser(db, { organizationId: input.organizationId, campaignId: input.campaignId, actorUserId: input.actorUserId });

  const lead = await createLead(db, {
    organizationId: input.organizationId,
    contactId: input.contactId ?? null,
    companyId: input.companyId ?? null,
    sourceId: campaign.sourceId ?? null,
    estimatedValueAmount: input.estimatedValueAmount ?? null,
    estimatedValueCurrency: input.estimatedValueCurrency ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    actorUserId: input.actorUserId,
  });

  const attribution = await recordAttribution(db, {
    organizationId: input.organizationId,
    campaignId: campaign.id,
    destinationId: input.destinationId ?? null,
    crmLeadId: lead.id,
    sourceId: campaign.sourceId ?? null,
    touchType: "first_touch",
    utmSource: input.utmSource ?? null,
    utmMedium: input.utmMedium ?? null,
    utmCampaign: input.utmCampaign ?? null,
    utmContent: input.utmContent ?? null,
    utmTerm: input.utmTerm ?? null,
    externalClickId: input.externalClickId ?? null,
    actorUserId: input.actorUserId,
  });

  return { lead, attribution };
}

/** Read-only view Sales OS/CRM can use to see a lead's marketing origin — never a second lead model, just resolving the same `marketing_attribution_records` rows `attribution.ts` already exposes. */
export async function getCampaignReferenceForLead(db: Db, input: { organizationId: string; crmLeadId: string; actorUserId: string }): Promise<MarketingAttributionRecord | null> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_attribution_record", "list");
  const { listAttributionForLead } = await import("./attribution");
  const records = await listAttributionForLead(db, { organizationId: input.organizationId, crmLeadId: input.crmLeadId, actorUserId: input.actorUserId });
  return records.find((r) => r.touchType === "first_touch") ?? records[0] ?? null;
}
