import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { generateText, Output } from "ai";
import { marketingBrandProfiles, marketingCampaigns, marketingContentItems, marketingContentPerformanceSnapshots, marketingContentStudioDrafts } from "@/db/schema";
import { requireExecutionVisibility } from "@/lib/agent-runtime/authz";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { getOfficeModel } from "@/lib/office/models";
import { resolveMarketingAuthContext, requireMarketingManageContentAuthority, requireMarketingViewAuthority } from "./authz";
import { createContentItem } from "./content";
import { createContentStudioPackageTask, resolveContentDraftAssistantAgent } from "./agents";
import {
  contentStudioConceptSchema,
  contentStudioConceptsSchema,
  contentStudioCarouselPostPackageSchema,
  contentStudioSingleImagePostPackageSchema,
  contentStudioPackageSchema,
  contentStudioVideoPackageSchema,
  type ContentStudioConcept,
  type ContentStudioContentKind,
  type ContentStudioPackage,
  type MarketingBrandKey,
} from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingBrandProfile {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  brandKey: MarketingBrandKey;
  name: string;
  positioning: string;
  audience: string;
  voice: string;
  visualRules: string;
  productContext: string;
  callsToAction: string[];
  approvedExamples: string[];
  claimsGuardrails: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentStudioDraft {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  brandProfileId: string;
  goal: string;
  intendedChannel: string;
  plannedPublishAt: Date | null;
  concepts: ContentStudioConcept[];
  selectedConceptId: string | null;
  productionPackage: ContentStudioPackage | null;
  status: "concepts" | "production" | "saved";
  contentItemId: string | null;
  ownerUserId: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_BRANDS: Record<MarketingBrandKey, Omit<MarketingBrandProfile, "id" | "organizationId" | "workspaceId" | "revision" | "createdAt" | "updatedAt">> = {
  lynq: {
    brandKey: "lynq",
    name: "LYNQ",
    positioning: "A premium digital partner that leads with high-converting websites and landing pages, then connects the systems, automation and LYNQ Office operations behind the customer journey. Digital transformation is the expansion path, not the opening pitch.",
    audience: "Founders and operators of established service businesses, restaurants, creative brands and growth-minded small-to-medium companies that need a better digital presence and fewer disconnected systems.",
    voice: "Direct, assured, precise and premium. Short sentences. Strong point of view. Show the business outcome through concrete proof. Avoid hype, jargon, generic AI language and crowded feature lists.",
    visualRules: "Black and white foundation with neon lime as a controlled accent. Editorial scale, generous negative space, sharp contrast, refined motion and premium art direction. Never use generic blue SaaS gradients, cartoon robots, stock-tech imagery or rainbow AI effects.",
    productContext: "Primary offer: websites and landing pages built to present the business clearly and convert demand. Expansion: connected CRM, workflows, analytics, automation, digital transformation and LYNQ Office as the operating layer that keeps people and AI work coordinated.",
    callsToAction: ["Book a strategy call", "Start with your website", "See what LYNQ can build", "Connect the systems behind your growth"],
    approvedExamples: ["Your website should do more than look expensive.", "Start with the page customers see. Then fix the system behind it.", "One clear landing page can expose every broken handoff behind it."],
    claimsGuardrails: "Do not promise guaranteed revenue, instant transformation or autonomous operations. Do not lead with LYNQ Office unless the topic is specifically operations. Never imply a client result without approved evidence.",
  },
  codeitlearn: {
    brandKey: "codeitlearn",
    name: "CodeItLearn",
    positioning: "Project-first coding for young creators: start with an idea, get a working first version, then learn, edit, save and share the real code behind a website, game or quiz. The promise is: start with an idea and leave with something real.",
    audience: "Primary buyers are parents and guardians of young creators ages 5–18. Users are young creators ages 5–18; ages 5–12 explore through a parent-managed profile and independent student accounts begin at 13. Partnership audiences include teachers, tutors, libraries, clubs, camps and after-school programs.",
    voice: "Clear, encouraging, energetic and honest. Lead with the thing the learner makes, then connect it to what they understand. Make parents feel informed without becoming academic or fear-based. Never pressure children or overstate learning outcomes.",
    visualRules: "Bright, playful, creator-led product visuals using real projects, browser recordings, large readable captions and the approved Pixel mascot/assets. For short video use 9:16, show the result in the first two seconds, make sound optional and avoid generic AI imagery.",
    productContext: "CodeIt helps students turn an idea into a real website, game or quiz, then learn, edit, save and share the code. Core content proofs: prompt to playable result, change one visible detail, explain one line or concept, show a related lesson, then save/share. The free first-game challenge is the safest current acquisition path.",
    callsToAction: ["Build a free project", "Try the free first-game challenge", "Join the Founding Family waitlist", "Book a short product walkthrough"],
    approvedExamples: ["A student starts with an idea, not a blank editor.", "Build it. Learn how it works. Make it yours.", "This score works because of a variable.", "Pick a game → build it → change it → understand it."],
    claimsGuardrails: "No billing is live, so never claim the Founding Family plan can be purchased. Label parent milestone emails as planned until delivery is live. Do not target or pressure children to buy. Do not imply guaranteed academic outcomes. Historical totals must be labeled historical, not active-customer claims.",
  },
};

function toBrand(row: typeof marketingBrandProfiles.$inferSelect): MarketingBrandProfile {
  return { ...row, brandKey: row.brandKey as MarketingBrandKey, callsToAction: row.callsToAction as string[], approvedExamples: row.approvedExamples as string[] };
}

function toStudio(row: typeof marketingContentStudioDrafts.$inferSelect): ContentStudioDraft {
  const rawPackage = row.productionPackage && typeof row.productionPackage === "object"
    ? row.productionPackage as Record<string, unknown>
    : null;
  const normalizedPackage = rawPackage
    ? {
        ...rawPackage,
        contentKind: "contentKind" in rawPackage ? rawPackage.contentKind : resolveContentStudioContentKind(row.intendedChannel),
        renderingStatus: rawPackage.renderingStatus === "ready" || rawPackage.renderingStatus === "failed" ? rawPackage.renderingStatus : "not_requested",
        renderedAssets: Array.isArray(rawPackage.renderedAssets) ? rawPackage.renderedAssets : [],
        renderingError: typeof rawPackage.renderingError === "string" ? rawPackage.renderingError : null,
      }
    : null;
  return {
    ...row,
    concepts: contentStudioConceptsSchema.parse(row.concepts),
    productionPackage: normalizedPackage ? contentStudioPackageSchema.parse(normalizedPackage) : null,
  };
}

export async function ensureDefaultBrandProfiles(db: Db, input: { organizationId: string; workspaceId?: string | null; actorUserId: string }): Promise<MarketingBrandProfile[]> {
  const workspaceId = input.workspaceId ?? null;
  await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_brand_profile", "defaults");

  for (const profile of Object.values(DEFAULT_BRANDS)) {
    const [existing] = await db.select({ id: marketingBrandProfiles.id }).from(marketingBrandProfiles).where(and(
      eq(marketingBrandProfiles.organizationId, input.organizationId),
      workspaceId ? eq(marketingBrandProfiles.workspaceId, workspaceId) : isNull(marketingBrandProfiles.workspaceId),
      eq(marketingBrandProfiles.brandKey, profile.brandKey),
    ));
    if (existing) continue;
    const [created] = await db.insert(marketingBrandProfiles).values({ organizationId: input.organizationId, workspaceId, ...profile }).returning();
    await recordAuditEvent(db, { eventType: "marketing_brand_profile_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_brand_profile", targetId: created.id, metadata: { brandKey: profile.brandKey, workspaceScoped: Boolean(workspaceId) } });
  }
  return listBrandProfiles(db, input);
}

export async function listBrandProfiles(db: Db, input: { organizationId: string; workspaceId?: string | null; actorUserId: string }): Promise<MarketingBrandProfile[]> {
  const workspaceId = input.workspaceId ?? null;
  await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_brand_profile", "list");
  const rows = await db.select().from(marketingBrandProfiles).where(and(
    eq(marketingBrandProfiles.organizationId, input.organizationId),
    workspaceId ? eq(marketingBrandProfiles.workspaceId, workspaceId) : isNull(marketingBrandProfiles.workspaceId),
  ));
  return rows.map(toBrand);
}

async function resolveBrand(db: Db, organizationId: string, brandProfileId: string): Promise<MarketingBrandProfile> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingBrandProfiles).where(and(eq(marketingBrandProfiles.id, brandProfileId), eq(marketingBrandProfiles.organizationId, organizationId)));
    return row ? toBrand(row) : undefined;
  });
}

export async function getStudioDraftForUser(db: Db, input: { organizationId: string; studioId: string; actorUserId: string }): Promise<ContentStudioDraft> {
  const row = await requireTenantScopedResource(async () => {
    const [found] = await db.select().from(marketingContentStudioDrafts).where(and(eq(marketingContentStudioDrafts.id, input.studioId), eq(marketingContentStudioDrafts.organizationId, input.organizationId)));
    return found;
  });
  await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId: row.workspaceId, actorUserId: input.actorUserId });
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_content_studio", row.id);
  return toStudio(row);
}

export async function listStudioDrafts(db: Db, input: { organizationId: string; actorUserId: string; limit?: number }): Promise<ContentStudioDraft[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_content_studio", "list");
  const rows = await db.select().from(marketingContentStudioDrafts).where(eq(marketingContentStudioDrafts.organizationId, input.organizationId)).orderBy(desc(marketingContentStudioDrafts.updatedAt)).limit(Math.min(input.limit ?? 12, 50));
  const visible: ContentStudioDraft[] = [];
  for (const row of rows) {
    try {
      await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId: row.workspaceId, actorUserId: input.actorUserId });
      visible.push(toStudio(row));
    } catch { /* A workspace-hidden draft is indistinguishable from absent. */ }
  }
  return visible;
}

type ConceptGenerator = (input: { brand: MarketingBrandProfile; goal: string; channel: string; performanceEvidence: Array<{ title: string; channel: string | null; views: number; engagements: number; clicks: number; leads: number; notes: string | null }> }) => Promise<ContentStudioConcept[]>;
type PackageGenerator = (input: { brand: MarketingBrandProfile; goal: string; channel: string; contentKind: ContentStudioContentKind; concept: ContentStudioConcept }) => Promise<ContentStudioPackage>;

export function resolveContentStudioContentKind(channel: string): ContentStudioContentKind {
  const normalized = channel.toLowerCase();
  if (normalized.includes("carousel")) return "carousel_post";
  if (normalized.includes("post")) return "single_image_post";
  return "short_video";
}

/**
 * Output.array deliberately wraps the provider response in a top-level object.
 * OpenAI structured outputs reject a top-level JSON Schema array.
 */
export const contentStudioConceptOutput = Output.array({
  name: "ContentStudioConcepts",
  element: contentStudioConceptSchema,
});

export function buildFallbackContentConcepts(input: { brand: MarketingBrandProfile; goal: string; channel: string }): ContentStudioConcept[] {
  const { brand, goal, channel } = input;
  const concepts = brand.brandKey === "codeitlearn"
    ? [
        { id: "playable-proof", title: "The idea becomes a playable game", angle: `Show the real CodeItLearn builder turning the requested idea into a finished game, then prove it works with a live score, timer and target. Goal: ${goal}`, hookDirection: "Open on the playable result—not the homepage—then reveal the prompt and one learning moment.", format: channel },
        { id: "one-change", title: "One change makes the project theirs", angle: "Start with the working game, make one visible gameplay or design change in the builder, and show the changed result immediately.", hookDirection: "Use a before-and-after game moment so parents can see that editing and learning happen inside the build.", format: channel },
        { id: "learn-behind-build", title: "Build first, understand the code behind it", angle: "Connect a real gameplay feature such as the score or timer to the code concept that powers it, without turning the content into a lecture.", hookDirection: "Lead with the game in motion, pause on the score or timer, then explain the one concept behind it.", format: channel },
      ]
    : [
        { id: "website-proof", title: "The website is the first system customers meet", angle: `Lead with a premium website or landing-page transformation tied to the requested outcome: ${goal}`, hookDirection: "Open with the finished page and the single business decision it clarifies.", format: channel },
        { id: "conversion-path", title: "From landing page to connected follow-up", angle: "Show the customer-facing page first, then reveal the CRM, workflow and measurement handoffs supporting it.", hookDirection: "Start with what the customer sees; reveal the connected system only after the value is clear.", format: channel },
        { id: "before-after", title: "Replace digital clutter with one clear path", angle: "Contrast a fragmented customer journey with a focused page, a clear call to action and a coordinated operating layer.", hookDirection: "Use a sharp before-and-after comparison grounded in visible interface proof.", format: channel },
      ];
  return contentStudioConceptsSchema.parse(concepts);
}

export function buildFallbackProductionPackage(input: { brand: MarketingBrandProfile; goal: string; channel: string; contentKind: ContentStudioContentKind; concept: ContentStudioConcept }): ContentStudioPackage {
  const { brand, contentKind, concept } = input;
  const isCodeIt = brand.brandKey === "codeitlearn";
  const hooks = isCodeIt
    ? ["What if one idea became a game you could actually play?", "This started as one sentence.", "Build the game first. Learn the code behind it."]
    : ["Your website is the first system customers meet.", "A premium website should make the next step obvious.", "Start with the page. Then connect the system behind it."];
  const callToAction = isCodeIt ? "Try the free first-game challenge at codeitlearn.com." : "Start with your website at lynq.build.";
  const base = {
    title: concept.title,
    hooks,
    selectedHook: hooks[0],
    caption: isCodeIt
      ? "One idea. One real, playable game. Then the learner changes it and understands the code behind it. Try the free first-game challenge at codeitlearn.com."
      : "Start with the page your customers see. Make the offer clear, the next step obvious, and the systems behind it connected. Start with your website at lynq.build.",
    coverText: isCodeIt ? "One idea → a playable game" : "Start with the page customers see",
    assetInstructions: isCodeIt
      ? ["Use the approved Pixel mascot and CodeIt logo.", "Use only verified CodeItLearn builder and live playable-game captures.", "The first product-proof frame must show the generated game with its score, timer and target; never substitute the homepage or sign-in screen."]
      : ["Use the LYNQ black-and-white foundation with controlled neon-lime accents.", "Use real website or portfolio proof.", "Keep layouts editorial, spacious and premium."],
    callToAction,
    renderingStatus: "not_requested" as const,
    renderedAssets: [],
    renderingError: null,
  };

  if (contentKind === "short_video") {
    return contentStudioPackageSchema.parse({
      ...base,
      contentKind,
      script: isCodeIt
        ? "What if one idea became a game you could actually play? Describe it in CodeItLearn. Build the first version. Play it with a real score and timer. Change it. Then learn the code behind it. Try the free first-game challenge."
        : "Your website is the first system customers meet. Make the offer clear. Make the next step obvious. Then connect the workflows and systems behind it. Start with your website at LYNQ.",
      shots: isCodeIt ? [
        { timing: "0:00–0:03", visual: "built_game: Real Circle Clicker playable result with score, timer and visible target.", onScreenText: "One idea became a real game.", audio: "What if one idea became a game you could actually play?" },
        { timing: "0:03–0:06", visual: "project_builder: Real CodeItLearn builder with the click-the-target prompt and generated project preview.", onScreenText: "Describe it.", audio: "Describe it in CodeItLearn." },
        { timing: "0:06–0:10", visual: "game_play: Live Circle Clicker gameplay showing the score, timer and target.", onScreenText: "Build it. Play it.", audio: "Build the first version, then play it." },
        { timing: "0:10–0:14", visual: "python_playground: Real product editor or learning proof connected to the game.", onScreenText: "Change it.", audio: "Make it yours." },
        { timing: "0:14–0:18", visual: "code_output: Real output or lesson proof showing the code concept behind the game.", onScreenText: "Learn how it works.", audio: "Then learn the code behind it." },
        { timing: "0:18–0:21", visual: "cta: Pixel mascot, approved logo and codeitlearn.com.", onScreenText: "Try the free first-game challenge.", audio: callToAction },
      ] : [
        { timing: "0:00–0:03", visual: "website: Real premium landing-page proof.", onScreenText: "Your website is the first system customers meet.", audio: hooks[0] },
        { timing: "0:03–0:06", visual: "portfolio: Real LYNQ website work.", onScreenText: "Make the offer clear.", audio: "Make the offer clear." },
        { timing: "0:06–0:09", visual: "website: Real conversion path and call to action.", onScreenText: "Make the next step obvious.", audio: "Make the next step obvious." },
        { timing: "0:09–0:12", visual: "systems: Connected workflow behind the customer journey.", onScreenText: "Connect what happens next.", audio: "Then connect the system behind it." },
        { timing: "0:12–0:15", visual: "cta: LYNQ brand card and lynq.build.", onScreenText: "Start with your website.", audio: callToAction },
      ],
    });
  }

  const codeItPanels = [
    { position: "1", purpose: "Prove the result immediately.", visual: "built_game: Real Circle Clicker game with score, timer and visible target.", overlayText: "One idea became a real game." },
    { position: "2", purpose: "Show where the build starts.", visual: "project_builder: Real CodeItLearn project builder with the user's game prompt.", overlayText: "Describe what you want to build." },
    { position: "3", purpose: "Show authentic playable proof.", visual: "game_play: Live Circle Clicker gameplay with score, timer and target.", overlayText: "Build it. Then play it." },
    { position: "4", purpose: "Connect the build to learning.", visual: "python_playground: Real CodeItLearn editor or related code concept.", overlayText: "Change it. Learn how it works." },
    { position: "5", purpose: "Close with the approved acquisition path.", visual: "cta: Pixel mascot, approved logo and codeitlearn.com.", overlayText: "Try the free first-game challenge." },
  ];
  const lynqPanels = [
    { position: "1", purpose: "Lead with customer-facing proof.", visual: "website: Real premium landing-page work.", overlayText: "Start with the page customers see." },
    { position: "2", purpose: "Clarify the business value.", visual: "portfolio: Real LYNQ website or portfolio proof.", overlayText: "Make the offer clear." },
    { position: "3", purpose: "Show the conversion path.", visual: "website: Real page and call-to-action detail.", overlayText: "Make the next step obvious." },
    { position: "4", purpose: "Reveal the operating layer after the website.", visual: "systems: Connected CRM and workflow behind the page.", overlayText: "Then connect what happens next." },
    { position: "5", purpose: "Close with the brand CTA.", visual: "cta: LYNQ brand card and lynq.build.", overlayText: "Start with your website." },
  ];
  const panels = contentKind === "single_image_post" ? [(isCodeIt ? codeItPanels : lynqPanels)[0]] : (isCodeIt ? codeItPanels : lynqPanels);
  return contentStudioPackageSchema.parse({ ...base, contentKind, postCopy: base.caption, panels });
}

export async function withContentStudioGenerationFallback<T>(input: { kind: "concept" | "package"; generate: () => Promise<T>; fallback: () => T }): Promise<T> {
  try {
    return await input.generate();
  } catch (error) {
    console.warn(`[content-studio] AI ${input.kind} generation unavailable; using verified local fallback`, error instanceof Error ? error.name : "unknown_error");
    return input.fallback();
  }
}

export function enforceContentStudioProofQuality(input: { brand: MarketingBrandProfile; goal: string; pkg: ContentStudioPackage }): ContentStudioPackage {
  const pkg = contentStudioPackageSchema.parse(input.pkg);
  if (input.brand.brandKey !== "codeitlearn" || !/game|project|playable|build/i.test(input.goal)) return pkg;
  const visuals = pkg.contentKind === "short_video" ? pkg.shots.map((shot) => shot.visual) : pkg.panels.map((panel) => panel.visual);
  const firstVisual = visuals[0]?.toLowerCase() ?? "";
  if (!/^(built_game|game_play):/.test(firstVisual)) {
    throw new Error("CodeItLearn game content must open with verified playable-game proof");
  }
  if (!visuals.some((visual) => /^(project_builder|built_game|game_play):/i.test(visual))) {
    throw new Error("CodeItLearn game content must include verified builder or gameplay evidence");
  }
  return pkg;
}

const defaultConceptGenerator: ConceptGenerator = async ({ brand, goal, channel, performanceEvidence }) => {
  return withContentStudioGenerationFallback({
    kind: "concept",
    generate: async () => {
    const result = await generateText({
      model: getOfficeModel("planning"),
      output: contentStudioConceptOutput,
      system: "You are LYNQ Office's Content Director. Produce exactly three strategically distinct, practical short-form content concepts. Follow the supplied brand profile literally. Never invent performance, product availability, customer proof or capabilities. Return structured data only.",
      prompt: JSON.stringify({ brand, goal, channel, verifiedPastPerformance: performanceEvidence, requirements: ["Each concept must be producible today", "Prefer product or process proof over generic advice", "Make the three angles meaningfully different", "Use verified past performance only when supplied; never invent or extrapolate results", ...(brand.brandKey === "codeitlearn" ? ["When the goal mentions a game or project, the first concept must lead with a real playable result and never substitute the homepage, lesson map or sign-in screen"] : [])] }),
    });
    return contentStudioConceptsSchema.parse(result.output);
    },
    fallback: () => buildFallbackContentConcepts({ brand, goal, channel }),
  });
};

const defaultPackageGenerator: PackageGenerator = async ({ brand, goal, channel, contentKind, concept }) => {
  const isVideo = contentKind === "short_video";
  const isCodeItVideo = isVideo && brand.brandKey === "codeitlearn";
  const isLynqVideo = isVideo && brand.brandKey === "lynq";
  const system = isVideo
    ? `You are LYNQ Office's short-form Creative Director and Script Writer. Create a complete short-video production package that a social media manager can render, review and publish. Follow the supplied brand truth and claims guardrails. The storyboard must be specific and usable. ${isCodeItVideo ? "Create 5–8 concise shots for an 18–24 second product walkthrough. Every visual field must start with one approved scene token—pixel_mascot, brand_logo, project_builder, built_game, game_play, lessons_map, python_playground, code_output, explore, or cta—then add the production direction. When the goal involves a project or game, open with built_game or game_play showing a real playable result; never use the homepage, lesson map or sign-in screen as a substitute. Include the builder and at least two real product-proof scenes." : isLynqVideo ? "Create exactly 5 premium shots for a 15-second video. Every visual field must start with one approved scene token—brand, website, portfolio, systems, office, automation, or cta. Lead with websites/landing pages unless the user's goal explicitly asks for operations. Use website or portfolio proof in at least two shots. Keep neon lime controlled and editorial." : "Keep the total concept suitable for a concise 10–15 second social video."} Never put production directions in onScreenText; onScreenText is final audience-facing copy only. contentKind must be short_video. Set renderingStatus to not_requested, renderedAssets to an empty array and renderingError to null. Return structured data only.`
    : `You are LYNQ Office's Social Creative Director and Copywriter. Create a complete, publish-ready social post package with final copy and specific visual direction. Follow the supplied brand truth and claims guardrails. For a single-image post return exactly one panel; for a carousel return 3–10 ordered panels with a clear narrative. ${brand.brandKey === "lynq" ? "Start every panel visual with one approved scene token—brand, website, portfolio, systems, office, automation, or cta. Lead with websites or landing pages unless the goal explicitly asks for operations. Use real portfolio/site proof and premium black/white/neon-lime art direction." : "Start every panel visual with one approved scene token—pixel_mascot, brand_logo, project_builder, built_game, game_play, lessons_map, python_playground, code_output, explore, or cta. When the goal involves a project or game, panel one must use built_game or game_play and show the real playable result with its visible game UI. Never substitute the homepage, lesson map or sign-in screen. Use Pixel only as supporting brand art, not as fake product proof."} Set renderingStatus to not_requested, renderedAssets to an empty array and renderingError to null. Return structured data only.`;
  const prompt = JSON.stringify({ brand, goal, channel, contentKind, selectedConcept: concept, requirements: isVideo
      ? [isCodeItVideo ? "18–24 seconds with 5–8 shots" : isLynqVideo ? "15 seconds with exactly 5 shots" : "10–15 seconds", "3–6 strong hooks", "concise word-for-word script", "timed shot list", "caption and cover", "specific asset instructions", "one CTA", ...(isCodeItVideo ? ["Open with built_game or game_play when showing a project", "Use real project_builder, built_game, game_play, lessons_map, python_playground, code_output or explore scenes", "End with cta and codeitlearn.com"] : []), ...(isLynqVideo ? ["Lead with website/landing-page proof", "Use website or portfolio scenes twice", "End with cta and lynq.build"] : [])]
      : ["3–6 opening-line options", "final post copy", "platform-appropriate caption", "panel-by-panel visual and overlay text", "specific asset instructions", "one CTA", "no invented product features or results"] });

  // Keep each structured-output schema concrete here. A union schema would be
  // ambiguous to the provider and is rejected by TypeScript's output contract.
  return withContentStudioGenerationFallback({
  kind: "package",
  generate: async () => {
  if (contentKind === "short_video") {
    const result = await generateText({
      model: getOfficeModel("planning"),
      output: Output.object({ name: "ContentStudioVideoPackage", schema: contentStudioVideoPackageSchema }),
      system,
      prompt,
    });
    return enforceContentStudioProofQuality({ brand, goal, pkg: contentStudioPackageSchema.parse(result.output) });
  }
  if (contentKind === "carousel_post") {
    const result = await generateText({
      model: getOfficeModel("planning"),
      output: Output.object({ name: "ContentStudioCarouselPackage", schema: contentStudioCarouselPostPackageSchema }),
      system,
      prompt,
    });
    return enforceContentStudioProofQuality({ brand, goal, pkg: contentStudioPackageSchema.parse(result.output) });
  }
  const result = await generateText({
    model: getOfficeModel("planning"),
    output: Output.object({ name: "ContentStudioSingleImagePackage", schema: contentStudioSingleImagePostPackageSchema }),
    system,
    prompt,
  });
  return enforceContentStudioProofQuality({ brand, goal, pkg: contentStudioPackageSchema.parse(result.output) });
  },
  fallback: () => buildFallbackProductionPackage({ brand, goal, channel, contentKind, concept }),
  });
};

export async function generateContentConcepts(db: Db, input: { organizationId: string; workspaceId?: string | null; brandProfileId: string; goal: string; intendedChannel: string; plannedPublishAt?: Date | null; actorUserId: string }, generator: ConceptGenerator = defaultConceptGenerator): Promise<ContentStudioDraft> {
  const workspaceId = input.workspaceId ?? null;
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_studio", "new");
  await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  const brand = await resolveBrand(db, input.organizationId, input.brandProfileId);
  if (brand.workspaceId !== workspaceId) throw new Error("Brand profile is outside this workspace");
  const performanceRows = await db.select({ title: marketingContentItems.title, channel: marketingContentItems.intendedChannel, views: marketingContentPerformanceSnapshots.views, likes: marketingContentPerformanceSnapshots.likes, comments: marketingContentPerformanceSnapshots.comments, shares: marketingContentPerformanceSnapshots.shares, saves: marketingContentPerformanceSnapshots.saves, clicks: marketingContentPerformanceSnapshots.clicks, leads: marketingContentPerformanceSnapshots.leads, notes: marketingContentPerformanceSnapshots.notes }).from(marketingContentPerformanceSnapshots).innerJoin(marketingContentItems, and(eq(marketingContentItems.id, marketingContentPerformanceSnapshots.contentItemId), eq(marketingContentItems.organizationId, marketingContentPerformanceSnapshots.organizationId))).innerJoin(marketingContentStudioDrafts, and(eq(marketingContentStudioDrafts.contentItemId, marketingContentItems.id), eq(marketingContentStudioDrafts.organizationId, marketingContentItems.organizationId))).where(and(eq(marketingContentPerformanceSnapshots.organizationId, input.organizationId), eq(marketingContentStudioDrafts.brandProfileId, brand.id))).orderBy(desc(marketingContentPerformanceSnapshots.capturedAt)).limit(12);
  const performanceEvidence = performanceRows.map((row) => ({ title: row.title, channel: row.channel, views: row.views, engagements: row.likes + row.comments + row.shares + row.saves, clicks: row.clicks, leads: row.leads, notes: row.notes }));
  const concepts = contentStudioConceptsSchema.parse(await generator({ brand, goal: input.goal, channel: input.intendedChannel, performanceEvidence }));
  const [row] = await db.insert(marketingContentStudioDrafts).values({ organizationId: input.organizationId, workspaceId, brandProfileId: brand.id, goal: input.goal, intendedChannel: input.intendedChannel, plannedPublishAt: input.plannedPublishAt ?? null, concepts, ownerUserId: input.actorUserId }).returning();
  await recordAuditEvent(db, { eventType: "marketing_content_studio_started", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_studio", targetId: row.id, metadata: { brandKey: brand.brandKey, channel: input.intendedChannel, workspaceScoped: Boolean(workspaceId) } });
  return toStudio(row);
}

export async function generateProductionPackage(db: Db, input: { organizationId: string; studioId: string; conceptId: string; expectedRevision: number; actorUserId: string }, generator: PackageGenerator = defaultPackageGenerator): Promise<ContentStudioDraft> {
  const studio = await getStudioDraftForUser(db, input);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_studio", studio.id);
  const concept = studio.concepts.find((item) => item.id === input.conceptId);
  if (!concept) throw new Error("Selected concept does not belong to this Content Studio draft");
  const brand = await resolveBrand(db, input.organizationId, studio.brandProfileId);
  const contentKind = resolveContentStudioContentKind(studio.intendedChannel);
  const productionPackage = contentStudioPackageSchema.parse(await generator({ brand, goal: studio.goal, channel: studio.intendedChannel, contentKind, concept }));
  const [row] = await db.update(marketingContentStudioDrafts).set({ selectedConceptId: concept.id, productionPackage, status: "production", revision: input.expectedRevision + 1, updatedAt: new Date() }).where(and(eq(marketingContentStudioDrafts.id, studio.id), eq(marketingContentStudioDrafts.organizationId, input.organizationId), eq(marketingContentStudioDrafts.revision, input.expectedRevision))).returning();
  if (!row) throw new Error("This Content Studio draft changed; refresh and try again");
  await recordAuditEvent(db, { eventType: "marketing_content_studio_package_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_studio", targetId: row.id, metadata: { conceptId: concept.id } });
  return toStudio(row);
}

export async function updateProductionPackage(db: Db, input: { organizationId: string; studioId: string; productionPackage: ContentStudioPackage; expectedRevision: number; actorUserId: string }): Promise<ContentStudioDraft> {
  const studio = await getStudioDraftForUser(db, input);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_studio", studio.id);
  const submittedPackage = contentStudioPackageSchema.parse(input.productionPackage);
  // Rendered media paths are server-owned. Editable forms may change the
  // creative package, but cannot inject or replace another tenant's blobs.
  const productionPackage = contentStudioPackageSchema.parse({
    ...submittedPackage,
    renderingStatus: studio.productionPackage?.renderingStatus ?? "not_requested",
    renderedAssets: studio.productionPackage?.renderedAssets ?? [],
    renderingError: studio.productionPackage?.renderingError ?? null,
  });
  const [row] = await db.update(marketingContentStudioDrafts).set({ productionPackage, revision: input.expectedRevision + 1, updatedAt: new Date() }).where(and(eq(marketingContentStudioDrafts.id, studio.id), eq(marketingContentStudioDrafts.organizationId, input.organizationId), eq(marketingContentStudioDrafts.revision, input.expectedRevision))).returning();
  if (!row) throw new Error("This Content Studio draft changed; refresh and try again");
  return toStudio(row);
}

export async function saveStudioToPipeline(db: Db, input: { organizationId: string; studioId: string; campaignId: string; actorUserId: string }): Promise<{ studio: ContentStudioDraft; contentItemId: string }> {
  const studio = await getStudioDraftForUser(db, input);
  if (!studio.productionPackage) throw new Error("Generate a production package before saving to the pipeline");
  if (studio.contentItemId) return { studio, contentItemId: studio.contentItemId };
  const [campaign] = await db.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.id, input.campaignId), eq(marketingCampaigns.organizationId, input.organizationId)));
  if (!campaign || campaign.workspaceId !== studio.workspaceId) throw new Error("Campaign is outside this Content Studio workspace");
  // Resolve the existing Runtime primitive before creating the canonical
  // content row, so a missing one-time setup cannot leave an orphan draft.
  await resolveContentDraftAssistantAgent(db, input.organizationId);
  const contentItem = await createContentItem(db, { organizationId: input.organizationId, campaignId: campaign.id, title: studio.productionPackage.title, contentType: studio.productionPackage.contentKind === "short_video" ? "script" : "social_post", intendedChannel: studio.intendedChannel, plannedPublishAt: studio.plannedPublishAt, actorUserId: input.actorUserId });
  await createContentStudioPackageTask(db, { organizationId: input.organizationId, workspaceId: studio.workspaceId, contentItemId: contentItem.id, productionPackage: studio.productionPackage, actorUserId: input.actorUserId });
  const [row] = await db.update(marketingContentStudioDrafts).set({ status: "saved", contentItemId: contentItem.id, revision: studio.revision + 1, updatedAt: new Date() }).where(and(eq(marketingContentStudioDrafts.id, studio.id), eq(marketingContentStudioDrafts.organizationId, input.organizationId), eq(marketingContentStudioDrafts.revision, studio.revision))).returning();
  if (!row) throw new Error("This Content Studio draft changed; refresh and try again");
  await recordAuditEvent(db, { eventType: "marketing_content_studio_saved", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_studio", targetId: row.id, metadata: { contentItemId: contentItem.id, campaignId: campaign.id } });
  return { studio: toStudio(row), contentItemId: contentItem.id };
}

export function serializeProductionPackage(value: ContentStudioPackage): string {
  const common = [
    `# ${value.title}`,
    "## Hooks", ...value.hooks.map((hook) => `- ${hook}`),
    `## Selected hook\n${value.selectedHook}`,
    `## Caption\n${value.caption}`,
    `## Cover\n${value.coverText}`,
    "## Assets", ...value.assetInstructions.map((item) => `- ${item}`),
    `## CTA\n${value.callToAction}`,
  ];
  const formatSpecific = value.contentKind === "short_video"
    ? [`## Script\n${value.script}`, "## Storyboard / shot list", ...value.shots.map((shot) => `### ${shot.timing}\n- Visual: ${shot.visual}\n- On-screen text: ${shot.onScreenText}\n- Audio: ${shot.audio}`), `## Rendering\n${value.renderingStatus === "ready" ? `${value.renderedAssets.length} rendered media asset(s) attached.` : "Media has not been rendered yet."}`]
    : [`## Post copy\n${value.postCopy}`, "## Post panels", ...value.panels.map((panel) => `### ${panel.position}\n- Purpose: ${panel.purpose}\n- Visual: ${panel.visual}\n- Overlay text: ${panel.overlayText}`)];
  return [...common, ...formatSpecific].join("\n\n");
}
