import "server-only";
import { and, asc, desc, eq, inArray, isNull, min, sql, count } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmSources, marketingBrandProfiles, marketingChannelAccounts, marketingContentItems, socialContentVariants, socialEngagementItems } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireOrganizationMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { resolveCrmAuthContext, requireCrmManageAuthority } from "@/lib/crm/authz";
import { createLead, getLeadForUser } from "@/lib/crm/leads";
import { getContactForUser } from "@/lib/crm/contacts";
import { resolveMarketingAuthContext, requireMarketingManageConnectionsAuthority, requireMarketingManageEngagementAuthority, requireMarketingViewAuthority } from "@/lib/marketing-os/authz";
import { enqueueJob, type RuntimeJob } from "@/lib/runtime/queue";
import { adapterDepsOf, providerEnvOf, serviceClock, toGenerationDeps, type SocialServiceDeps } from "./analytics-sync";
import { recordAccountError, resolveSocialAccountCredential, type SocialConnectionDeps } from "./connections";
import { InvalidSocialTransitionError, SocialAccountNotConnectedError, SocialEngagementNotRepliableError, SocialProviderError, SocialProviderNotSupportedError, StaleSocialUpdateError } from "./errors";
import { resolveAdapterForPlatform } from "./providers/social/registry";
import { draftEngagementReply } from "./studio";
import { SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORM_PROVIDER, type SocialEngagementStatus, type SocialEngagementType, type SocialPlatform } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type ItemRow = typeof socialEngagementItems.$inferSelect;

/**
 * Module 19 — the unified engagement inbox. Comments, mentions and (where
 * the platform allows) DMs are pulled by `social_engagement_sync`, deduped
 * on (account, type, external id), and triaged by humans. AI drafts are
 * suggestions only: a public reply is sent ONLY by `sendReply`, which is
 * itself the human approval (a person typed or edited the text and pressed
 * send) and requires `marketing_manage_engagement`. High-intent items link
 * to the existing CRM through CRM Core's own services and authority.
 */

const DAY_MS = 24 * 3600 * 1000;
const DEFAULT_ENGAGEMENT_LOOKBACK_DAYS = 14;
const MAX_TEXT = 8000;
const OPEN_STATUSES: readonly SocialEngagementStatus[] = ["new", "needs_reply", "reply_drafted"];

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface EngagementItemView {
  id: string;
  organizationId: string;
  channelAccountId: string;
  accountDisplayName: string | null;
  brandProfileId: string | null;
  brandName: string | null;
  platform: SocialPlatform;
  platformLabel: string;
  contentVariantId: string | null;
  postTitle: string | null;
  itemType: SocialEngagementType;
  status: SocialEngagementStatus;
  externalId: string;
  externalParentId: string | null;
  externalPostId: string | null;
  externalUrl: string | null;
  authorExternalId: string | null;
  authorName: string | null;
  authorHandle: string | null;
  text: string;
  postedAt: Date;
  sentiment: string | null;
  category: string | null;
  isLead: boolean;
  crmLeadId: string | null;
  crmContactId: string | null;
  assignedUserId: string | null;
  replyDraft: string | null;
  replyDraftGenerationId: string | null;
  replyText: string | null;
  repliedAt: Date | null;
  repliedByUserId: string | null;
  externalReplyId: string | null;
  hiddenAt: Date | null;
  /** Whether this build can reply to this item through an official API (comments on Facebook/Instagram/LinkedIn). */
  canReply: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const REPLY_SUPPORTED_PLATFORMS: readonly SocialPlatform[] = ["facebook", "instagram", "linkedin"];

function toView(row: ItemRow, extra: { accountDisplayName: string | null; brandProfileId: string | null; brandName: string | null; postTitle: string | null }): EngagementItemView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channelAccountId: row.channelAccountId,
    accountDisplayName: extra.accountDisplayName,
    brandProfileId: extra.brandProfileId,
    brandName: extra.brandName,
    platform: row.platform,
    platformLabel: SOCIAL_PLATFORM_LABELS[row.platform],
    contentVariantId: row.contentVariantId,
    postTitle: extra.postTitle,
    itemType: row.itemType,
    status: row.status,
    externalId: row.externalId,
    externalParentId: row.externalParentId,
    externalPostId: row.externalPostId,
    externalUrl: row.externalUrl,
    authorExternalId: row.authorExternalId,
    authorName: row.authorName,
    authorHandle: row.authorHandle,
    text: row.text,
    postedAt: row.postedAt,
    sentiment: row.sentiment,
    category: row.category,
    isLead: row.isLead,
    crmLeadId: row.crmLeadId,
    crmContactId: row.crmContactId,
    assignedUserId: row.assignedUserId,
    replyDraft: row.replyDraft,
    replyDraftGenerationId: row.replyDraftGenerationId,
    replyText: row.replyText,
    repliedAt: row.repliedAt,
    repliedByUserId: row.repliedByUserId,
    externalReplyId: row.externalReplyId,
    hiddenAt: row.hiddenAt,
    canReply: row.itemType === "comment" && REPLY_SUPPORTED_PLATFORMS.includes(row.platform) && row.status !== "replied" && row.status !== "hidden",
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function selectWithContext(db: Db) {
  return db
    .select({ item: socialEngagementItems, accountDisplayName: marketingChannelAccounts.displayName, brandProfileId: marketingChannelAccounts.brandProfileId, brandName: marketingBrandProfiles.name, postTitle: marketingContentItems.title })
    .from(socialEngagementItems)
    .leftJoin(marketingChannelAccounts, and(eq(marketingChannelAccounts.id, socialEngagementItems.channelAccountId), eq(marketingChannelAccounts.organizationId, socialEngagementItems.organizationId)))
    .leftJoin(marketingBrandProfiles, and(eq(marketingBrandProfiles.id, marketingChannelAccounts.brandProfileId), eq(marketingBrandProfiles.organizationId, marketingChannelAccounts.organizationId)))
    .leftJoin(socialContentVariants, and(eq(socialContentVariants.id, socialEngagementItems.contentVariantId), eq(socialContentVariants.organizationId, socialEngagementItems.organizationId)))
    .leftJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)));
}

async function resolveItem(db: Db, organizationId: string, engagementItemId: string): Promise<ItemRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(socialEngagementItems).where(and(eq(socialEngagementItems.id, engagementItemId), eq(socialEngagementItems.organizationId, organizationId)));
    return row;
  });
}

async function itemView(db: Db, organizationId: string, engagementItemId: string): Promise<EngagementItemView> {
  const [r] = await selectWithContext(db).where(and(eq(socialEngagementItems.id, engagementItemId), eq(socialEngagementItems.organizationId, organizationId)));
  if (!r) return toView(await resolveItem(db, organizationId, engagementItemId), { accountDisplayName: null, brandProfileId: null, brandName: null, postTitle: null });
  return toView(r.item, { accountDisplayName: r.accountDisplayName, brandProfileId: r.brandProfileId, brandName: r.brandName, postTitle: r.postTitle });
}

// ---------------------------------------------------------------------------
// Sync (worker entry)
// ---------------------------------------------------------------------------

export interface SyncEngagementResult extends Record<string, unknown> {
  fetched: number;
  inserted: number;
  skippedOwn: number;
}

function metadataOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Worker entry (`social_engagement_sync:<channelAccountId>`). Cursor: `account.metadata.engagementSyncedAt`. */
export async function syncAccountEngagement(db: Db, input: { organizationId: string; channelAccountId: string; runtimeJobId?: string; deps?: SocialConnectionDeps }): Promise<SyncEngagementResult> {
  const { account, credential, provider } = await resolveSocialAccountCredential(db, { organizationId: input.organizationId, channelAccountId: input.channelAccountId, deps: input.deps });
  const platform = account.platform as SocialPlatform;
  const adapter = resolveAdapterForPlatform(platform, providerEnvOf(input.deps), adapterDepsOf(input.deps));
  if (!adapter.fetchEngagement) throw new SocialProviderNotSupportedError(platform, "engagement sync");
  const now = serviceClock(input.deps);
  const metadata = metadataOf(account.metadata);
  const cursorRaw = typeof metadata.engagementSyncedAt === "string" ? new Date(metadata.engagementSyncedAt) : null;
  const since = cursorRaw && !Number.isNaN(cursorRaw.getTime()) ? cursorRaw : new Date(now.getTime() - DEFAULT_ENGAGEMENT_LOOKBACK_DAYS * DAY_MS);

  let fetched;
  try {
    fetched = await adapter.fetchEngagement(credential, { since });
  } catch (err) {
    if (err instanceof SocialProviderError) await recordAccountError(db, { organizationId: input.organizationId, channelAccountId: account.id, code: err.code, message: err.message, authorizationLost: err.authorizationLost });
    throw err;
  }

  const own = account.externalAccountId;
  const candidates = fetched.filter((i) => !(own && i.authorExternalId && i.authorExternalId === own));
  const skippedOwn = fetched.length - candidates.length;
  const postIds = [...new Set(candidates.map((i) => i.externalPostId).filter((p): p is string => Boolean(p)))];
  const variants = postIds.length
    ? await db
        .select({ id: socialContentVariants.id, externalPostId: socialContentVariants.externalPostId })
        .from(socialContentVariants)
        .where(and(eq(socialContentVariants.organizationId, input.organizationId), inArray(socialContentVariants.externalPostId, postIds)))
    : [];
  const variantByPost = new Map(variants.map((v) => [v.externalPostId as string, v.id]));

  let inserted = 0;
  if (candidates.length) {
    const rows = candidates.map((i) => ({
      organizationId: input.organizationId,
      channelAccountId: account.id,
      platform,
      contentVariantId: i.externalPostId ? (variantByPost.get(i.externalPostId) ?? null) : null,
      itemType: i.itemType,
      status: "new" as const,
      externalId: i.externalId.slice(0, 300),
      externalParentId: i.externalParentId ?? null,
      externalPostId: i.externalPostId ?? null,
      externalUrl: i.externalUrl ?? null,
      authorExternalId: i.authorExternalId ?? null,
      authorName: i.authorName?.slice(0, 300) ?? null,
      authorHandle: i.authorHandle?.slice(0, 300) ?? null,
      text: (i.text ?? "").slice(0, MAX_TEXT),
      postedAt: i.postedAt,
      metadata: i.metadata ?? {},
    }));
    for (let k = 0; k < rows.length; k += 100) {
      const res = await db.insert(socialEngagementItems).values(rows.slice(k, k + 100)).onConflictDoNothing().returning({ id: socialEngagementItems.id });
      inserted += res.length;
    }
  }

  await db
    .update(marketingChannelAccounts)
    .set({ metadata: sql`${marketingChannelAccounts.metadata} || ${JSON.stringify({ engagementSyncedAt: now.toISOString() })}::jsonb`, updatedAt: now })
    .where(and(eq(marketingChannelAccounts.id, account.id), eq(marketingChannelAccounts.organizationId, input.organizationId)));
  await recordAuditEvent(db, { eventType: "social_engagement_synced", organizationId: input.organizationId, targetType: "marketing_channel_account", targetId: account.id, metadata: { platform, provider, fetched: fetched.length, inserted, skippedOwn, since: since.toISOString(), runtimeJobId: input.runtimeJobId ?? null } });
  return { fetched: fetched.length, inserted, skippedOwn };
}

/** Internal enqueue (callers check authority). */
export async function enqueueEngagementSyncJob(db: Db, input: { organizationId: string; channelAccountId: string }): Promise<RuntimeJob> {
  return enqueueJob(db, { organizationId: input.organizationId, jobType: "social_engagement_sync", idempotencyKey: `social_engagement_sync:${input.channelAccountId}`, maxAttempts: 3 });
}

/** "Sync inbox now" — requires `marketing_manage_connections` (same as metrics sync). */
export async function requestEngagementSync(db: Db, input: { organizationId: string; channelAccountId: string; actorUserId: string }): Promise<{ jobId: string; status: string }> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageConnectionsAuthority(db, ctx, "marketing_channel_account", input.channelAccountId);
  const account = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select({ id: marketingChannelAccounts.id, connectionStatus: marketingChannelAccounts.connectionStatus, platform: marketingChannelAccounts.platform })
      .from(marketingChannelAccounts)
      .where(and(eq(marketingChannelAccounts.id, input.channelAccountId), eq(marketingChannelAccounts.organizationId, input.organizationId), isNull(marketingChannelAccounts.archivedAt)));
    return row;
  });
  if (account.connectionStatus !== "connected") throw new SocialAccountNotConnectedError(account.connectionStatus);
  if (!SOCIAL_PLATFORM_PROVIDER[account.platform as SocialPlatform]) throw new SocialProviderNotSupportedError(account.platform, "engagement sync");
  const job = await enqueueEngagementSyncJob(db, { organizationId: input.organizationId, channelAccountId: account.id });
  return { jobId: job.id, status: job.status };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listEngagementItems(
  db: Db,
  input: { organizationId: string; actorUserId: string; brandProfileId?: string; platform?: SocialPlatform; status?: SocialEngagementStatus; itemType?: SocialEngagementType; assignedUserId?: string; isLead?: boolean; limit?: number },
): Promise<EngagementItemView[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_engagement_item", "list");
  const conditions = [eq(socialEngagementItems.organizationId, input.organizationId)];
  if (input.brandProfileId) conditions.push(eq(marketingChannelAccounts.brandProfileId, input.brandProfileId));
  if (input.platform) conditions.push(eq(socialEngagementItems.platform, input.platform));
  if (input.status) conditions.push(eq(socialEngagementItems.status, input.status));
  if (input.itemType) conditions.push(eq(socialEngagementItems.itemType, input.itemType));
  if (input.assignedUserId) conditions.push(eq(socialEngagementItems.assignedUserId, input.assignedUserId));
  if (input.isLead !== undefined) conditions.push(eq(socialEngagementItems.isLead, input.isLead));
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await selectWithContext(db).where(and(...conditions)).orderBy(desc(socialEngagementItems.postedAt)).limit(limit);
  return rows.map((r) => toView(r.item, { accountDisplayName: r.accountDisplayName, brandProfileId: r.brandProfileId, brandName: r.brandName, postTitle: r.postTitle }));
}

export async function getEngagementItemForUser(db: Db, input: { organizationId: string; engagementItemId: string; actorUserId: string }): Promise<EngagementItemView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_engagement_item", input.engagementItemId);
  await resolveItem(db, input.organizationId, input.engagementItemId);
  return itemView(db, input.organizationId, input.engagementItemId);
}

export interface InboxSummary {
  byStatus: Record<SocialEngagementStatus, number>;
  total: number;
  needsReplyCount: number;
  leadsCount: number;
  oldestUnansweredAt: Date | null;
}

export async function getInboxSummary(db: Db, input: { organizationId: string; actorUserId: string; brandProfileId?: string }): Promise<InboxSummary> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_engagement_item", "summary");
  return computeInboxSummary(db, input);
}

/** Internal (no authority check) — used by attention/overview after their own check. */
export async function computeInboxSummary(db: Db, input: { organizationId: string; brandProfileId?: string | null }): Promise<InboxSummary> {
  const conditions = [eq(socialEngagementItems.organizationId, input.organizationId)];
  if (input.brandProfileId) conditions.push(eq(marketingChannelAccounts.brandProfileId, input.brandProfileId));
  const rows = await db
    .select({ status: socialEngagementItems.status, isLead: socialEngagementItems.isLead, n: count(), oldest: min(socialEngagementItems.postedAt) })
    .from(socialEngagementItems)
    .innerJoin(marketingChannelAccounts, and(eq(marketingChannelAccounts.id, socialEngagementItems.channelAccountId), eq(marketingChannelAccounts.organizationId, socialEngagementItems.organizationId)))
    .where(and(...conditions))
    .groupBy(socialEngagementItems.status, socialEngagementItems.isLead);
  const byStatus: Record<SocialEngagementStatus, number> = { new: 0, needs_reply: 0, reply_drafted: 0, replied: 0, ignored: 0, hidden: 0, escalated: 0 };
  let leadsCount = 0;
  let oldest: Date | null = null;
  for (const r of rows) {
    const n = Number(r.n);
    byStatus[r.status] += n;
    if (r.isLead) leadsCount += n;
    if (OPEN_STATUSES.includes(r.status) && r.oldest) {
      const d = r.oldest instanceof Date ? r.oldest : new Date(r.oldest as unknown as string);
      if (!oldest || d.getTime() < oldest.getTime()) oldest = d;
    }
  }
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return { byStatus, total, needsReplyCount: byStatus.new + byStatus.needs_reply + byStatus.reply_drafted, leadsCount, oldestUnansweredAt: oldest };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function requireEngage(db: Db, input: { organizationId: string; actorUserId: string }, engagementItemId: string) {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageEngagementAuthority(db, ctx, "social_engagement_item", engagementItemId);
  return ctx;
}

async function casItem(db: Db, row: ItemRow, expectedRevision: number, set: Partial<typeof socialEngagementItems.$inferInsert>): Promise<ItemRow> {
  if (row.revision !== expectedRevision) throw new StaleSocialUpdateError("engagement item");
  const [updated] = await db
    .update(socialEngagementItems)
    .set({ ...set, revision: expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(socialEngagementItems.id, row.id), eq(socialEngagementItems.organizationId, row.organizationId), eq(socialEngagementItems.revision, expectedRevision)))
    .returning();
  if (!updated) throw new StaleSocialUpdateError("engagement item");
  return updated;
}

const DRAFTABLE: readonly SocialEngagementStatus[] = ["new", "needs_reply", "reply_drafted", "escalated"];

/** Drafts a suggested reply (never sends). Requires `marketing_manage_engagement` (and the studio's `marketing_generate_content`). */
export async function draftReply(db: Db, input: { organizationId: string; engagementItemId: string; actorUserId: string; deps?: SocialServiceDeps }): Promise<EngagementItemView> {
  await requireEngage(db, input, input.engagementItemId);
  const item = await resolveItem(db, input.organizationId, input.engagementItemId);
  if (!DRAFTABLE.includes(item.status)) throw new InvalidSocialTransitionError("engagement item", item.status, "reply_drafted");
  const [account] = await db.select({ brandProfileId: marketingChannelAccounts.brandProfileId }).from(marketingChannelAccounts).where(and(eq(marketingChannelAccounts.id, item.channelAccountId), eq(marketingChannelAccounts.organizationId, input.organizationId)));
  if (!account) throw new SocialAccountNotConnectedError("missing");
  let postContext: string | undefined;
  if (item.contentVariantId) {
    const [v] = await db.select({ hook: socialContentVariants.hook, body: socialContentVariants.body }).from(socialContentVariants).where(and(eq(socialContentVariants.id, item.contentVariantId), eq(socialContentVariants.organizationId, input.organizationId)));
    if (v) postContext = [v.hook, v.body].filter(Boolean).join("\n").slice(0, 1500) || undefined;
  }
  const draft = await draftEngagementReply(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    brandProfileId: account.brandProfileId,
    item: { platform: item.platform, itemType: item.itemType, authorName: item.authorName ?? item.authorHandle ?? "someone", text: item.text, postContext },
    deps: toGenerationDeps(input.deps),
  });
  // Re-read for the CAS: the model call may have taken a while.
  const fresh = await resolveItem(db, input.organizationId, item.id);
  if (!DRAFTABLE.includes(fresh.status)) throw new InvalidSocialTransitionError("engagement item", fresh.status, "reply_drafted");
  const row = await casItem(db, fresh, fresh.revision, { replyDraft: draft.reply || null, replyDraftGenerationId: draft.generationId, sentiment: draft.sentiment, category: draft.category, isLead: fresh.isLead || draft.isLead, status: fresh.status === "new" || fresh.status === "needs_reply" ? "reply_drafted" : fresh.status });
  await recordAuditEvent(db, { eventType: "social_engagement_reply_drafted", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_engagement_item", targetId: row.id, metadata: { generationId: draft.generationId, sentiment: draft.sentiment, category: draft.category, isLead: row.isLead } });
  return itemView(db, input.organizationId, row.id);
}

/** Sends a public reply. This call IS the human approval: a person typed/edited the text and pressed send. */
export async function sendReply(db: Db, input: { organizationId: string; engagementItemId: string; actorUserId: string; expectedRevision: number; text: string; deps?: SocialServiceDeps }): Promise<EngagementItemView> {
  await requireEngage(db, input, input.engagementItemId);
  const item = await resolveItem(db, input.organizationId, input.engagementItemId);
  if (item.revision !== input.expectedRevision) throw new StaleSocialUpdateError("engagement item");
  if (item.status === "replied") throw new SocialEngagementNotRepliableError("a reply was already sent");
  if (item.status === "hidden") throw new SocialEngagementNotRepliableError("the item is hidden");
  const text = input.text.trim();
  if (!text) throw new SocialEngagementNotRepliableError("the reply is empty");
  const max = item.platform === "x" ? 280 : 8000;
  if (text.length > max) throw new SocialEngagementNotRepliableError(`the reply is longer than ${max} characters`);

  const { credential } = await resolveSocialAccountCredential(db, { organizationId: input.organizationId, channelAccountId: item.channelAccountId, deps: input.deps });
  const adapter = resolveAdapterForPlatform(item.platform, providerEnvOf(input.deps), adapterDepsOf(input.deps));
  if (!adapter.replyToEngagement) throw new SocialProviderNotSupportedError(item.platform, "replies");
  let externalReplyId: string;
  try {
    ({ externalReplyId } = await adapter.replyToEngagement(credential, { itemType: item.itemType, externalId: item.externalId, externalPostId: item.externalPostId }, text));
  } catch (err) {
    if (err instanceof SocialProviderError) await recordAccountError(db, { organizationId: input.organizationId, channelAccountId: item.channelAccountId, code: err.code, message: err.message, authorizationLost: err.authorizationLost });
    throw err;
  }
  const now = serviceClock(input.deps);
  const set = { replyText: text, repliedAt: now, repliedByUserId: input.actorUserId, externalReplyId, status: "replied" as const };
  let [row] = await db
    .update(socialEngagementItems)
    .set({ ...set, revision: input.expectedRevision + 1, updatedAt: now })
    .where(and(eq(socialEngagementItems.id, item.id), eq(socialEngagementItems.organizationId, input.organizationId), eq(socialEngagementItems.revision, input.expectedRevision)))
    .returning();
  if (!row) {
    // The reply is already public — record it even though someone else touched the item meanwhile.
    const current = await resolveItem(db, input.organizationId, item.id);
    [row] = await db.update(socialEngagementItems).set({ ...set, revision: current.revision + 1, updatedAt: now }).where(and(eq(socialEngagementItems.id, item.id), eq(socialEngagementItems.organizationId, input.organizationId))).returning();
  }
  await recordAuditEvent(db, { eventType: "social_engagement_replied", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_engagement_item", targetId: item.id, metadata: { platform: item.platform, externalReplyId, usedDraft: Boolean(item.replyDraft && item.replyDraft.trim() === text) } });
  return itemView(db, input.organizationId, row.id);
}

export async function hideItem(db: Db, input: { organizationId: string; engagementItemId: string; actorUserId: string; expectedRevision: number; deps?: SocialServiceDeps }): Promise<EngagementItemView> {
  await requireEngage(db, input, input.engagementItemId);
  const item = await resolveItem(db, input.organizationId, input.engagementItemId);
  if (item.revision !== input.expectedRevision) throw new StaleSocialUpdateError("engagement item");
  if (item.status === "hidden") return itemView(db, input.organizationId, item.id);
  const { credential } = await resolveSocialAccountCredential(db, { organizationId: input.organizationId, channelAccountId: item.channelAccountId, deps: input.deps });
  const adapter = resolveAdapterForPlatform(item.platform, providerEnvOf(input.deps), adapterDepsOf(input.deps));
  if (!adapter.hideEngagement) throw new SocialProviderNotSupportedError(item.platform, "hiding comments");
  try {
    await adapter.hideEngagement(credential, { itemType: item.itemType, externalId: item.externalId });
  } catch (err) {
    if (err instanceof SocialProviderError) await recordAccountError(db, { organizationId: input.organizationId, channelAccountId: item.channelAccountId, code: err.code, message: err.message, authorizationLost: err.authorizationLost });
    throw err;
  }
  const row = await casItem(db, item, input.expectedRevision, { status: "hidden", hiddenAt: serviceClock(input.deps) });
  await recordAuditEvent(db, { eventType: "social_engagement_hidden", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_engagement_item", targetId: row.id, metadata: { platform: item.platform, from: item.status } });
  return itemView(db, input.organizationId, row.id);
}

const STATUS_TRANSITIONS: Record<"ignored" | "needs_reply" | "escalated", readonly SocialEngagementStatus[]> = {
  ignored: ["new", "needs_reply", "reply_drafted", "escalated"],
  needs_reply: ["new", "ignored", "reply_drafted", "escalated"],
  escalated: ["new", "needs_reply", "reply_drafted", "ignored"],
};

async function setStatus(db: Db, input: { organizationId: string; engagementItemId: string; actorUserId: string; expectedRevision: number }, to: "ignored" | "needs_reply" | "escalated"): Promise<EngagementItemView> {
  await requireEngage(db, input, input.engagementItemId);
  const item = await resolveItem(db, input.organizationId, input.engagementItemId);
  if (!STATUS_TRANSITIONS[to].includes(item.status)) throw new InvalidSocialTransitionError("engagement item", item.status, to);
  const row = await casItem(db, item, input.expectedRevision, { status: to });
  await recordAuditEvent(db, { eventType: "social_engagement_status_changed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_engagement_item", targetId: row.id, metadata: { from: item.status, to } });
  return itemView(db, input.organizationId, row.id);
}

export async function ignoreItem(db: Db, input: { organizationId: string; engagementItemId: string; actorUserId: string; expectedRevision: number }): Promise<EngagementItemView> {
  return setStatus(db, input, "ignored");
}

export async function markNeedsReply(db: Db, input: { organizationId: string; engagementItemId: string; actorUserId: string; expectedRevision: number }): Promise<EngagementItemView> {
  return setStatus(db, input, "needs_reply");
}

export async function escalateItem(db: Db, input: { organizationId: string; engagementItemId: string; actorUserId: string; expectedRevision: number }): Promise<EngagementItemView> {
  return setStatus(db, input, "escalated");
}

export async function assignItem(db: Db, input: { organizationId: string; engagementItemId: string; actorUserId: string; expectedRevision: number; assignedUserId: string | null }): Promise<EngagementItemView> {
  await requireEngage(db, input, input.engagementItemId);
  const item = await resolveItem(db, input.organizationId, input.engagementItemId);
  if (input.assignedUserId) await requireOrganizationMembership(db, input.organizationId, input.assignedUserId);
  const row = await casItem(db, item, input.expectedRevision, { assignedUserId: input.assignedUserId });
  await recordAuditEvent(db, { eventType: "social_engagement_assigned", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_engagement_item", targetId: row.id, metadata: { assignedUserId: input.assignedUserId, previous: item.assignedUserId } });
  return itemView(db, input.organizationId, row.id);
}

export async function flagLead(db: Db, input: { organizationId: string; engagementItemId: string; actorUserId: string; expectedRevision: number; isLead: boolean }): Promise<EngagementItemView> {
  await requireEngage(db, input, input.engagementItemId);
  const item = await resolveItem(db, input.organizationId, input.engagementItemId);
  const row = await casItem(db, item, input.expectedRevision, { isLead: input.isLead });
  await recordAuditEvent(db, { eventType: "social_engagement_flagged_lead", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_engagement_item", targetId: row.id, metadata: { isLead: input.isLead } });
  return itemView(db, input.organizationId, row.id);
}

/** Idempotently ensures the org's `social_<platform>` CRM source (type `social`) and returns its id. Caller has already passed CRM manage authority. */
async function ensureSocialCrmSource(db: Db, organizationId: string, platform: SocialPlatform): Promise<string> {
  const sourceKey = `social_${platform}`;
  await db.insert(crmSources).values({ organizationId, sourceKey, name: `Social — ${SOCIAL_PLATFORM_LABELS[platform]}`, sourceType: "social", description: "Leads captured from the Social Command Center engagement inbox." }).onConflictDoNothing();
  const [row] = await db.select({ id: crmSources.id }).from(crmSources).where(and(eq(crmSources.organizationId, organizationId), eq(crmSources.sourceKey, sourceKey)));
  if (!row) throw new Error(`CRM source ${sourceKey} could not be ensured`);
  return row.id;
}

/**
 * Links an engagement item to the existing CRM. Requires
 * `marketing_manage_engagement` AND CRM Core's own authority (enforced by
 * `createLead` / `getLeadForUser` / `getContactForUser` themselves).
 */
export async function linkToCrm(
  db: Db,
  input: { organizationId: string; engagementItemId: string; actorUserId: string; expectedRevision: number; mode: "create_lead" | "existing_lead" | "existing_contact"; leadId?: string; contactId?: string; deps?: SocialServiceDeps },
): Promise<EngagementItemView> {
  await requireEngage(db, input, input.engagementItemId);
  const item = await resolveItem(db, input.organizationId, input.engagementItemId);
  if (item.revision !== input.expectedRevision) throw new StaleSocialUpdateError("engagement item");
  let crmLeadId = item.crmLeadId;
  let crmContactId = item.crmContactId;
  if (input.mode === "create_lead") {
    const crmCtx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
    await requireCrmManageAuthority(db, crmCtx, "crm_lead", "new");
    const sourceId = await ensureSocialCrmSource(db, input.organizationId, item.platform);
    const who = item.authorName ?? item.authorHandle ?? "unknown author";
    const lead = await createLead(db, {
      organizationId: input.organizationId,
      contactId: item.crmContactId,
      sourceId,
      qualificationNotes: `${SOCIAL_PLATFORM_LABELS[item.platform]} ${item.itemType.replace(/_/g, " ")} from ${who}${item.externalUrl ? ` (${item.externalUrl})` : ""}: "${item.text.slice(0, 1000)}"`,
      nextAction: "Reply and qualify",
      idempotencyKey: `social_engagement:${item.id}`,
      actorUserId: input.actorUserId,
    });
    crmLeadId = lead.id;
  } else if (input.mode === "existing_lead") {
    if (!input.leadId) throw new SocialEngagementNotRepliableError("choose a lead to link");
    const lead = await getLeadForUser(db, { organizationId: input.organizationId, leadId: input.leadId, actorUserId: input.actorUserId });
    crmLeadId = lead.id;
    if (!crmContactId && lead.contactId) crmContactId = lead.contactId;
  } else {
    if (!input.contactId) throw new SocialEngagementNotRepliableError("choose a contact to link");
    const contact = await getContactForUser(db, { organizationId: input.organizationId, contactId: input.contactId, actorUserId: input.actorUserId });
    crmContactId = contact.id;
  }
  const row = await casItem(db, item, input.expectedRevision, { crmLeadId, crmContactId, isLead: input.mode === "existing_contact" ? item.isLead : true });
  await recordAuditEvent(db, { eventType: "social_engagement_linked_crm", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_engagement_item", targetId: row.id, metadata: { mode: input.mode, crmLeadId, crmContactId } });
  return itemView(db, input.organizationId, row.id);
}

/** Open items oldest-first (internal — automation `reply_drafts`). */
export async function listItemsAwaitingDraft(db: Db, input: { organizationId: string; brandProfileId?: string | null; limit: number }): Promise<{ id: string }[]> {
  const conditions = [eq(socialEngagementItems.organizationId, input.organizationId), eq(socialEngagementItems.status, "new"), isNull(socialEngagementItems.replyDraft), eq(socialEngagementItems.itemType, "comment")];
  if (input.brandProfileId) conditions.push(eq(marketingChannelAccounts.brandProfileId, input.brandProfileId));
  return db
    .select({ id: socialEngagementItems.id })
    .from(socialEngagementItems)
    .innerJoin(marketingChannelAccounts, and(eq(marketingChannelAccounts.id, socialEngagementItems.channelAccountId), eq(marketingChannelAccounts.organizationId, socialEngagementItems.organizationId)))
    .where(and(...conditions))
    .orderBy(asc(socialEngagementItems.postedAt))
    .limit(input.limit);
}
