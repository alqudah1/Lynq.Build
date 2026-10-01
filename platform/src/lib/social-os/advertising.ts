import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { z } from "zod";
import { agentApprovalRequests, marketingChannelAccounts, socialAdCampaignSnapshots, socialAdChangeRequests } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { approveRequest, rejectRequest } from "@/lib/agent-runtime/approvals";
import {
  hasMarketingCapability,
  requireMarketingApproveAdChangesAuthority,
  requireMarketingGenerateContentAuthority,
  requireMarketingManageAdsAuthority,
  requireMarketingViewAuthority,
  resolveMarketingAuthContext,
} from "@/lib/marketing-os/authz";
import { enqueueJob } from "@/lib/runtime/queue";
import { requestAdChangeApproval } from "./agents";
import { adapterDepsOf, providerEnvOf, serviceClock, toGenerationDeps, type SocialServiceDeps } from "./analytics-sync";
import { assembleBrandContext, requireActiveBrand } from "./brands";
import { describeConnectionCenter, recordAccountError, resolveSocialAccountCredential, type SocialAccountView } from "./connections";
import { InvalidSocialTransitionError, SocialAdChangeNotExecutableError, SocialProviderError, SocialProviderNotSupportedError, StaleSocialUpdateError } from "./errors";
import { generateTextRecorded } from "./generation";
import { resolveAdapterForPlatform } from "./providers/social/registry";
import {
  SOCIAL_AD_CHANGE_TYPES,
  SOCIAL_PLATFORM_LABELS,
  isAdPlatform,
  parseAdChangePayload,
  socialAdChangePayloadSchemas,
  socialAdChangeTypeSchema,
  type SocialAdChangeStatus,
  type SocialAdChangeType,
  type SocialPlatform,
} from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type ChangeRow = typeof socialAdChangeRequests.$inferSelect;
type CampaignSnapshotRow = typeof socialAdCampaignSnapshots.$inferSelect;

/**
 * Module 19 — the advertising command center. READ: campaign snapshots
 * synced by `analytics-sync`, with derived cpc/cpm/ctr/cpa only where the
 * inputs exist. WRITE: the recommendation → approval → execution boundary.
 * A change request is `proposed` (by a human or the AI), submitted for a
 * recorded human approval (`agent_approval_requests`, high risk), decided by
 * someone holding `marketing_approve_ad_changes`, and only then executed by
 * the `social_ad_change_execute` job — which re-verifies the approval row
 * itself before any provider call. Spend never moves on a recommendation.
 */

const DAY_MS = 24 * 3600 * 1000;
const CAMPAIGN_TARGETED: readonly SocialAdChangeType[] = ["update_budget", "pause_campaign", "resume_campaign", "update_targeting", "create_ad_set"];
const ACTIVE_STATUSES = new Set(["ACTIVE", "ENABLED", "ACTIVE_ACCOUNT", "RUNNING"]);

// ---------------------------------------------------------------------------
// Pure: derived metrics + anomaly detection
// ---------------------------------------------------------------------------

export interface DerivedAdMetrics {
  cpc: number | null;
  cpm: number | null;
  ctr: number | null;
  cpa: number | null;
}

function round(n: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** cpc/cpm/cpa in minor units of the currency, ctr as a fraction — null whenever an input is missing or a denominator is 0. Pure. */
export function deriveAdMetrics(input: { spendMinor: number | null; impressions: number | null; clicks: number | null; conversions: number | null }): DerivedAdMetrics {
  const { spendMinor, impressions, clicks, conversions } = input;
  return {
    cpc: spendMinor !== null && clicks !== null && clicks > 0 ? round(spendMinor / clicks, 2) : null,
    cpm: spendMinor !== null && impressions !== null && impressions > 0 ? round((spendMinor / impressions) * 1000, 2) : null,
    ctr: clicks !== null && impressions !== null && impressions > 0 ? round(clicks / impressions, 6) : null,
    cpa: spendMinor !== null && conversions !== null && conversions > 0 ? round(spendMinor / conversions, 2) : null,
  };
}

export interface AdSnapshotLike {
  channelAccountId: string;
  externalCampaignId: string;
  name: string;
  status: string;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  periodStart: Date;
  periodEnd: Date;
  capturedAt: Date;
  spendMinor: number | null;
  impressions: number | null;
  clicks: number | null;
}

export type AdAnomalyKind = "spend_spike" | "ctr_drop" | "zero_impressions" | "budget_exhausted";

export interface AdAnomaly {
  campaignId: string;
  channelAccountId: string;
  name: string;
  kind: AdAnomalyKind;
  detail: string;
}

/** Spend spike: daily-average spend up ≥ 50% AND by at least this much (minor units/day). */
const SPIKE_RATIO = 1.5;
const SPIKE_MIN_DELTA_MINOR_PER_DAY = 500;
/** CTR drop: ≥ 30% relative drop with ≥ 1000 impressions in both periods. */
const CTR_DROP_RATIO = 0.7;
const CTR_MIN_IMPRESSIONS = 1000;

function periodDays(s: Pick<AdSnapshotLike, "periodStart" | "periodEnd">): number {
  return Math.max(1, Math.round((s.periodEnd.getTime() - s.periodStart.getTime()) / DAY_MS));
}

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

/**
 * Deterministic anomaly rules over the last two distinct periods of each
 * campaign (sorted by periodEnd, then capturedAt). Never infers from absent
 * data: a rule only fires when every input it needs was synced. Pure.
 */
export function computeAdAnomalies(snapshots: AdSnapshotLike[]): AdAnomaly[] {
  const groups = new Map<string, AdSnapshotLike[]>();
  for (const s of snapshots) {
    const key = `${s.channelAccountId}::${s.externalCampaignId}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  const out: AdAnomaly[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime() || b.capturedAt.getTime() - a.capturedAt.getTime());
    const latest = list[0];
    const previous = list.find((s) => s.periodEnd.getTime() < latest.periodEnd.getTime() || s.periodStart.getTime() !== latest.periodStart.getTime()) ?? null;
    const base = { campaignId: latest.externalCampaignId, channelAccountId: latest.channelAccountId, name: latest.name };
    const active = ACTIVE_STATUSES.has(latest.status.toUpperCase());

    if (active && latest.impressions === 0) {
      out.push({ ...base, kind: "zero_impressions", detail: `"${latest.name}" is active but recorded 0 impressions in the last ${periodDays(latest)} days.` });
    }

    if (latest.spendMinor !== null) {
      if (latest.lifetimeBudgetMinor !== null && latest.lifetimeBudgetMinor > 0 && latest.spendMinor >= latest.lifetimeBudgetMinor * 0.98) {
        out.push({ ...base, kind: "budget_exhausted", detail: `"${latest.name}" has spent ${money(latest.spendMinor)} of its ${money(latest.lifetimeBudgetMinor)} lifetime budget.` });
      } else if (active && latest.dailyBudgetMinor !== null && latest.dailyBudgetMinor > 0 && latest.spendMinor / periodDays(latest) >= latest.dailyBudgetMinor * 0.98) {
        out.push({ ...base, kind: "budget_exhausted", detail: `"${latest.name}" is spending its full daily budget (${money(latest.dailyBudgetMinor)}/day) — delivery may be capped.` });
      }
    }

    if (previous) {
      if (latest.spendMinor !== null && previous.spendMinor !== null && previous.spendMinor > 0) {
        const cur = latest.spendMinor / periodDays(latest);
        const prev = previous.spendMinor / periodDays(previous);
        if (cur >= prev * SPIKE_RATIO && cur - prev >= SPIKE_MIN_DELTA_MINOR_PER_DAY) {
          out.push({ ...base, kind: "spend_spike", detail: `"${latest.name}" daily spend rose from ${money(prev)} to ${money(cur)} (+${Math.round((cur / prev - 1) * 100)}%).` });
        }
      }
      if (latest.clicks !== null && latest.impressions !== null && previous.clicks !== null && previous.impressions !== null && latest.impressions >= CTR_MIN_IMPRESSIONS && previous.impressions >= CTR_MIN_IMPRESSIONS) {
        const cur = latest.clicks / latest.impressions;
        const prev = previous.clicks / previous.impressions;
        if (prev > 0 && cur <= prev * CTR_DROP_RATIO) {
          out.push({ ...base, kind: "ctr_drop", detail: `"${latest.name}" click-through rate fell from ${(prev * 100).toFixed(2)}% to ${(cur * 100).toFixed(2)}%.` });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure: AI recommendation validation
// ---------------------------------------------------------------------------

export interface AdRecommendation {
  title: string;
  changeType: SocialAdChangeType;
  rationale: string;
  externalCampaignId: string | null;
  payload: Record<string, unknown>;
  estimatedDailySpendMinor: number | null;
}

const rawRecommendationSchema = z.object({
  title: z.string().default(""),
  changeType: z.string().default(""),
  rationale: z.string().default(""),
  payload: z.unknown().optional(),
  estimatedDailySpendMinor: z.number().nullable().optional(),
});
export const adRecommendationsOutputSchema = z.object({ recommendations: z.array(z.unknown()).default([]) });

/**
 * Keeps only recommendations that are (1) a known change type, (2) a payload
 * that validates for that type, and (3) for campaign-targeted changes, aimed
 * at a campaign that actually exists in the synced snapshots. Everything
 * else is dropped — never "repaired". Pure.
 */
export function normalizeAdRecommendations(raw: unknown[], options: { knownCampaignIds: ReadonlySet<string> }): { valid: AdRecommendation[]; dropped: number } {
  const valid: AdRecommendation[] = [];
  let dropped = 0;
  for (const item of raw.slice(0, 20)) {
    const r = rawRecommendationSchema.safeParse(item);
    if (!r.success) {
      dropped++;
      continue;
    }
    const ct = socialAdChangeTypeSchema.safeParse(r.data.changeType);
    const title = r.data.title.trim().slice(0, 200);
    if (!ct.success || !title) {
      dropped++;
      continue;
    }
    const payload = socialAdChangePayloadSchemas[ct.data].safeParse(r.data.payload ?? {});
    if (!payload.success) {
      dropped++;
      continue;
    }
    const data = payload.data as Record<string, unknown>;
    const campaignId = typeof data.externalCampaignId === "string" ? data.externalCampaignId : null;
    if (CAMPAIGN_TARGETED.includes(ct.data) && (!campaignId || !options.knownCampaignIds.has(campaignId))) {
      dropped++;
      continue;
    }
    const est = r.data.estimatedDailySpendMinor;
    valid.push({
      title,
      changeType: ct.data,
      rationale: r.data.rationale.trim().slice(0, 2000),
      externalCampaignId: campaignId,
      payload: data,
      estimatedDailySpendMinor: typeof est === "number" && Number.isFinite(est) && est >= 0 ? Math.round(est) : null,
    });
  }
  return { valid: valid.slice(0, 10), dropped };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface AdCampaignView extends DerivedAdMetrics {
  channelAccountId: string;
  accountDisplayName: string | null;
  platform: SocialPlatform;
  externalCampaignId: string;
  name: string;
  status: string;
  objective: string | null;
  currency: string;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  periodStart: Date;
  periodEnd: Date;
  capturedAt: Date;
  spendMinor: number | null;
  impressions: number | null;
  clicks: number | null;
  reach: number | null;
  conversions: number | null;
  metrics: Record<string, unknown>;
}

export interface AdChangeRequestView {
  id: string;
  channelAccountId: string;
  accountDisplayName: string | null;
  platform: SocialPlatform;
  changeType: SocialAdChangeType;
  status: SocialAdChangeStatus;
  externalCampaignId: string | null;
  title: string;
  rationale: string;
  payload: Record<string, unknown>;
  estimatedDailySpendMinor: number | null;
  currency: string;
  approvalRequestId: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  decisionNote: string | null;
  runtimeJobId: string | null;
  executedAt: Date | null;
  externalResult: Record<string, unknown>;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  proposedByUserId: string | null;
  proposedByAgentId: string | null;
  generationId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toChangeView(row: ChangeRow, accountName: string | null): AdChangeRequestView {
  return {
    id: row.id,
    channelAccountId: row.channelAccountId,
    accountDisplayName: accountName,
    platform: row.platform,
    changeType: row.changeType,
    status: row.status,
    externalCampaignId: row.externalCampaignId,
    title: row.title,
    rationale: row.rationale,
    payload: asRecord(row.payload),
    estimatedDailySpendMinor: row.estimatedDailySpendMinor,
    currency: row.currency,
    approvalRequestId: row.approvalRequestId,
    approvedByUserId: row.approvedByUserId,
    approvedAt: row.approvedAt,
    decisionNote: row.decisionNote,
    runtimeJobId: row.runtimeJobId,
    executedAt: row.executedAt,
    externalResult: asRecord(row.externalResult),
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    proposedByUserId: row.proposedByUserId,
    proposedByAgentId: row.proposedByAgentId,
    generationId: row.generationId,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCampaignView(s: CampaignSnapshotRow, accountName: string | null): AdCampaignView {
  const conversions = s.conversions === null ? null : Number(s.conversions);
  return {
    channelAccountId: s.channelAccountId,
    accountDisplayName: accountName,
    platform: s.platform,
    externalCampaignId: s.externalCampaignId,
    name: s.name,
    status: s.status,
    objective: s.objective,
    currency: s.currency,
    dailyBudgetMinor: s.dailyBudgetMinor,
    lifetimeBudgetMinor: s.lifetimeBudgetMinor,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    capturedAt: s.capturedAt,
    spendMinor: s.spendMinor,
    impressions: s.impressions,
    clicks: s.clicks,
    reach: s.reach,
    conversions,
    metrics: asRecord(s.metrics),
    ...deriveAdMetrics({ spendMinor: s.spendMinor, impressions: s.impressions, clicks: s.clicks, conversions }),
  };
}

/** Latest snapshot per (account, campaign). Pure. */
export function latestPerCampaign<T extends { channelAccountId: string; externalCampaignId: string; periodEnd: Date; capturedAt: Date }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.channelAccountId}::${r.externalCampaignId}`;
    const cur = best.get(key);
    if (!cur || r.periodEnd.getTime() > cur.periodEnd.getTime() || (r.periodEnd.getTime() === cur.periodEnd.getTime() && r.capturedAt.getTime() > cur.capturedAt.getTime())) best.set(key, r);
  }
  return [...best.values()];
}

function sumNullable(values: (number | null)[]): number | null {
  let total: number | null = null;
  for (const v of values) if (v !== null && Number.isFinite(v)) total = (total ?? 0) + v;
  return total;
}

export interface AdTotals extends DerivedAdMetrics {
  campaigns: number;
  currency: string | null;
  spendMinor: number | null;
  impressions: number | null;
  clicks: number | null;
  reach: number | null;
  conversions: number | null;
}

/** Sums the given (latest) campaign snapshots. Money is only summed within one currency; mixed currencies → spend/cpc/cpm/cpa null. Pure. */
export function computeAdTotals(campaigns: Pick<AdCampaignView, "currency" | "spendMinor" | "impressions" | "clicks" | "reach" | "conversions">[]): AdTotals {
  const currencies = [...new Set(campaigns.map((c) => c.currency))];
  const currency = currencies.length === 1 ? currencies[0] : null;
  const spendMinor = currency ? sumNullable(campaigns.map((c) => c.spendMinor)) : null;
  const impressions = sumNullable(campaigns.map((c) => c.impressions));
  const clicks = sumNullable(campaigns.map((c) => c.clicks));
  const reach = sumNullable(campaigns.map((c) => c.reach));
  const conversions = sumNullable(campaigns.map((c) => c.conversions));
  return { campaigns: campaigns.length, currency, spendMinor, impressions, clicks, reach, conversions, ...deriveAdMetrics({ spendMinor, impressions, clicks, conversions }) };
}

/** Internal loader shared with attention.ts: campaign snapshots of the org's ad accounts (optionally one brand) captured since `since`. */
export async function loadAdCampaignSnapshots(db: Db, input: { organizationId: string; brandProfileId?: string | null; since: Date }): Promise<{ snapshots: CampaignSnapshotRow[]; accountNames: Map<string, string> }> {
  const conditions = [eq(marketingChannelAccounts.organizationId, input.organizationId), eq(marketingChannelAccounts.accountKind, "paid"), isNull(marketingChannelAccounts.archivedAt)];
  if (input.brandProfileId) conditions.push(eq(marketingChannelAccounts.brandProfileId, input.brandProfileId));
  const accounts = await db.select({ id: marketingChannelAccounts.id, displayName: marketingChannelAccounts.displayName }).from(marketingChannelAccounts).where(and(...conditions));
  const accountNames = new Map(accounts.map((a) => [a.id, a.displayName]));
  if (!accounts.length) return { snapshots: [], accountNames };
  const snapshots = await db
    .select()
    .from(socialAdCampaignSnapshots)
    .where(and(eq(socialAdCampaignSnapshots.organizationId, input.organizationId), inArray(socialAdCampaignSnapshots.channelAccountId, accounts.map((a) => a.id)), gte(socialAdCampaignSnapshots.capturedAt, input.since)))
    .orderBy(desc(socialAdCampaignSnapshots.periodEnd), desc(socialAdCampaignSnapshots.capturedAt))
    .limit(2000);
  return { snapshots, accountNames };
}

export interface AdCommandCenter {
  accounts: SocialAccountView[];
  campaigns: AdCampaignView[];
  totals: AdTotals;
  anomalies: AdAnomaly[];
  changeRequests: AdChangeRequestView[];
  dataNotes: string[];
}

export async function getAdCommandCenter(db: Db, input: { organizationId: string; actorUserId: string; brandProfileId?: string; days?: number; deps?: SocialServiceDeps }): Promise<AdCommandCenter> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_ad_command_center", input.brandProfileId ?? "all");
  const now = serviceClock(input.deps);
  const days = Math.min(Math.max(Math.floor(input.days ?? 60), 1), 365);
  const center = await describeConnectionCenter(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, deps: input.deps });
  const accounts = center.accounts.filter((a) => (a.accountKind === "paid" || isAdPlatform(a.platform)) && (!input.brandProfileId || a.brandProfileId === input.brandProfileId));

  const { snapshots, accountNames } = await loadAdCampaignSnapshots(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId, since: new Date(now.getTime() - days * DAY_MS) });
  const campaigns = latestPerCampaign(snapshots).map((s) => toCampaignView(s, accountNames.get(s.channelAccountId) ?? null));
  campaigns.sort((a, b) => (b.spendMinor ?? -1) - (a.spendMinor ?? -1) || a.name.localeCompare(b.name));
  const anomalies = computeAdAnomalies(snapshots);

  const accountIds = [...accountNames.keys()];
  const changes = accountIds.length
    ? await db
        .select()
        .from(socialAdChangeRequests)
        .where(and(eq(socialAdChangeRequests.organizationId, input.organizationId), inArray(socialAdChangeRequests.channelAccountId, accountIds)))
        .orderBy(desc(socialAdChangeRequests.createdAt))
        .limit(50)
    : [];

  const dataNotes: string[] = [];
  if (!accounts.length) dataNotes.push("No advertising account is linked yet — connect Meta Ads, Google Ads or LinkedIn Ads in the Connection Center.");
  for (const a of accounts) {
    if (a.connectionStatus !== "connected") dataNotes.push(`${a.displayName} (${a.platformLabel}) is ${a.connectionStatus.replace(/_/g, " ")} — campaign data cannot be synced until it is reconnected.`);
    else if (!snapshots.some((s) => s.channelAccountId === a.id)) dataNotes.push(`No synced campaign data for ${a.displayName} yet — run a metrics sync.`);
  }
  const totals = computeAdTotals(campaigns);
  if (campaigns.length && !totals.currency) dataNotes.push("Campaigns use more than one currency — spend totals are shown per campaign only.");

  return { accounts, campaigns, totals, anomalies, changeRequests: changes.map((c) => toChangeView(c, accountNames.get(c.channelAccountId) ?? null)), dataNotes };
}

// ---------------------------------------------------------------------------
// Change requests
// ---------------------------------------------------------------------------

async function resolveChange(db: Db, organizationId: string, changeRequestId: string): Promise<ChangeRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(socialAdChangeRequests).where(and(eq(socialAdChangeRequests.id, changeRequestId), eq(socialAdChangeRequests.organizationId, organizationId)));
    return row;
  });
}

async function resolveAdAccount(db: Db, organizationId: string, channelAccountId: string) {
  const account = await requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingChannelAccounts).where(and(eq(marketingChannelAccounts.id, channelAccountId), eq(marketingChannelAccounts.organizationId, organizationId)));
    return row;
  });
  if (account.archivedAt) throw new SocialAdChangeNotExecutableError("the advertising account is archived");
  if (!isAdPlatform(account.platform as SocialPlatform)) throw new SocialAdChangeNotExecutableError("the account is not an advertising account");
  return account;
}

async function changeView(db: Db, row: ChangeRow): Promise<AdChangeRequestView> {
  const [account] = await db.select({ displayName: marketingChannelAccounts.displayName }).from(marketingChannelAccounts).where(and(eq(marketingChannelAccounts.id, row.channelAccountId), eq(marketingChannelAccounts.organizationId, row.organizationId)));
  return toChangeView(row, account?.displayName ?? null);
}

async function casChange(db: Db, row: ChangeRow, expectedRevision: number, from: readonly SocialAdChangeStatus[], set: Partial<typeof socialAdChangeRequests.$inferInsert>): Promise<ChangeRow> {
  if (!from.includes(row.status)) throw new InvalidSocialTransitionError("advertising change", row.status, String(set.status ?? row.status));
  if (row.revision !== expectedRevision) throw new StaleSocialUpdateError("advertising change");
  const [updated] = await db
    .update(socialAdChangeRequests)
    .set({ ...set, revision: expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(socialAdChangeRequests.id, row.id), eq(socialAdChangeRequests.organizationId, row.organizationId), eq(socialAdChangeRequests.revision, expectedRevision), inArray(socialAdChangeRequests.status, [...from])))
    .returning();
  if (!updated) throw new StaleSocialUpdateError("advertising change");
  return updated;
}

function currencyOf(payload: Record<string, unknown>, explicit: string | undefined, accountMetadata: unknown): string {
  const fromPayload = typeof payload.currency === "string" ? payload.currency : undefined;
  const meta = asRecord(accountMetadata);
  const fromAccount = typeof meta.currency === "string" ? meta.currency : undefined;
  return (fromPayload ?? explicit ?? fromAccount ?? "CAD").toUpperCase().slice(0, 3);
}

/** Internal insert shared by `proposeAdChange` and `generateAdRecommendations` (authority already checked). */
async function insertProposal(
  db: Db,
  input: { organizationId: string; account: typeof marketingChannelAccounts.$inferSelect; actorUserId: string | null; changeType: SocialAdChangeType; title: string; rationale: string; payload: Record<string, unknown>; externalCampaignId?: string | null; estimatedDailySpendMinor?: number | null; currency?: string; generationId?: string | null; proposedByAgentId?: string | null },
): Promise<ChangeRow> {
  const payload = parseAdChangePayload(input.changeType, input.payload) as Record<string, unknown>;
  const externalCampaignId = input.externalCampaignId ?? (typeof payload.externalCampaignId === "string" ? payload.externalCampaignId : null);
  const [row] = await db
    .insert(socialAdChangeRequests)
    .values({
      organizationId: input.organizationId,
      channelAccountId: input.account.id,
      platform: input.account.platform as SocialPlatform,
      changeType: input.changeType,
      status: "proposed",
      externalCampaignId,
      title: input.title.trim().slice(0, 200) || `${input.changeType.replace(/_/g, " ")}`,
      rationale: input.rationale.trim().slice(0, 4000),
      payload,
      estimatedDailySpendMinor: input.estimatedDailySpendMinor ?? null,
      currency: currencyOf(payload, input.currency, input.account.metadata),
      idempotencyKey: `ad_change:${randomUUID()}`,
      proposedByUserId: input.actorUserId,
      proposedByAgentId: input.proposedByAgentId ?? null,
      generationId: input.generationId ?? null,
    })
    .returning();
  await recordAuditEvent(db, {
    eventType: "social_ad_change_proposed",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "social_ad_change_request",
    targetId: row.id,
    metadata: { channelAccountId: input.account.id, platform: row.platform, changeType: row.changeType, externalCampaignId, generationId: input.generationId ?? null },
  });
  return row;
}

export async function proposeAdChange(
  db: Db,
  input: {
    organizationId: string;
    channelAccountId: string;
    actorUserId: string;
    changeType: SocialAdChangeType;
    title: string;
    rationale?: string;
    payload: unknown;
    externalCampaignId?: string | null;
    estimatedDailySpendMinor?: number | null;
    currency?: string;
    generationId?: string | null;
    proposedByAgentId?: string | null;
  },
): Promise<AdChangeRequestView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageAdsAuthority(db, ctx, "marketing_channel_account", input.channelAccountId);
  const changeType = socialAdChangeTypeSchema.parse(input.changeType);
  const account = await resolveAdAccount(db, input.organizationId, input.channelAccountId);
  const row = await insertProposal(db, { organizationId: input.organizationId, account, actorUserId: input.actorUserId, changeType, title: input.title, rationale: input.rationale ?? "", payload: asRecord(input.payload), externalCampaignId: input.externalCampaignId, estimatedDailySpendMinor: input.estimatedDailySpendMinor, currency: input.currency, generationId: input.generationId, proposedByAgentId: input.proposedByAgentId });
  return toChangeView(row, account.displayName);
}

function changeSummary(row: ChangeRow): string {
  const platform = SOCIAL_PLATFORM_LABELS[row.platform];
  const est = row.estimatedDailySpendMinor !== null ? ` Estimated daily spend: ${money(row.estimatedDailySpendMinor)} ${row.currency}.` : "";
  return `${platform}: ${row.title} (${row.changeType.replace(/_/g, " ")}${row.externalCampaignId ? ` on campaign ${row.externalCampaignId}` : ""}).${est} ${row.rationale}`.trim().slice(0, 2000);
}

export async function submitAdChangeForApproval(db: Db, input: { organizationId: string; changeRequestId: string; actorUserId: string; expectedRevision: number }): Promise<AdChangeRequestView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageAdsAuthority(db, ctx, "social_ad_change_request", input.changeRequestId);
  const existing = await resolveChange(db, input.organizationId, input.changeRequestId);
  // Re-validate the payload as stored before anyone is asked to approve it.
  parseAdChangePayload(existing.changeType, existing.payload);
  const row = await casChange(db, existing, input.expectedRevision, ["proposed"], { status: "pending_approval", approvalRequestId: null, approvedAt: null, approvedByUserId: null });
  try {
    await requestAdChangeApproval(db, { organizationId: input.organizationId, changeRequestId: row.id, summary: changeSummary(row), actorUserId: input.actorUserId });
  } catch (err) {
    // Never leave a change "pending approval" with no approval request behind it.
    await db.update(socialAdChangeRequests).set({ status: "proposed", revision: row.revision + 1, updatedAt: new Date() }).where(and(eq(socialAdChangeRequests.id, row.id), eq(socialAdChangeRequests.organizationId, input.organizationId), eq(socialAdChangeRequests.revision, row.revision)));
    throw err;
  }
  await recordAuditEvent(db, { eventType: "social_ad_change_submitted", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_ad_change_request", targetId: row.id, metadata: { changeType: row.changeType, platform: row.platform } });
  return changeView(db, await resolveChange(db, input.organizationId, row.id));
}

export async function decideAdChange(db: Db, input: { organizationId: string; changeRequestId: string; actorUserId: string; expectedRevision: number; decision: "approve" | "reject"; note?: string }): Promise<AdChangeRequestView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingApproveAdChangesAuthority(db, ctx, "social_ad_change_request", input.changeRequestId);
  const existing = await resolveChange(db, input.organizationId, input.changeRequestId);
  if (existing.status !== "pending_approval") throw new InvalidSocialTransitionError("advertising change", existing.status, input.decision === "approve" ? "approved" : "rejected");
  if (existing.revision !== input.expectedRevision) throw new StaleSocialUpdateError("advertising change");
  if (!existing.approvalRequestId) throw new SocialAdChangeNotExecutableError("it has no approval request — resubmit it");
  if (input.decision === "approve") parseAdChangePayload(existing.changeType, existing.payload);
  const note = input.note?.trim().slice(0, 2000) || null;

  const [approval] = await db.select().from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, existing.approvalRequestId), eq(agentApprovalRequests.organizationId, input.organizationId)));
  const wanted = input.decision === "approve" ? "approved" : "rejected";
  if (approval?.status === "pending") {
    const decide = { organizationId: input.organizationId, approvalId: approval.id, decisionNote: note, actorUserId: input.actorUserId };
    if (input.decision === "approve") await approveRequest(db, decide);
    else await rejectRequest(db, decide);
  } else if (!approval || approval.status !== wanted) {
    throw new InvalidSocialTransitionError("approval", approval?.status ?? "missing", wanted);
  }

  const now = new Date();
  if (input.decision === "reject") {
    const row = await casChange(db, existing, input.expectedRevision, ["pending_approval"], { status: "rejected", decisionNote: note });
    await recordAuditEvent(db, { eventType: "social_ad_change_rejected", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_ad_change_request", targetId: row.id, metadata: { approvalRequestId: existing.approvalRequestId } });
    return changeView(db, row);
  }

  let row = await casChange(db, existing, input.expectedRevision, ["pending_approval"], { status: "approved", approvedByUserId: input.actorUserId, approvedAt: now, decisionNote: note });
  // One attempt only: a money-moving call is never retried blindly — a failure surfaces to a human.
  const job = await enqueueJob(db, { organizationId: input.organizationId, jobType: "social_ad_change_execute", idempotencyKey: `social_ad_change_execute:${row.id}`, maxAttempts: 1 });
  const [withJob] = await db.update(socialAdChangeRequests).set({ runtimeJobId: job.id, updatedAt: new Date() }).where(and(eq(socialAdChangeRequests.id, row.id), eq(socialAdChangeRequests.organizationId, input.organizationId))).returning();
  row = withJob ?? row;
  await recordAuditEvent(db, { eventType: "social_ad_change_approved", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_ad_change_request", targetId: row.id, metadata: { approvalRequestId: existing.approvalRequestId, runtimeJobId: job.id } });
  return changeView(db, row);
}

export async function cancelAdChange(db: Db, input: { organizationId: string; changeRequestId: string; actorUserId: string; expectedRevision: number }): Promise<AdChangeRequestView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageAdsAuthority(db, ctx, "social_ad_change_request", input.changeRequestId);
  const existing = await resolveChange(db, input.organizationId, input.changeRequestId);
  const row = await casChange(db, existing, input.expectedRevision, ["proposed", "pending_approval"], { status: "cancelled" });
  if (existing.status === "pending_approval" && existing.approvalRequestId) {
    // Close the open approval so it does not linger in the Approval Center. Best effort: the change is already
    // cancelled, and execution requires status `approved`, so a later approval of this request can never execute it.
    try {
      const [approval] = await db.select({ status: agentApprovalRequests.status }).from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, existing.approvalRequestId), eq(agentApprovalRequests.organizationId, input.organizationId)));
      if (approval?.status === "pending") await rejectRequest(db, { organizationId: input.organizationId, approvalId: existing.approvalRequestId, decisionNote: "Cancelled by the requester", actorUserId: input.actorUserId, severe: true });
    } catch {
      // The actor may not be an approver for that execution; the request expires on its own.
    }
  }
  await recordAuditEvent(db, { eventType: "social_ad_change_cancelled", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_ad_change_request", targetId: row.id, metadata: { from: existing.status } });
  return changeView(db, row);
}

export async function listAdChangeRequests(db: Db, input: { organizationId: string; actorUserId: string; status?: SocialAdChangeStatus; limit?: number }): Promise<AdChangeRequestView[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_ad_change_request", "list");
  const conditions = [eq(socialAdChangeRequests.organizationId, input.organizationId)];
  if (input.status) conditions.push(eq(socialAdChangeRequests.status, input.status));
  const rows = await db
    .select({ change: socialAdChangeRequests, accountName: marketingChannelAccounts.displayName })
    .from(socialAdChangeRequests)
    .leftJoin(marketingChannelAccounts, and(eq(marketingChannelAccounts.id, socialAdChangeRequests.channelAccountId), eq(marketingChannelAccounts.organizationId, socialAdChangeRequests.organizationId)))
    .where(and(...conditions))
    .orderBy(desc(socialAdChangeRequests.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
  return rows.map((r) => toChangeView(r.change, r.accountName));
}

// ---------------------------------------------------------------------------
// Worker entry: execution
// ---------------------------------------------------------------------------

export interface ExecuteAdChangeResult extends Record<string, unknown> {
  changeRequestId: string;
  status: SocialAdChangeStatus;
  externalIds?: Record<string, string>;
  summary?: string;
  alreadyExecuted?: boolean;
}

async function markFailed(db: Db, row: ChangeRow, code: string, message: string): Promise<void> {
  await db
    .update(socialAdChangeRequests)
    .set({ status: "failed", lastErrorCode: code.slice(0, 100), lastErrorMessage: message.slice(0, 1000), revision: row.revision + 1, updatedAt: new Date() })
    .where(and(eq(socialAdChangeRequests.id, row.id), eq(socialAdChangeRequests.organizationId, row.organizationId), eq(socialAdChangeRequests.revision, row.revision)));
  await recordAuditEvent(db, { eventType: "social_ad_change_failed", organizationId: row.organizationId, targetType: "social_ad_change_request", targetId: row.id, metadata: { code, changeType: row.changeType, platform: row.platform } });
}

/** Worker entry (`social_ad_change_execute:<changeRequestId>`). Executes ONLY an `approved` request whose approval row is itself `approved`. */
export async function executeAdChangeRequest(db: Db, input: { organizationId: string; changeRequestId: string; runtimeJobId?: string; deps?: SocialServiceDeps }): Promise<ExecuteAdChangeResult> {
  const existing = await resolveChange(db, input.organizationId, input.changeRequestId);
  if (existing.status === "executed") return { changeRequestId: existing.id, status: "executed", alreadyExecuted: true };
  if (existing.status !== "approved") throw new SocialAdChangeNotExecutableError(`its status is "${existing.status}", not "approved"`);

  // Re-verify the human approval from the source of truth, not from this row's own columns.
  const refuse = async (detail: string): Promise<never> => {
    await markFailed(db, existing, "ad_change_not_executable", detail);
    throw new SocialAdChangeNotExecutableError(detail);
  };
  if (!existing.approvedAt || !existing.approvedByUserId || !existing.approvalRequestId) await refuse("no recorded human approval");
  const [approval] = await db.select({ status: agentApprovalRequests.status }).from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, existing.approvalRequestId!), eq(agentApprovalRequests.organizationId, input.organizationId)));
  if (approval?.status !== "approved") await refuse(`the linked approval is "${approval?.status ?? "missing"}"`);
  try {
    const approverCtx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: existing.approvedByUserId! });
    if (!hasMarketingCapability(approverCtx, "marketing_approve_ad_changes")) await refuse("the approver no longer holds the ad-approval capability");
  } catch (err) {
    if (err instanceof SocialAdChangeNotExecutableError) throw err;
    await refuse("the approver is no longer a member of this organization");
  }
  let payload: Record<string, unknown>;
  try {
    payload = parseAdChangePayload(existing.changeType, existing.payload) as Record<string, unknown>;
  } catch {
    return refuse("the stored payload no longer validates");
  }

  // Claim: approved → executing (CAS). A concurrent worker loses here.
  const [claimed] = await db
    .update(socialAdChangeRequests)
    .set({ status: "executing", runtimeJobId: input.runtimeJobId ?? existing.runtimeJobId, revision: existing.revision + 1, updatedAt: new Date() })
    .where(and(eq(socialAdChangeRequests.id, existing.id), eq(socialAdChangeRequests.organizationId, input.organizationId), eq(socialAdChangeRequests.revision, existing.revision), eq(socialAdChangeRequests.status, "approved")))
    .returning();
  if (!claimed) throw new SocialAdChangeNotExecutableError("another worker is already executing it");

  try {
    const resolved = await resolveSocialAccountCredential(db, { organizationId: input.organizationId, channelAccountId: claimed.channelAccountId, deps: input.deps });
    const adapter = resolveAdapterForPlatform(claimed.platform, providerEnvOf(input.deps), adapterDepsOf(input.deps));
    if (!adapter.executeAdChange) throw new SocialProviderNotSupportedError(claimed.platform, "advertising changes");
    const result = await adapter.executeAdChange(resolved.credential, { changeType: claimed.changeType, payload, idempotencyKey: claimed.idempotencyKey });
    const now = serviceClock(input.deps);
    await db
      .update(socialAdChangeRequests)
      .set({ status: "executed", executedAt: now, externalResult: { externalIds: result.externalIds, summary: result.summary.slice(0, 1000) }, lastErrorCode: null, lastErrorMessage: null, revision: claimed.revision + 1, updatedAt: now })
      .where(and(eq(socialAdChangeRequests.id, claimed.id), eq(socialAdChangeRequests.organizationId, input.organizationId)));
    await recordAuditEvent(db, { eventType: "social_ad_change_executed", actorUserId: claimed.approvedByUserId, organizationId: input.organizationId, targetType: "social_ad_change_request", targetId: claimed.id, metadata: { changeType: claimed.changeType, platform: claimed.platform, externalIds: result.externalIds } });
    return { changeRequestId: claimed.id, status: "executed", externalIds: result.externalIds, summary: result.summary };
  } catch (err) {
    const code = err instanceof SocialProviderError ? err.code : err instanceof SocialProviderNotSupportedError ? "provider_not_supported" : "execution_failed";
    const message = err instanceof Error ? err.message : "execution failed";
    await markFailed(db, claimed, code, message);
    if (err instanceof SocialProviderError) {
      await recordAccountError(db, { organizationId: input.organizationId, channelAccountId: claimed.channelAccountId, code: err.code, message: err.message, authorizationLost: err.authorizationLost });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// AI: recommendations + creative concepts
// ---------------------------------------------------------------------------

const RECOMMENDATIONS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          changeType: { type: "string", enum: [...SOCIAL_AD_CHANGE_TYPES] },
          rationale: { type: "string" },
          payload: { type: "object" },
          estimatedDailySpendMinor: { type: ["integer", "null"] },
        },
        required: ["title", "changeType", "rationale", "payload"],
      },
    },
  },
  required: ["recommendations"],
};

export type AdRecommendationsResult = { available: false; reason: string } | { available: true; generationId: string; recommendations: AdChangeRequestView[]; dropped: number };

export async function generateAdRecommendations(db: Db, input: { organizationId: string; channelAccountId: string; actorUserId: string; deps?: SocialServiceDeps }): Promise<AdRecommendationsResult> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageAdsAuthority(db, ctx, "marketing_channel_account", input.channelAccountId);
  const account = await resolveAdAccount(db, input.organizationId, input.channelAccountId);
  const now = serviceClock(input.deps);
  const rows = await db
    .select()
    .from(socialAdCampaignSnapshots)
    .where(and(eq(socialAdCampaignSnapshots.organizationId, input.organizationId), eq(socialAdCampaignSnapshots.channelAccountId, account.id), gte(socialAdCampaignSnapshots.capturedAt, new Date(now.getTime() - 60 * DAY_MS))))
    .orderBy(desc(socialAdCampaignSnapshots.periodEnd))
    .limit(500);
  if (!rows.length) return { available: false, reason: `No campaign data has been synced for ${account.displayName} yet — run a metrics sync first.` };

  const latest = latestPerCampaign(rows).slice(0, 25);
  const evidence = latest.map((s) => {
    const v = toCampaignView(s, account.displayName);
    return { externalCampaignId: v.externalCampaignId, name: v.name, status: v.status, objective: v.objective, currency: v.currency, dailyBudgetMinor: v.dailyBudgetMinor, lifetimeBudgetMinor: v.lifetimeBudgetMinor, periodStart: v.periodStart.toISOString(), periodEnd: v.periodEnd.toISOString(), spendMinor: v.spendMinor, impressions: v.impressions, clicks: v.clicks, reach: v.reach, conversions: v.conversions, cpc: v.cpc, cpm: v.cpm, ctr: v.ctr, cpa: v.cpa };
  });
  const anomalies = computeAdAnomalies(rows).map((a) => ({ campaignId: a.campaignId, kind: a.kind, detail: a.detail }));
  const brand = await assembleBrandContext(db, { organizationId: input.organizationId, brandProfileId: account.brandProfileId, sections: ["identity", "offer", "audience", "guardrails", "objectives"] });
  const system = [
    `You are the paid-advertising analyst for ${brand.name} on ${SOCIAL_PLATFORM_LABELS[account.platform as SocialPlatform]}.`,
    "Base every recommendation ONLY on the campaign numbers supplied. Never invent a metric, a campaign id, or an audience size. If the data is too thin, return an empty list.",
    "Each recommendation is a concrete change a human will review and approve before anything happens. Prefer few, high-confidence changes.",
    "Budgets are integers in the account currency's MINOR units (cents) with an explicit 3-letter currency. New campaigns always start paused.",
    "Return JSON only.",
    "",
    brand.text,
  ].join("\n");
  const prompt = JSON.stringify({
    task: "Recommend up to 5 changes to these campaigns.",
    campaigns: evidence,
    anomalies,
    payloadShapes: {
      update_budget: { externalCampaignId: "string", dailyBudgetMinor: "int?", lifetimeBudgetMinor: "int?", currency: "XXX" },
      pause_campaign: { externalCampaignId: "string" },
      resume_campaign: { externalCampaignId: "string" },
      create_campaign: { name: "string", objective: "string", dailyBudgetMinor: "int?", currency: "XXX" },
    },
    output: '{"recommendations":[{"title","changeType","rationale","payload":{},"estimatedDailySpendMinor":null}]}',
  });
  const result = await generateTextRecorded(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    scope: { brandProfileId: account.brandProfileId },
    generationType: "analysis",
    system,
    prompt,
    jsonSchema: RECOMMENDATIONS_JSON_SCHEMA,
    maxOutputTokens: 2000,
    temperature: 0.2,
    parse: (json) => adRecommendationsOutputSchema.parse(json),
    deps: toGenerationDeps(input.deps),
  });
  const { valid, dropped } = normalizeAdRecommendations(result.json.recommendations, { knownCampaignIds: new Set(latest.map((s) => s.externalCampaignId)) });
  const created: AdChangeRequestView[] = [];
  for (const rec of valid) {
    const row = await insertProposal(db, { organizationId: input.organizationId, account, actorUserId: input.actorUserId, changeType: rec.changeType, title: rec.title, rationale: rec.rationale, payload: rec.payload, externalCampaignId: rec.externalCampaignId, estimatedDailySpendMinor: rec.estimatedDailySpendMinor, generationId: result.generationId });
    created.push(toChangeView(row, account.displayName));
  }
  return { available: true, generationId: result.generationId, recommendations: created, dropped };
}

const conceptsOutputSchema = z.object({
  concepts: z
    .array(z.object({ headline: z.string().default(""), primaryText: z.string().default(""), cta: z.string().default(""), visualConcept: z.string().default("") }))
    .default([]),
});

export interface AdCreativeConcept {
  headline: string;
  primaryText: string;
  cta: string;
  visualConcept: string;
}

/** Ad copy + creative concepts for a human to use — returned, never persisted as ads, never sent to a provider. Requires `marketing_generate_content`. */
export async function generateAdCreativeConcepts(
  db: Db,
  input: { organizationId: string; brandProfileId: string; actorUserId: string; objective: string; audience: string; platform: SocialPlatform; count?: number; deps?: SocialServiceDeps },
): Promise<{ generationId: string; concepts: AdCreativeConcept[] }> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingGenerateContentAuthority(db, ctx, "marketing_brand_profile", input.brandProfileId);
  await requireActiveBrand(db, input.organizationId, input.brandProfileId);
  const count = Math.min(Math.max(Math.floor(input.count ?? 4), 1), 8);
  const brand = await assembleBrandContext(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId });
  const system = [
    `You write paid social ad concepts for ${brand.name}. A human reviews everything before it is used.`,
    "Respect every brand guardrail. Never promise guaranteed results, invent statistics, testimonials, prices or discounts that are not in the brand context.",
    "Headlines ≤ 40 characters; primary text ≤ 300 characters; CTA is a short button label.",
    "Return JSON only.",
    "",
    brand.text,
  ].join("\n");
  const prompt = JSON.stringify({ platform: SOCIAL_PLATFORM_LABELS[input.platform], objective: input.objective.slice(0, 500), audience: input.audience.slice(0, 1000), count, output: '{"concepts":[{"headline","primaryText","cta","visualConcept"}]}' });
  const result = await generateTextRecorded(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    scope: { brandProfileId: input.brandProfileId },
    generationType: "text",
    system,
    prompt,
    jsonSchema: { type: "object", properties: { concepts: { type: "array", items: { type: "object", properties: { headline: { type: "string" }, primaryText: { type: "string" }, cta: { type: "string" }, visualConcept: { type: "string" } }, required: ["headline", "primaryText", "cta", "visualConcept"] } } }, required: ["concepts"] },
    maxOutputTokens: 2000,
    parse: (json) => conceptsOutputSchema.parse(json),
    deps: toGenerationDeps(input.deps),
  });
  const concepts = result.json.concepts
    .map((c) => ({ headline: c.headline.trim().slice(0, 80), primaryText: c.primaryText.trim().slice(0, 600), cta: c.cta.trim().slice(0, 40), visualConcept: c.visualConcept.trim().slice(0, 1000) }))
    .filter((c) => c.headline || c.primaryText)
    .slice(0, count);
  return { generationId: result.generationId, concepts };
}
