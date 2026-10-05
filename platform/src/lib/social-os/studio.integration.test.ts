import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { marketingContentItems, marketingContentPerformanceSnapshots, runtimeJobs, socialAiGenerations, socialAssets, socialContentVariants } from "@/db/schema";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { db, makeSocialOrg, makeMarketingUser, makeManualAccount, cleanupAgentRuntimeTestData, TINY_JPEG } from "./test-helpers";
import { createContentItem, getContentItemForUser } from "./content";
import { analyzePerformance, draftEngagementReply, generateContentIdeas, generateVariantsForItem, planWeek, regenerateVariantPart } from "./studio";
import { SocialGenerationFailedError } from "./errors";
import { socialContentBriefSchema } from "./validation";
import { fakeImageProvider, fakeTextProvider, fakeVideoProvider, memoryStorage } from "./providers/ai/test-fakes";
import type { TextGenerationRequest } from "./providers/ai/types";

const brief = (o: Record<string, unknown> = {}) => socialContentBriefSchema.parse({ topic: "Fast websites win local search", ...o });

/** A fake model that writes platform-specific copy for whichever platforms the prompt asks for. */
function variantWriter(req: TextGenerationRequest) {
  const p = JSON.parse(req.prompt) as { platforms?: { platform: string }[] };
  return {
    json: {
      variants: (p.platforms ?? []).map(({ platform }) => ({
        platform,
        hook: `${platform} hook`,
        body: platform === "x" ? "x ".repeat(400) : `A ${platform}-native post body.`,
        hashtags: platform === "linkedin" ? ["#smallbusiness"] : ["#web", "#design", "#toronto"],
        callToAction: "Book a call",
        platformOptions: platform === "instagram" ? { altText: "A fast website on a phone" } : {},
        imagePrompt: "Bold black and white photo of a storefront with a phone",
      })),
    },
  };
}

function nextMonday(from = new Date()): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 7));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(12);
  return d;
}

describe("Content Studio (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("generates platform-specific copy into each draft variant and fills the brief's gaps", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Speed", brief: brief(), platforms: ["linkedin", "instagram", "x"] });
    const fake = fakeTextProvider(variantWriter);
    const out = await generateVariantsForItem(db, { organizationId: orgId, contentItemId: item.id, actorUserId: ownerId, deps: { textProvider: fake.provider, env: {} } });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].system).toContain("Never promise guaranteed revenue.");
    const by = Object.fromEntries(out.variants.map((v) => [v.platform, v]));
    expect(by.linkedin.body).toBe("A linkedin-native post body.");
    expect(by.instagram.body).toBe("A instagram-native post body.");
    expect(by.linkedin.body).not.toBe(by.instagram.body);
    expect(by.instagram.hashtags).toEqual(["#web", "#design", "#toronto"]);
    expect(by.instagram.platformOptions.altText).toBe("A fast website on a phone");
    expect(by.x.body.length + 2 + by.x.hashtags.join(" ").length).toBeLessThanOrEqual(280);
    for (const v of out.variants) {
      expect(v.status).toBe("draft");
      expect(v.lastGenerationId).toBe(out.generationId);
    }
    const fresh = await getContentItemForUser(db, { organizationId: orgId, contentItemId: item.id, actorUserId: ownerId });
    expect(fresh.brief.creativeDirection).toContain("storefront");
    expect(fresh.brief.topic).toBe("Fast websites win local search");
    const [gen] = await db.select().from(socialAiGenerations).where(eq(socialAiGenerations.id, out.generationId));
    expect(gen).toMatchObject({ status: "succeeded", generationType: "text", contentItemId: item.id, brandProfileId: brand.id });
  });

  it("a provider failure returns the variants to draft and records a failed generation", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Oops", brief: brief(), platforms: ["linkedin"] });
    const broken = fakeTextProvider(() => {
      throw new SocialGenerationFailedError("Fake", "overloaded", true);
    });
    await expect(generateVariantsForItem(db, { organizationId: orgId, contentItemId: item.id, actorUserId: ownerId, deps: { textProvider: broken.provider, env: {} } })).rejects.toBeInstanceOf(SocialGenerationFailedError);
    const [v] = await db.select().from(socialContentVariants).where(eq(socialContentVariants.contentItemId, item.id));
    expect(v.status).toBe("draft");
    const [gen] = await db.select().from(socialAiGenerations).where(eq(socialAiGenerations.contentItemId, item.id));
    expect(gen.status).toBe("failed");
  });

  it("contributors may generate; viewers may not", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const contributor = await makeMarketingUser(orgId, "marketing_contributor", ownerId);
    const viewer = await makeMarketingUser(orgId, "viewer", ownerId);
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: contributor, brandProfileId: brand.id, title: "By contributor", brief: brief(), platforms: ["facebook"] });
    const fake = fakeTextProvider(variantWriter);
    const out = await generateVariantsForItem(db, { organizationId: orgId, contentItemId: item.id, actorUserId: contributor, deps: { textProvider: fake.provider, env: {} } });
    expect(out.variants[0].body).toBe("A facebook-native post body.");
    await expect(generateVariantsForItem(db, { organizationId: orgId, contentItemId: item.id, actorUserId: viewer, deps: { textProvider: fake.provider, env: {} } })).rejects.toBeInstanceOf(InsufficientRoleError);
    await expect(generateContentIdeas(db, { organizationId: orgId, brandProfileId: brand.id, actorUserId: viewer, deps: { textProvider: fake.provider, env: {} } })).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("regenerating the hook keeps the body; regenerating the image stores an asset as the primary media", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Speed", brief: brief({ creativeDirection: "A storefront at dusk" }), platforms: ["linkedin"] });
    const writer = fakeTextProvider(variantWriter);
    const generated = await generateVariantsForItem(db, { organizationId: orgId, contentItemId: item.id, actorUserId: ownerId, deps: { textProvider: writer.provider, env: {} } });
    const v0 = generated.variants[0];

    const hooker = fakeTextProvider(() => ({ json: { hook: "A brand new hook" } }));
    const r1 = await regenerateVariantPart(db, { organizationId: orgId, contentVariantId: v0.id, actorUserId: ownerId, part: "hook", instruction: "punchier", deps: { textProvider: hooker.provider, env: {} } });
    expect(r1.pending).toBe(false);
    expect(r1.variant.hook).toBe("A brand new hook");
    expect(r1.variant.body).toBe(v0.body);
    expect(r1.variant.hashtags).toEqual(v0.hashtags);
    expect(JSON.parse(hooker.calls[0].prompt).instruction).toBe("punchier");

    const storage = memoryStorage();
    const image = fakeImageProvider(TINY_JPEG);
    const r2 = await regenerateVariantPart(db, { organizationId: orgId, contentVariantId: v0.id, actorUserId: ownerId, part: "image", deps: { imageProvider: image.provider, storage, env: {} } });
    expect(image.calls[0].aspectRatio).toBe("1:1");
    expect(image.calls[0].prompt).toContain("A storefront at dusk");
    expect(r2.variant.format).toBe("image");
    expect(r2.variant.media).toHaveLength(1);
    expect(r2.variant.media[0].role).toBe("primary");
    const [asset] = await db.select().from(socialAssets).where(eq(socialAssets.id, r2.variant.media[0].assetId));
    expect(asset).toMatchObject({ assetType: "image", source: "generated", provider: "openai", model: "fake-image-1", generationId: r2.generationId, contentType: "image/jpeg", contentVariantId: v0.id });
    expect(storage.objects.size).toBe(1);
    const [gen] = await db.select().from(socialAiGenerations).where(eq(socialAiGenerations.id, r2.generationId));
    expect(gen).toMatchObject({ status: "succeeded", generationType: "image", assetId: asset.id });
    expect(Number(gen.costUsd)).toBeCloseTo(0.04, 6);
  });

  it("regenerating video starts a background render: pending, variant generating, runtime job queued", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Reel", brief: brief({ kind: "short_video_concept" }), platforms: ["instagram"] });
    const video = fakeVideoProvider({ statuses: [{ status: "running" }] });
    const r = await regenerateVariantPart(db, { organizationId: orgId, contentVariantId: item.variants[0].id, actorUserId: ownerId, part: "video", deps: { videoProvider: video.provider, env: {} } });
    expect(r.pending).toBe(true);
    expect(r.variant.status).toBe("generating");
    expect(video.started[0]).toMatchObject({ aspectRatio: "9:16", durationSeconds: 5 });
    const [gen] = await db.select().from(socialAiGenerations).where(eq(socialAiGenerations.id, r.generationId));
    expect(gen).toMatchObject({ status: "running", generationType: "video", providerTaskId: "task-1" });
    expect(Number(gen.costUsd)).toBeCloseTo(0.6, 6);
    const [job] = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.organizationId, orgId), eq(runtimeJobs.idempotencyKey, `social_generation_run:${r.generationId}`)));
    expect(job).toMatchObject({ jobType: "social_generation_run", maxAttempts: 12 });
    expect(job.availableAt.getTime()).toBeGreaterThan(Date.now() + 5_000);
  });

  it("analyzePerformance: no data → available:false without calling the model; with data → grounded analysis", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const never = fakeTextProvider(() => {
      throw new Error("the model must not be called without data");
    });
    const empty = await analyzePerformance(db, { organizationId: orgId, brandProfileId: brand.id, actorUserId: ownerId, deps: { textProvider: never.provider, env: {} } });
    expect(empty.available).toBe(false);
    expect(never.calls).toHaveLength(0);

    const account = await makeManualAccount(orgId, brand.id, "linkedin");
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Published one", brief: brief(), platforms: ["linkedin"] });
    const v = item.variants[0];
    await db.update(socialContentVariants).set({ status: "published", publishedAt: new Date(Date.now() - 3 * 86400_000), body: "Real post" }).where(eq(socialContentVariants.id, v.id));
    const stillEmpty = await analyzePerformance(db, { organizationId: orgId, brandProfileId: brand.id, actorUserId: ownerId, deps: { textProvider: never.provider, env: {} } });
    expect(stillEmpty).toMatchObject({ available: false });
    if (!stillEmpty.available) expect(stillEmpty.reason).toMatch(/no performance has been synced/);

    await db.insert(marketingContentPerformanceSnapshots).values({ organizationId: orgId, contentItemId: item.id, channelAccountId: account.id, contentVariantId: v.id, source: "manual", impressions: 1200, reach: 900, likes: 40, comments: 6, shares: 3, saves: 1, clicks: 22 });
    const analyst = fakeTextProvider(() => ({ json: { summary: "One post, 50 engagements on 900 reach.", whatWorked: ["Published one: 50 engagements"], whatDidNot: [], recommendations: [{ title: "Do more", rationale: "it worked", suggestedKind: "carousel", suggestedPlatforms: ["linkedin", "myspace"] }] } }));
    const res = await analyzePerformance(db, { organizationId: orgId, brandProfileId: brand.id, actorUserId: ownerId, deps: { textProvider: analyst.provider, env: {} } });
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.evidence.posts[0].metrics).toMatchObject({ impressions: 1200, engagements: 50 });
      expect(res.analysis.recommendations[0].suggestedPlatforms).toEqual(["linkedin"]);
    }
    expect(JSON.parse(analyst.calls[0].prompt).evidence.posts[0].metrics.impressions).toBe(1200);
  });

  it("planWeek creates scheduled drafts on weekdays with generated copy and never submits them", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const weekStart = nextMonday();
    const fake = fakeTextProvider((req) => {
      if (req.prompt.includes('"variants"') || req.prompt.includes("one post per platform")) return variantWriter(req);
      return { json: { ideas: [
        { title: "Idea A", kind: "carousel", objective: "education", platforms: ["linkedin"], hook: "A", angle: "a", whyNow: "now", dayOffset: 0, localTime: "10:00" },
        { title: "Idea B", kind: "text_post", objective: "leads", platforms: ["instagram", "linkedin"], hook: "B", angle: "b", whyNow: "now", dayOffset: 6, localTime: "03:00" },
      ] } };
    });
    const out = await planWeek(db, { organizationId: orgId, brandProfileId: brand.id, actorUserId: ownerId, weekStart, postsPerWeek: 2, deps: { textProvider: fake.provider, env: {} } });
    expect(out.timezone).toBe("America/Toronto");
    expect(out.createdContentItemIds).toHaveLength(2);
    expect(out.skipped).toEqual([]);
    const items = await db.select().from(marketingContentItems).where(eq(marketingContentItems.organizationId, orgId));
    for (const item of items) {
      expect(item.plannedPublishAt).toBeInstanceOf(Date);
      const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(item.plannedPublishAt!);
      expect(["Mon", "Tue", "Wed", "Thu", "Fri"]).toContain(local.find((p) => p.type === "weekday")?.value);
      const hour = Number(local.find((p) => p.type === "hour")?.value);
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThanOrEqual(17);
    }
    const variants = await db.select().from(socialContentVariants).where(eq(socialContentVariants.organizationId, orgId));
    expect(variants).toHaveLength(3);
    for (const v of variants) {
      expect(v.status).toBe("draft");
      expect(v.body).toMatch(/native post body/);
      expect(v.approvalRequestId).toBeNull();
    }
  });

  it("drafts an engagement reply without touching engagement tables", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const fake = fakeTextProvider(() => ({ json: { reply: "Thanks Sam! Send us a DM and we'll share options.", sentiment: "positive", category: "lead", isLead: true } }));
    const r = await draftEngagementReply(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, item: { platform: "instagram", itemType: "comment", authorName: "Sam", text: "How much for a website?" }, deps: { textProvider: fake.provider, env: {} } });
    expect(r).toMatchObject({ sentiment: "positive", category: "lead", isLead: true });
    const [gen] = await db.select().from(socialAiGenerations).where(eq(socialAiGenerations.id, r.generationId));
    expect(gen.generationType).toBe("reply_draft");
  });
});
