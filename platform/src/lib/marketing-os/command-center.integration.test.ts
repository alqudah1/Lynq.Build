import { afterEach, describe, expect, it } from "vitest";
import { db, makeOrgWithOwner, makeUser, cleanupAgentRuntimeTestData, randMarketingKey } from "./test-helpers";
import { ensureDefaultBrandProfiles, generateContentConcepts, generateProductionPackage, saveStudioToPipeline } from "./content-studio";
import { createCampaign } from "./campaigns";
import { ensureDefaultChannelAccounts, getMarketingCommandCenter, recordPerformanceSnapshot } from "./command-center";
import { seedMarketingAgents } from "./agents";
import { renderContentStudioMedia } from "./media-production";
import type { ContentStudioConcept, ContentStudioPackage } from "./validation";

afterEach(cleanupAgentRuntimeTestData);

const concepts: ContentStudioConcept[] = [
  { id: "one", title: "Website proof", angle: "Show the page", hookDirection: "Lead with the result", format: "carousel" },
  { id: "two", title: "Before and after", angle: "Show the transformation", hookDirection: "Contrast", format: "carousel" },
  { id: "three", title: "System behind it", angle: "Connect the handoff", hookDirection: "Reveal", format: "carousel" },
];

const pkg: ContentStudioPackage = {
  contentKind: "single_image_post", title: "Your website should work harder", hooks: ["Your website should work harder.", "Pretty is not enough.", "Start with the page customers see."], selectedHook: "Your website should work harder.", postCopy: "Start with the page customers see.", panels: [{ position: "1", purpose: "Show proof", visual: "website — real project", overlayText: "Your website should work harder." }], caption: "A clear website is the first connected system.", coverText: "Build better.", assetInstructions: ["Use real portfolio proof"], callToAction: "Start with your website", renderingStatus: "not_requested", renderedAssets: [], renderingError: null,
};

describe("Marketing Command Center", () => {
  it("tracks both brands, saves real performance, and blocks cross-tenant records", async () => {
    const ownerA = await makeUser(); const orgA = await makeOrgWithOwner(ownerA);
    const ownerB = await makeUser(); const orgB = await makeOrgWithOwner(ownerB);
    const brandsA = await ensureDefaultBrandProfiles(db, { organizationId: orgA, actorUserId: ownerA });
    await ensureDefaultBrandProfiles(db, { organizationId: orgB, actorUserId: ownerB });
    await ensureDefaultChannelAccounts(db, { organizationId: orgA, actorUserId: ownerA });
    await ensureDefaultChannelAccounts(db, { organizationId: orgB, actorUserId: ownerB });
    await seedMarketingAgents(db, { organizationId: orgA, humanOwnerUserId: ownerA, actorUserId: ownerA });
    const lynq = brandsA.find((brand) => brand.brandKey === "lynq")!;
    const campaign = await createCampaign(db, { organizationId: orgA, campaignKey: randMarketingKey("CMD"), name: "LYNQ proof", actorUserId: ownerA });
    const draft = await generateContentConcepts(db, { organizationId: orgA, brandProfileId: lynq.id, goal: "Show a premium website", intendedChannel: "Instagram Post", actorUserId: ownerA }, async () => concepts);
    const packaged = await generateProductionPackage(db, { organizationId: orgA, studioId: draft.id, conceptId: "one", expectedRevision: draft.revision, actorUserId: ownerA }, async () => pkg);
    const rendered = await renderContentStudioMedia(db, { organizationId: orgA, studioId: packaged.id, expectedRevision: packaged.revision, actorUserId: ownerA }, { store: async ({ pathname, bytes, contentType }) => { expect(contentType).toBe("image/png"); expect(bytes.byteLength).toBeGreaterThan(10_000); return { pathname: `private/${pathname}` }; } });
    expect(rendered.productionPackage?.renderedAssets[0]?.model).toContain("lynq-premium-v2");
    const saved = await saveStudioToPipeline(db, { organizationId: orgA, studioId: rendered.id, campaignId: campaign.id, actorUserId: ownerA });
    const centerA = await getMarketingCommandCenter(db, { organizationId: orgA, actorUserId: ownerA });
    expect(centerA.accounts).toHaveLength(14);
    expect(new Set(centerA.accounts.map((account) => account.brandName))).toEqual(new Set(["LYNQ", "CodeItLearn"]));
    const account = centerA.accounts.find((row) => row.brandName === "LYNQ" && row.platform === "instagram")!;
    const wrongBrandAccount = centerA.accounts.find((row) => row.brandName === "CodeItLearn" && row.platform === "instagram")!;
    await expect(recordPerformanceSnapshot(db, { organizationId: orgA, actorUserId: ownerA, contentItemId: saved.contentItemId, channelAccountId: wrongBrandAccount.id, impressions: 1, reach: 1, views: 1, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, leads: 0, conversions: 0, spendAmount: "0", revenueAmount: "0" })).rejects.toThrow("same brand");
    await recordPerformanceSnapshot(db, { organizationId: orgA, actorUserId: ownerA, contentItemId: saved.contentItemId, channelAccountId: account.id, impressions: 1200, reach: 900, views: 700, likes: 60, comments: 7, shares: 9, saves: 11, clicks: 40, leads: 3, conversions: 1, spendAmount: "25.00", revenueAmount: "120.00", notes: "Website proof held attention." });
    const updated = await getMarketingCommandCenter(db, { organizationId: orgA, actorUserId: ownerA });
    expect(updated.totals).toMatchObject({ impressions: 1200, views: 700, engagement: 87, clicks: 40, leads: 3, conversions: 1, spend: 25, revenue: 120 });
    await expect(recordPerformanceSnapshot(db, { organizationId: orgB, actorUserId: ownerB, contentItemId: saved.contentItemId, channelAccountId: account.id, impressions: 1, reach: 1, views: 1, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, leads: 0, conversions: 0, spendAmount: "0", revenueAmount: "0" })).rejects.toThrow("unavailable in this organization");
    const centerB = await getMarketingCommandCenter(db, { organizationId: orgB, actorUserId: ownerB });
    expect(centerB.snapshots).toHaveLength(0);
  }, 120000);
});
