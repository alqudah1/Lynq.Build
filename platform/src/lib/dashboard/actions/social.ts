"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import {
  archiveContentItem,
  archiveVariant,
  createContentItem,
  decideVariantApproval,
  getVariantForUser,
  publishVariantNow,
  returnVariantToDraft,
  scheduleVariant,
  submitVariantForReview,
  unscheduleVariant,
  updateContentItem,
  updateVariant,
} from "@/lib/social-os/content";
import { rescheduleVariant } from "@/lib/social-os/calendar";
import { cancelPublishJob, retryPublishJob } from "@/lib/social-os/publishing";
import { generateVariantsForItem, planWeek, regenerateVariantPart, zonedDateTimeToUtc } from "@/lib/social-os/studio";
import { createManagerThread } from "@/lib/social-os/manager";
import { assignItem, draftReply, escalateItem, flagLead, hideItem, ignoreItem, linkToCrm, markNeedsReply, requestEngagementSync, sendReply } from "@/lib/social-os/engagement";
import { requestMetricsSync } from "@/lib/social-os/analytics-sync";
import { cancelAdChange, decideAdChange, generateAdRecommendations, proposeAdChange, submitAdChangeForApproval } from "@/lib/social-os/advertising";
import { archiveBrand, createBrand, getBrandForUser, parseBrandChanges, updateBrand } from "@/lib/social-os/brands";
import { archiveAccount, createManualAccount, disconnectConnection, updateAccount, verifyAccount } from "@/lib/social-os/connections";
import { archiveAutomationRule, runAutomationRuleNow, setAutomationRuleEnabled, upsertAutomationRule } from "@/lib/social-os/automation";
import { describeAiProviders, loadSocialAiEnv } from "@/lib/social-os/providers/ai/registry";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import {
  SOCIAL_AUTOMATION_KINDS,
  SOCIAL_CONTENT_KINDS,
  SOCIAL_CONTENT_OBJECTIVES,
  SOCIAL_ORGANIC_PLATFORMS,
  SOCIAL_PLATFORMS,
  brandProfileInputSchema,
  socialContentBriefSchema,
  socialRegeneratePartSchema,
  type SocialVariantMedia,
  type SocialVariantUpdate,
} from "@/lib/social-os/validation";
import { toActionResult } from "./errors";
import { SocialProviderError } from "@/lib/social-os/errors";
import type { ActionResult } from "./types";

/**
 * Module 19 — Social Command Center dashboard mutations. Each action
 * re-runs the session gate and resolves the organization from the slug,
 * parses FormData with zod (`safeParse` → field errors), and calls exactly
 * one domain service (which owns all authorization, tenancy and revision
 * checks). Times typed into `datetime-local` inputs are wall-clock times
 * in the organization's business timezone and are converted to UTC here.
 */

async function context(organizationSlug: string, path: string) {
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, path);
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
  return { db, user, organization };
}

function socialPath(organizationSlug: string) {
  return `/app/${organizationSlug}/social`;
}

function revalidateSocial(organizationSlug: string) {
  revalidatePath(socialPath(organizationSlug), "layout");
}

const uuidSchema = z.string().uuid();
const revisionSchema = z.coerce.number().int().min(1);

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function optionalText(formData: FormData, name: string): string | undefined {
  const v = text(formData, name).trim();
  return v ? v : undefined;
}

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

/** `YYYY-MM-DDTHH:mm` in `timeZone` (or a full ISO instant) → Date; empty → null; garbage → undefined (invalid). */
function parseLocalDateTime(raw: string | undefined, timeZone: string): Date | null | undefined {
  const value = raw?.trim();
  if (!value) return null;
  const m = LOCAL_DATETIME.exec(value);
  if (m) return zonedDateTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), timeZone);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function invalid(field: string, message: string): ActionResult {
  return { ok: false, code: "invalid_request", message: "Please fix the errors below.", fieldErrors: { [field]: [message] } };
}

function parseHashtags(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`)))];
}

async function textProviderConfigured(): Promise<boolean> {
  const providers = describeAiProviders(await loadSocialAiEnv());
  return providers.some((p) => p.kind === "text" && p.configured);
}

// ---------------------------------------------------------------------------
// Content Studio: create + generate
// ---------------------------------------------------------------------------

const createSchema = z.object({
  brandProfileId: uuidSchema,
  campaignId: uuidSchema.optional(),
  title: z.string().trim().min(1, "Give the post a working title").max(200),
  platforms: z.array(z.enum(SOCIAL_ORGANIC_PLATFORMS)).min(1, "Choose at least one platform"),
  kind: z.enum(SOCIAL_CONTENT_KINDS),
  objective: z.enum(SOCIAL_CONTENT_OBJECTIVES),
  topic: z.string().trim().max(2000).default(""),
  audience: z.string().trim().max(1000).default(""),
  tone: z.string().trim().max(200).default(""),
  callToAction: z.string().trim().max(300).default(""),
  creativeDirection: z.string().trim().max(3000).default(""),
  hook: z.string().trim().max(400).default(""),
  generate: z.boolean(),
});

export async function createSocialContentAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const path = `${socialPath(organizationSlug)}/create`;
  const { db, user, organization } = await context(organizationSlug, path);
  const parsed = createSchema.safeParse({
    brandProfileId: formData.get("brandProfileId"),
    campaignId: optionalText(formData, "campaignId"),
    title: text(formData, "title").trim() || text(formData, "topic").trim().slice(0, 120),
    platforms: formData.getAll("platforms").map(String),
    kind: formData.get("kind"),
    objective: formData.get("objective"),
    topic: text(formData, "topic"),
    audience: text(formData, "audience"),
    tone: text(formData, "tone"),
    callToAction: text(formData, "callToAction"),
    creativeDirection: text(formData, "creativeDirection"),
    hook: text(formData, "hook"),
    generate: formData.get("generate") === "on" || formData.get("generate") === "true",
  });
  if (!parsed.success) return toActionResult(parsed.error);
  const tz = await getSocialTimezone(db, organization.id);
  const scheduledFor = parseLocalDateTime(optionalText(formData, "scheduledFor"), tz);
  if (scheduledFor === undefined) return invalid("scheduledFor", "Enter a valid date and time");

  let contentItemId: string;
  let notice: string;
  try {
    const { brandProfileId, campaignId, title, platforms, generate, ...brief } = parsed.data;
    const item = await createContentItem(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId, campaignId: campaignId ?? null, title, platforms, scheduledFor, brief: socialContentBriefSchema.parse(brief) });
    contentItemId = item.id;
    notice = "drafts_created";
    if (generate) {
      if (!(await textProviderConfigured())) {
        notice = "ai_not_configured";
      } else {
        try {
          const result = await generateVariantsForItem(db, { organizationId: organization.id, contentItemId: item.id, actorUserId: user.userId });
          notice = result.skippedPlatforms.length ? "generated_partial" : "generated";
        } catch (err) {
          console.error("[social] generation after create failed:", err instanceof Error ? err.name : "error");
          notice = "generation_failed";
        }
      }
    }
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  redirect(`${socialPath(organizationSlug)}/library/${contentItemId}?notice=${notice}`);
}

export async function generateVariantsAction(organizationSlug: string, contentItemId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/library/${contentItemId}`);
  const instruction = z.string().trim().max(1000).optional().safeParse(optionalText(formData, "instruction"));
  if (!instruction.success) return toActionResult(instruction.error);
  let message: string;
  try {
    const result = await generateVariantsForItem(db, { organizationId: organization.id, contentItemId, actorUserId: user.userId, instruction: instruction.data });
    message = result.skippedPlatforms.length ? `Generated ${result.variants.length} post(s). Skipped: ${result.skippedPlatforms.join(", ")}.` : `Generated ${result.variants.length} post(s).`;
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message };
}

// ---------------------------------------------------------------------------
// Brief + variant edits
// ---------------------------------------------------------------------------

const briefSchema = z.object({
  expectedRevision: revisionSchema,
  title: z.string().trim().min(1).max(200),
  kind: z.enum(SOCIAL_CONTENT_KINDS),
  objective: z.enum(SOCIAL_CONTENT_OBJECTIVES),
  topic: z.string().trim().max(2000),
  audience: z.string().trim().max(1000),
  tone: z.string().trim().max(200),
  callToAction: z.string().trim().max(300),
  creativeDirection: z.string().trim().max(3000),
  hook: z.string().trim().max(400),
});

export async function updateSocialBriefAction(organizationSlug: string, contentItemId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/library/${contentItemId}`);
  const parsed = briefSchema.safeParse({
    expectedRevision: formData.get("expectedRevision"),
    title: text(formData, "title"),
    kind: formData.get("kind"),
    objective: formData.get("objective"),
    topic: text(formData, "topic"),
    audience: text(formData, "audience"),
    tone: text(formData, "tone"),
    callToAction: text(formData, "callToAction"),
    creativeDirection: text(formData, "creativeDirection"),
    hook: text(formData, "hook"),
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    const { expectedRevision, title, ...brief } = parsed.data;
    await updateContentItem(db, { organizationId: organization.id, contentItemId, actorUserId: user.userId, expectedRevision, changes: { title, brief } });
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message: "Brief saved." };
}

export async function updateSocialVariantAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/library`);
  const expectedRevision = revisionSchema.safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return toActionResult(expectedRevision.error);
  const tz = await getSocialTimezone(db, organization.id);
  const scheduledFor = parseLocalDateTime(optionalText(formData, "scheduledFor"), tz);
  if (scheduledFor === undefined) return invalid("scheduledFor", "Enter a valid date and time");
  const linkUrl = optionalText(formData, "linkUrl");
  if (linkUrl && !z.string().url().safeParse(linkUrl).success) return invalid("linkUrl", "Enter a full URL starting with https://");
  const firstComment = text(formData, "firstComment").trim();
  const accountRaw = text(formData, "channelAccountId").trim();
  if (accountRaw && !uuidSchema.safeParse(accountRaw).success) return invalid("channelAccountId", "Choose an account");

  try {
    const current = await getVariantForUser(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId });
    const platformOptions = { ...current.platformOptions };
    if (firstComment) platformOptions.firstComment = firstComment;
    else delete platformOptions.firstComment;
    const changes: SocialVariantUpdate = {
      hook: text(formData, "hook"),
      body: text(formData, "body"),
      hashtags: parseHashtags(text(formData, "hashtags")),
      callToAction: text(formData, "callToAction"),
      linkUrl: linkUrl ?? null,
      platformOptions,
      scheduledFor,
      channelAccountId: accountRaw || null,
    };
    await updateVariant(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId, expectedRevision: expectedRevision.data, changes });
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message: "Post saved." };
}

export async function regenerateVariantPartAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/library`);
  const parsed = z.object({ part: socialRegeneratePartSchema, instruction: z.string().trim().max(1000).optional() }).safeParse({ part: formData.get("part"), instruction: optionalText(formData, "instruction") });
  if (!parsed.success) return toActionResult(parsed.error);
  let message: string;
  try {
    const result = await regenerateVariantPart(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId, part: parsed.data.part, instruction: parsed.data.instruction });
    message = result.pending ? "Rendering started. This can take a few minutes — refresh to see progress." : "Regenerated.";
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message };
}

const attachSchema = z.object({ expectedRevision: revisionSchema, assetId: uuidSchema, role: z.enum(["primary", "carousel_item", "cover", "thumbnail"]).default("primary") });

export async function attachAssetToVariantAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/library`);
  const parsed = attachSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), assetId: formData.get("assetId"), role: optionalText(formData, "role") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    const current = await getVariantForUser(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId });
    if (current.media.some((m) => m.assetId === parsed.data.assetId)) return { ok: true, message: "That asset is already attached." };
    const media: SocialVariantMedia = [...current.media, { assetId: parsed.data.assetId, position: current.media.length, role: current.media.length === 0 ? "primary" : parsed.data.role === "primary" ? "carousel_item" : parsed.data.role }];
    await updateVariant(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId, expectedRevision: parsed.data.expectedRevision, changes: { media } });
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message: "Asset attached." };
}

export async function detachAssetFromVariantAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/library`);
  const parsed = z.object({ expectedRevision: revisionSchema, assetId: uuidSchema }).safeParse({ expectedRevision: formData.get("expectedRevision"), assetId: formData.get("assetId") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    const current = await getVariantForUser(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId });
    const media: SocialVariantMedia = current.media
      .filter((m) => m.assetId !== parsed.data.assetId)
      .map((m, index) => ({ ...m, position: index, role: index === 0 && m.role === "carousel_item" ? "primary" : m.role }));
    await updateVariant(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId, expectedRevision: parsed.data.expectedRevision, changes: { media } });
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message: "Asset removed from this post." };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function lifecycle(
  organizationSlug: string,
  formData: FormData,
  run: (ctx: Awaited<ReturnType<typeof context>>, expectedRevision: number) => Promise<unknown>,
  message: string
): Promise<ActionResult> {
  const ctx = await context(organizationSlug, socialPath(organizationSlug));
  const expectedRevision = revisionSchema.safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return toActionResult(expectedRevision.error);
  try {
    await run(ctx, expectedRevision.data);
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message };
}

export async function submitVariantForReviewAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  return lifecycle(organizationSlug, formData, ({ db, user, organization }, expectedRevision) => submitVariantForReview(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId, expectedRevision, summary: optionalText(formData, "summary") }), "Sent for review.");
}

export async function returnVariantToDraftAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  return lifecycle(organizationSlug, formData, ({ db, user, organization }, expectedRevision) => returnVariantToDraft(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId, expectedRevision }), "Returned to draft.");
}

export async function unscheduleVariantAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  return lifecycle(organizationSlug, formData, ({ db, user, organization }, expectedRevision) => unscheduleVariant(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId, expectedRevision }), "Unscheduled. The post stays approved.");
}

export async function publishVariantNowAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  return lifecycle(organizationSlug, formData, ({ db, user, organization }, expectedRevision) => publishVariantNow(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId, expectedRevision }), "Queued to publish now. Check Publishing for the result.");
}

export async function archiveVariantAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  return lifecycle(organizationSlug, formData, ({ db, user, organization }, expectedRevision) => archiveVariant(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId, expectedRevision }), "Post archived.");
}

export async function scheduleVariantAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, socialPath(organizationSlug));
  const expectedRevision = revisionSchema.safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return toActionResult(expectedRevision.error);
  const tz = await getSocialTimezone(db, organization.id);
  const scheduledFor = parseLocalDateTime(optionalText(formData, "scheduledFor"), tz);
  if (!scheduledFor) return invalid("scheduledFor", "Choose when to publish");
  try {
    await scheduleVariant(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId, expectedRevision: expectedRevision.data, scheduledFor });
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message: "Scheduled." };
}

const decisionSchema = z.object({
  expectedRevision: revisionSchema,
  decision: z.enum(["approve", "request_changes", "reject"]),
  note: z.string().trim().max(2000).optional(),
  publishNow: z.boolean(),
});

export async function decideVariantApprovalAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/approvals`);
  const parsed = decisionSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), decision: formData.get("decision"), note: optionalText(formData, "note"), publishNow: formData.get("publishNow") === "1" });
  if (!parsed.success) return toActionResult(parsed.error);
  if (parsed.data.decision === "request_changes" && !parsed.data.note) return invalid("note", "Say what should change");
  const tz = await getSocialTimezone(db, organization.id);
  const scheduledFor = parseLocalDateTime(optionalText(formData, "scheduledFor"), tz);
  if (scheduledFor === undefined) return invalid("scheduledFor", "Enter a valid date and time");
  let message: string;
  try {
    const variant = await decideVariantApproval(db, {
      organizationId: organization.id,
      contentVariantId,
      actorUserId: user.userId,
      expectedRevision: parsed.data.expectedRevision,
      decision: parsed.data.decision,
      note: parsed.data.note,
      publishNow: parsed.data.publishNow,
      // An empty field means "keep the post's own planned time" (service default); a value is an explicit schedule.
      scheduledFor: scheduledFor ?? undefined,
    });
    message =
      parsed.data.decision === "approve"
        ? parsed.data.publishNow
          ? "Approved and queued to publish now."
          : variant.status === "scheduled"
            ? "Approved and scheduled."
            : "Approved. It is ready to schedule."
        : parsed.data.decision === "reject"
          ? "Rejected."
          : "Changes requested.";
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message };
}

/** Calendar move: keeps the post's local time of day and moves it to `targetDate` (YYYY-MM-DD in the business timezone). */
export async function rescheduleSocialVariantAction(organizationSlug: string, contentVariantId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/calendar`);
  const parsed = z
    .object({ expectedRevision: revisionSchema, targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), originalAt: z.string().optional() })
    .safeParse({ expectedRevision: formData.get("expectedRevision"), targetDate: formData.get("targetDate"), originalAt: optionalText(formData, "originalAt") });
  if (!parsed.success) return toActionResult(parsed.error);
  const tz = await getSocialTimezone(db, organization.id);
  const original = parsed.data.originalAt ? new Date(parsed.data.originalAt) : null;
  let hour = 10;
  let minute = 0;
  if (original && !Number.isNaN(original.getTime())) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(original);
    hour = Number(parts.find((p) => p.type === "hour")?.value ?? "10") % 24;
    minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  }
  const [y, m, d] = parsed.data.targetDate.split("-").map(Number);
  const scheduledFor = zonedDateTimeToUtc(y, m, d, hour, minute, tz);
  try {
    await rescheduleVariant(db, { organizationId: organization.id, contentVariantId, actorUserId: user.userId, expectedRevision: parsed.data.expectedRevision, scheduledFor });
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message: "Moved." };
}

export async function archiveContentItemAction(organizationSlug: string, contentItemId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/library/${contentItemId}`);
  const expectedRevision = revisionSchema.safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return toActionResult(expectedRevision.error);
  try {
    await archiveContentItem(db, { organizationId: organization.id, contentItemId, actorUserId: user.userId, expectedRevision: expectedRevision.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  redirect(`${socialPath(organizationSlug)}/library`);
}

// ---------------------------------------------------------------------------
// Publishing queue
// ---------------------------------------------------------------------------

export async function cancelPublishJobAction(organizationSlug: string, publishJobId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/publishing`);
  try {
    await cancelPublishJob(db, { organizationId: organization.id, publishJobId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message: "Cancelled. The post is back to approved." };
}

export async function retryPublishJobAction(organizationSlug: string, publishJobId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/publishing`);
  try {
    await retryPublishJob(db, { organizationId: organization.id, publishJobId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message: "Retry queued." };
}

// ---------------------------------------------------------------------------
// AI Manager + planning
// ---------------------------------------------------------------------------

export async function createManagerThreadAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/manager`);
  const parsed = z
    .object({ brandProfileId: uuidSchema.optional(), title: z.string().trim().max(200).optional(), prompt: z.string().trim().max(8000).optional() })
    .safeParse({ brandProfileId: optionalText(formData, "brandProfileId"), title: optionalText(formData, "title"), prompt: optionalText(formData, "prompt") });
  if (!parsed.success) return toActionResult(parsed.error);
  let threadId: string;
  try {
    const thread = await createManagerThread(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: parsed.data.brandProfileId ?? null, title: parsed.data.title });
    threadId = thread.id;
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  const qs = new URLSearchParams();
  if (parsed.data.brandProfileId) qs.set("brand", parsed.data.brandProfileId);
  if (parsed.data.prompt) qs.set("prompt", parsed.data.prompt.slice(0, 500));
  redirect(`${socialPath(organizationSlug)}/manager/${threadId}${qs.size ? `?${qs.toString()}` : ""}`);
}

/** Drafts next week (Monday start, business timezone) for one brand. Never submits for review or publishes. */
export async function planWeekAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, socialPath(organizationSlug));
  const parsed = z.object({ brandProfileId: uuidSchema, postsPerWeek: z.coerce.number().int().min(1).max(7).optional() }).safeParse({ brandProfileId: formData.get("brandProfileId"), postsPerWeek: optionalText(formData, "postsPerWeek") });
  if (!parsed.success) return parsed.error.issues.some((i) => i.path[0] === "brandProfileId") ? invalidBrand() : toActionResult(parsed.error);
  const tz = await getSocialTimezone(db, organization.id);
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const daysToMonday = ((8 - weekday) % 7) || 7;
  const localToday = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")));
  const monday = new Date(localToday + daysToMonday * 86_400_000);
  const weekStart = zonedDateTimeToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, tz);
  let created: number;
  try {
    const result = await planWeek(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: parsed.data.brandProfileId, weekStart, postsPerWeek: parsed.data.postsPerWeek });
    created = result.createdContentItemIds.length;
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  const from = monday.toISOString().slice(0, 10);
  redirect(`${socialPath(organizationSlug)}/calendar?view=week&from=${from}&brand=${parsed.data.brandProfileId}&notice=planned_${created}`);
}

function invalidBrand(): ActionResult {
  return { ok: false, code: "invalid_request", message: "Choose a brand to plan for." };
}

// ===========================================================================
// UI pass 2 — inbox, analytics, advertising, brands, connections, automation
// ===========================================================================

/** A zod failure with its first issue spelled out — the Social forms render `message`, not per-field errors. */
function zodFailure(error: z.ZodError): ActionResult {
  const issue = error.issues[0];
  const field = issue?.path.length ? `${String(issue.path[issue.path.length - 1])}: ` : "";
  return { ok: false, code: "invalid_request", message: issue ? `${field}${issue.message}` : "Please check the form.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> };
}

/** A single-field failure whose message is shown as-is (unlike `invalid`, which defers to inline field errors). */
function fieldFailure(field: string, message: string): ActionResult {
  return { ok: false, code: "invalid_request", message, fieldErrors: { [field]: [message] } };
}

/** One value per line (blank lines dropped, trimmed). */
function lines(formData: FormData, name: string): string[] {
  return text(formData, name).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Dollars typed into a form → integer minor units; empty → undefined; garbage → NaN (rejected by the schema). */
function dollarsToMinor(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : Number.NaN;
}

/** A provider call failed: lead with what it means for the user, then the (already redacted) provider detail. */
function providerFailure(err: SocialProviderError): ActionResult {
  const lead = err.authorizationLost
    ? "The platform no longer accepts LYNQ's authorization — reconnect the account in the Connection Center."
    : err.retryable
      ? "The platform could not be reached or had a temporary problem. Nothing was changed there — try again in a moment."
      : "The platform refused the request.";
  const base = toActionResult(err);
  return base.ok ? base : { ...base, message: `${lead} Details: ${err.message}` };
}

async function run(organizationSlug: string, path: string, fn: (ctx: Awaited<ReturnType<typeof context>>) => Promise<string>): Promise<ActionResult> {
  const ctx = await context(organizationSlug, path);
  let message: string;
  try {
    message = await fn(ctx);
  } catch (err) {
    if (err instanceof z.ZodError) return zodFailure(err);
    if (err instanceof SocialProviderError) return providerFailure(err);
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message };
}

// ---------------------------------------------------------------------------
// Engagement inbox
// ---------------------------------------------------------------------------

function inboxPath(organizationSlug: string) {
  return `${socialPath(organizationSlug)}/inbox`;
}

/** AI-suggested reply. Never sends — the draft lands in the reply box for a human to edit. */
export async function draftReplyAction(organizationSlug: string, engagementItemId: string): Promise<ActionResult> {
  if (!(await textProviderConfigured())) return { ok: false, code: "social_provider_not_configured", message: "No AI text provider is configured on this server (Anthropic, OpenAI or the AI Gateway). Write the reply by hand." };
  return run(organizationSlug, inboxPath(organizationSlug), async ({ db, user, organization }) => {
    const item = await draftReply(db, { organizationId: organization.id, engagementItemId, actorUserId: user.userId });
    return item.replyDraft ? "Draft ready — review and edit it before sending." : "The AI returned no reply text. Write the reply by hand.";
  });
}

const sendReplySchema = z.object({ expectedRevision: revisionSchema, text: z.string().trim().min(1, "Write a reply first").max(8000) });

/** Posts the reply publicly. Pressing send is the human approval. */
export async function sendReplyAction(organizationSlug: string, engagementItemId: string, formData: FormData): Promise<ActionResult> {
  const parsed = sendReplySchema.safeParse({ expectedRevision: formData.get("expectedRevision"), text: text(formData, "text") });
  if (!parsed.success) return zodFailure(parsed.error);
  return run(organizationSlug, inboxPath(organizationSlug), async ({ db, user, organization }) => {
    await sendReply(db, { organizationId: organization.id, engagementItemId, actorUserId: user.userId, expectedRevision: parsed.data.expectedRevision, text: parsed.data.text });
    return "Reply posted.";
  });
}

const engagementStatusSchema = z.object({ expectedRevision: revisionSchema, status: z.enum(["hide", "ignore", "needs_reply", "escalate"]) });

export async function engagementStatusAction(organizationSlug: string, engagementItemId: string, formData: FormData): Promise<ActionResult> {
  const parsed = engagementStatusSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), status: formData.get("status") });
  if (!parsed.success) return zodFailure(parsed.error);
  const { expectedRevision, status } = parsed.data;
  return run(organizationSlug, inboxPath(organizationSlug), async ({ db, user, organization }) => {
    const input = { organizationId: organization.id, engagementItemId, actorUserId: user.userId, expectedRevision };
    if (status === "hide") {
      await hideItem(db, input);
      return "Hidden on the platform.";
    }
    if (status === "ignore") {
      await ignoreItem(db, input);
      return "Marked as ignored.";
    }
    if (status === "needs_reply") {
      await markNeedsReply(db, input);
      return "Marked as needing a reply.";
    }
    await escalateItem(db, input);
    return "Escalated.";
  });
}

export async function assignEngagementAction(organizationSlug: string, engagementItemId: string, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ expectedRevision: revisionSchema, assignedUserId: uuidSchema.nullable() }).safeParse({ expectedRevision: formData.get("expectedRevision"), assignedUserId: optionalText(formData, "assignedUserId") ?? null });
  if (!parsed.success) return zodFailure(parsed.error);
  return run(organizationSlug, inboxPath(organizationSlug), async ({ db, user, organization }) => {
    await assignItem(db, { organizationId: organization.id, engagementItemId, actorUserId: user.userId, expectedRevision: parsed.data.expectedRevision, assignedUserId: parsed.data.assignedUserId });
    return parsed.data.assignedUserId ? "Assigned." : "Unassigned.";
  });
}

export async function flagLeadAction(organizationSlug: string, engagementItemId: string, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ expectedRevision: revisionSchema, isLead: z.enum(["1", "0"]) }).safeParse({ expectedRevision: formData.get("expectedRevision"), isLead: formData.get("isLead") });
  if (!parsed.success) return zodFailure(parsed.error);
  return run(organizationSlug, inboxPath(organizationSlug), async ({ db, user, organization }) => {
    await flagLead(db, { organizationId: organization.id, engagementItemId, actorUserId: user.userId, expectedRevision: parsed.data.expectedRevision, isLead: parsed.data.isLead === "1" });
    return parsed.data.isLead === "1" ? "Flagged as a lead." : "Lead flag removed.";
  });
}

const crmLinkSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("create_lead"), expectedRevision: revisionSchema }),
  z.object({ mode: z.literal("existing_lead"), expectedRevision: revisionSchema, leadId: z.string().trim().uuid("Paste the lead's id (a UUID from its CRM page)") }),
  z.object({ mode: z.literal("existing_contact"), expectedRevision: revisionSchema, contactId: z.string().trim().uuid("Paste the contact's id (a UUID from its CRM page)") }),
]);

/** Links to CRM Core through its own services (which enforce CRM authority on top of marketing engagement authority). */
export async function linkEngagementToCrmAction(organizationSlug: string, engagementItemId: string, formData: FormData): Promise<ActionResult> {
  const parsed = crmLinkSchema.safeParse({ mode: formData.get("mode"), expectedRevision: formData.get("expectedRevision"), leadId: optionalText(formData, "leadId"), contactId: optionalText(formData, "contactId") });
  if (!parsed.success) return zodFailure(parsed.error);
  const data = parsed.data;
  return run(organizationSlug, inboxPath(organizationSlug), async ({ db, user, organization }) => {
    await linkToCrm(db, {
      organizationId: organization.id,
      engagementItemId,
      actorUserId: user.userId,
      expectedRevision: data.expectedRevision,
      mode: data.mode,
      leadId: data.mode === "existing_lead" ? data.leadId : undefined,
      contactId: data.mode === "existing_contact" ? data.contactId : undefined,
    });
    return data.mode === "create_lead" ? "Lead created in CRM." : data.mode === "existing_lead" ? "Linked to the CRM lead." : "Linked to the CRM contact.";
  });
}

export async function requestEngagementSyncAction(organizationSlug: string, channelAccountId: string): Promise<ActionResult> {
  return run(organizationSlug, inboxPath(organizationSlug), async ({ db, user, organization }) => {
    const job = await requestEngagementSync(db, { organizationId: organization.id, channelAccountId, actorUserId: user.userId });
    return job.status === "queued" ? "Inbox sync queued. New comments appear once the worker finishes — refresh in a minute." : `Inbox sync is already ${job.status.replace(/_/g, " ")}.`;
  });
}

export async function requestMetricsSyncAction(organizationSlug: string, channelAccountId: string): Promise<ActionResult> {
  return run(organizationSlug, `${socialPath(organizationSlug)}/analytics`, async ({ db, user, organization }) => {
    const job = await requestMetricsSync(db, { organizationId: organization.id, channelAccountId, actorUserId: user.userId });
    return job.status === "queued" ? "Metrics sync queued. Numbers update once the worker finishes — refresh in a minute." : `Metrics sync is already ${job.status.replace(/_/g, " ")}.`;
  });
}

// ---------------------------------------------------------------------------
// Advertising — recommendation → approval → execution
// ---------------------------------------------------------------------------

function adsPath(organizationSlug: string) {
  return `${socialPath(organizationSlug)}/advertising`;
}

const AD_FORM_CHANGE_TYPES = ["update_budget", "pause_campaign", "resume_campaign", "create_campaign"] as const;
const currencySchema = z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code (e.g. CAD)").transform((v) => v.toUpperCase());
const minorSchema = z.number({ message: "Enter an amount like 25 or 25.50" }).int().min(0).max(1_000_000_000);

const proposeAdSchema = z.object({
  channelAccountId: uuidSchema,
  changeType: z.enum(AD_FORM_CHANGE_TYPES),
  title: z.string().trim().min(1, "Give the change a short title").max(200),
  rationale: z.string().trim().max(4000).default(""),
  externalCampaignId: z.string().trim().max(100).optional(),
  dailyBudgetMinor: minorSchema.optional(),
  lifetimeBudgetMinor: minorSchema.optional(),
  estimatedDailySpendMinor: minorSchema.optional(),
  currency: currencySchema.optional(),
  name: z.string().trim().max(200).optional(),
  objective: z.string().trim().max(60).optional(),
});

/** A human proposal. Nothing reaches the ad platform until it is submitted, approved, and executed by the worker. */
export async function proposeAdChangeAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const parsed = proposeAdSchema.safeParse({
    channelAccountId: formData.get("channelAccountId"),
    changeType: formData.get("changeType"),
    title: text(formData, "title"),
    rationale: text(formData, "rationale"),
    externalCampaignId: optionalText(formData, "externalCampaignId"),
    dailyBudgetMinor: dollarsToMinor(optionalText(formData, "dailyBudget")),
    lifetimeBudgetMinor: dollarsToMinor(optionalText(formData, "lifetimeBudget")),
    estimatedDailySpendMinor: dollarsToMinor(optionalText(formData, "estimatedDailySpend")),
    currency: optionalText(formData, "currency"),
    name: optionalText(formData, "name"),
    objective: optionalText(formData, "objective"),
  });
  if (!parsed.success) return zodFailure(parsed.error);
  const d = parsed.data;
  let payload: Record<string, unknown>;
  if (d.changeType === "pause_campaign" || d.changeType === "resume_campaign") {
    if (!d.externalCampaignId) return fieldFailure("externalCampaignId", "Choose the campaign to change");
    payload = { externalCampaignId: d.externalCampaignId };
  } else if (d.changeType === "update_budget") {
    if (!d.externalCampaignId) return fieldFailure("externalCampaignId", "Choose the campaign to change");
    if (d.dailyBudgetMinor === undefined && d.lifetimeBudgetMinor === undefined) return fieldFailure("dailyBudget", "Enter a new daily or lifetime budget");
    if (!d.currency) return fieldFailure("currency", "Enter the account currency (e.g. CAD)");
    payload = { externalCampaignId: d.externalCampaignId, currency: d.currency, ...(d.dailyBudgetMinor !== undefined ? { dailyBudgetMinor: d.dailyBudgetMinor } : {}), ...(d.lifetimeBudgetMinor !== undefined ? { lifetimeBudgetMinor: d.lifetimeBudgetMinor } : {}) };
  } else {
    if (!d.name) return fieldFailure("name", "Name the new campaign");
    if (!d.objective) return fieldFailure("objective", "Enter the campaign objective");
    if (!d.currency) return fieldFailure("currency", "Enter the account currency (e.g. CAD)");
    payload = { name: d.name, objective: d.objective, currency: d.currency, startPaused: true, ...(d.dailyBudgetMinor !== undefined ? { dailyBudgetMinor: d.dailyBudgetMinor } : {}), ...(d.lifetimeBudgetMinor !== undefined ? { lifetimeBudgetMinor: d.lifetimeBudgetMinor } : {}) };
  }
  const estimate = d.estimatedDailySpendMinor ?? (d.changeType === "update_budget" || d.changeType === "create_campaign" ? d.dailyBudgetMinor : undefined);
  return run(organizationSlug, adsPath(organizationSlug), async ({ db, user, organization }) => {
    await proposeAdChange(db, { organizationId: organization.id, channelAccountId: d.channelAccountId, actorUserId: user.userId, changeType: d.changeType, title: d.title, rationale: d.rationale, payload, externalCampaignId: d.externalCampaignId ?? null, estimatedDailySpendMinor: estimate ?? null, currency: d.currency });
    return "Proposed. Submit it for approval when it is ready — nothing changes on the ad platform until it is approved.";
  });
}

async function adChangeRevision(organizationSlug: string, formData: FormData, fn: (ctx: Awaited<ReturnType<typeof context>>, expectedRevision: number) => Promise<string>): Promise<ActionResult> {
  const expectedRevision = revisionSchema.safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return zodFailure(expectedRevision.error);
  return run(organizationSlug, adsPath(organizationSlug), (ctx) => fn(ctx, expectedRevision.data));
}

export async function submitAdChangeAction(organizationSlug: string, changeRequestId: string, formData: FormData): Promise<ActionResult> {
  return adChangeRevision(organizationSlug, formData, async ({ db, user, organization }, expectedRevision) => {
    await submitAdChangeForApproval(db, { organizationId: organization.id, changeRequestId, actorUserId: user.userId, expectedRevision });
    return "Submitted for approval.";
  });
}

export async function decideAdChangeAction(organizationSlug: string, changeRequestId: string, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ expectedRevision: revisionSchema, decision: z.enum(["approve", "reject"]), note: z.string().trim().max(2000).optional() }).safeParse({ expectedRevision: formData.get("expectedRevision"), decision: formData.get("decision"), note: optionalText(formData, "note") });
  if (!parsed.success) return zodFailure(parsed.error);
  return run(organizationSlug, adsPath(organizationSlug), async ({ db, user, organization }) => {
    await decideAdChange(db, { organizationId: organization.id, changeRequestId, actorUserId: user.userId, ...parsed.data });
    return parsed.data.decision === "approve" ? "Approved. The change is queued for execution — check back for the platform's result." : "Rejected. Nothing was changed.";
  });
}

export async function cancelAdChangeAction(organizationSlug: string, changeRequestId: string, formData: FormData): Promise<ActionResult> {
  return adChangeRevision(organizationSlug, formData, async ({ db, user, organization }, expectedRevision) => {
    await cancelAdChange(db, { organizationId: organization.id, changeRequestId, actorUserId: user.userId, expectedRevision });
    return "Cancelled.";
  });
}

/** AI proposals from synced campaign data only. They land as `proposed` changes; none is submitted automatically. */
export async function generateAdRecommendationsAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const account = uuidSchema.safeParse(formData.get("channelAccountId"));
  if (!account.success) return fieldFailure("channelAccountId", "Choose an ad account");
  if (!(await textProviderConfigured())) return { ok: false, code: "social_provider_not_configured", message: "No AI text provider is configured on this server, so no recommendations can be generated." };
  const { db, user, organization } = await context(organizationSlug, adsPath(organizationSlug));
  let message: string;
  try {
    const result = await generateAdRecommendations(db, { organizationId: organization.id, channelAccountId: account.data, actorUserId: user.userId });
    if (!result.available) return { ok: false, code: "no_synced_data", message: result.reason };
    const n = result.recommendations.length;
    message = n ? `${n} recommendation${n === 1 ? "" : "s"} added as proposals below${result.dropped ? ` (${result.dropped} invalid suggestion${result.dropped === 1 ? "" : "s"} discarded)` : ""}. Review each one before submitting.` : `The AI found nothing it could recommend from the synced data${result.dropped ? ` (${result.dropped} invalid suggestion${result.dropped === 1 ? "" : "s"} discarded)` : ""}.`;
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return { ok: true, message };
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export async function createBrandAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/brands`);
  const parsed = brandProfileInputSchema.safeParse({
    brandKey: text(formData, "brandKey").trim().toLowerCase(),
    name: text(formData, "name"),
    positioning: text(formData, "positioning"),
    audience: text(formData, "audience"),
    voice: text(formData, "voice"),
    productContext: text(formData, "productContext"),
    claimsGuardrails: text(formData, "claimsGuardrails"),
    visualRules: text(formData, "visualRules"),
  });
  if (!parsed.success) return zodFailure(parsed.error);
  let brandProfileId: string;
  try {
    brandProfileId = (await createBrand(db, { organizationId: organization.id, actorUserId: user.userId, brand: parsed.data })).id;
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  redirect(`${socialPath(organizationSlug)}/brands/${brandProfileId}?brand=${brandProfileId}`);
}

const BRAND_SECTIONS = ["identity", "voice", "offer", "guardrails", "visual", "content"] as const;
const MAX_FORM_ROWS = 12;

function objectiveRows(formData: FormData): { key: string; description: string; target: string }[] {
  const rows: { key: string; description: string; target: string }[] = [];
  for (let i = 0; i < MAX_FORM_ROWS; i++) {
    const key = text(formData, `objectiveKey${i}`).trim();
    const description = text(formData, `objectiveDescription${i}`).trim();
    const target = text(formData, `objectiveTarget${i}`).trim();
    if (key || description || target) rows.push({ key, description, target });
  }
  return rows;
}

function colorRows(formData: FormData): { name: string; hex: string; role: string }[] {
  const rows: { name: string; hex: string; role: string }[] = [];
  for (let i = 0; i < MAX_FORM_ROWS; i++) {
    const name = text(formData, `colorName${i}`).trim();
    let hex = text(formData, `colorHex${i}`).trim();
    const role = text(formData, `colorRole${i}`).trim();
    if (hex && !hex.startsWith("#")) hex = `#${hex}`;
    if (name || (hex && hex !== "#") || role) rows.push({ name, hex, role });
  }
  return rows;
}

/** Saves ONE section of a brand: only that section's fields are sent, so the other sections are never reset. */
export async function updateBrandAction(organizationSlug: string, brandProfileId: string, formData: FormData): Promise<ActionResult> {
  const head = z.object({ expectedRevision: revisionSchema, section: z.enum(BRAND_SECTIONS) }).safeParse({ expectedRevision: formData.get("expectedRevision"), section: formData.get("section") });
  if (!head.success) return zodFailure(head.error);
  const { expectedRevision, section } = head.data;
  return run(organizationSlug, `${socialPath(organizationSlug)}/brands/${brandProfileId}`, async ({ db, user, organization }) => {
    let raw: Record<string, unknown>;
    switch (section) {
      case "identity":
        raw = { name: text(formData, "name"), companyInfo: text(formData, "companyInfo"), positioning: text(formData, "positioning"), brandStory: text(formData, "brandStory"), geographicMarket: text(formData, "geographicMarket"), websites: lines(formData, "websites") };
        break;
      case "voice":
        raw = { voice: text(formData, "voice"), writingStyle: text(formData, "writingStyle"), prohibitedLanguage: lines(formData, "prohibitedLanguage"), approvedExamples: lines(formData, "approvedExamples") };
        break;
      case "offer":
        raw = { productContext: text(formData, "productContext"), audience: text(formData, "audience"), objectives: objectiveRows(formData) };
        break;
      case "guardrails":
        raw = { claimsGuardrails: text(formData, "claimsGuardrails"), neverClaim: lines(formData, "neverClaim"), competitors: lines(formData, "competitors") };
        break;
      case "visual": {
        // visualIdentity is stored whole — keep the parts this form does not edit (logo ids).
        const current = await getBrandForUser(db, { organizationId: organization.id, brandProfileId, actorUserId: user.userId });
        raw = {
          visualRules: text(formData, "visualRules"),
          visualIdentity: { colors: colorRows(formData), typography: { heading: text(formData, "typographyHeading"), body: text(formData, "typographyBody") }, logoAssetIds: current.visualIdentity.logoAssetIds, notes: text(formData, "visualNotes") },
        };
        break;
      }
      case "content":
        raw = { contentPillars: lines(formData, "contentPillars"), preferredPlatforms: formData.getAll("preferredPlatforms").map(String).filter((p) => (SOCIAL_PLATFORMS as readonly string[]).includes(p)), callsToAction: lines(formData, "callsToAction") };
        break;
    }
    const changes = parseBrandChanges(raw);
    await updateBrand(db, { organizationId: organization.id, brandProfileId, actorUserId: user.userId, expectedRevision, changes });
    return "Saved.";
  });
}

export async function archiveBrandAction(organizationSlug: string, brandProfileId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `${socialPath(organizationSlug)}/brands/${brandProfileId}`);
  const expectedRevision = revisionSchema.safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return zodFailure(expectedRevision.error);
  try {
    await archiveBrand(db, { organizationId: organization.id, brandProfileId, actorUserId: user.userId, expectedRevision: expectedRevision.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  redirect(`${socialPath(organizationSlug)}/brands`);
}

// ---------------------------------------------------------------------------
// Connection Center
// ---------------------------------------------------------------------------

function connectionsPath(organizationSlug: string) {
  return `${socialPath(organizationSlug)}/connections`;
}

function verifyFailureLead(status: string, code: string | null): string {
  if (status === "token_expired") return "The authorization has expired — reconnect the account to keep publishing and syncing.";
  if (status === "authorization_required") return "LYNQ no longer has permission for this account — reconnect it.";
  if (code === "network_error") return "LYNQ could not reach the platform to check this account. The stored authorization was kept — try Verify again in a moment.";
  return `The platform did not confirm this account (status: ${status.replace(/_/g, " ")}).`;
}

/** Re-checks the stored authorization with the provider and records the honest result. */
export async function verifyAccountAction(organizationSlug: string, channelAccountId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, connectionsPath(organizationSlug));
  let result: ActionResult;
  try {
    const account = await verifyAccount(db, { organizationId: organization.id, channelAccountId, actorUserId: user.userId });
    result = account.connectionStatus === "connected" ? { ok: true, message: "Verified — the account is connected." } : { ok: false, code: account.lastErrorCode ?? account.connectionStatus, message: `${verifyFailureLead(account.connectionStatus, account.lastErrorCode)}${account.lastErrorMessage ? ` Details: ${account.lastErrorMessage}` : ""}` };
  } catch (err) {
    return toActionResult(err);
  }
  revalidateSocial(organizationSlug);
  return result;
}

const updateAccountSchema = z.object({
  expectedRevision: revisionSchema,
  brandProfileId: uuidSchema,
  displayName: z.string().trim().min(1, "Enter a display name").max(200),
  handle: z.string().trim().max(200).nullable(),
  externalUrl: z.string().trim().url("Enter a full URL starting with https://").max(2000).nullable(),
});

export async function updateAccountAction(organizationSlug: string, channelAccountId: string, formData: FormData): Promise<ActionResult> {
  const parsed = updateAccountSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), brandProfileId: formData.get("brandProfileId"), displayName: text(formData, "displayName"), handle: optionalText(formData, "handle") ?? null, externalUrl: optionalText(formData, "externalUrl") ?? null });
  if (!parsed.success) return zodFailure(parsed.error);
  const { expectedRevision, ...changes } = parsed.data;
  return run(organizationSlug, connectionsPath(organizationSlug), async ({ db, user, organization }) => {
    await updateAccount(db, { organizationId: organization.id, channelAccountId, actorUserId: user.userId, expectedRevision, changes });
    return "Account saved.";
  });
}

export async function archiveAccountAction(organizationSlug: string, channelAccountId: string, formData: FormData): Promise<ActionResult> {
  const expectedRevision = revisionSchema.safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return zodFailure(expectedRevision.error);
  return run(organizationSlug, connectionsPath(organizationSlug), async ({ db, user, organization }) => {
    await archiveAccount(db, { organizationId: organization.id, channelAccountId, actorUserId: user.userId, expectedRevision: expectedRevision.data });
    return "Account archived.";
  });
}

const manualAccountSchema = z.object({
  brandProfileId: uuidSchema,
  platform: z.enum(SOCIAL_PLATFORMS),
  displayName: z.string().trim().min(1, "Enter the account name").max(200),
  handle: z.string().trim().max(200).optional(),
  externalUrl: z.string().trim().url("Enter a full URL starting with https://").max(2000).optional(),
});

/** A tracking-only account (no credentials): its results are recorded by hand. */
export async function createManualAccountAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const parsed = manualAccountSchema.safeParse({ brandProfileId: formData.get("brandProfileId"), platform: formData.get("platform"), displayName: text(formData, "displayName"), handle: optionalText(formData, "handle"), externalUrl: optionalText(formData, "externalUrl") });
  if (!parsed.success) return zodFailure(parsed.error);
  return run(organizationSlug, connectionsPath(organizationSlug), async ({ db, user, organization }) => {
    await createManualAccount(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
    return "Manual account added.";
  });
}

export async function disconnectConnectionAction(organizationSlug: string, connectionId: string, formData: FormData): Promise<ActionResult> {
  const expectedRevision = revisionSchema.safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return zodFailure(expectedRevision.error);
  return run(organizationSlug, connectionsPath(organizationSlug), async ({ db, user, organization }) => {
    await disconnectConnection(db, { organizationId: organization.id, connectionId, actorUserId: user.userId, expectedRevision: expectedRevision.data });
    return "Disconnected. The stored authorization was revoked.";
  });
}

// ---------------------------------------------------------------------------
// Automation — drafts, syncs and attention only; never publishes or spends
// ---------------------------------------------------------------------------

function automationPath(organizationSlug: string) {
  return `${socialPath(organizationSlug)}/automation`;
}

const optionalInt = (min: number, max: number) => z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.coerce.number().int().min(min).max(max).optional());

const upsertRuleSchema = z.object({
  kind: z.enum(SOCIAL_AUTOMATION_KINDS),
  brandProfileId: uuidSchema.nullable(),
  enabled: z.boolean(),
  intervalMinutes: optionalInt(1, 60 * 24 * 31),
  postsPerWeek: optionalInt(1, 21),
  maxDraftsPerRun: optionalInt(1, 50),
  expiryWarningDays: optionalInt(1, 30),
  platforms: z.array(z.enum(SOCIAL_ORGANIC_PLATFORMS)),
});

export async function upsertAutomationRuleAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const parsed = upsertRuleSchema.safeParse({
    kind: formData.get("kind"),
    brandProfileId: optionalText(formData, "brandProfileId") ?? null,
    enabled: formData.get("enabled") === "on" || formData.get("enabled") === "1",
    intervalMinutes: optionalText(formData, "intervalMinutes"),
    postsPerWeek: optionalText(formData, "postsPerWeek"),
    maxDraftsPerRun: optionalText(formData, "maxDraftsPerRun"),
    expiryWarningDays: optionalText(formData, "expiryWarningDays"),
    platforms: formData.getAll("platforms").map(String),
  });
  if (!parsed.success) return zodFailure(parsed.error);
  const d = parsed.data;
  const config = {
    ...(d.kind === "weekly_plan" && d.postsPerWeek !== undefined ? { postsPerWeek: d.postsPerWeek } : {}),
    ...(d.kind === "weekly_plan" && d.platforms.length ? { platforms: d.platforms } : {}),
    ...(d.kind === "reply_drafts" && d.maxDraftsPerRun !== undefined ? { maxDraftsPerRun: d.maxDraftsPerRun } : {}),
    ...(d.kind === "token_watch" && d.expiryWarningDays !== undefined ? { expiryWarningDays: d.expiryWarningDays } : {}),
  };
  return run(organizationSlug, automationPath(organizationSlug), async ({ db, user, organization }) => {
    const rule = await upsertAutomationRule(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: d.brandProfileId, kind: d.kind, enabled: d.enabled, intervalMinutes: d.intervalMinutes, config });
    return rule.enabled ? "Saved. The rule is on." : "Saved. The rule is off.";
  });
}

export async function setAutomationRuleEnabledAction(organizationSlug: string, ruleId: string, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ expectedRevision: revisionSchema, enabled: z.enum(["1", "0"]) }).safeParse({ expectedRevision: formData.get("expectedRevision"), enabled: formData.get("enabled") });
  if (!parsed.success) return zodFailure(parsed.error);
  return run(organizationSlug, automationPath(organizationSlug), async ({ db, user, organization }) => {
    await setAutomationRuleEnabled(db, { organizationId: organization.id, ruleId, actorUserId: user.userId, expectedRevision: parsed.data.expectedRevision, enabled: parsed.data.enabled === "1" });
    return parsed.data.enabled === "1" ? "Turned on." : "Turned off.";
  });
}

export async function archiveAutomationRuleAction(organizationSlug: string, ruleId: string, formData: FormData): Promise<ActionResult> {
  const expectedRevision = revisionSchema.safeParse(formData.get("expectedRevision"));
  if (!expectedRevision.success) return zodFailure(expectedRevision.error);
  return run(organizationSlug, automationPath(organizationSlug), async ({ db, user, organization }) => {
    await archiveAutomationRule(db, { organizationId: organization.id, ruleId, actorUserId: user.userId, expectedRevision: expectedRevision.data });
    return "Rule removed.";
  });
}

export async function runAutomationRuleNowAction(organizationSlug: string, ruleId: string): Promise<ActionResult> {
  return run(organizationSlug, automationPath(organizationSlug), async ({ db, user, organization }) => {
    await runAutomationRuleNow(db, { organizationId: organization.id, ruleId, actorUserId: user.userId });
    return "Run queued. The result appears under recent runs once the worker finishes.";
  });
}
