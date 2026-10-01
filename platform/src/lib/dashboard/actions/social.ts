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
import { describeAiProviders, loadSocialAiEnv } from "@/lib/social-os/providers/ai/registry";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import {
  SOCIAL_CONTENT_KINDS,
  SOCIAL_CONTENT_OBJECTIVES,
  SOCIAL_ORGANIC_PLATFORMS,
  socialContentBriefSchema,
  socialRegeneratePartSchema,
  type SocialVariantMedia,
  type SocialVariantUpdate,
} from "@/lib/social-os/validation";
import { toActionResult } from "./errors";
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
