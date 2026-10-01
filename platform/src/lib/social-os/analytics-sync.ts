import "server-only";
import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingChannelAccounts, marketingContentPerformanceSnapshots, socialAccountMetricSnapshots, socialAdCampaignSnapshots, socialContentVariants } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { loadEnv } from "@/lib/env";
import { resolveMarketingAuthContext, requireMarketingManageConnectionsAuthority } from "@/lib/marketing-os/authz";
import { enqueueJob, type RuntimeJob } from "@/lib/runtime/queue";
import { recordAccountError, resolveSocialAccountCredential, type SocialConnectionDeps } from "./connections";
import { SocialAccountNotConnectedError, SocialProviderError, SocialProviderNotSupportedError } from "./errors";
import type { SocialGenerationDeps } from "./generation";
import { resolveAdapterForPlatform, type SocialProviderEnv } from "./providers/social/registry";
import type { AccountInsights, PostInsights } from "./providers/social/types";
import type { SocialAiEnv } from "./providers/ai/http";
import type { TextProvider } from "./providers/ai/types";
import { isAdPlatform, isOrganicPlatform, type SocialPlatform } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Module 19 — provider metrics ingestion (worker entry `social_metrics_sync`).
 *
 * Honesty rules: only values the provider actually returned are written.
 * Account-level snapshots keep `null` for anything missing; post-level
 * snapshots (whose counter columns are NOT NULL DEFAULT 0 for the manual
 * path) record the provider-returned subset in `extraMetrics.provided`, so
 * the analytics read model can tell "0" from "not provided".
 *
 * Periods are aligned to UTC day boundaries so a second sync on the same
 * day upserts the same account/campaign period instead of adding a
 * near-duplicate row.
 */

/** Shared dependency bag for the Slice D services: provider HTTP + clock (connections) and the AI text provider (studio). */
export interface SocialServiceDeps extends SocialConnectionDeps {
  textProvider?: TextProvider;
  /** AI provider keys; defaults to `loadSocialAiEnv()` inside the generation layer. */
  aiEnv?: SocialAiEnv;
}

/** Maps the Slice D deps onto the generation layer's deps (whose `now` is a Date, not a clock). */
export function toGenerationDeps(deps?: SocialServiceDeps): SocialGenerationDeps | undefined {
  if (!deps) return undefined;
  const out: SocialGenerationDeps = {};
  if (deps.textProvider) out.textProvider = deps.textProvider;
  if (deps.aiEnv) out.env = deps.aiEnv;
  if (deps.now) out.now = deps.now();
  return out;
}

export function serviceClock(deps?: { now?: () => Date }): Date {
  return deps?.now ? deps.now() : new Date();
}

export function providerEnvOf(deps?: SocialConnectionDeps): SocialProviderEnv {
  return deps?.env ?? loadEnv();
}

export function adapterDepsOf(deps?: SocialConnectionDeps) {
  return { fetchImpl: deps?.fetchImpl, now: deps?.now, sleep: deps?.sleep };
}

const DAY_MS = 24 * 3600 * 1000;
const ACCOUNT_WINDOW_DAYS = 28;
const POST_LOOKBACK_DAYS = 90;
const AD_WINDOW_DAYS = 30;
const POST_CHUNK = 25;
const INT_MAX = 2_147_483_647;

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Integer-safe metric value (columns are int4). Non-finite → undefined. */
export function toMetricInt(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(Math.min(Math.round(value), INT_MAX), -INT_MAX);
}

const POST_COUNTERS = ["impressions", "reach", "views", "likes", "comments", "shares", "saves", "clicks"] as const;
export type PostCounter = (typeof POST_COUNTERS)[number];

/** The provider-returned subset of the fixed post counters, as stored in `extraMetrics.provided`. Pure. */
export function providedPostCounters(insights: PostInsights): Partial<Record<PostCounter, number>> {
  const out: Partial<Record<PostCounter, number>> = {};
  for (const key of POST_COUNTERS) {
    const v = toMetricInt(insights[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Account snapshot column values — `null` for anything the provider did not return. Pure. */
export function accountSnapshotValues(insights: AccountInsights) {
  const pick = (v: number | undefined) => toMetricInt(v) ?? null;
  const extra: Record<string, number> = {};
  for (const [k, v] of Object.entries(insights.extra ?? {})) if (typeof v === "number" && Number.isFinite(v)) extra[k] = v;
  return {
    followers: pick(insights.followers),
    reach: pick(insights.reach),
    impressions: pick(insights.impressions),
    views: pick(insights.views),
    engagements: pick(insights.engagements),
    profileViews: pick(insights.profileViews),
    websiteClicks: pick(insights.websiteClicks),
    metrics: extra,
  };
}

export interface SyncAccountMetricsResult extends Record<string, unknown> {
  accountMetrics: boolean;
  postSnapshots: number;
  adCampaigns: number;
  /** Sections the platform does not support through its official API (skipped, not failed). */
  unsupported?: string[];
}

/** Worker entry (`social_metrics_sync:<channelAccountId>`). */
export async function syncAccountMetrics(db: Db, input: { organizationId: string; channelAccountId: string; runtimeJobId?: string; deps?: SocialConnectionDeps }): Promise<SyncAccountMetricsResult> {
  const resolved = await resolveSocialAccountCredential(db, { organizationId: input.organizationId, channelAccountId: input.channelAccountId, deps: input.deps });
  const { account, credential, provider } = resolved;
  const platform = account.platform as SocialPlatform;
  const adapter = resolveAdapterForPlatform(platform, providerEnvOf(input.deps), adapterDepsOf(input.deps));
  const now = serviceClock(input.deps);
  const today = startOfUtcDay(now);
  const source = `synced:${provider}`;
  const result: SyncAccountMetricsResult = { accountMetrics: false, postSnapshots: 0, adCampaigns: 0 };
  const unsupported: string[] = [];
  /** A capability the platform lacks (e.g. insights for a LinkedIn member profile) skips that section instead of failing the sync. */
  const supported = async <T>(section: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof SocialProviderNotSupportedError) {
        unsupported.push(section);
        return null;
      }
      throw err;
    }
  };

  try {
    // (a) account insights
    if (isOrganicPlatform(platform) && adapter.fetchAccountInsights) {
      const range = { since: new Date(today.getTime() - ACCOUNT_WINDOW_DAYS * DAY_MS), until: today };
      const fetchAccountInsights = adapter.fetchAccountInsights;
      const insights = await supported("account_insights", () => fetchAccountInsights(credential, range));
      if (insights) {
        const values = accountSnapshotValues(insights);
        const periodStart = range.since;
        const periodEnd = range.until;
        await db
          .insert(socialAccountMetricSnapshots)
          .values({ organizationId: input.organizationId, channelAccountId: account.id, platform, capturedAt: now, periodStart, periodEnd, source, ...values })
          .onConflictDoUpdate({
            target: [socialAccountMetricSnapshots.channelAccountId, socialAccountMetricSnapshots.source, socialAccountMetricSnapshots.periodStart, socialAccountMetricSnapshots.periodEnd],
            set: { capturedAt: now, ...values },
          });
        result.accountMetrics = true;
      }
    }

    // (b) post insights for published variants of this account
    if (isOrganicPlatform(platform) && adapter.fetchPostInsights) {
      const variants = await db
        .select({ id: socialContentVariants.id, contentItemId: socialContentVariants.contentItemId, externalPostId: socialContentVariants.externalPostId })
        .from(socialContentVariants)
        .where(
          and(
            eq(socialContentVariants.organizationId, input.organizationId),
            eq(socialContentVariants.channelAccountId, account.id),
            eq(socialContentVariants.status, "published"),
            isNotNull(socialContentVariants.externalPostId),
            gte(socialContentVariants.publishedAt, new Date(now.getTime() - POST_LOOKBACK_DAYS * DAY_MS)),
          ),
        );
      const byPost = new Map(variants.filter((v) => v.externalPostId).map((v) => [v.externalPostId as string, v]));
      const ids = [...byPost.keys()];
      for (let i = 0; i < ids.length; i += POST_CHUNK) {
        const chunk = ids.slice(i, i + POST_CHUNK);
        const fetchPostInsights = adapter.fetchPostInsights;
        const insights = await supported("post_insights", () => fetchPostInsights(credential, chunk));
        if (!insights) break;
        const rows = insights
          .map((ins) => {
            const variant = byPost.get(ins.externalPostId);
            if (!variant) return null;
            const provided = providedPostCounters(ins);
            const raw: Record<string, number> = {};
            for (const [k, v] of Object.entries(ins.extra ?? {})) if (typeof v === "number" && Number.isFinite(v)) raw[k] = v;
            return {
              organizationId: input.organizationId,
              contentItemId: variant.contentItemId,
              channelAccountId: account.id,
              capturedAt: now,
              source,
              contentVariantId: variant.id,
              externalPostId: ins.externalPostId,
              recordedByUserId: null,
              ...provided,
              extraMetrics: { provided, raw },
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        if (rows.length) {
          await db.insert(marketingContentPerformanceSnapshots).values(rows);
          result.postSnapshots += rows.length;
        }
      }
    }

    // (c) ad campaigns
    if (isAdPlatform(platform) && adapter.listAdCampaigns) {
      const range = { since: new Date(today.getTime() - AD_WINDOW_DAYS * DAY_MS), until: today };
      const listAdCampaigns = adapter.listAdCampaigns;
      const campaigns = (await supported("ad_campaigns", () => listAdCampaigns(credential, range))) ?? [];
      for (const c of campaigns) {
        const values = {
          name: c.name.slice(0, 500),
          status: c.status,
          objective: c.objective ?? null,
          currency: (c.currency || "CAD").toUpperCase().slice(0, 3),
          dailyBudgetMinor: toMetricInt(c.dailyBudgetMinor) ?? null,
          lifetimeBudgetMinor: toMetricInt(c.lifetimeBudgetMinor) ?? null,
          capturedAt: now,
          spendMinor: toMetricInt(c.spendMinor) ?? null,
          impressions: toMetricInt(c.impressions) ?? null,
          clicks: toMetricInt(c.clicks) ?? null,
          reach: toMetricInt(c.reach) ?? null,
          conversions: c.conversions === null || c.conversions === undefined || !Number.isFinite(c.conversions) ? null : String(Math.round(c.conversions * 100) / 100),
          metrics: c.metrics ?? {},
        };
        await db
          .insert(socialAdCampaignSnapshots)
          .values({ organizationId: input.organizationId, channelAccountId: account.id, platform, externalCampaignId: c.externalCampaignId, periodStart: range.since, periodEnd: range.until, ...values })
          .onConflictDoUpdate({
            target: [socialAdCampaignSnapshots.channelAccountId, socialAdCampaignSnapshots.externalCampaignId, socialAdCampaignSnapshots.periodStart, socialAdCampaignSnapshots.periodEnd],
            set: values,
          });
        result.adCampaigns++;
      }
    }
  } catch (err) {
    if (err instanceof SocialProviderError) {
      await recordAccountError(db, { organizationId: input.organizationId, channelAccountId: account.id, code: err.code, message: err.message, authorizationLost: err.authorizationLost });
    }
    throw err;
  }

  await db
    .update(marketingChannelAccounts)
    .set({ lastSyncAt: now, updatedAt: now })
    .where(and(eq(marketingChannelAccounts.id, account.id), eq(marketingChannelAccounts.organizationId, input.organizationId)));
  await recordAuditEvent(db, {
    eventType: "social_metrics_synced",
    organizationId: input.organizationId,
    targetType: "marketing_channel_account",
    targetId: account.id,
    metadata: { platform, provider, accountMetrics: result.accountMetrics, postSnapshots: result.postSnapshots, adCampaigns: result.adCampaigns, unsupported, runtimeJobId: input.runtimeJobId ?? null },
  });
  return unsupported.length ? { ...result, unsupported } : result;
}

/** Enqueues a metrics sync for one account (internal — callers check authority). */
export async function enqueueMetricsSyncJob(db: Db, input: { organizationId: string; channelAccountId: string }): Promise<RuntimeJob> {
  return enqueueJob(db, { organizationId: input.organizationId, jobType: "social_metrics_sync", idempotencyKey: `social_metrics_sync:${input.channelAccountId}`, maxAttempts: 3 });
}

/** "Sync now" — requires `marketing_manage_connections`; only connected, non-archived accounts. */
export async function requestMetricsSync(db: Db, input: { organizationId: string; channelAccountId: string; actorUserId: string }): Promise<{ jobId: string; status: string }> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageConnectionsAuthority(db, ctx, "marketing_channel_account", input.channelAccountId);
  const account = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select({ id: marketingChannelAccounts.id, connectionStatus: marketingChannelAccounts.connectionStatus })
      .from(marketingChannelAccounts)
      .where(and(eq(marketingChannelAccounts.id, input.channelAccountId), eq(marketingChannelAccounts.organizationId, input.organizationId), isNull(marketingChannelAccounts.archivedAt)));
    return row;
  });
  if (account.connectionStatus !== "connected") throw new SocialAccountNotConnectedError(account.connectionStatus);
  const job = await enqueueMetricsSyncJob(db, { organizationId: input.organizationId, channelAccountId: account.id });
  return { jobId: job.id, status: job.status };
}
