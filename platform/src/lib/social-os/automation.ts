import "server-only";
import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingBrandProfiles, marketingChannelAccounts, socialAutomationRules, socialAutomationRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { hasMarketingCapability, requireMarketingManageAutomationAuthority, requireMarketingViewAuthority, resolveMarketingAuthContext, type MarketingAuthContext } from "@/lib/marketing-os/authz";
import { enqueueJob } from "@/lib/runtime/queue";
import { enqueueMetricsSyncJob, serviceClock, type SocialServiceDeps } from "./analytics-sync";
import { computeSocialAttention } from "./attention";
import { requireActiveBrand } from "./brands";
import { watchConnectionTokens } from "./connections";
import { draftReply, enqueueEngagementSyncJob, listItemsAwaitingDraft } from "./engagement";
import { InvalidSocialTransitionError, SocialProviderNotConfiguredError, StaleSocialUpdateError } from "./errors";
import { errorMessageFor } from "./generation";
import { planWeek } from "./studio";
import { SOCIAL_AUTOMATION_DEFAULTS, SOCIAL_AUTOMATION_KINDS, SOCIAL_PLATFORM_PROVIDER, isOrganicPlatform, socialAutomationConfigSchema, socialAutomationKindSchema, type SocialAutomationConfig, type SocialAutomationKind, type SocialPlatform } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RuleRow = typeof socialAutomationRules.$inferSelect;
type RunRow = typeof socialAutomationRuns.$inferSelect;

/**
 * Module 19 — safe automation. Each rule is explicit, per organization
 * (optionally per brand), enabled by a human, bounded by `config` and a
 * minimum interval, and only ever produces drafts, snapshots, sync jobs and
 * attention items — never a publish, a public reply or an ad change.
 *
 * Scheduling: the cron route calls `enqueueDueAutomationRules`, which
 * advances `next_run_at` with a CAS on its previous value before enqueuing
 * `social_automation_run:<ruleId>:<runStamp>`, so overlapping cron
 * invocations never double-enqueue. Rules that act "as" someone
 * (reply drafts, weekly plan) run as the rule's creator and re-check that
 * person's capability at run time.
 */

export class SocialAutomationIntervalError extends DomainRuleViolationError {
  readonly reason = "social_automation_interval_too_short";
  constructor(kind: SocialAutomationKind, min: number) {
    super(`The "${SOCIAL_AUTOMATION_DEFAULTS[kind].label}" rule cannot run more often than every ${min} minutes`);
    this.name = "SocialAutomationIntervalError";
  }
}

const MINUTE_MS = 60_000;
const MAX_INTERVAL_MINUTES = 60 * 24 * 31;

export interface AutomationRunView {
  id: string;
  kind: SocialAutomationKind;
  startedAt: Date;
  completedAt: Date | null;
  succeeded: boolean | null;
  summary: string;
  result: Record<string, unknown>;
  errorMessage: string | null;
}

export interface AutomationRuleView {
  id: string;
  organizationId: string;
  brandProfileId: string | null;
  brandName: string | null;
  kind: SocialAutomationKind;
  label: string;
  description: string;
  name: string;
  enabled: boolean;
  intervalMinutes: number;
  minIntervalMinutes: number;
  config: SocialAutomationConfig;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastRunStatus: string | null;
  lastRunSummary: string | null;
  createdByUserId: string | null;
  recentRuns: AutomationRunView[];
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function parseConfig(value: unknown): SocialAutomationConfig {
  const parsed = socialAutomationConfigSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toRunView(r: RunRow): AutomationRunView {
  return { id: r.id, kind: r.kind, startedAt: r.startedAt, completedAt: r.completedAt, succeeded: r.succeeded, summary: r.summary, result: asRecord(r.result), errorMessage: r.errorMessage };
}

function toRuleView(r: RuleRow, brandName: string | null, runs: RunRow[]): AutomationRuleView {
  const d = SOCIAL_AUTOMATION_DEFAULTS[r.kind];
  return {
    id: r.id,
    organizationId: r.organizationId,
    brandProfileId: r.brandProfileId,
    brandName,
    kind: r.kind,
    label: d.label,
    description: d.description,
    name: r.name,
    enabled: r.enabled,
    intervalMinutes: r.intervalMinutes,
    minIntervalMinutes: d.minIntervalMinutes,
    config: parseConfig(r.config),
    lastRunAt: r.lastRunAt,
    nextRunAt: r.nextRunAt,
    lastRunStatus: r.lastRunStatus,
    lastRunSummary: r.lastRunSummary,
    createdByUserId: r.createdByUserId,
    recentRuns: runs.map(toRunView),
    revision: r.revision,
    archivedAt: r.archivedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Validates an interval against the kind's bounds. Pure. */
export function validateAutomationInterval(kind: SocialAutomationKind, intervalMinutes: number | undefined): number {
  const d = SOCIAL_AUTOMATION_DEFAULTS[kind];
  const value = intervalMinutes ?? d.intervalMinutes;
  if (!Number.isInteger(value) || value < d.minIntervalMinutes) throw new SocialAutomationIntervalError(kind, d.minIntervalMinutes);
  return Math.min(value, MAX_INTERVAL_MINUTES);
}

async function resolveRule(db: Db, organizationId: string, ruleId: string): Promise<RuleRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(socialAutomationRules).where(and(eq(socialAutomationRules.id, ruleId), eq(socialAutomationRules.organizationId, organizationId)));
    return row;
  });
}

async function ruleViews(db: Db, organizationId: string, rules: RuleRow[]): Promise<AutomationRuleView[]> {
  if (!rules.length) return [];
  const brandIds = [...new Set(rules.map((r) => r.brandProfileId).filter((id): id is string => Boolean(id)))];
  const brands = brandIds.length ? await db.select({ id: marketingBrandProfiles.id, name: marketingBrandProfiles.name }).from(marketingBrandProfiles).where(and(eq(marketingBrandProfiles.organizationId, organizationId), inArray(marketingBrandProfiles.id, brandIds))) : [];
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const runs = await db
    .select()
    .from(socialAutomationRuns)
    .where(and(eq(socialAutomationRuns.organizationId, organizationId), inArray(socialAutomationRuns.ruleId, rules.map((r) => r.id))))
    .orderBy(desc(socialAutomationRuns.startedAt))
    .limit(Math.min(rules.length * 20, 1000));
  const byRule = new Map<string, RunRow[]>();
  for (const run of runs) {
    const list = byRule.get(run.ruleId) ?? [];
    if (list.length < 5) list.push(run);
    byRule.set(run.ruleId, list);
  }
  return rules.map((r) => toRuleView(r, r.brandProfileId ? (brandName.get(r.brandProfileId) ?? null) : null, byRule.get(r.id) ?? []));
}

// ---------------------------------------------------------------------------
// Rules CRUD
// ---------------------------------------------------------------------------

export async function listAutomationRules(db: Db, input: { organizationId: string; actorUserId: string }): Promise<{ rules: AutomationRuleView[]; kinds: { kind: SocialAutomationKind; label: string; description: string; intervalMinutes: number; minIntervalMinutes: number }[] }> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_automation_rule", "list");
  const rules = await db
    .select()
    .from(socialAutomationRules)
    .where(and(eq(socialAutomationRules.organizationId, input.organizationId), isNull(socialAutomationRules.archivedAt)))
    .orderBy(socialAutomationRules.kind, socialAutomationRules.createdAt);
  return { rules: await ruleViews(db, input.organizationId, rules), kinds: SOCIAL_AUTOMATION_KINDS.map((kind) => ({ kind, ...SOCIAL_AUTOMATION_DEFAULTS[kind] })) };
}

async function getRuleView(db: Db, organizationId: string, ruleId: string): Promise<AutomationRuleView> {
  const [view] = await ruleViews(db, organizationId, [await resolveRule(db, organizationId, ruleId)]);
  return view;
}

async function findScopeRule(db: Db, organizationId: string, brandProfileId: string | null, kind: SocialAutomationKind): Promise<RuleRow | undefined> {
  const [row] = await db
    .select()
    .from(socialAutomationRules)
    .where(and(eq(socialAutomationRules.organizationId, organizationId), brandProfileId ? eq(socialAutomationRules.brandProfileId, brandProfileId) : isNull(socialAutomationRules.brandProfileId), eq(socialAutomationRules.kind, kind), isNull(socialAutomationRules.archivedAt)));
  return row;
}

/** Creates the rule for (scope, kind) or updates the existing one. `nextRunAt` is set to now when the rule becomes enabled; cleared when disabled. */
export async function upsertAutomationRule(
  db: Db,
  input: { organizationId: string; actorUserId: string; brandProfileId: string | null; kind: SocialAutomationKind; name?: string; enabled: boolean; intervalMinutes?: number; config?: SocialAutomationConfig; now?: Date },
): Promise<AutomationRuleView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageAutomationAuthority(db, ctx, "social_automation_rule", input.brandProfileId ?? "organization");
  const kind = socialAutomationKindSchema.parse(input.kind);
  if (input.brandProfileId) await requireActiveBrand(db, input.organizationId, input.brandProfileId);
  const intervalMinutes = validateAutomationInterval(kind, input.intervalMinutes);
  const config = socialAutomationConfigSchema.parse(input.config ?? {});
  const name = (input.name?.trim() || SOCIAL_AUTOMATION_DEFAULTS[kind].label).slice(0, 200);
  const now = input.now ?? new Date();

  const update = async (existing: RuleRow) => {
    const enabling = input.enabled && (!existing.enabled || !existing.nextRunAt);
    const [row] = await db
      .update(socialAutomationRules)
      .set({ name, enabled: input.enabled, intervalMinutes, config, nextRunAt: input.enabled ? (enabling ? now : existing.nextRunAt) : null, revision: existing.revision + 1, updatedAt: now })
      .where(and(eq(socialAutomationRules.id, existing.id), eq(socialAutomationRules.organizationId, input.organizationId), eq(socialAutomationRules.revision, existing.revision)))
      .returning();
    if (!row) throw new StaleSocialUpdateError("automation rule");
    await recordAuditEvent(db, { eventType: "social_automation_rule_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_automation_rule", targetId: row.id, metadata: { kind, enabled: row.enabled, intervalMinutes } });
    return row;
  };

  const existing = await findScopeRule(db, input.organizationId, input.brandProfileId, kind);
  let row: RuleRow;
  if (existing) row = await update(existing);
  else {
    try {
      [row] = await db
        .insert(socialAutomationRules)
        .values({ organizationId: input.organizationId, brandProfileId: input.brandProfileId, kind, name, enabled: input.enabled, intervalMinutes, config, nextRunAt: input.enabled ? now : null, createdByUserId: input.actorUserId })
        .returning();
    } catch (err) {
      if (!isPostgresUniqueViolation(err)) throw err;
      const raced = await findScopeRule(db, input.organizationId, input.brandProfileId, kind);
      if (!raced) throw err;
      row = await update(raced);
    }
    await recordAuditEvent(db, { eventType: "social_automation_rule_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_automation_rule", targetId: row.id, metadata: { kind, brandProfileId: input.brandProfileId, enabled: row.enabled, intervalMinutes } });
  }
  return getRuleView(db, input.organizationId, row.id);
}

async function requireAutomation(db: Db, input: { organizationId: string; actorUserId: string }, ruleId: string): Promise<MarketingAuthContext> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageAutomationAuthority(db, ctx, "social_automation_rule", ruleId);
  return ctx;
}

export async function setAutomationRuleEnabled(db: Db, input: { organizationId: string; ruleId: string; actorUserId: string; expectedRevision: number; enabled: boolean; now?: Date }): Promise<AutomationRuleView> {
  await requireAutomation(db, input, input.ruleId);
  const existing = await resolveRule(db, input.organizationId, input.ruleId);
  if (existing.archivedAt) throw new InvalidSocialTransitionError("automation rule", "archived", input.enabled ? "enabled" : "disabled");
  const now = input.now ?? new Date();
  const [row] = await db
    .update(socialAutomationRules)
    .set({ enabled: input.enabled, nextRunAt: input.enabled ? (existing.enabled && existing.nextRunAt ? existing.nextRunAt : now) : null, revision: input.expectedRevision + 1, updatedAt: now })
    .where(and(eq(socialAutomationRules.id, existing.id), eq(socialAutomationRules.organizationId, input.organizationId), eq(socialAutomationRules.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("automation rule");
  await recordAuditEvent(db, { eventType: "social_automation_rule_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_automation_rule", targetId: row.id, metadata: { action: input.enabled ? "enable" : "disable", kind: row.kind } });
  return getRuleView(db, input.organizationId, row.id);
}

export async function archiveAutomationRule(db: Db, input: { organizationId: string; ruleId: string; actorUserId: string; expectedRevision: number }): Promise<AutomationRuleView> {
  await requireAutomation(db, input, input.ruleId);
  const existing = await resolveRule(db, input.organizationId, input.ruleId);
  if (existing.archivedAt) return getRuleView(db, input.organizationId, existing.id);
  const now = new Date();
  const [row] = await db
    .update(socialAutomationRules)
    .set({ archivedAt: now, enabled: false, nextRunAt: null, revision: input.expectedRevision + 1, updatedAt: now })
    .where(and(eq(socialAutomationRules.id, existing.id), eq(socialAutomationRules.organizationId, input.organizationId), eq(socialAutomationRules.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("automation rule");
  await recordAuditEvent(db, { eventType: "social_automation_rule_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_automation_rule", targetId: row.id, metadata: { action: "archive", kind: row.kind } });
  return getRuleView(db, input.organizationId, row.id);
}

export async function runAutomationRuleNow(db: Db, input: { organizationId: string; ruleId: string; actorUserId: string }): Promise<{ jobId: string; status: string }> {
  await requireAutomation(db, input, input.ruleId);
  const rule = await resolveRule(db, input.organizationId, input.ruleId);
  if (rule.archivedAt) throw new InvalidSocialTransitionError("automation rule", "archived", "run");
  const job = await enqueueJob(db, { organizationId: input.organizationId, jobType: "social_automation_run", idempotencyKey: `social_automation_run:${rule.id}:${Date.now()}`, maxAttempts: 1 });
  await recordAuditEvent(db, { eventType: "social_automation_rule_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_automation_rule", targetId: rule.id, metadata: { action: "run_now", runtimeJobId: job.id } });
  return { jobId: job.id, status: job.status };
}

// ---------------------------------------------------------------------------
// Scheduler (cron) — NOT org-scoped: called by the internal cron route only.
// ---------------------------------------------------------------------------

export async function enqueueDueAutomationRules(db: Db, input: { now?: Date; limit?: number } = {}): Promise<{ enqueued: number; ruleIds: string[] }> {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
  const due = await db
    .select()
    .from(socialAutomationRules)
    .where(and(eq(socialAutomationRules.enabled, true), isNull(socialAutomationRules.archivedAt), lte(socialAutomationRules.nextRunAt, now)))
    .orderBy(socialAutomationRules.nextRunAt)
    .limit(limit);
  const ruleIds: string[] = [];
  for (const rule of due) {
    if (!rule.nextRunAt) continue;
    const next = new Date(now.getTime() + rule.intervalMinutes * MINUTE_MS);
    // CAS on the previous next_run_at: only one concurrent cron invocation wins this slot.
    const [won] = await db
      .update(socialAutomationRules)
      .set({ nextRunAt: next })
      .where(and(eq(socialAutomationRules.id, rule.id), eq(socialAutomationRules.organizationId, rule.organizationId), eq(socialAutomationRules.enabled, true), eq(socialAutomationRules.nextRunAt, rule.nextRunAt)))
      .returning({ id: socialAutomationRules.id });
    if (!won) continue;
    await enqueueJob(db, { organizationId: rule.organizationId, jobType: "social_automation_run", idempotencyKey: `social_automation_run:${rule.id}:${rule.nextRunAt.getTime()}`, maxAttempts: 1 });
    ruleIds.push(rule.id);
  }
  return { enqueued: ruleIds.length, ruleIds };
}

// ---------------------------------------------------------------------------
// Worker entry
// ---------------------------------------------------------------------------

export interface RunAutomationRuleResult extends Record<string, unknown> {
  runId: string | null;
  kind: SocialAutomationKind;
  succeeded: boolean;
  skipped?: boolean;
  summary: string;
}

/** The next Monday strictly after `now` (UTC calendar), at 12:00 UTC — the same local day in North American zones. Pure. */
export function nextMonday(now: Date): Date {
  const dow = now.getUTCDay();
  const delta = ((8 - dow) % 7) || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta, 12));
}

async function actorWith(db: Db, organizationId: string, userId: string | null, capabilities: Parameters<typeof hasMarketingCapability>[1][]): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  if (!userId) return { ok: false, reason: "the rule has no creator to act as" };
  try {
    const ctx = await resolveMarketingAuthContext(db, { organizationId, actorUserId: userId });
    const missing = capabilities.filter((c) => !hasMarketingCapability(ctx, c));
    if (missing.length) return { ok: false, reason: `the rule's creator no longer holds ${missing.join(", ")}` };
    return { ok: true, userId };
  } catch {
    return { ok: false, reason: "the rule's creator is no longer a member of this organization" };
  }
}

async function scopedConnectedAccounts(db: Db, rule: RuleRow) {
  const conditions = [eq(marketingChannelAccounts.organizationId, rule.organizationId), eq(marketingChannelAccounts.connectionStatus, "connected"), isNull(marketingChannelAccounts.archivedAt)];
  if (rule.brandProfileId) conditions.push(eq(marketingChannelAccounts.brandProfileId, rule.brandProfileId));
  const rows = await db.select({ id: marketingChannelAccounts.id, platform: marketingChannelAccounts.platform, accountKind: marketingChannelAccounts.accountKind }).from(marketingChannelAccounts).where(and(...conditions));
  return rows.filter((r) => SOCIAL_PLATFORM_PROVIDER[r.platform as SocialPlatform]);
}

function boundResult(value: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(value);
  return json.length <= 32_000 ? value : { truncated: true, size: json.length };
}

/** Worker entry (`social_automation_run:<ruleId>:<runStamp>`). */
export async function runAutomationRule(db: Db, input: { organizationId: string; ruleId: string; runtimeJobId?: string; deps?: SocialServiceDeps }): Promise<RunAutomationRuleResult> {
  const rule = await resolveRule(db, input.organizationId, input.ruleId);
  if (rule.archivedAt) return { runId: null, kind: rule.kind, succeeded: true, skipped: true, summary: "Rule is archived — nothing to do." };
  const now = serviceClock(input.deps);
  const config = parseConfig(rule.config);
  const [run] = await db.insert(socialAutomationRuns).values({ organizationId: input.organizationId, ruleId: rule.id, kind: rule.kind, runtimeJobId: input.runtimeJobId ?? null, startedAt: now }).returning();

  const finish = async (succeeded: boolean, summary: string, result: Record<string, unknown>, errorMessage: string | null) => {
    const completedAt = new Date();
    await db.update(socialAutomationRuns).set({ completedAt, succeeded, summary: summary.slice(0, 2000), result: boundResult(result), errorMessage: errorMessage?.slice(0, 2000) ?? null }).where(and(eq(socialAutomationRuns.id, run.id), eq(socialAutomationRuns.organizationId, input.organizationId)));
    await db
      .update(socialAutomationRules)
      .set({ lastRunAt: completedAt, lastRunStatus: succeeded ? (result.skipped ? "skipped" : "succeeded") : "failed", lastRunSummary: summary.slice(0, 1000), updatedAt: completedAt })
      .where(and(eq(socialAutomationRules.id, rule.id), eq(socialAutomationRules.organizationId, input.organizationId)));
    await recordAuditEvent(db, { eventType: "social_automation_run_completed", actorUserId: null, organizationId: input.organizationId, targetType: "social_automation_rule", targetId: rule.id, metadata: { runId: run.id, kind: rule.kind, succeeded, summary: summary.slice(0, 300) } });
  };

  try {
    let summary = "";
    let result: Record<string, unknown> = {};
    switch (rule.kind) {
      case "metrics_sync": {
        const accounts = await scopedConnectedAccounts(db, rule);
        const jobs: string[] = [];
        for (const a of accounts) jobs.push((await enqueueMetricsSyncJob(db, { organizationId: input.organizationId, channelAccountId: a.id })).id);
        summary = accounts.length ? `Queued a performance sync for ${accounts.length} connected account(s).` : "No connected accounts to sync.";
        result = { enqueued: accounts.length, accountIds: accounts.map((a) => a.id), jobIds: jobs };
        break;
      }
      case "engagement_sync": {
        const accounts = (await scopedConnectedAccounts(db, rule)).filter((a) => a.accountKind !== "paid" && isOrganicPlatform(a.platform as SocialPlatform));
        for (const a of accounts) await enqueueEngagementSyncJob(db, { organizationId: input.organizationId, channelAccountId: a.id });
        summary = accounts.length ? `Queued an engagement sync for ${accounts.length} account(s).` : "No connected organic accounts to sync.";
        result = { enqueued: accounts.length, accountIds: accounts.map((a) => a.id) };
        break;
      }
      case "token_watch": {
        const watch = await watchConnectionTokens(db, { organizationId: input.organizationId, deps: input.deps });
        summary = `Checked ${watch.checked} account(s): ${watch.expired} expired, ${watch.refreshed} refreshed, ${watch.expiringSoon.length} expiring soon.`;
        result = { ...watch };
        break;
      }
      case "reply_drafts": {
        const actor = await actorWith(db, input.organizationId, rule.createdByUserId, ["marketing_manage_engagement", "marketing_generate_content"]);
        if (!actor.ok) {
          summary = `Skipped: ${actor.reason}.`;
          result = { skipped: true, reason: actor.reason };
          break;
        }
        const maxDrafts = config.maxDraftsPerRun ?? 10;
        const pending = await listItemsAwaitingDraft(db, { organizationId: input.organizationId, brandProfileId: rule.brandProfileId, limit: maxDrafts });
        let drafted = 0;
        let failed = 0;
        let stoppedReason: string | null = null;
        for (const item of pending) {
          try {
            await draftReply(db, { organizationId: input.organizationId, engagementItemId: item.id, actorUserId: actor.userId, deps: input.deps });
            drafted++;
          } catch (err) {
            failed++;
            if (err instanceof SocialProviderNotConfiguredError) {
              stoppedReason = errorMessageFor(err);
              break;
            }
          }
        }
        summary = pending.length ? `Drafted ${drafted} suggested repl${drafted === 1 ? "y" : "ies"}${failed ? `, ${failed} failed` : ""}. Nothing was sent.` : "No new comments awaiting a draft.";
        if (stoppedReason) summary += ` Stopped: ${stoppedReason}`;
        result = { candidates: pending.length, drafted, failed, stoppedReason };
        break;
      }
      case "weekly_plan": {
        const actor = await actorWith(db, input.organizationId, rule.createdByUserId, ["marketing_generate_content", "marketing_manage_content"]);
        if (!actor.ok) {
          summary = `Skipped: ${actor.reason}.`;
          result = { skipped: true, reason: actor.reason };
          break;
        }
        const brandConditions = [eq(marketingBrandProfiles.organizationId, input.organizationId), isNull(marketingBrandProfiles.archivedAt)];
        if (rule.brandProfileId) brandConditions.push(eq(marketingBrandProfiles.id, rule.brandProfileId));
        const brands = await db.select({ id: marketingBrandProfiles.id, name: marketingBrandProfiles.name }).from(marketingBrandProfiles).where(and(...brandConditions)).limit(5);
        const weekStart = nextMonday(now);
        const plans: Record<string, unknown>[] = [];
        for (const b of brands) {
          try {
            const plan = await planWeek(db, { organizationId: input.organizationId, brandProfileId: b.id, actorUserId: actor.userId, weekStart, postsPerWeek: config.postsPerWeek, platforms: config.platforms, deps: input.deps ? { textProvider: input.deps.textProvider, env: input.deps.aiEnv, now } : undefined });
            plans.push({ brandProfileId: b.id, generationId: plan.generationId, createdContentItemIds: plan.createdContentItemIds, skipped: plan.skipped });
          } catch (err) {
            plans.push({ brandProfileId: b.id, error: errorMessageFor(err).slice(0, 300) });
          }
        }
        const drafts = plans.reduce((n, p) => n + (Array.isArray(p.createdContentItemIds) ? p.createdContentItemIds.length : 0), 0);
        const failures = plans.filter((p) => p.error).length;
        if (brands.length && failures === brands.length) throw new Error(`Weekly plan failed for every brand: ${String(plans[0].error)}`);
        summary = brands.length ? `Prepared ${drafts} draft post(s) for the week of ${weekStart.toISOString().slice(0, 10)} across ${brands.length} brand(s). Nothing was published.` : "No active brands to plan for.";
        result = { weekStart: weekStart.toISOString(), plans };
        break;
      }
      case "daily_attention": {
        const attention = await computeSocialAttention(db, { organizationId: input.organizationId, brandProfileId: rule.brandProfileId, now, deps: input.deps });
        const urgent = attention.items.filter((i) => i.severity === "urgent").length;
        summary = `${attention.items.length} attention item(s), ${urgent} urgent.`;
        result = { attention };
        break;
      }
      default: {
        const exhaustive: never = rule.kind;
        throw new Error(`Unknown automation kind ${String(exhaustive)}`);
      }
    }
    await finish(true, summary, result, null);
    return { runId: run.id, kind: rule.kind, succeeded: true, ...(result.skipped ? { skipped: true } : {}), summary };
  } catch (err) {
    const message = errorMessageFor(err);
    await finish(false, `Failed: ${message}`.slice(0, 500), {}, message);
    throw err;
  }
}
