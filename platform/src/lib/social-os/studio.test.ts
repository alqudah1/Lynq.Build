import { describe, it, expect } from "vitest";
import { assignWeekSlots, buildAnalysisPrompt, buildImagePrompt, buildIdeasPrompt, buildPartPrompt, buildReplyPrompt, buildVariantGenerationPrompt, fitVariantToPlatform, hasPerformanceData, imageAspectFor, normalizeIdea, variantGenerationOutputSchema, zonedDateTimeToUtc, type PerformanceEvidence } from "./studio";
import { composeCaption } from "./providers/social/http";
import { socialContentBriefSchema } from "./validation";
import type { BrandContext, SocialBrand } from "./brands";

const brand: BrandContext = {
  brandId: "b1",
  brandKey: "lynq",
  name: "LYNQ",
  text: "BRAND: LYNQ (lynq)\nVOICE: Direct and warm.\nCLAIMS GUARDRAILS: Never promise guaranteed revenue.",
  facts: { preferredPlatforms: ["instagram", "linkedin"], contentPillars: ["education", "proof"], callsToAction: ["Book a call"], prohibitedLanguage: ["guaranteed", "cheap"], neverClaim: ["#1 agency in Toronto"], websites: [], geographicMarket: "GTA" },
  recentTopics: ["Why speed matters", "Google reviews 101"],
};
const brief = socialContentBriefSchema.parse({ topic: "Fast websites win local search", hook: "Your site is slow" });

const emptyEvidence: PerformanceEvidence = { brandProfileId: "b1", windowDays: 30, from: "", to: "", publishedPosts: 0, postsWithMetrics: 0, posts: [], accounts: [] };

describe("prompt builders", () => {
  it("variant prompt carries brand context, guardrails, recent topics and per-platform conventions", () => {
    const { system, prompt } = buildVariantGenerationPrompt({ brand, title: "Speed", brief, targets: [{ platform: "linkedin", format: "text" }, { platform: "instagram", format: "image" }] });
    expect(system).toContain("CLAIMS GUARDRAILS: Never promise guaranteed revenue.");
    expect(system).toContain('"guaranteed"');
    expect(system).toContain("#1 agency in Toronto");
    expect(system).toMatch(/LinkedIn post must read differently from the Instagram/);
    const p = JSON.parse(prompt);
    expect(p.recentTopics.topics).toEqual(["Why speed matters", "Google reviews 101"]);
    expect(p.platforms.map((x: { platform: string }) => x.platform)).toEqual(["linkedin", "instagram"]);
    expect(p.platforms[0].conventions).toMatch(/no hashtag spam/i);
    expect(p.platforms[1].conventions).toMatch(/Hook-first/);
    expect(p.verifiedPastPerformance).toBeUndefined();
    expect(p.brief.topic).toBe("Fast websites win local search");
  });

  it("only includes performance evidence when real numbers were supplied", () => {
    const { prompt } = buildVariantGenerationPrompt({ brand, title: "x", brief, targets: [{ platform: "x", format: "text" }], performance: [{ title: "Old post", platform: "x", publishedAt: null, excerpt: "e", impressions: 100, reach: 90, views: 0, likes: 5, comments: 1, shares: 0, saves: 0, clicks: 2, leads: 0, engagements: 6, engagementRate: 0.06, source: "manual", capturedAt: "2026-09-01T00:00:00.000Z" }] });
    const p = JSON.parse(prompt);
    expect(p.verifiedPastPerformance.posts[0].impressions).toBe(100);
    expect(p.verifiedPastPerformance.note).toMatch(/never quote/);
  });

  it("ideas, part, analysis and reply prompts keep the guardrails", () => {
    const ideas = buildIdeasPrompt({ brand, count: 4, platforms: ["linkedin"], theme: "spring" });
    expect(ideas.system).toContain('"cheap"');
    expect(JSON.parse(ideas.prompt).recentTopics).toContain("Why speed matters");
    expect(JSON.parse(ideas.prompt).verifiedPastPerformance.note).toMatch(/No performance data/);
    const part = buildPartPrompt({ brand, title: "t", brief, platform: "linkedin", current: { hook: "h", body: "b", hashtags: [], callToAction: "" }, part: "hook" });
    expect(part.system).toContain("Rewrite only the requested part");
    expect(part.prompt).toContain('{\\"hook\\"');
    const analysis = buildAnalysisPrompt({ brand, evidence: emptyEvidence });
    expect(analysis.system).toMatch(/Never invent, estimate or extrapolate/);
    const reply = buildReplyPrompt({ brand, item: { platform: "x", itemType: "comment", authorName: "Sam", text: "How much for a site?" } });
    expect(reply.system).toContain("≤ 280 characters");
    expect(reply.system).toMatch(/isLead is true only/);
  });
});

describe("fitVariantToPlatform", () => {
  it("keeps X within 280 characters including the hashtag block", () => {
    const out = fitVariantToPlatform("x", { hook: "h", body: "word ".repeat(200), hashtags: ["#one", "two", "#three", "#four", "#five", "#six", "#seven"], callToAction: "Go" });
    expect(out.hashtags.length).toBeLessThanOrEqual(5);
    expect(composeCaption(out.body, out.hashtags).length).toBeLessThanOrEqual(280);
    expect(out.body.endsWith("…")).toBe(true);
  });

  it("normalizes, dedupes and caps hashtags, drops invalid ones, bounds fields", () => {
    const out = fitVariantToPlatform("instagram", { hook: "x".repeat(600), body: "Body", hashtags: ["#Web Design", "webdesign", "#WEBDESIGN", "#ok_tag", "!!!", ...Array.from({ length: 40 }, (_, i) => `t${i}`)], callToAction: "c".repeat(400), platformOptions: { altText: "a".repeat(2000), title: null } });
    expect(out.hashtags[0]).toBe("#WebDesign");
    expect(out.hashtags.filter((t) => t.toLowerCase() === "#webdesign")).toHaveLength(1);
    expect(out.hashtags).toContain("#ok_tag");
    expect(out.hashtags.length).toBeLessThanOrEqual(30);
    expect(out.hook.length).toBeLessThanOrEqual(400);
    expect(out.callToAction.length).toBeLessThanOrEqual(300);
    expect(out.platformOptions.altText?.length).toBeLessThanOrEqual(1000);
    expect(composeCaption(out.body, out.hashtags).length).toBeLessThanOrEqual(2200);
  });

  it("validates model output shape", () => {
    expect(variantGenerationOutputSchema.safeParse({ variants: [] }).success).toBe(false);
    const ok = variantGenerationOutputSchema.parse({ variants: [{ platform: "linkedin", body: "b" }] });
    expect(ok.variants[0]).toMatchObject({ hook: "", hashtags: [], callToAction: "" });
  });
});

describe("planning helpers", () => {
  it("assigns weekday business-hour slots, replacing invalid or colliding proposals", () => {
    const weekdays = [0, 1, 2, 3, 4];
    const slots = assignWeekSlots([{ dayOffset: 1, localTime: "10:30" }, { dayOffset: 5, localTime: "11:00" }, { dayOffset: 1, localTime: "14:00" }, { dayOffset: 2, localTime: "22:00" }], weekdays);
    expect(slots[0]).toEqual({ dayOffset: 1, hour: 10, minute: 30 });
    for (const s of slots) {
      expect(weekdays).toContain(s.dayOffset);
      expect(s.hour).toBeGreaterThanOrEqual(9);
      expect(s.hour).toBeLessThanOrEqual(17);
    }
    expect(new Set(slots.map((s) => s.dayOffset)).size).toBe(4);
  });

  it("converts Toronto wall-clock time to UTC across DST", () => {
    expect(zonedDateTimeToUtc(2026, 7, 15, 10, 0, "America/Toronto").toISOString()).toBe("2026-07-15T14:00:00.000Z");
    expect(zonedDateTimeToUtc(2026, 12, 15, 10, 0, "America/Toronto").toISOString()).toBe("2026-12-15T15:00:00.000Z");
    expect(zonedDateTimeToUtc(2026, 12, 15, 10, 0, "UTC").toISOString()).toBe("2026-12-15T10:00:00.000Z");
  });

  it("normalizes ideas to the closed vocabularies", () => {
    const idea = normalizeIdea({ title: "T", kind: "podcast", objective: "world_domination", platforms: ["LinkedIn", "myspace"], hook: "h", angle: "a", whyNow: "w" }, ["linkedin", "instagram"]);
    expect(idea).toMatchObject({ kind: "text_post", objective: "engagement", platforms: ["linkedin"] });
    expect(normalizeIdea({ title: "T", kind: "carousel", objective: "leads", platforms: [], hook: "", angle: "", whyNow: "" }, ["x"]).platforms).toEqual(["x"]);
  });

  it("image aspect per platform/format", () => {
    expect(imageAspectFor("instagram", "image")).toBe("4:5");
    expect(imageAspectFor("instagram", "story")).toBe("9:16");
    expect(imageAspectFor("linkedin", "image")).toBe("1:1");
    expect(imageAspectFor("facebook", "image")).toBe("1:1");
  });
});

describe("performance evidence", () => {
  it("is unavailable with no post metrics and no account snapshots", () => {
    expect(hasPerformanceData(emptyEvidence)).toBe(false);
    expect(hasPerformanceData({ ...emptyEvidence, publishedPosts: 3 })).toBe(false);
    expect(hasPerformanceData({ ...emptyEvidence, postsWithMetrics: 1 })).toBe(true);
  });
});

describe("buildImagePrompt", () => {
  const socialBrand = { name: "LYNQ", brandKey: "lynq", visualRules: "Scenes with a concept.", visualIdentity: { colors: [], typography: {} } } as unknown as SocialBrand;
  const withDirection = socialContentBriefSchema.parse({ topic: "Nasma", creativeDirection: "One ceramic plate on black." });

  it("leads with the brief's art direction when there is no instruction", () => {
    const p = buildImagePrompt({ brand: socialBrand, brief: withDirection, title: "Nasma", hook: "Menu to reservation", platform: "instagram" });
    expect(p.split("\n")[0]).toBe("Art direction: One ceramic plate on black.");
    expect(p).toContain("VISUAL RULES: Scenes with a concept.");
  });

  it("a regenerate instruction replaces the old art direction instead of trailing it", () => {
    const p = buildImagePrompt({ brand: socialBrand, brief: withDirection, title: "Nasma", hook: "Menu to reservation", platform: "instagram", instruction: "  A kitchen pass at night.  " });
    expect(p.split("\n")[0]).toBe("Art direction: A kitchen pass at night.");
    expect(p).not.toContain("ceramic plate");
  });
});
