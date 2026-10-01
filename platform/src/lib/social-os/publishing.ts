import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingChannelAccounts, marketingContentItems, runtimeJobs, socialAssets, socialContentVariants, socialPublishJobs } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { AuthzError } from "@/lib/authz/errors";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { loadEnv } from "@/lib/env";
import { loadAuthEnv } from "@/lib/auth/env";
import { enqueueJob, cancelJob } from "@/lib/runtime/queue";
import { resolveMarketingAuthContext, hasMarketingCapability, requireMarketingViewAuthority, requireMarketingPublishAuthority } from "@/lib/marketing-os/authz";
import { resolveSocialAccountCredential, recordAccountError } from "./connections";
import { resolveAdapterForPlatform, type SocialProviderEnv } from "./providers/social/registry";
import { providerStateFromError, redactSecrets } from "./providers/social/http";
import type { FetchLike, PublishInput, PublishMediaInput } from "./providers/social/types";
import { assetPublicUrl, resolveAssetBytes, type SocialAssetStorage } from "./assets";
import { blockingMessages, computeStoredVariantWarnings, recordVariantPublished, recordVariantPublishFailed, resolveVariantRow, scheduleWarning, syncContentItemStatus } from "./content";
import { SOCIAL_PLATFORM_PROVIDER, socialOrganicPlatformSchema, socialVariantMediaSchema, type SocialOrganicPlatform, type SocialPublishJobStatus, type SocialVariantFormat } from "./validation";
import {
  InvalidSocialTransitionError,
  SocialDuplicatePublishError,
  SocialInvalidScheduleError,
  SocialProviderError,
  SocialProviderNotSupportedError,
  SocialVariantNotPublishableError,
  StaleSocialUpdateError,
} from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type JobRow = typeof socialPublishJobs.$inferSelect;

/**
 * Module 19 — the publishing engine.
 *
 * One `social_publish_jobs` row per publish attempt series; its runtime
 * job (`social_publish:<publishJobId>`) waits in the shared queue until
 * `scheduledFor`, then the worker calls `processPublishJob`, which:
 *   1. re-reads the job and variant (idempotent: a published or cancelled
 *      job is a no-op),
 *   2. claims queued|retrying → processing with a revision CAS,
 *   3. re-validates the variant (still approved/scheduled, the requester
 *      still holds `marketing_publish`),
 *   4. decrypts the account credential and calls the provider adapter with
 *      the persisted `provider_state` so a retry resumes (Instagram
 *      container ids, Facebook photo ids) instead of duplicating,
 *   5. records `published` only once the provider returned an id.
 * Failures persist the resumable provider state and are rethrown so the
 * runtime queue classifies them (retryable provider errors back off and
 * retry; everything else fails and surfaces to a human).
 */

export const DEFAULT_PUBLISH_MAX_ATTEMPTS = 4;
const ACTIVE_JOB_STATUSES: SocialPublishJobStatus[] = ["queued", "processing", "retrying"];

export interface SocialPublishJobView {
  id: string;
  organizationId: string;
  contentItemId: string;
  contentVariantId: string;
  channelAccountId: string;
  platform: string;
  status: SocialPublishJobStatus;
  scheduledFor: Date;
  attemptCount: number;
  maxAttempts: number;
  startedAt: Date | null;
  publishedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  externalPostId: string | null;
  externalPostUrl: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorClass: string | null;
  runtimeJobId: string | null;
  requestedByUserId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  title?: string | null;
  brandProfileId?: string | null;
  accountDisplayName?: string | null;
  variantStatus?: string | null;
}

function toJobView(row: JobRow, extra: Partial<SocialPublishJobView> = {}): SocialPublishJobView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contentItemId: row.contentItemId,
    contentVariantId: row.contentVariantId,
    channelAccountId: row.channelAccountId,
    platform: row.platform,
    status: row.status,
    scheduledFor: row.scheduledFor,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    startedAt: row.startedAt,
    publishedAt: row.publishedAt,
    failedAt: row.failedAt,
    cancelledAt: row.cancelledAt,
    externalPostId: row.externalPostId,
    externalPostUrl: row.externalPostUrl,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    lastErrorClass: row.lastErrorClass,
    runtimeJobId: row.runtimeJobId,
    requestedByUserId: row.requestedByUserId,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...extra,
  };
}

async function resolveJobRow(db: Db, organizationId: string, publishJobId: string): Promise<JobRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(socialPublishJobs).where(and(eq(socialPublishJobs.id, publishJobId), eq(socialPublishJobs.organizationId, organizationId)));
    return row;
  });
}

function sanitize(message: string, max = 500): string {
  const clean = redactSecrets(message);
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

// ---------------------------------------------------------------------------
// Enqueue / cancel / retry
// ---------------------------------------------------------------------------

/**
 * Queues one publish of an approved variant. `now: true` publishes as soon
 * as the worker picks it up; otherwise `scheduledFor` is validated against
 * the platform's lead window. Exactly one active job per variant
 * (`SocialDuplicatePublishError`).
 */
export async function enqueuePublish(db: Db, input: { organizationId: string; contentVariantId: string; actorUserId: string; now?: boolean; scheduledFor?: Date; maxAttempts?: number }): Promise<SocialPublishJobView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingPublishAuthority(db, ctx, "social_content_variant", input.contentVariantId);
  const variant = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  if (!["approved", "scheduled", "failed"].includes(variant.status) || variant.archivedAt) throw new InvalidSocialTransitionError("post", variant.status, input.now ? "publishing" : "scheduled");
  if (!variant.approvedAt) throw new SocialVariantNotPublishableError(["the post has not been approved"]);
  if (!variant.channelAccountId) throw new SocialVariantNotPublishableError(["no account is selected for this post"]);
  const platform = socialOrganicPlatformSchema.parse(variant.platform);
  const target = input.now ? new Date() : input.scheduledFor ?? variant.scheduledFor;
  if (!target) throw new SocialInvalidScheduleError("a scheduled time is required");
  if (!input.now) {
    const w = scheduleWarning(platform, target);
    if (w) throw new SocialInvalidScheduleError(w.message);
  }
  const blockers = blockingMessages(await computeStoredVariantWarnings(db, input.organizationId, variant, {}, { checkSchedule: false }));
  if (blockers.length) throw new SocialVariantNotPublishableError(blockers);

  const jobId = randomUUID();
  const idempotencyKey = `social_publish:${jobId}`;
  const maxAttempts = Math.min(Math.max(input.maxAttempts ?? DEFAULT_PUBLISH_MAX_ATTEMPTS, 1), 10);
  let job: JobRow;
  try {
    [job] = await db
      .insert(socialPublishJobs)
      .values({ id: jobId, organizationId: input.organizationId, contentItemId: variant.contentItemId, contentVariantId: variant.id, channelAccountId: variant.channelAccountId, platform, status: "queued", scheduledFor: target, idempotencyKey, maxAttempts, requestedByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SocialDuplicatePublishError();
    throw err;
  }

  try {
    const runtime = await enqueueJob(db, { organizationId: input.organizationId, jobType: "social_publish", idempotencyKey, availableAt: target, maxAttempts });
    [job] = await db.update(socialPublishJobs).set({ runtimeJobId: runtime.id, updatedAt: new Date() }).where(eq(socialPublishJobs.id, job.id)).returning();
    const [moved] = await db
      .update(socialContentVariants)
      .set({ status: input.now ? "publishing" : "scheduled", scheduledFor: target, revision: variant.revision + 1, updatedAt: new Date() })
      .where(and(eq(socialContentVariants.id, variant.id), eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.revision, variant.revision)))
      .returning({ id: socialContentVariants.id });
    if (!moved) throw new StaleSocialUpdateError("post");
  } catch (err) {
    // Never leave an orphan active job behind a failed enqueue.
    await markCancelled(db, job, null);
    throw err;
  }

  await recordAuditEvent(db, { eventType: "social_publish_job_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_publish_job", targetId: job.id, metadata: { contentVariantId: variant.id, platform, scheduledFor: target.toISOString(), now: Boolean(input.now) } });
  if (!input.now) await recordAuditEvent(db, { eventType: "social_variant_scheduled", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: variant.id, metadata: { publishJobId: job.id, scheduledFor: target.toISOString() } });
  await syncContentItemStatus(db, input.organizationId, variant.contentItemId);
  return toJobView(job);
}

async function cancelRuntimeJob(db: Db, job: JobRow, actorUserId: string | null): Promise<void> {
  if (!job.runtimeJobId) return;
  if (actorUserId) {
    try {
      await cancelJob(db, { jobId: job.runtimeJobId, organizationId: job.organizationId, actorUserId });
      return;
    } catch (err) {
      // cancelJob is reserved to org owner/admin and refuses terminal jobs;
      // a marketing manager's (already authorized) cancel falls through to
      // the scoped update below. The worker re-reads the publish job and
      // skips a cancelled one in any case.
      if (!(err instanceof AuthzError) && !(err instanceof Error && err.name === "InvalidJobTransitionError")) throw err;
    }
  }
  await db
    .update(runtimeJobs)
    .set({ status: "cancelled", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(runtimeJobs.id, job.runtimeJobId), eq(runtimeJobs.organizationId, job.organizationId), inArray(runtimeJobs.status, ["queued", "retry_scheduled"])));
}

async function markCancelled(db: Db, job: JobRow, actorUserId: string | null): Promise<JobRow | null> {
  const now = new Date();
  const [row] = await db
    .update(socialPublishJobs)
    .set({ status: "cancelled", cancelledAt: now, revision: job.revision + 1, updatedAt: now })
    .where(and(eq(socialPublishJobs.id, job.id), eq(socialPublishJobs.organizationId, job.organizationId), inArray(socialPublishJobs.status, ["queued", "retrying", "processing"])))
    .returning();
  await cancelRuntimeJob(db, job, actorUserId);
  return row ?? null;
}

/**
 * Cancels a queued/retrying publish job (a job mid-flight with the provider
 * cannot be cancelled). With an actor, requires `marketing_publish`; with
 * `actorUserId: null` the caller (archive) has already authorized. By
 * default a scheduled/publishing variant returns to `approved`.
 */
export async function cancelPublishJob(db: Db, input: { organizationId: string; publishJobId: string; actorUserId: string | null; revertVariant?: boolean }): Promise<SocialPublishJobView> {
  if (input.actorUserId) {
    const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
    await requireMarketingPublishAuthority(db, ctx, "social_publish_job", input.publishJobId);
  }
  const job = await resolveJobRow(db, input.organizationId, input.publishJobId);
  if (job.status === "cancelled") return toJobView(job);
  if (job.status !== "queued" && job.status !== "retrying") throw new InvalidSocialTransitionError("publish job", job.status, "cancelled");
  const row = await markCancelled(db, job, input.actorUserId);
  if (!row) throw new StaleSocialUpdateError("publish job");

  if (input.revertVariant !== false) {
    const variant = await resolveVariantRow(db, input.organizationId, job.contentVariantId);
    if (variant.status === "scheduled" || variant.status === "publishing") {
      await db
        .update(socialContentVariants)
        .set({ status: "approved", revision: variant.revision + 1, updatedAt: new Date() })
        .where(and(eq(socialContentVariants.id, variant.id), eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.revision, variant.revision)));
      await syncContentItemStatus(db, input.organizationId, variant.contentItemId);
    }
  }
  await recordAuditEvent(db, { eventType: "social_publish_job_cancelled", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_publish_job", targetId: job.id, metadata: { contentVariantId: job.contentVariantId, from: job.status } });
  return toJobView(row);
}

/** A failed job never resumes in place: a retry is a new job series (new idempotency key), queued to publish now. */
export async function retryPublishJob(db: Db, input: { organizationId: string; publishJobId: string; actorUserId: string }): Promise<SocialPublishJobView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingPublishAuthority(db, ctx, "social_publish_job", input.publishJobId);
  const job = await resolveJobRow(db, input.organizationId, input.publishJobId);
  if (job.status !== "failed") throw new InvalidSocialTransitionError("publish job", job.status, "retried");
  const next = await enqueuePublish(db, { organizationId: input.organizationId, contentVariantId: job.contentVariantId, actorUserId: input.actorUserId, now: true, maxAttempts: job.maxAttempts });
  await recordAuditEvent(db, { eventType: "social_publish_job_retried", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_publish_job", targetId: job.id, metadata: { newPublishJobId: next.id } });
  return next;
}

export async function listPublishJobs(db: Db, input: { organizationId: string; actorUserId: string; status?: SocialPublishJobStatus; brandProfileId?: string; limit?: number }): Promise<SocialPublishJobView[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_publish_job", "list");
  const conditions = [eq(socialPublishJobs.organizationId, input.organizationId)];
  if (input.status) conditions.push(eq(socialPublishJobs.status, input.status));
  if (input.brandProfileId) conditions.push(eq(marketingContentItems.brandProfileId, input.brandProfileId));
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db
    .select({ job: socialPublishJobs, title: marketingContentItems.title, brandProfileId: marketingContentItems.brandProfileId, accountDisplayName: marketingChannelAccounts.displayName, variantStatus: socialContentVariants.status })
    .from(socialPublishJobs)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialPublishJobs.contentItemId), eq(marketingContentItems.organizationId, socialPublishJobs.organizationId)))
    .innerJoin(socialContentVariants, and(eq(socialContentVariants.id, socialPublishJobs.contentVariantId), eq(socialContentVariants.organizationId, socialPublishJobs.organizationId)))
    .leftJoin(marketingChannelAccounts, and(eq(marketingChannelAccounts.id, socialPublishJobs.channelAccountId), eq(marketingChannelAccounts.organizationId, socialPublishJobs.organizationId)))
    .where(and(...conditions))
    .orderBy(desc(socialPublishJobs.createdAt))
    .limit(limit);
  return rows.map((r) => toJobView(r.job, { title: r.title, brandProfileId: r.brandProfileId, accountDisplayName: r.accountDisplayName, variantStatus: r.variantStatus }));
}

// ---------------------------------------------------------------------------
// Worker entry
// ---------------------------------------------------------------------------

export interface ProcessPublishJobDeps {
  fetchImpl?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  env?: SocialProviderEnv;
  storage?: SocialAssetStorage;
  /** For the signed media delivery URL handed to URL-pulling providers; defaults to `loadAuthEnv()`. */
  assetUrlEnv?: { AUTH_BASE_URL: string; AUTH_SECRET: string };
}

export interface ProcessPublishJobResult extends Record<string, unknown> {
  outcome: "published" | "scheduled_natively" | "skipped" | "cancelled";
  skipped?: boolean;
  externalPostId?: string | null;
}

async function updateJob(db: Db, job: JobRow, set: Partial<typeof socialPublishJobs.$inferInsert>): Promise<JobRow> {
  const [row] = await db
    .update(socialPublishJobs)
    .set({ ...set, revision: job.revision + 1, updatedAt: new Date() })
    .where(and(eq(socialPublishJobs.id, job.id), eq(socialPublishJobs.organizationId, job.organizationId), eq(socialPublishJobs.revision, job.revision)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("publish job");
  return row;
}

function errorDetails(err: unknown): { code: string; message: string; errorClass: string } {
  if (err instanceof SocialProviderError) return { code: err.code, message: sanitize(err.message), errorClass: err.authorizationLost ? "authorization_lost" : err.retryable ? "transient" : "permanent" };
  if (err instanceof Error) {
    const reason = (err as { reason?: unknown }).reason;
    return { code: typeof reason === "string" ? reason : err.name || "error", message: sanitize(err.message), errorClass: "permanent" };
  }
  return { code: "error", message: "unknown failure", errorClass: "permanent" };
}

async function buildMedia(db: Db, organizationId: string, platform: SocialOrganicPlatform, rawMedia: unknown, deps: ProcessPublishJobDeps): Promise<PublishMediaInput[]> {
  const media = socialVariantMediaSchema.safeParse(rawMedia ?? []);
  if (!media.success || !media.data.length) return [];
  const ids = [...new Set(media.data.map((m) => m.assetId))];
  const assets = await db.select().from(socialAssets).where(and(eq(socialAssets.organizationId, organizationId), inArray(socialAssets.id, ids)));
  const byId = new Map(assets.map((a) => [a.id, a]));
  const provider = SOCIAL_PLATFORM_PROVIDER[platform];
  const needsUrl = provider === "meta";
  const needsBytes = provider === "linkedin";
  const urlEnv = needsUrl ? (deps.assetUrlEnv ?? loadAuthEnv()) : null;
  const out: PublishMediaInput[] = [];
  for (const m of [...media.data].sort((a, b) => a.position - b.position)) {
    const asset = byId.get(m.assetId);
    if (!asset || asset.archivedAt) throw new SocialVariantNotPublishableError([`a media item (${m.assetId}) is missing or archived`]);
    const entry: PublishMediaInput = { assetId: asset.id, contentType: asset.contentType, role: m.role, position: m.position, altText: asset.altText || undefined };
    if (asset.storageKind === "external_url" && asset.url) entry.url = asset.url;
    else if (urlEnv) entry.url = assetPublicUrl(urlEnv, asset.id, deps.now?.());
    if (needsBytes) entry.bytes = (await resolveAssetBytes(db, { organizationId, assetId: asset.id, storage: deps.storage, fetchImpl: deps.fetchImpl })).bytes;
    out.push(entry);
  }
  return out;
}

/**
 * Worker entry for `social_publish` (keep the signature: `worker.ts` calls
 * it with `{ organizationId, publishJobId }`). Idempotent and resumable.
 */
export async function processPublishJob(db: Db, input: { organizationId: string; publishJobId: string; runtimeJobId?: string; deps?: ProcessPublishJobDeps }): Promise<ProcessPublishJobResult> {
  const deps = input.deps ?? {};
  const clock = () => (deps.now ? deps.now() : new Date());
  const [loaded] = await db.select().from(socialPublishJobs).where(and(eq(socialPublishJobs.id, input.publishJobId), eq(socialPublishJobs.organizationId, input.organizationId)));
  if (!loaded) return { outcome: "skipped", skipped: true, reason: "not_found" };
  if (loaded.status === "published" || loaded.status === "cancelled" || loaded.status === "failed") return { outcome: "skipped", skipped: true, reason: loaded.status, externalPostId: loaded.externalPostId };

  // Claim. `processing` is accepted too: the runtime only re-delivers a job
  // whose previous lease expired mid-attempt, and provider_state makes the
  // resumed attempt safe.
  const [claimed] = await db
    .update(socialPublishJobs)
    .set({ status: "processing", attemptCount: loaded.attemptCount + 1, startedAt: clock(), revision: loaded.revision + 1, updatedAt: new Date() })
    .where(and(eq(socialPublishJobs.id, loaded.id), eq(socialPublishJobs.organizationId, input.organizationId), eq(socialPublishJobs.revision, loaded.revision), inArray(socialPublishJobs.status, ["queued", "retrying", "processing"])))
    .returning();
  if (!claimed) return { outcome: "skipped", skipped: true, reason: "claim_lost" };
  let job = claimed;

  const [variant] = await db.select().from(socialContentVariants).where(and(eq(socialContentVariants.id, job.contentVariantId), eq(socialContentVariants.organizationId, input.organizationId)));
  if (!variant || variant.archivedAt || !["scheduled", "publishing", "approved"].includes(variant.status)) {
    job = await updateJob(db, job, { status: "cancelled", cancelledAt: clock(), lastErrorCode: "variant_not_publishable", lastErrorMessage: `The post is ${variant ? (variant.archivedAt ? "archived" : variant.status) : "missing"}; nothing was published.` });
    await recordAuditEvent(db, { eventType: "social_publish_job_cancelled", organizationId: input.organizationId, targetType: "social_publish_job", targetId: job.id, metadata: { reason: "variant_not_publishable", variantStatus: variant?.status ?? null } });
    return { outcome: "cancelled", skipped: true };
  }

  const fail = async (err: unknown): Promise<never> => {
    const details = errorDetails(err);
    const state = providerStateFromError(err);
    const retryable = err instanceof SocialProviderError && err.retryable && job.attemptCount < job.maxAttempts;
    const now = clock();
    job = await updateJob(db, job, {
      status: retryable ? "retrying" : "failed",
      ...(state ? { providerState: { ...(job.providerState as Record<string, unknown>), ...state } } : {}),
      lastErrorCode: details.code.slice(0, 100),
      lastErrorMessage: details.message,
      lastErrorClass: details.errorClass,
      ...(retryable ? {} : { failedAt: now }),
    });
    if (!retryable) {
      await recordVariantPublishFailed(db, { organizationId: input.organizationId, contentVariantId: variant.id, code: details.code, message: details.message, publishJobId: job.id });
      if (err instanceof SocialProviderError && err.authorizationLost) await recordAccountError(db, { organizationId: input.organizationId, channelAccountId: job.channelAccountId, code: err.code, message: err.message, authorizationLost: true });
    }
    throw err;
  };

  try {
    // Authority is re-validated at execution time: the requester must still be a member holding marketing_publish.
    if (job.requestedByUserId) {
      let allowed = false;
      try {
        const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: job.requestedByUserId });
        allowed = hasMarketingCapability(ctx, "marketing_publish");
      } catch {
        allowed = false;
      }
      if (!allowed) throw new SocialVariantNotPublishableError(["the person who scheduled this post no longer has publishing authority"]);
    }
    if (!variant.approvedAt) throw new SocialVariantNotPublishableError(["the post has not been approved"]);
    if (variant.channelAccountId !== job.channelAccountId) throw new SocialVariantNotPublishableError(["the post's account changed after it was queued"]);

    if (variant.status !== "publishing") {
      await db.update(socialContentVariants).set({ status: "publishing", revision: variant.revision + 1, updatedAt: new Date() }).where(and(eq(socialContentVariants.id, variant.id), eq(socialContentVariants.organizationId, input.organizationId)));
    }

    const env = deps.env ?? loadEnv();
    const { credential } = await resolveSocialAccountCredential(db, { organizationId: input.organizationId, channelAccountId: job.channelAccountId, deps: { fetchImpl: deps.fetchImpl, now: deps.now, sleep: deps.sleep, env } });
    const platform = socialOrganicPlatformSchema.parse(variant.platform);
    const adapter = resolveAdapterForPlatform(platform, env, { fetchImpl: deps.fetchImpl, now: deps.now, sleep: deps.sleep });
    if (!adapter.publish) throw new SocialProviderNotSupportedError(platform, "publishing");

    const publishInput: PublishInput = {
      platform,
      format: variant.format as SocialVariantFormat,
      body: variant.body,
      hashtags: Array.isArray(variant.hashtags) ? (variant.hashtags as unknown[]).filter((h): h is string => typeof h === "string") : [],
      linkUrl: variant.linkUrl,
      media: await buildMedia(db, input.organizationId, platform, variant.media, deps),
      platformOptions: variant.platformOptions && typeof variant.platformOptions === "object" ? (variant.platformOptions as Record<string, unknown>) : {},
      idempotencyKey: job.idempotencyKey,
      providerState: job.providerState && typeof job.providerState === "object" ? (job.providerState as Record<string, unknown>) : {},
      scheduledFor: job.scheduledFor,
    };
    const result = await adapter.publish(credential, publishInput);

    if (result.outcome === "pending") {
      const exhausted = job.attemptCount >= job.maxAttempts;
      job = await updateJob(db, job, { status: "retrying", providerState: result.providerState ?? publishInput.providerState, lastErrorCode: "pending", lastErrorMessage: "The platform is still processing the media; the publish will be retried.", lastErrorClass: "transient" });
      throw new SocialProviderError(adapter.provider, exhausted ? "pending_timeout" : "pending", exhausted ? "the platform did not finish processing the media in time" : "the platform is still processing the media", { retryable: !exhausted });
    }
    if (!result.externalPostId) throw new SocialProviderError(adapter.provider, "missing_post_id", "the platform did not return a post id", { retryable: false });

    const publishedAt = result.outcome === "scheduled_natively" && job.scheduledFor > clock() ? job.scheduledFor : clock();
    job = await updateJob(db, job, { status: "published", publishedAt, externalPostId: result.externalPostId, externalPostUrl: result.externalPostUrl ?? null, providerState: {}, lastErrorCode: null, lastErrorMessage: null, lastErrorClass: null });
    await recordVariantPublished(db, { organizationId: input.organizationId, contentVariantId: variant.id, externalPostId: result.externalPostId, externalPostUrl: result.externalPostUrl ?? null, publishedAt, publishJobId: job.id });
    await db.update(marketingChannelAccounts).set({ lastSyncAt: new Date(), updatedAt: new Date() }).where(and(eq(marketingChannelAccounts.id, job.channelAccountId), eq(marketingChannelAccounts.organizationId, input.organizationId)));
    return { outcome: result.outcome, externalPostId: result.externalPostId };
  } catch (err) {
    if (job.status === "retrying" && err instanceof SocialProviderError && (err.code === "pending" || err.code === "pending_timeout")) {
      if (err.code === "pending_timeout") {
        job = await updateJob(db, job, { status: "failed", failedAt: clock(), lastErrorCode: "pending_timeout", lastErrorMessage: sanitize(err.message), lastErrorClass: "permanent" });
        await recordVariantPublishFailed(db, { organizationId: input.organizationId, contentVariantId: variant.id, code: err.code, message: err.message, publishJobId: job.id });
      }
      throw err;
    }
    return fail(err);
  }
}

/** Active (queued/processing/retrying) job for a variant, if any. */
export async function findActivePublishJob(db: Db, organizationId: string, contentVariantId: string): Promise<SocialPublishJobView | null> {
  const [row] = await db
    .select()
    .from(socialPublishJobs)
    .where(and(eq(socialPublishJobs.organizationId, organizationId), eq(socialPublishJobs.contentVariantId, contentVariantId), inArray(socialPublishJobs.status, ACTIVE_JOB_STATUSES)));
  return row ? toJobView(row) : null;
}
