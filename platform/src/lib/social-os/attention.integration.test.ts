import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { socialContentVariants } from "@/db/schema";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { db, makeSocialOrg, makeConnectedAccount, makeUser, addOrgMember, setAccountStatus, cleanupAgentRuntimeTestData } from "./test-helpers";
import { createContentItem, submitVariantForReview, updateVariant } from "./content";
import { computeSocialAttention, socialAttentionRules } from "./attention";
import { getSocialOverview } from "./overview";
import { socialContentBriefSchema } from "./validation";

describe("social attention (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("surfaces pending approvals, an expired token and a quiet platform from live data", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const { account: fb } = await makeConnectedAccount(orgId, brand.id, "facebook");
    const { account: ig } = await makeConnectedAccount(orgId, brand.id, "instagram");
    const { account: li } = await makeConnectedAccount(orgId, brand.id, "linkedin");
    await setAccountStatus(li.id, "token_expired");

    // A post awaiting approval.
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Review me", brief: socialContentBriefSchema.parse({ kind: "text_post" }), platforms: ["facebook"] });
    const v = await updateVariant(db, { organizationId: orgId, contentVariantId: item.variants[0].id, actorUserId: ownerId, expectedRevision: item.variants[0].revision, changes: { body: "Fast sites win." } });
    await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });

    // Instagram last posted 6 days ago.
    const old = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Old post", brief: socialContentBriefSchema.parse({ kind: "image_post" }), platforms: ["instagram"] });
    await db.update(socialContentVariants).set({ status: "published", channelAccountId: ig.id, externalPostId: "m1", publishedAt: new Date(Date.now() - 6 * 24 * 3600_000) }).where(eq(socialContentVariants.id, old.variants[0].id));

    const attention = await computeSocialAttention(db, { organizationId: orgId, actorUserId: ownerId, deps: { aiEnv: {} } });
    const byCode = new Map(attention.items.map((i) => [i.id, i]));
    expect(byCode.get("social_review_queue")).toMatchObject({ severity: "attention", count: 1, path: "/social/approvals" });
    expect(byCode.get(`social_account_broken:${li.id}`)).toMatchObject({ severity: "urgent", reasonCode: "social_account_reauthorize", path: "/social/connections" });
    expect(byCode.get(`social_platform_stale:${ig.id}`)).toMatchObject({ severity: "attention", title: expect.stringMatching(/in 6 days/) });
    // Facebook has never published: informational, not a warning.
    expect(byCode.get(`social_platform_stale:${fb.id}`)?.severity).toBe("info");
    expect(byCode.get(`social_brand_no_upcoming:${brand.id}`)?.title).toBe("Test Brand needs another post");
    expect(attention.items[0].severity).toBe("urgent");
    expect(attention.actions.map((a) => a.path)).toContain("/social/approvals");

    const founder = await socialAttentionRules({ db, organizationId: orgId, actorUserId: ownerId });
    expect(founder.every((i) => i.domain === "marketing" && i.severity !== "info")).toBe(true);
    expect(founder.map((i) => i.id)).toContain(`social_account_broken:${li.id}`);

    const overview = await getSocialOverview(db, { organizationId: orgId, actorUserId: ownerId, deps: { aiEnv: {} } });
    expect(overview.selectedBrand?.id).toBe(brand.id);
    expect(overview.pipeline.ready_for_review).toBe(1);
    expect(overview.connectionSummary.byStatus).toMatchObject({ connected: 2, token_expired: 1 });
    expect(overview.recentPublished.map((p) => p.title)).toEqual(["Old post"]);
    expect(overview.aiAvailability.textConfigured).toBe(false);
  });

  it("requires marketing_view when an actor is given", async () => {
    const { orgId } = await makeSocialOrg();
    const outsider = await makeUser();
    await addOrgMember(orgId, outsider, "member");
    await expect(computeSocialAttention(db, { organizationId: orgId, actorUserId: outsider })).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});
