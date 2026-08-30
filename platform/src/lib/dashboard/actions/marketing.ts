"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { upsertMarketingConfiguration } from "@/lib/marketing-os/configuration";
import { createMarketingTeam, addMarketingTeamMember } from "@/lib/marketing-os/teams";
import { grantMarketingRole, revokeMarketingRole } from "@/lib/marketing-os/roles";
import { createCampaign, updateCampaign, transitionCampaignStatus } from "@/lib/marketing-os/campaigns";
import { createAudience, updateAudience, snapshotAudience } from "@/lib/marketing-os/audiences";
import { createContentItem, submitContentForReview, scheduleContent, confirmContentPublished, archiveContentItem } from "@/lib/marketing-os/content";
import { requestContentReviewApproval } from "@/lib/marketing-os/agents";
import { approveRequest, rejectRequest } from "@/lib/agent-runtime/approvals";
import { applyContentApprovalDecision } from "@/lib/marketing-os/content";
import { createPlaybook, addPlaybookStep, publishPlaybookVersion } from "@/lib/marketing-os/playbooks";
import { startCampaignRun, completeCampaignRunItem, completeCampaignRun } from "@/lib/marketing-os/campaign-runs";
import { createDestination } from "@/lib/marketing-os/destinations";
import { createBudgetEntry } from "@/lib/marketing-os/budget";
import { createCampaignBriefTask, createContentDraftTask, createCampaignSummaryTask } from "@/lib/marketing-os/agents";
import { seedMarketingAgents } from "@/lib/marketing-os/agents";
import { seedMarketingWorkflowTemplates } from "@/lib/marketing-os/templates";
import {
  marketingRoleSchema,
  marketingTeamMemberRoleSchema,
  marketingKeySchema,
  marketingNameSchema,
  marketingTitleSchema,
  marketingObjectiveTypeSchema,
  marketingContentTypeSchema,
  marketingPlaybookTypeSchema,
  marketingPlaybookStepTypeSchema,
  marketingAudienceEntityTypeSchema,
  marketingCampaignStatusSchema,
  marketingDestinationTypeSchema,
} from "@/lib/marketing-os/validation";
import { toActionResult } from "./errors";
import type { ActionResult } from "./types";
import { ensureDefaultBrandProfiles, generateContentConcepts, generateProductionPackage, saveStudioToPipeline, updateProductionPackage } from "@/lib/marketing-os/content-studio";
import { contentStudioContentKindSchema, contentStudioPackageSchema } from "@/lib/marketing-os/validation";
import { renderContentStudioMedia } from "@/lib/marketing-os/media-production";
import { ensureDefaultChannelAccounts, recordPerformanceSnapshot } from "@/lib/marketing-os/command-center";
import { createCreativeReference, CREATIVE_REFERENCE_TYPES } from "@/lib/marketing-os/creative-references";

async function context(organizationSlug: string, path: string) {
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, path);
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
  return { db, user, organization };
}

const uuidSchema = z.string().uuid();

function parseStudioPackage(formData: FormData) {
  const contentKind = contentStudioContentKindSchema.safeParse(formData.get("contentKind"));
  if (!contentKind.success) return contentStudioPackageSchema.safeParse({ contentKind: formData.get("contentKind") });
  const common = {
    contentKind: contentKind.data,
    title: formData.get("title"),
    hooks: String(formData.get("hooks") ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
    selectedHook: formData.get("selectedHook"),
    caption: formData.get("caption"),
    coverText: formData.get("coverText"),
    assetInstructions: String(formData.get("assetInstructions") ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
    callToAction: formData.get("callToAction"),
  };
  if (contentKind.data !== "short_video") {
    const positions = formData.getAll("panelPosition").map(String);
    const purposes = formData.getAll("panelPurpose").map(String);
    const visuals = formData.getAll("panelVisual").map(String);
    const overlayText = formData.getAll("panelOverlayText").map(String);
    return contentStudioPackageSchema.safeParse({
      ...common,
      postCopy: formData.get("postCopy"),
      panels: positions.map((position, index) => ({ position, purpose: purposes[index] ?? "", visual: visuals[index] ?? "", overlayText: overlayText[index] ?? "" })),
      renderingStatus: "not_requested",
      renderedAssets: [],
      renderingError: null,
    });
  }
  const timings = formData.getAll("shotTiming").map(String);
  const visuals = formData.getAll("shotVisual").map(String);
  const texts = formData.getAll("shotText").map(String);
  const audio = formData.getAll("shotAudio").map(String);
  return contentStudioPackageSchema.safeParse({
    ...common,
    script: formData.get("script"),
    shots: timings.map((timing, index) => ({ timing, visual: visuals[index] ?? "", onScreenText: texts[index] ?? "", audio: audio[index] ?? "" })),
    renderingStatus: "not_requested",
    renderedAssets: [],
    renderingError: null,
  });
}

export async function setupContentStudioAction(organizationSlug: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content-studio`);
  try {
    await ensureDefaultBrandProfiles(db, { organizationId: organization.id, actorUserId: user.userId });
    await seedMarketingAgents(db, { organizationId: organization.id, humanOwnerUserId: user.userId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/content-studio`);
  return { ok: true };
}

export async function setupMarketingCommandCenterAction(organizationSlug: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/command-center`);
  try {
    await ensureDefaultBrandProfiles(db, { organizationId: organization.id, actorUserId: user.userId });
    await ensureDefaultChannelAccounts(db, { organizationId: organization.id, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/command-center`);
  return { ok: true };
}

const nonnegativeInt = z.coerce.number().int().min(0).max(2_000_000_000).default(0);
const moneyAmount = z.coerce.number().min(0).max(1_000_000_000).default(0);
const performanceSnapshotSchema = z.object({
  contentItemId: uuidSchema,
  channelAccountId: uuidSchema,
  capturedAt: z.string().trim().optional(),
  impressions: nonnegativeInt,
  reach: nonnegativeInt,
  views: nonnegativeInt,
  likes: nonnegativeInt,
  comments: nonnegativeInt,
  shares: nonnegativeInt,
  saves: nonnegativeInt,
  clicks: nonnegativeInt,
  leads: nonnegativeInt,
  conversions: nonnegativeInt,
  spendAmount: moneyAmount,
  revenueAmount: moneyAmount,
  notes: z.string().trim().max(1000).optional(),
});

export async function recordMarketingPerformanceAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/command-center`);
  const parsed = performanceSnapshotSchema.safeParse({
    contentItemId: formData.get("contentItemId"), channelAccountId: formData.get("channelAccountId"), capturedAt: formData.get("capturedAt") || undefined,
    impressions: formData.get("impressions") || 0, reach: formData.get("reach") || 0, views: formData.get("views") || 0,
    likes: formData.get("likes") || 0, comments: formData.get("comments") || 0, shares: formData.get("shares") || 0, saves: formData.get("saves") || 0,
    clicks: formData.get("clicks") || 0, leads: formData.get("leads") || 0, conversions: formData.get("conversions") || 0,
    spendAmount: formData.get("spendAmount") || 0, revenueAmount: formData.get("revenueAmount") || 0, notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await recordPerformanceSnapshot(db, {
      ...parsed.data,
      organizationId: organization.id,
      actorUserId: user.userId,
      capturedAt: parsed.data.capturedAt ? new Date(parsed.data.capturedAt) : undefined,
      spendAmount: parsed.data.spendAmount.toFixed(2),
      revenueAmount: parsed.data.revenueAmount.toFixed(2),
    });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/command-center`);
  return { ok: true };
}

const generateStudioSchema = z.object({
  brandProfileId: uuidSchema,
  goal: z.string().trim().min(5).max(2000),
  intendedChannel: z.string().trim().min(1).max(100),
  plannedPublishAt: z.string().trim().optional(),
  creativeReferenceIds: z.array(uuidSchema).max(5).default([]),
});

const creativeReferenceSchema = z.object({
  brandProfileId: uuidSchema,
  title: z.string().trim().min(3).max(160),
  referenceType: z.enum(CREATIVE_REFERENCE_TYPES),
  sourceUrl: z.string().trim().url().max(2048).refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Use an http(s) reference URL"),
  transcript: z.string().trim().max(12_000).optional(),
  creativeNotes: z.string().trim().min(5).max(4_000),
  adaptationRules: z.string().trim().max(4_000).optional(),
});

export async function createCreativeReferenceAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content-studio`);
  const parsed = creativeReferenceSchema.safeParse({
    brandProfileId: formData.get("brandProfileId"),
    title: formData.get("title"),
    referenceType: formData.get("referenceType"),
    sourceUrl: formData.get("sourceUrl"),
    transcript: formData.get("transcript") || undefined,
    creativeNotes: formData.get("creativeNotes"),
    adaptationRules: formData.get("adaptationRules") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createCreativeReference(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/content-studio`);
  return { ok: true };
}

export async function generateContentStudioConceptsAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content-studio`);
  const parsed = generateStudioSchema.safeParse({ brandProfileId: formData.get("brandProfileId"), goal: formData.get("goal"), intendedChannel: formData.get("intendedChannel"), plannedPublishAt: formData.get("plannedPublishAt") || undefined, creativeReferenceIds: formData.getAll("creativeReferenceIds").map(String) });
  if (!parsed.success) return toActionResult(parsed.error);
  let studioId: string;
  try {
    const studio = await generateContentConcepts(db, { organizationId: organization.id, brandProfileId: parsed.data.brandProfileId, goal: parsed.data.goal, intendedChannel: parsed.data.intendedChannel, plannedPublishAt: parsed.data.plannedPublishAt ? new Date(parsed.data.plannedPublishAt) : null, creativeReferenceIds: parsed.data.creativeReferenceIds, actorUserId: user.userId });
    studioId = studio.id;
  } catch (err) {
    return toActionResult(err);
  }
  redirect(`/app/${organizationSlug}/marketing/content-studio/${studioId}`);
}

export async function generateContentStudioPackageAction(organizationSlug: string, studioId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content-studio/${studioId}`);
  const parsed = z.object({ conceptId: z.string().trim().min(1).max(40), expectedRevision: z.coerce.number().int().min(1) }).safeParse({ conceptId: formData.get("conceptId"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await generateProductionPackage(db, { organizationId: organization.id, studioId, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/content-studio/${studioId}`);
  return { ok: true };
}

export async function updateContentStudioPackageAction(organizationSlug: string, studioId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content-studio/${studioId}`);
  const expectedRevision = z.coerce.number().int().min(1).safeParse(formData.get("expectedRevision"));
  const productionPackage = parseStudioPackage(formData);
  if (!expectedRevision.success) return toActionResult(expectedRevision.error);
  if (!productionPackage.success) return toActionResult(productionPackage.error);
  try {
    await updateProductionPackage(db, { organizationId: organization.id, studioId, productionPackage: productionPackage.data, expectedRevision: expectedRevision.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/content-studio/${studioId}`);
  return { ok: true };
}

export async function saveContentStudioToPipelineAction(organizationSlug: string, studioId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content-studio/${studioId}`);
  const parsed = z.object({ campaignId: uuidSchema.optional(), expectedRevision: z.coerce.number().int().min(1), decision: z.enum(["render", "review", "approve"]) }).safeParse({ campaignId: formData.get("campaignId") || undefined, expectedRevision: formData.get("expectedRevision"), decision: formData.get("decision") });
  const productionPackage = parseStudioPackage(formData);
  if (!parsed.success) return toActionResult(parsed.error);
  if (!productionPackage.success) return toActionResult(productionPackage.error);
  let contentItemId: string;
  try {
    const updatedStudio = await updateProductionPackage(db, { organizationId: organization.id, studioId, productionPackage: productionPackage.data, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
    if (parsed.data.decision === "render") {
      await renderContentStudioMedia(db, { organizationId: organization.id, studioId: updatedStudio.id, expectedRevision: updatedStudio.revision, actorUserId: user.userId });
      revalidatePath(`/app/${organizationSlug}/marketing/content-studio/${studioId}`);
      return { ok: true };
    }
    if (!parsed.data.campaignId) return toActionResult(new Error("Choose a campaign before saving to the pipeline"));
    const saved = await saveStudioToPipeline(db, { organizationId: organization.id, studioId: updatedStudio.id, campaignId: parsed.data.campaignId, actorUserId: user.userId });
    contentItemId = saved.contentItemId;
    const content = await import("@/lib/marketing-os/content").then((module) => module.resolveContentItemById(db, organization.id, contentItemId));
    const reviewed = await submitContentForReview(db, { organizationId: organization.id, contentItemId, toStatus: "review", expectedRevision: content.revision, actorUserId: user.userId });
    const { approval } = await requestContentReviewApproval(db, { organizationId: organization.id, contentItemId, summary: `Review the Content Studio package for ${productionPackage.data.title}. No publishing action is included.`, actorUserId: user.userId });
    if (parsed.data.decision === "approve") {
      await approveRequest(db, { organizationId: organization.id, approvalId: approval.id, actorUserId: user.userId });
      const approved = await applyContentApprovalDecision(db, { organizationId: organization.id, contentItemId, approvalRequestId: approval.id, decision: "approved", expectedRevision: reviewed.revision, actorUserId: user.userId });
      if (saved.studio.plannedPublishAt) await scheduleContent(db, { organizationId: organization.id, contentItemId, toStatus: "scheduled", expectedRevision: approved.revision, actorUserId: user.userId });
    }
  } catch (err) {
    return toActionResult(err);
  }
  redirect(`/app/${organizationSlug}/marketing/content/${contentItemId}`);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const configSchema = z.object({
  expectedRevision: z.coerce.number().int().min(1).optional(),
  businessTimezone: z.string().trim().min(1).max(100).optional(),
  defaultCurrency: z.string().trim().length(3).toUpperCase().optional(),
  staleCampaignThresholdDays: z.coerce.number().int().min(1).max(365).optional(),
  attributionWindowDays: z.coerce.number().int().min(1).max(365).optional(),
});

export async function upsertMarketingConfigurationAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/settings`);
  const parsed = configSchema.safeParse({
    expectedRevision: formData.get("expectedRevision") || undefined,
    businessTimezone: formData.get("businessTimezone") || undefined,
    defaultCurrency: formData.get("defaultCurrency") || undefined,
    staleCampaignThresholdDays: formData.get("staleCampaignThresholdDays") || undefined,
    attributionWindowDays: formData.get("attributionWindowDays") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await upsertMarketingConfiguration(db, { organizationId: organization.id, workspaceId: null, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/settings`);
  return { ok: true };
}

/** Seeds the three Marketing agents + three starter workflow templates. Org owner/admin only (enforced inside the seed functions themselves via org-admin bootstrap authority). */
export async function seedMarketingAgentsAndTemplatesAction(organizationSlug: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/settings`);
  try {
    await seedMarketingAgents(db, { organizationId: organization.id, humanOwnerUserId: user.userId, actorUserId: user.userId });
    await seedMarketingWorkflowTemplates(db, { organizationId: organization.id, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/settings`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

const createTeamSchema = z.object({ name: marketingNameSchema, teamKey: marketingKeySchema });

export async function createMarketingTeamAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/teams`);
  const parsed = createTeamSchema.safeParse({ name: formData.get("name"), teamKey: formData.get("teamKey") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createMarketingTeam(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/teams`);
  return { ok: true };
}

const addMemberSchema = z.object({ userId: uuidSchema, teamRole: marketingTeamMemberRoleSchema.optional() });

export async function addMarketingTeamMemberAction(organizationSlug: string, teamId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/teams`);
  const parsed = addMemberSchema.safeParse({ userId: formData.get("userId"), teamRole: formData.get("teamRole") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await addMarketingTeamMember(db, { organizationId: organization.id, teamId, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/teams`);
  return { ok: true };
}

const grantRoleSchema = z.object({ userId: uuidSchema, role: marketingRoleSchema });

export async function grantMarketingRoleAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/teams`);
  const parsed = grantRoleSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await grantMarketingRole(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/teams`);
  return { ok: true };
}

export async function revokeMarketingRoleAction(organizationSlug: string, roleAssignmentId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/teams`);
  const expectedRevision = z.coerce.number().int().min(1).safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return toActionResult(expectedRevision.error);

  try {
    await revokeMarketingRole(db, { organizationId: organization.id, roleAssignmentId, expectedRevision: expectedRevision.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/teams`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

const createCampaignSchema = z.object({
  campaignKey: marketingKeySchema,
  name: marketingNameSchema,
  objectiveType: marketingObjectiveTypeSchema.optional(),
  budgetAmount: z.coerce.number().nonnegative().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  primaryAudienceId: uuidSchema.optional(),
  sourceId: uuidSchema.optional(),
});

export async function createCampaignAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/campaigns`);
  const parsed = createCampaignSchema.safeParse({
    campaignKey: formData.get("campaignKey"),
    name: formData.get("name"),
    objectiveType: formData.get("objectiveType") || undefined,
    budgetAmount: formData.get("budgetAmount") || undefined,
    currency: formData.get("currency") || undefined,
    primaryAudienceId: formData.get("primaryAudienceId") || undefined,
    sourceId: formData.get("sourceId") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createCampaign(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/campaigns`);
  return { ok: true };
}

const updateCampaignSchema = z.object({ expectedRevision: z.coerce.number().int().min(1), name: marketingNameSchema.optional(), primaryAudienceId: uuidSchema.optional() });

export async function updateCampaignAction(organizationSlug: string, campaignId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  const parsed = updateCampaignSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), name: formData.get("name") || undefined, primaryAudienceId: formData.get("primaryAudienceId") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await updateCampaign(db, { organizationId: organization.id, campaignId, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  return { ok: true };
}

const transitionCampaignSchema = z.object({ toStatus: marketingCampaignStatusSchema, expectedRevision: z.coerce.number().int().min(1) });

export async function transitionCampaignStatusAction(organizationSlug: string, campaignId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  const parsed = transitionCampaignSchema.safeParse({ toStatus: formData.get("toStatus"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await transitionCampaignStatus(db, { organizationId: organization.id, campaignId, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  return { ok: true };
}

export async function launchCampaignBriefAction(organizationSlug: string, campaignId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  try {
    await createCampaignBriefTask(db, { organizationId: organization.id, campaignId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  return { ok: true };
}

export async function launchCampaignSummaryAction(organizationSlug: string, campaignId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  try {
    await createCampaignSummaryTask(db, { organizationId: organization.id, campaignId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Campaign runs (playbook execution)
// ---------------------------------------------------------------------------

export async function startCampaignRunAction(organizationSlug: string, campaignId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  const parsed = z.object({ playbookVersionId: uuidSchema }).safeParse({ playbookVersionId: formData.get("playbookVersionId") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await startCampaignRun(db, { organizationId: organization.id, campaignId, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  return { ok: true };
}

export async function completeCampaignRunItemAction(organizationSlug: string, campaignId: string, itemId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  const parsed = z.object({ status: z.enum(["complete", "skipped"]) }).safeParse({ status: formData.get("status") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await completeCampaignRunItem(db, { organizationId: organization.id, itemId, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  return { ok: true };
}

export async function completeCampaignRunAction(organizationSlug: string, campaignId: string, runId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  const expectedRevision = z.coerce.number().int().min(1).safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return toActionResult(expectedRevision.error);

  try {
    await completeCampaignRun(db, { organizationId: organization.id, runId, expectedRevision: expectedRevision.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------

const createAudienceSchema = z.object({ name: marketingNameSchema, audienceKey: marketingKeySchema, entityType: marketingAudienceEntityTypeSchema });

export async function createAudienceAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/audiences`);
  const parsed = createAudienceSchema.safeParse({ name: formData.get("name"), audienceKey: formData.get("audienceKey"), entityType: formData.get("entityType") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createAudience(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/audiences`);
  return { ok: true };
}

export async function snapshotAudienceAction(organizationSlug: string, audienceId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/audiences`);
  const expectedRevision = z.coerce.number().int().min(1).safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return toActionResult(expectedRevision.error);

  try {
    await snapshotAudience(db, { organizationId: organization.id, audienceId, expectedRevision: expectedRevision.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/audiences`);
  return { ok: true };
}

export async function updateAudienceFilterAction(organizationSlug: string, audienceId: string, expectedRevision: number, filterDefinition: unknown): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/audiences`);
  try {
    await updateAudience(db, { organizationId: organization.id, audienceId, expectedRevision, actorUserId: user.userId, filterDefinition: filterDefinition as never });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/audiences`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const createContentSchema = z.object({ campaignId: uuidSchema, title: marketingTitleSchema, contentType: marketingContentTypeSchema, intendedChannel: z.string().trim().max(100).optional() });

export async function createContentItemAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content`);
  const parsed = createContentSchema.safeParse({ campaignId: formData.get("campaignId"), title: formData.get("title"), contentType: formData.get("contentType"), intendedChannel: formData.get("intendedChannel") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createContentItem(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/content`);
  return { ok: true };
}

export async function launchContentDraftAction(organizationSlug: string, contentId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content/${contentId}`);
  try {
    await createContentDraftTask(db, { organizationId: organization.id, contentItemId: contentId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/content/${contentId}`);
  return { ok: true };
}

export async function submitContentForReviewAction(organizationSlug: string, contentId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content/${contentId}`);
  const parsed = z.object({ expectedRevision: z.coerce.number().int().min(1), summary: z.string().trim().min(1).max(2000) }).safeParse({ expectedRevision: formData.get("expectedRevision"), summary: formData.get("summary") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await submitContentForReview(db, { organizationId: organization.id, contentItemId: contentId, toStatus: "review", expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
    await requestContentReviewApproval(db, { organizationId: organization.id, contentItemId: contentId, summary: parsed.data.summary, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/content/${contentId}`);
  return { ok: true };
}

export async function decideContentApprovalAction(organizationSlug: string, contentId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content/${contentId}`);
  const parsed = z
    .object({ approvalRequestId: uuidSchema, decision: z.enum(["approved", "rejected"]), expectedRevision: z.coerce.number().int().min(1) })
    .safeParse({ approvalRequestId: formData.get("approvalRequestId"), decision: formData.get("decision"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    if (parsed.data.decision === "approved") {
      await approveRequest(db, { organizationId: organization.id, approvalId: parsed.data.approvalRequestId, actorUserId: user.userId });
    } else {
      await rejectRequest(db, { organizationId: organization.id, approvalId: parsed.data.approvalRequestId, actorUserId: user.userId });
    }
    await applyContentApprovalDecision(db, { organizationId: organization.id, contentItemId: contentId, approvalRequestId: parsed.data.approvalRequestId, decision: parsed.data.decision, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/content/${contentId}`);
  return { ok: true };
}

const scheduleContentSchema = z.object({ expectedRevision: z.coerce.number().int().min(1), plannedPublishAt: z.coerce.date().optional() });

export async function scheduleContentAction(organizationSlug: string, contentId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content/${contentId}`);
  const parsed = scheduleContentSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), plannedPublishAt: formData.get("plannedPublishAt") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await scheduleContent(db, { organizationId: organization.id, contentItemId: contentId, toStatus: "scheduled", expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/content/${contentId}`);
  return { ok: true };
}

export async function confirmContentPublishedAction(organizationSlug: string, contentId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content/${contentId}`);
  const expectedRevision = z.coerce.number().int().min(1).safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return toActionResult(expectedRevision.error);

  try {
    await confirmContentPublished(db, { organizationId: organization.id, contentItemId: contentId, toStatus: "published", expectedRevision: expectedRevision.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/content/${contentId}`);
  return { ok: true };
}

export async function archiveContentItemAction(organizationSlug: string, contentId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/content/${contentId}`);
  const expectedRevision = z.coerce.number().int().min(1).safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return toActionResult(expectedRevision.error);

  try {
    await archiveContentItem(db, { organizationId: organization.id, contentItemId: contentId, toStatus: "archived", expectedRevision: expectedRevision.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/content/${contentId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Playbooks
// ---------------------------------------------------------------------------

const createPlaybookSchema = z.object({ name: marketingNameSchema, playbookKey: marketingKeySchema, playbookType: marketingPlaybookTypeSchema });

export async function createMarketingPlaybookAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/playbooks`);
  const parsed = createPlaybookSchema.safeParse({ name: formData.get("name"), playbookKey: formData.get("playbookKey"), playbookType: formData.get("playbookType") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createPlaybook(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/playbooks`);
  return { ok: true };
}

const addStepSchema = z.object({ stepKey: z.string().trim().min(1).max(60), stepType: marketingPlaybookStepTypeSchema, name: z.string().trim().min(1).max(200), sequence: z.coerce.number().int().min(0), required: z.coerce.boolean().optional() });

export async function addMarketingPlaybookStepAction(organizationSlug: string, playbookId: string, playbookVersionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/playbooks/${playbookId}`);
  const parsed = addStepSchema.safeParse({ stepKey: formData.get("stepKey"), stepType: formData.get("stepType"), name: formData.get("name"), sequence: formData.get("sequence"), required: formData.get("required") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await addPlaybookStep(db, { organizationId: organization.id, playbookVersionId, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/playbooks/${playbookId}`);
  return { ok: true };
}

export async function publishMarketingPlaybookVersionAction(organizationSlug: string, playbookId: string, versionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/playbooks/${playbookId}`);
  const expectedRevision = z.coerce.number().int().min(1).safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return toActionResult(expectedRevision.error);

  try {
    await publishPlaybookVersion(db, { organizationId: organization.id, playbookId, versionId, expectedRevision: expectedRevision.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/playbooks/${playbookId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Destinations & budget
// ---------------------------------------------------------------------------

const createDestinationSchema = z.object({
  label: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(2000),
  destinationType: marketingDestinationTypeSchema.optional(),
  utmSource: z.string().trim().min(1).max(100),
  utmMedium: z.string().trim().min(1).max(100),
  utmCampaign: z.string().trim().min(1).max(100),
});

export async function createDestinationAction(organizationSlug: string, campaignId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  const parsed = createDestinationSchema.safeParse({
    label: formData.get("label"),
    url: formData.get("url"),
    destinationType: formData.get("destinationType") || undefined,
    utmSource: formData.get("utmSource"),
    utmMedium: formData.get("utmMedium"),
    utmCampaign: formData.get("utmCampaign"),
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createDestination(db, { organizationId: organization.id, campaignId, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  return { ok: true };
}

const createBudgetEntrySchema = z.object({ category: z.string().trim().min(1).max(100).optional(), plannedAmount: z.coerce.number().nonnegative().optional(), spendAmount: z.coerce.number().nonnegative().optional(), currency: z.string().trim().length(3).toUpperCase() });

export async function createBudgetEntryAction(organizationSlug: string, campaignId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  const parsed = createBudgetEntrySchema.safeParse({
    category: formData.get("category") || undefined,
    plannedAmount: formData.get("plannedAmount") || undefined,
    spendAmount: formData.get("spendAmount") || undefined,
    currency: formData.get("currency"),
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createBudgetEntry(db, { organizationId: organization.id, campaignId, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/marketing/campaigns/${campaignId}`);
  return { ok: true };
}
