import "server-only";
import { and, eq, isNull, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingBrandProfiles, marketingChannelAccounts, marketingCampaigns, marketingContentItems, socialContentVariants } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveMarketingAuthContext, requireMarketingViewAuthority, requireMarketingManageBrandsAuthority, type MarketingAuthContext } from "@/lib/marketing-os/authz";
import { brandProfileInputSchema, brandProfileUpdateSchema, brandVisualIdentitySchema, type BrandProfileInput, type BrandProfileUpdate, type BrandVisualIdentity, type SocialPlatform } from "./validation";
import { SocialBrandKeyTakenError, SocialBrandArchivedError, StaleSocialUpdateError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Module 19 — brands. A brand is the persistent context the AI Social
 * Manager, the Content Studio and every connection hangs off. Reuses
 * `marketing_brand_profiles` (extended with Module 19 columns) so Content
 * Studio and the Social Command Center always agree on who a brand is.
 */

export interface SocialBrand {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  brandKey: string;
  name: string;
  positioning: string;
  audience: string;
  voice: string;
  visualRules: string;
  productContext: string;
  claimsGuardrails: string;
  callsToAction: string[];
  approvedExamples: string[];
  companyInfo: string;
  brandStory: string;
  writingStyle: string;
  visualIdentity: BrandVisualIdentity;
  websites: string[];
  competitors: string[];
  contentPillars: string[];
  preferredPlatforms: SocialPlatform[];
  prohibitedLanguage: string[];
  neverClaim: string[];
  geographicMarket: string;
  objectives: { key: string; description: string; target: string }[];
  createdByUserId: string | null;
  archivedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function toSocialBrand(row: typeof marketingBrandProfiles.$inferSelect): SocialBrand {
  const visual = brandVisualIdentitySchema.safeParse(row.visualIdentity);
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    brandKey: row.brandKey,
    name: row.name,
    positioning: row.positioning,
    audience: row.audience,
    voice: row.voice,
    visualRules: row.visualRules,
    productContext: row.productContext,
    claimsGuardrails: row.claimsGuardrails,
    callsToAction: stringList(row.callsToAction),
    approvedExamples: stringList(row.approvedExamples),
    companyInfo: row.companyInfo,
    brandStory: row.brandStory,
    writingStyle: row.writingStyle,
    visualIdentity: visual.success ? visual.data : { colors: [], typography: { heading: "", body: "" }, logoAssetIds: [], notes: "" },
    websites: stringList(row.websites),
    competitors: stringList(row.competitors),
    contentPillars: stringList(row.contentPillars),
    preferredPlatforms: stringList(row.preferredPlatforms) as SocialPlatform[],
    prohibitedLanguage: stringList(row.prohibitedLanguage),
    neverClaim: stringList(row.neverClaim),
    geographicMarket: row.geographicMarket,
    objectives: Array.isArray(row.objectives) ? (row.objectives as SocialBrand["objectives"]) : [],
    createdByUserId: row.createdByUserId,
    archivedAt: row.archivedAt,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function resolveBrandById(db: Db, organizationId: string, brandProfileId: string): Promise<SocialBrand> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingBrandProfiles).where(and(eq(marketingBrandProfiles.id, brandProfileId), eq(marketingBrandProfiles.organizationId, organizationId)));
    return row ? toSocialBrand(row) : undefined;
  });
}

export async function requireActiveBrand(db: Db, organizationId: string, brandProfileId: string): Promise<SocialBrand> {
  const brand = await resolveBrandById(db, organizationId, brandProfileId);
  if (brand.archivedAt) throw new SocialBrandArchivedError();
  return brand;
}

export async function listBrands(db: Db, input: { organizationId: string; actorUserId: string; includeArchived?: boolean }): Promise<SocialBrand[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_brand_profile", "list");
  const conditions = [eq(marketingBrandProfiles.organizationId, input.organizationId)];
  if (!input.includeArchived) conditions.push(isNull(marketingBrandProfiles.archivedAt));
  const rows = await db.select().from(marketingBrandProfiles).where(and(...conditions)).orderBy(desc(marketingBrandProfiles.createdAt));
  return rows.map(toSocialBrand);
}

export async function getBrandForUser(db: Db, input: { organizationId: string; brandProfileId: string; actorUserId: string }): Promise<SocialBrand> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_brand_profile", input.brandProfileId);
  return resolveBrandById(db, input.organizationId, input.brandProfileId);
}

function toColumns(input: Partial<BrandProfileInput>) {
  const out: Partial<typeof marketingBrandProfiles.$inferInsert> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.positioning !== undefined) out.positioning = input.positioning;
  if (input.audience !== undefined) out.audience = input.audience;
  if (input.voice !== undefined) out.voice = input.voice;
  if (input.visualRules !== undefined) out.visualRules = input.visualRules;
  if (input.productContext !== undefined) out.productContext = input.productContext;
  if (input.claimsGuardrails !== undefined) out.claimsGuardrails = input.claimsGuardrails;
  if (input.callsToAction !== undefined) out.callsToAction = input.callsToAction;
  if (input.approvedExamples !== undefined) out.approvedExamples = input.approvedExamples;
  if (input.companyInfo !== undefined) out.companyInfo = input.companyInfo;
  if (input.brandStory !== undefined) out.brandStory = input.brandStory;
  if (input.writingStyle !== undefined) out.writingStyle = input.writingStyle;
  if (input.visualIdentity !== undefined) out.visualIdentity = input.visualIdentity;
  if (input.websites !== undefined) out.websites = input.websites;
  if (input.competitors !== undefined) out.competitors = input.competitors;
  if (input.contentPillars !== undefined) out.contentPillars = input.contentPillars;
  if (input.preferredPlatforms !== undefined) out.preferredPlatforms = input.preferredPlatforms;
  if (input.prohibitedLanguage !== undefined) out.prohibitedLanguage = input.prohibitedLanguage;
  if (input.neverClaim !== undefined) out.neverClaim = input.neverClaim;
  if (input.geographicMarket !== undefined) out.geographicMarket = input.geographicMarket;
  if (input.objectives !== undefined) out.objectives = input.objectives;
  return out;
}

export async function createBrand(db: Db, input: { organizationId: string; actorUserId: string; brand: BrandProfileInput }): Promise<SocialBrand> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageBrandsAuthority(db, ctx, "marketing_brand_profile", "new");
  const parsed = brandProfileInputSchema.parse(input.brand);
  let row: typeof marketingBrandProfiles.$inferSelect;
  try {
    [row] = await db
      .insert(marketingBrandProfiles)
      .values({ organizationId: input.organizationId, workspaceId: null, brandKey: parsed.brandKey, createdByUserId: input.actorUserId, ...toColumns(parsed), name: parsed.name, positioning: parsed.positioning, audience: parsed.audience, voice: parsed.voice, visualRules: parsed.visualRules, productContext: parsed.productContext, claimsGuardrails: parsed.claimsGuardrails })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SocialBrandKeyTakenError(parsed.brandKey);
    throw err;
  }
  await recordAuditEvent(db, { eventType: "social_brand_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_brand_profile", targetId: row.id, metadata: { brandKey: parsed.brandKey } });
  return toSocialBrand(row);
}

export async function updateBrand(db: Db, input: { organizationId: string; brandProfileId: string; actorUserId: string; expectedRevision: number; changes: BrandProfileUpdate }): Promise<SocialBrand> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageBrandsAuthority(db, ctx, "marketing_brand_profile", input.brandProfileId);
  await requireActiveBrand(db, input.organizationId, input.brandProfileId);
  const changes = brandProfileUpdateSchema.parse(input.changes);
  const [row] = await db
    .update(marketingBrandProfiles)
    .set({ ...toColumns(changes), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(marketingBrandProfiles.id, input.brandProfileId), eq(marketingBrandProfiles.organizationId, input.organizationId), eq(marketingBrandProfiles.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("brand");
  await recordAuditEvent(db, { eventType: "social_brand_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_brand_profile", targetId: row.id, metadata: { fields: Object.keys(changes) } });
  return toSocialBrand(row);
}

export async function archiveBrand(db: Db, input: { organizationId: string; brandProfileId: string; actorUserId: string; expectedRevision: number }): Promise<SocialBrand> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageBrandsAuthority(db, ctx, "marketing_brand_profile", input.brandProfileId);
  await requireActiveBrand(db, input.organizationId, input.brandProfileId);
  const [row] = await db
    .update(marketingBrandProfiles)
    .set({ archivedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(marketingBrandProfiles.id, input.brandProfileId), eq(marketingBrandProfiles.organizationId, input.organizationId), eq(marketingBrandProfiles.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("brand");
  await recordAuditEvent(db, { eventType: "social_brand_archived", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_brand_profile", targetId: row.id });
  return toSocialBrand(row);
}

/**
 * Every brand needs one campaign to hang content on (`marketing_content_items.campaign_id`
 * is NOT NULL). The Social Command Center uses a per-brand "always-on"
 * campaign unless the caller names another; created lazily, idempotent.
 */
export async function ensureAlwaysOnCampaign(db: Db, input: { organizationId: string; brand: SocialBrand; actorUserId: string }): Promise<{ id: string; name: string }> {
  const campaignKey = `social-always-on-${input.brand.brandKey}`.slice(0, 60);
  const [existing] = await db.select({ id: marketingCampaigns.id, name: marketingCampaigns.name }).from(marketingCampaigns).where(and(eq(marketingCampaigns.organizationId, input.organizationId), eq(marketingCampaigns.campaignKey, campaignKey)));
  if (existing) return existing;
  try {
    const [created] = await db
      .insert(marketingCampaigns)
      .values({ organizationId: input.organizationId, campaignKey, name: `${input.brand.name} — always-on social`, description: "Evergreen social content for this brand (created by the Social Command Center).", objectiveType: "engagement", status: "active", ownerUserId: input.actorUserId, createdByUserId: input.actorUserId })
      .returning({ id: marketingCampaigns.id, name: marketingCampaigns.name });
    return created;
  } catch (err) {
    if (!isPostgresUniqueViolation(err)) throw err;
    const [raced] = await db.select({ id: marketingCampaigns.id, name: marketingCampaigns.name }).from(marketingCampaigns).where(and(eq(marketingCampaigns.organizationId, input.organizationId), eq(marketingCampaigns.campaignKey, campaignKey)));
    return raced;
  }
}

// ---------------------------------------------------------------------------
// Context assembly — the bounded, structured brand context handed to the AI
// layer. Never a dump of every column on every call: callers ask for the
// sections they need and get a size-capped text block plus the structured
// facts the prompt builders key off.
// ---------------------------------------------------------------------------

export type BrandContextSection = "identity" | "voice" | "offer" | "audience" | "guardrails" | "visual" | "pillars" | "examples" | "objectives";

export interface BrandContext {
  brandId: string;
  brandKey: string;
  name: string;
  text: string;
  facts: {
    preferredPlatforms: SocialPlatform[];
    contentPillars: string[];
    callsToAction: string[];
    prohibitedLanguage: string[];
    neverClaim: string[];
    websites: string[];
    geographicMarket: string;
  };
  recentTopics: string[];
}

const SECTION_LIMIT = 1200;

function clip(value: string, limit = SECTION_LIMIT): string {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

export function buildBrandContextText(brand: SocialBrand, sections: BrandContextSection[]): string {
  const want = new Set(sections);
  const parts: string[] = [`BRAND: ${brand.name} (${brand.brandKey})`];
  if (want.has("identity")) {
    if (brand.companyInfo) parts.push(`COMPANY: ${clip(brand.companyInfo)}`);
    if (brand.positioning) parts.push(`POSITIONING: ${clip(brand.positioning)}`);
    if (brand.brandStory) parts.push(`STORY: ${clip(brand.brandStory)}`);
    if (brand.geographicMarket) parts.push(`MARKET: ${clip(brand.geographicMarket, 300)}`);
    if (brand.websites.length) parts.push(`WEBSITES: ${brand.websites.join(", ")}`);
  }
  if (want.has("offer") && brand.productContext) parts.push(`PRODUCTS/SERVICES: ${clip(brand.productContext)}`);
  if (want.has("audience") && brand.audience) parts.push(`AUDIENCE: ${clip(brand.audience)}`);
  if (want.has("voice")) {
    if (brand.voice) parts.push(`VOICE: ${clip(brand.voice)}`);
    if (brand.writingStyle) parts.push(`WRITING STYLE: ${clip(brand.writingStyle)}`);
  }
  if (want.has("visual")) {
    if (brand.visualRules) parts.push(`VISUAL RULES: ${clip(brand.visualRules)}`);
    const colors = brand.visualIdentity.colors.map((c) => `${c.name} ${c.hex}${c.role ? ` (${c.role})` : ""}`).join(", ");
    if (colors) parts.push(`COLORS: ${colors}`);
    const typo = [brand.visualIdentity.typography.heading && `heading: ${brand.visualIdentity.typography.heading}`, brand.visualIdentity.typography.body && `body: ${brand.visualIdentity.typography.body}`].filter(Boolean).join("; ");
    if (typo) parts.push(`TYPOGRAPHY: ${typo}`);
  }
  if (want.has("pillars") && brand.contentPillars.length) parts.push(`CONTENT PILLARS: ${brand.contentPillars.join(" | ")}`);
  if (want.has("guardrails")) {
    if (brand.claimsGuardrails) parts.push(`CLAIMS GUARDRAILS: ${clip(brand.claimsGuardrails)}`);
    if (brand.neverClaim.length) parts.push(`NEVER CLAIM: ${brand.neverClaim.join(" | ")}`);
    if (brand.prohibitedLanguage.length) parts.push(`PROHIBITED LANGUAGE: ${brand.prohibitedLanguage.join(", ")}`);
    if (brand.competitors.length) parts.push(`COMPETITORS (never disparage, never copy): ${brand.competitors.join(", ")}`);
  }
  if (want.has("examples")) {
    if (brand.callsToAction.length) parts.push(`PREFERRED CTAS: ${brand.callsToAction.join(" | ")}`);
    if (brand.approvedExamples.length) parts.push(`APPROVED EXAMPLES:\n- ${brand.approvedExamples.slice(0, 8).map((e) => clip(e, 300)).join("\n- ")}`);
  }
  if (want.has("objectives") && brand.objectives.length) parts.push(`OBJECTIVES: ${brand.objectives.map((o) => `${o.key}: ${o.description}${o.target ? ` (target ${o.target})` : ""}`).join(" | ")}`);
  return parts.join("\n");
}

/** Assembles brand context plus the brand's recent published/scheduled topics so the AI does not repeat itself. Tenant-scoped; no authz of its own — callers already checked. */
export async function assembleBrandContext(db: Db, input: { organizationId: string; brandProfileId: string; sections?: BrandContextSection[]; recentLimit?: number }): Promise<BrandContext> {
  const brand = await resolveBrandById(db, input.organizationId, input.brandProfileId);
  const sections = input.sections ?? ["identity", "voice", "offer", "audience", "guardrails", "pillars", "examples", "objectives"];
  const recent = await db
    .select({ title: marketingContentItems.title, status: socialContentVariants.status, platform: socialContentVariants.platform })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, eq(socialContentVariants.contentItemId, marketingContentItems.id))
    .where(and(eq(socialContentVariants.organizationId, input.organizationId), eq(marketingContentItems.brandProfileId, input.brandProfileId), isNull(socialContentVariants.archivedAt)))
    .orderBy(desc(socialContentVariants.updatedAt))
    .limit(input.recentLimit ?? 20);
  const recentTopics = Array.from(new Set(recent.map((r) => r.title))).slice(0, 15);
  return {
    brandId: brand.id,
    brandKey: brand.brandKey,
    name: brand.name,
    text: buildBrandContextText(brand, sections),
    facts: {
      preferredPlatforms: brand.preferredPlatforms,
      contentPillars: brand.contentPillars,
      callsToAction: brand.callsToAction,
      prohibitedLanguage: brand.prohibitedLanguage,
      neverClaim: brand.neverClaim,
      websites: brand.websites,
      geographicMarket: brand.geographicMarket,
    },
    recentTopics,
  };
}

/** Accounts attached to a brand, for brand switching and the Connection Center. */
export async function listBrandAccounts(db: Db, input: { organizationId: string; brandProfileId: string }): Promise<(typeof marketingChannelAccounts.$inferSelect)[]> {
  return db.select().from(marketingChannelAccounts).where(and(eq(marketingChannelAccounts.organizationId, input.organizationId), eq(marketingChannelAccounts.brandProfileId, input.brandProfileId), isNull(marketingChannelAccounts.archivedAt)));
}

export type { MarketingAuthContext };
