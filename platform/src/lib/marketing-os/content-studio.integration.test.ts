import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agentArtifacts, marketingContentItems } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, randMarketingKey } from "./test-helpers";
import { seedMarketingAgents } from "./agents";
import { createCampaign } from "./campaigns";
import { buildFallbackContentConcepts, buildFallbackProductionPackage, contentStudioConceptOutput, enforceContentStudioProofQuality, ensureDefaultBrandProfiles, generateContentConcepts, generateProductionPackage, getStudioDraftForUser, saveStudioToPipeline, withContentStudioGenerationFallback } from "./content-studio";
import { createCreativeReference, listCreativeReferences, resolveCreativeReferences } from "./creative-references";
import { classifyCodeItScene, renderContentStudioMedia, renderPostPanel } from "./media-production";
import type { ContentStudioConcept, ContentStudioPackage } from "./validation";

afterEach(cleanupAgentRuntimeTestData);

const concepts: ContentStudioConcept[] = [
  { id: "proof", title: "Show the result first", angle: "Open on a working result, then reveal how it was made.", hookDirection: "Lead with visible proof.", format: "screen recording" },
  { id: "change", title: "Change one thing", angle: "Make one visible edit and connect it to the underlying system.", hookDirection: "Challenge the viewer to spot the change.", format: "before and after" },
  { id: "explain", title: "Explain the mechanism", angle: "Connect one visible behavior to the code or workflow behind it.", hookDirection: "Ask why the result works.", format: "micro tutorial" },
];

const productionPackage: ContentStudioPackage = {
  contentKind: "short_video",
  title: "One idea becomes a real project",
  hooks: ["Start with the result.", "One idea. One working project.", "Skip the blank editor."],
  selectedHook: "Start with the result.",
  script: "Start with the result. Then show the idea, the working first version, and one meaningful change. End by inviting the viewer to try it.",
  shots: [
    { timing: "0–2s", visual: "Finished project", onScreenText: "Start with the result", audio: "Start with the result." },
    { timing: "2–8s", visual: "Prompt to first version", onScreenText: "Idea → project", audio: "One idea becomes something real." },
    { timing: "8–15s", visual: "Edit one detail", onScreenText: "Make it yours", audio: "Then change it and understand how it works." },
  ],
  caption: "Start with an idea and leave with something real.",
  coverText: "Idea → real project",
  assetInstructions: ["Record a clean 9:16 browser capture", "Keep captions readable without sound"],
  callToAction: "Try the free challenge",
  renderingStatus: "not_requested",
  renderedAssets: [],
  renderingError: null,
};

const carouselPackage: ContentStudioPackage = {
  contentKind: "carousel_post",
  title: "From idea to a real project",
  hooks: ["What could your child build?", "Start with an idea.", "A blank editor is not the only way to learn."],
  selectedHook: "What could your child build?",
  postCopy: "A young creator starts with an idea, builds a working first version, and then learns how to change the code behind it.",
  panels: [
    { position: "Slide 1", purpose: "Stop the scroll", visual: "CodeItLearn mascot beside a simple idea sketch", overlayText: "What could your child build?" },
    { position: "Slide 2", purpose: "Show the process", visual: "Real CodeItLearn project screen", overlayText: "Idea → working project" },
    { position: "Slide 3", purpose: "Invite action", visual: "Finished project with the approved CodeItLearn identity", overlayText: "Build it. Learn it. Make it yours." },
  ],
  caption: "Start with an idea and leave with something real.",
  coverText: "Idea → real project",
  assetInstructions: ["Use a 4:5 canvas", "Use real product captures", "Keep every slide readable on mobile"],
  callToAction: "Try the free challenge",
  renderingStatus: "not_requested",
  renderedAssets: [],
  renderingError: null,
};

describe("Marketing Content Studio — isolation and vertical slice", () => {
  it("keeps generation working when the AI provider is rate-limited and preserves real game proof", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrgWithOwner(ownerId);
    const brands = await ensureDefaultBrandProfiles(db, { organizationId, actorUserId: ownerId });
    const brand = brands.find((item) => item.brandKey === "codeitlearn");
    if (!brand) throw new Error("CodeItLearn brand missing");

    const fallbackConcepts = await withContentStudioGenerationFallback({
      kind: "concept",
      generate: async () => { throw Object.assign(new Error("rate limited"), { statusCode: 429 }); },
      fallback: () => buildFallbackContentConcepts({ brand, goal: "Show a child building a playable game", channel: "Instagram Carousel" }),
    });
    expect(fallbackConcepts).toHaveLength(3);

    const pkg = await withContentStudioGenerationFallback({
      kind: "package",
      generate: async () => { throw Object.assign(new Error("rate limited"), { statusCode: 429 }); },
      fallback: () => buildFallbackProductionPackage({ brand, goal: "Show a child building a playable game", channel: "Instagram Carousel", contentKind: "carousel_post", concept: fallbackConcepts[0] }),
    });
    expect(pkg.contentKind).toBe("carousel_post");
    if (pkg.contentKind !== "carousel_post") throw new Error("Expected carousel package");
    expect(pkg.panels[0].visual).toMatch(/^built_game:/);
    expect(classifyCodeItScene({ visual: pkg.panels[0].visual, onScreenText: pkg.panels[0].overlayText }, 0, pkg.panels.length)).toBe("builtGame");
    expect(pkg.panels.some((panel) => panel.visual.startsWith("game_play:"))).toBe(true);
    const rendered = await renderPostPanel({ brand, pkg, panelIndex: 0 });
    expect(rendered.contentType).toBe("image/png");
    expect(rendered.model).toContain("real-product-v3");
    expect(rendered.bytes.byteLength).toBeGreaterThan(20_000);
    expect(Array.from(rendered.bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(() => enforceContentStudioProofQuality({ brand, goal: "Show a playable game", pkg: { ...pkg, panels: [{ ...pkg.panels[0], visual: "website_home: Generic homepage" }, ...pkg.panels.slice(1)] } })).toThrow(/playable-game proof/);
  });

  it("uses a provider-compatible top-level object for concept generation", async () => {
    const responseFormat = await contentStudioConceptOutput.responseFormat;
    if (!responseFormat || responseFormat.type !== "json") throw new Error("Concept output must use JSON structured output");
    expect(responseFormat.type).toBe("json");
    expect(responseFormat.schema).toMatchObject({
      type: "object",
      required: ["elements"],
      properties: { elements: { type: "array" } },
    });
  });

  it("never resolves a studio draft through another organization", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);
    const [brandA] = await ensureDefaultBrandProfiles(db, { organizationId: orgA, actorUserId: ownerA });
    const studio = await generateContentConcepts(db, { organizationId: orgA, brandProfileId: brandA.id, goal: "Create a tenant-safe concept set", intendedChannel: "Instagram Reels", actorUserId: ownerA }, async () => concepts);

    await expect(getStudioDraftForUser(db, { organizationId: orgB, studioId: studio.id, actorUserId: ownerB })).rejects.toThrow(TenantResourceNotFoundError);
  });

  it("persists brand references, grounds generation, and rejects cross-tenant reference IDs", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);
    const brandsA = await ensureDefaultBrandProfiles(db, { organizationId: orgA, actorUserId: ownerA });
    const brandsB = await ensureDefaultBrandProfiles(db, { organizationId: orgB, actorUserId: ownerB });
    const brandA = brandsA.find((brand) => brand.brandKey === "codeitlearn")!;
    const brandB = brandsB.find((brand) => brand.brandKey === "codeitlearn")!;
    const reference = await createCreativeReference(db, {
      organizationId: orgA,
      brandProfileId: brandA.id,
      title: "Parent reaction to playable proof",
      referenceType: "tutorial",
      sourceUrl: "https://www.instagram.com/reel/example/",
      transcript: "Wait, my kid built this?",
      creativeNotes: "Borrow the surprise hook, then show the real finished game before the tutorial.",
      adaptationRules: "Use CodeItLearn and Pixel; do not copy characters, wording, credentials, or claims.",
      actorUserId: ownerA,
    });
    expect(await listCreativeReferences(db, { organizationId: orgA, actorUserId: ownerA })).toHaveLength(1);
    expect(await listCreativeReferences(db, { organizationId: orgB, actorUserId: ownerB })).toHaveLength(0);
    await expect(resolveCreativeReferences(db, { organizationId: orgB, brandProfileId: brandB.id, referenceIds: [reference.id], actorUserId: ownerB })).rejects.toThrow(TenantResourceNotFoundError);

    const studio = await generateContentConcepts(db, {
      organizationId: orgA,
      brandProfileId: brandA.id,
      goal: "Show parents a child building a playable original game",
      intendedChannel: "Instagram Reel",
      creativeReferenceIds: [reference.id],
      actorUserId: ownerA,
    }, async (input) => {
      expect(input.creativeReferences).toHaveLength(1);
      expect(input.creativeReferences[0]?.transcript).toContain("my kid built this");
      return concepts;
    });
    expect(studio.creativeReferenceIds).toEqual([reference.id]);

    await generateProductionPackage(db, { organizationId: orgA, studioId: studio.id, conceptId: "proof", expectedRevision: studio.revision, actorUserId: ownerA }, async (input) => {
      expect(input.creativeReferences[0]?.adaptationRules).toContain("do not copy");
      return productionPackage;
    });
  });

  it("generates three concepts, creates a package, and saves it to the canonical content pipeline as a Runtime artifact", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrgWithOwner(ownerId);
    await seedMarketingAgents(db, { organizationId, humanOwnerUserId: ownerId, actorUserId: ownerId });
    const brands = await ensureDefaultBrandProfiles(db, { organizationId, actorUserId: ownerId });
    const brand = brands.find((item) => item.brandKey === "codeitlearn")!;
    const campaign = await createCampaign(db, { organizationId, campaignKey: randMarketingKey("STUDIO"), name: "CodeItLearn social", actorUserId: ownerId });

    const conceptsDraft = await generateContentConcepts(db, { organizationId, brandProfileId: brand.id, goal: "Show parents how one idea becomes a playable project", intendedChannel: "Instagram Reels", plannedPublishAt: new Date("2026-09-01T14:00:00Z"), actorUserId: ownerId }, async (input) => {
      expect(input.brand.brandKey).toBe("codeitlearn");
      return concepts;
    });
    expect(conceptsDraft.concepts).toHaveLength(3);

    const packaged = await generateProductionPackage(db, { organizationId, studioId: conceptsDraft.id, conceptId: "proof", expectedRevision: conceptsDraft.revision, actorUserId: ownerId }, async (input) => {
      expect(input.concept.id).toBe("proof");
      expect(input.contentKind).toBe("short_video");
      return productionPackage;
    });
    expect(packaged.productionPackage?.renderingStatus).toBe("not_requested");

    const rendered = await renderContentStudioMedia(db, { organizationId, studioId: packaged.id, expectedRevision: packaged.revision, actorUserId: ownerId }, {
      store: async ({ pathname, bytes, contentType }) => {
        expect(contentType).toBe("video/mp4");
        expect(bytes.byteLength).toBeGreaterThan(100_000);
        expect(Buffer.from(bytes).subarray(4, 8).toString("ascii")).toBe("ftyp");
        return { pathname: `private/${pathname}` };
      },
    });
    expect(rendered.productionPackage?.renderingStatus).toBe("ready");
    expect(rendered.productionPackage?.renderedAssets).toHaveLength(1);
    expect(rendered.productionPackage?.renderedAssets[0]?.model).toBe("lynq-office-codeit-director-cut-v4");

    const saved = await saveStudioToPipeline(db, { organizationId, studioId: rendered.id, campaignId: campaign.id, actorUserId: ownerId });
    expect(saved.studio.status).toBe("saved");
    const [content] = await db.select().from(marketingContentItems).where(and(eq(marketingContentItems.id, saved.contentItemId), eq(marketingContentItems.organizationId, organizationId)));
    expect(content.title).toBe(productionPackage.title);
    expect(content.plannedPublishAt?.toISOString()).toBe("2026-09-01T14:00:00.000Z");
    expect(content.currentArtifactId).toBeTruthy();
    const [artifact] = await db.select().from(agentArtifacts).where(and(eq(agentArtifacts.id, content.currentArtifactId!), eq(agentArtifacts.organizationId, organizationId)));
    expect(artifact.content).toContain("## Storyboard / shot list");
    expect(artifact.content).toContain("1 rendered media asset(s) attached");
  }, 180000);

  it("creates and saves a carousel as canonical social content with final copy and ordered panels", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrgWithOwner(ownerId);
    await seedMarketingAgents(db, { organizationId, humanOwnerUserId: ownerId, actorUserId: ownerId });
    const brands = await ensureDefaultBrandProfiles(db, { organizationId, actorUserId: ownerId });
    const brand = brands.find((item) => item.brandKey === "codeitlearn")!;
    const campaign = await createCampaign(db, { organizationId, campaignKey: randMarketingKey("POST"), name: "CodeItLearn posts", actorUserId: ownerId });

    const conceptsDraft = await generateContentConcepts(db, { organizationId, brandProfileId: brand.id, goal: "Create a parent-facing carousel", intendedChannel: "Instagram Carousel", actorUserId: ownerId }, async () => concepts);
    const packaged = await generateProductionPackage(db, { organizationId, studioId: conceptsDraft.id, conceptId: "proof", expectedRevision: conceptsDraft.revision, actorUserId: ownerId }, async (input) => {
      expect(input.contentKind).toBe("carousel_post");
      return carouselPackage;
    });
    const rendered = await renderContentStudioMedia(db, { organizationId, studioId: packaged.id, expectedRevision: packaged.revision, actorUserId: ownerId }, {
      store: async ({ pathname, bytes, contentType }) => {
        expect(contentType).toBe("image/png");
        expect(bytes.byteLength).toBeGreaterThan(10_000);
        expect([...bytes.slice(0, 4)]).toEqual([137, 80, 78, 71]);
        return { pathname: `private/${pathname}` };
      },
    });
    expect(rendered.productionPackage?.renderingStatus).toBe("ready");
    expect(rendered.productionPackage?.renderedAssets).toHaveLength(3);
    expect(rendered.productionPackage?.renderedAssets.every((asset) => asset.model.endsWith("-codeit-real-product-v3"))).toBe(true);
    expect(rendered.productionPackage?.renderedAssets.every((asset) => asset.pathname.includes(organizationId))).toBe(true);

    const saved = await saveStudioToPipeline(db, { organizationId, studioId: rendered.id, campaignId: campaign.id, actorUserId: ownerId });
    const [content] = await db.select().from(marketingContentItems).where(and(eq(marketingContentItems.id, saved.contentItemId), eq(marketingContentItems.organizationId, organizationId)));
    expect(content.contentType).toBe("social_post");
    const [artifact] = await db.select().from(agentArtifacts).where(and(eq(agentArtifacts.id, content.currentArtifactId!), eq(agentArtifacts.organizationId, organizationId)));
    expect(artifact.content).toContain("## Post copy");
    expect(artifact.content).toContain("## Post panels");
    expect(artifact.content).not.toContain("Media has not been rendered yet");
  }, 120000);
});
