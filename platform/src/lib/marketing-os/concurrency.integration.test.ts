import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, randMarketingKey, makeTestMarketingPlaybook } from "./test-helpers";
import { createCampaign } from "./campaigns";
import { MarketingKeyAlreadyTakenError, StaleMarketingUpdateError, PlaybookVersionImmutableError, DuplicateActiveRunError } from "./errors";
import { createAudience } from "./audiences";
import { linkAudienceToCampaign } from "./audiences";
import { createContentItem } from "./content";
import { createDestination } from "./destinations";
import { addPlaybookStep, publishPlaybookVersion } from "./playbooks";
import { startCampaignRun } from "./campaign-runs";
import { createBudgetEntry, updateBudgetEntry } from "./budget";
import { recordAttribution } from "./attribution";
import { requestContentReviewApproval, seedMarketingAgents } from "./agents";
import { marketingApprovalLinks } from "@/db/schema";
import { eq } from "drizzle-orm";

afterEach(cleanupAgentRuntimeTestData);

describe("Marketing OS concurrency and idempotency guarantees", () => {
  it("duplicate campaign keys fail safely", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const key = randMarketingKey("CAMP");
    await createCampaign(db, { organizationId: orgId, campaignKey: key, name: "First", actorUserId: ownerId });
    await expect(createCampaign(db, { organizationId: orgId, campaignKey: key, name: "Second", actorUserId: ownerId })).rejects.toThrow(MarketingKeyAlreadyTakenError);
  });

  it("campaign lifecycle transitions are revision guarded — a stale revision fails, never silently overwrites", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test", actorUserId: ownerId });
    const { transitionCampaignStatus } = await import("./campaigns");
    await transitionCampaignStatus(db, { organizationId: orgId, campaignId: campaign.id, toStatus: "planning", expectedRevision: campaign.revision, actorUserId: ownerId });
    // "planning" -> "ready" is a valid transition, but reusing the now-stale original revision must still fail — the revision guard, not the transition map, is what's being proven here.
    await expect(transitionCampaignStatus(db, { organizationId: orgId, campaignId: campaign.id, toStatus: "ready", expectedRevision: campaign.revision, actorUserId: ownerId })).rejects.toThrow(StaleMarketingUpdateError);
  });

  it("a stale content item update fails", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test", actorUserId: ownerId });
    const content = await createContentItem(db, { organizationId: orgId, campaignId: campaign.id, title: "Draft", contentType: "social_post", actorUserId: ownerId });
    const { updateContentItem } = await import("./content");
    await updateContentItem(db, { organizationId: orgId, contentItemId: content.id, expectedRevision: content.revision, title: "Renamed once", actorUserId: ownerId });
    await expect(updateContentItem(db, { organizationId: orgId, contentItemId: content.id, expectedRevision: content.revision, title: "Renamed twice", actorUserId: ownerId })).rejects.toThrow(StaleMarketingUpdateError);
  });

  it("a published marketing playbook version is immutable — no further steps may be added", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { version } = await makeTestMarketingPlaybook(orgId, ownerId, "campaign");
    await expect(addPlaybookStep(db, { organizationId: orgId, playbookVersionId: version.id, stepKey: "EXTRA", stepType: "checklist", name: "Extra", sequence: 1, actorUserId: ownerId })).rejects.toThrow(PlaybookVersionImmutableError);
  });

  it("publishing a marketing playbook version onto an already-published playbook is revision-guarded", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { playbook, version } = await makeTestMarketingPlaybook(orgId, ownerId, "campaign");
    await expect(publishPlaybookVersion(db, { organizationId: orgId, playbookId: playbook.id, versionId: version.id, expectedRevision: 1, actorUserId: ownerId })).rejects.toThrow(StaleMarketingUpdateError);
  });

  it("a campaign cannot have two active playbook runs at once", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test", actorUserId: ownerId });
    const { version } = await makeTestMarketingPlaybook(orgId, ownerId, "campaign");
    await startCampaignRun(db, { organizationId: orgId, campaignId: campaign.id, playbookVersionId: version.id, actorUserId: ownerId });
    await expect(startCampaignRun(db, { organizationId: orgId, campaignId: campaign.id, playbookVersionId: version.id, actorUserId: ownerId })).rejects.toThrow(DuplicateActiveRunError);
  });

  it("duplicate audience-to-campaign links are prevented idempotently — never a second row", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test", actorUserId: ownerId });
    const audience = await createAudience(db, { organizationId: orgId, name: "Audience", audienceKey: randMarketingKey("AUD"), entityType: "lead", actorUserId: ownerId });

    await linkAudienceToCampaign(db, { organizationId: orgId, campaignId: campaign.id, audienceId: audience.id, actorUserId: ownerId });
    await linkAudienceToCampaign(db, { organizationId: orgId, campaignId: campaign.id, audienceId: audience.id, actorUserId: ownerId }); // no throw — idempotent no-op

    const { listAudiencesForCampaign } = await import("./audiences");
    const linked = await listAudiencesForCampaign(db, { organizationId: orgId, campaignId: campaign.id, actorUserId: ownerId });
    expect(linked).toHaveLength(1);
  });

  it("a duplicate destination UTM combination for the same campaign is controlled (rejected), never silently duplicated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test", actorUserId: ownerId });
    await createDestination(db, { organizationId: orgId, campaignId: campaign.id, label: "First", url: "https://example.com/a", utmSource: "google", utmMedium: "cpc", utmCampaign: "spring", actorUserId: ownerId });
    await expect(createDestination(db, { organizationId: orgId, campaignId: campaign.id, label: "Duplicate", url: "https://example.com/b", utmSource: "google", utmMedium: "cpc", utmCampaign: "spring", actorUserId: ownerId })).rejects.toThrow(MarketingKeyAlreadyTakenError);
  });

  it("a duplicate approval link for the same content item / approval request is prevented", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await seedMarketingAgents(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId });
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test", actorUserId: ownerId });
    const content = await createContentItem(db, { organizationId: orgId, campaignId: campaign.id, title: "Draft", contentType: "social_post", actorUserId: ownerId });
    const { approval } = await requestContentReviewApproval(db, { organizationId: orgId, contentItemId: content.id, summary: "Review please", actorUserId: ownerId });

    await expect(db.insert(marketingApprovalLinks).values({ organizationId: orgId, approvalRequestId: approval.id, linkedEntityType: "content_item", linkedEntityId: content.id, purpose: "review_content", createdByUserId: ownerId })).rejects.toThrow();
    const links = await db.select().from(marketingApprovalLinks).where(eq(marketingApprovalLinks.approvalRequestId, approval.id));
    expect(links).toHaveLength(1);
  });

  it("campaign run completion is single-use — a stale run revision fails", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test", actorUserId: ownerId });
    const { version } = await makeTestMarketingPlaybook(orgId, ownerId, "campaign");
    const { run } = await startCampaignRun(db, { organizationId: orgId, campaignId: campaign.id, playbookVersionId: version.id, actorUserId: ownerId });

    const { listCampaignRunItems, completeCampaignRunItem, completeCampaignRun } = await import("./campaign-runs");
    const items = await listCampaignRunItems(db, orgId, run.id);
    await completeCampaignRunItem(db, { organizationId: orgId, itemId: items[0].id, status: "complete", actorUserId: ownerId });

    await completeCampaignRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: ownerId });
    await expect(completeCampaignRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: ownerId })).rejects.toThrow(StaleMarketingUpdateError);
  });

  it("budget entry updates use revision guards", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test", actorUserId: ownerId });
    const entry = await createBudgetEntry(db, { organizationId: orgId, campaignId: campaign.id, currency: "USD", plannedAmount: 1000, actorUserId: ownerId });
    await updateBudgetEntry(db, { organizationId: orgId, budgetEntryId: entry.id, expectedRevision: entry.revision, spendAmount: 100, actorUserId: ownerId });
    await expect(updateBudgetEntry(db, { organizationId: orgId, budgetEntryId: entry.id, expectedRevision: entry.revision, spendAmount: 200, actorUserId: ownerId })).rejects.toThrow(StaleMarketingUpdateError);
  });

  it("duplicate first-touch attribution submission for the same lead is safely idempotent — never a second row", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { createLead } = await import("@/lib/crm/leads");
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test", actorUserId: ownerId });

    const first = await recordAttribution(db, { organizationId: orgId, campaignId: campaign.id, crmLeadId: lead.id, touchType: "first_touch", utmSource: "google", actorUserId: ownerId });
    const second = await recordAttribution(db, { organizationId: orgId, campaignId: campaign.id, crmLeadId: lead.id, touchType: "first_touch", utmSource: "facebook", actorUserId: ownerId });
    // Idempotent no-op — the SAME row is returned, the first-touch source is never overwritten.
    expect(second.id).toBe(first.id);
    expect(second.utmSource).toBe("google");

    const { marketingAttributionRecords } = await import("@/db/schema");
    const { and } = await import("drizzle-orm");
    const rows = await db.select().from(marketingAttributionRecords).where(and(eq(marketingAttributionRecords.crmLeadId, lead.id), eq(marketingAttributionRecords.touchType, "first_touch")));
    expect(rows).toHaveLength(1);
  });

  it("last-touch attribution is always upserted to the newest observed touch — never accumulates duplicate rows", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { createLead } = await import("@/lib/crm/leads");
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test", actorUserId: ownerId });

    await recordAttribution(db, { organizationId: orgId, campaignId: campaign.id, crmLeadId: lead.id, touchType: "last_touch", utmSource: "google", actorUserId: ownerId });
    const latest = await recordAttribution(db, { organizationId: orgId, campaignId: campaign.id, crmLeadId: lead.id, touchType: "last_touch", utmSource: "facebook", actorUserId: ownerId });
    expect(latest.utmSource).toBe("facebook");

    const { marketingAttributionRecords } = await import("@/db/schema");
    const { and } = await import("drizzle-orm");
    const rows = await db.select().from(marketingAttributionRecords).where(and(eq(marketingAttributionRecords.crmLeadId, lead.id), eq(marketingAttributionRecords.touchType, "last_touch")));
    expect(rows).toHaveLength(1);
  });

  it("two racing campaign status transitions — exactly one wins, the other fails on a stale revision", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test", actorUserId: ownerId });
    const { transitionCampaignStatus } = await import("./campaigns");

    const results = await Promise.allSettled([
      transitionCampaignStatus(db, { organizationId: orgId, campaignId: campaign.id, toStatus: "planning", expectedRevision: campaign.revision, actorUserId: ownerId }),
      transitionCampaignStatus(db, { organizationId: orgId, campaignId: campaign.id, toStatus: "cancelled", expectedRevision: campaign.revision, actorUserId: ownerId }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleMarketingUpdateError);
  });
});
