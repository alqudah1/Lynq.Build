import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { socialAiGenerations, socialContentVariants } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "@/lib/marketing-os/authz";
import { createGeneratedAsset, SOCIAL_ASSET_MAX_BYTES, type SocialAssetStorage } from "./assets";
import { computeStoredVariantWarnings, syncContentItemStatus } from "./content";
import { SocialGenerationFailedError, SocialGenerationLimitError } from "./errors";
import { loadSocialAiEnv, resolveProviderById, resolveTextProvider } from "./providers/ai/registry";
import type { SocialAiEnv } from "./providers/ai/http";
import type { AiProviderId, AiUsage, ImageProvider, TextProvider, VideoProvider } from "./providers/ai/types";
import { SOCIAL_PLATFORM_RULES, socialOrganicPlatformSchema, socialVariantMediaSchema, type SocialGenerationStatus, type SocialGenerationType, type SocialVariantFormat, type SocialVariantMedia } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type GenerationRow = typeof socialAiGenerations.$inferSelect;

/**
 * Module 19 — every AI call the Social Command Center makes is recorded in
 * `social_ai_generations` BEFORE it runs (status `running`), then completed
 * or failed with the provider's usage and cost. Two guards run at begin:
 *
 *   * dedupe — an identical request (same org/type/provider/model/request
 *     fingerprint) that is still queued/running is refused, so a double
 *     click or a retry never pays for the same video twice (also enforced by
 *     the `social_ai_generations_active_fingerprint_unique` partial index);
 *   * daily budget — media (image/video) spend today, counting running
 *     generations at their estimate, plus this request's estimate must stay
 *     within `SOCIAL_AI_DAILY_BUDGET_USD` (default $25).
 *
 * Long-running video renders are finished by `runGenerationJob` (runtime
 * job `social_generation_run:<generationId>`), which polls the provider
 * task and attaches the result to the variant as its primary media.
 */

export const DEFAULT_SOCIAL_AI_DAILY_BUDGET_USD = 25;
const MAX_REQUEST_JSON_BYTES = 32 * 1024;
const MAX_OUTPUT_JSON_BYTES = 64 * 1024;
const VIDEO_RENDER_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const MEDIA_TYPES: readonly SocialGenerationType[] = ["image", "video"];

export interface SocialGenerationDeps {
  textProvider?: TextProvider;
  imageProvider?: ImageProvider;
  videoProvider?: VideoProvider;
  storage?: SocialAssetStorage;
  env?: SocialAiEnv;
  now?: Date;
}

export interface SocialGeneration {
  id: string;
  organizationId: string;
  brandProfileId: string | null;
  campaignId: string | null;
  contentItemId: string | null;
  contentVariantId: string | null;
  generationType: SocialGenerationType;
  status: SocialGenerationStatus;
  provider: string;
  model: string;
  request: unknown;
  output: unknown;
  assetId: string | null;
  providerTaskId: string | null;
  usage: AiUsage;
  costUsd: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestedByUserId: string | null;
  requestedByAgentId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toView(row: GenerationRow): SocialGeneration {
  return {
    id: row.id,
    organizationId: row.organizationId,
    brandProfileId: row.brandProfileId,
    campaignId: row.campaignId,
    contentItemId: row.contentItemId,
    contentVariantId: row.contentVariantId,
    generationType: row.generationType,
    status: row.status,
    provider: row.provider,
    model: row.model,
    request: row.request,
    output: row.output,
    assetId: row.assetId,
    providerTaskId: row.providerTaskId,
    usage: (row.usage && typeof row.usage === "object" ? row.usage : {}) as AiUsage,
    costUsd: row.costUsd === null ? null : Number(row.costUsd),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    requestedByUserId: row.requestedByUserId,
    requestedByAgentId: row.requestedByAgentId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** JSON with object keys sorted recursively — the canonical form the fingerprint hashes. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Uint8Array) return `bytes:${createHash("sha256").update(v).digest("hex")}`;
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        const item = (v as Record<string, unknown>)[key];
        if (item !== undefined) out[key] = norm(item);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value)) ?? "null";
}

export function requestFingerprint(input: { organizationId: string; generationType: SocialGenerationType; provider: string; model: string; request: unknown }): string {
  return createHash("sha256").update(canonicalJson({ organizationId: input.organizationId, generationType: input.generationType, provider: input.provider, model: input.model, request: input.request })).digest("hex");
}

function truncateStrings(value: unknown, maxLen: number): unknown {
  if (typeof value === "string") return value.length > maxLen ? `${value.slice(0, maxLen)}… [truncated ${value.length - maxLen} chars]` : value;
  if (value instanceof Uint8Array) return `[${value.byteLength} bytes]`;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => truncateStrings(v, maxLen));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, truncateStrings(v, maxLen)]));
  return value;
}

/** Bounds a JSON value to `maxBytes`: long strings are truncated progressively; if still too large, a preview is stored instead. */
export function boundJson(value: unknown, maxBytes: number = MAX_REQUEST_JSON_BYTES): unknown {
  for (const limit of [8000, 2000, 500, 120]) {
    const candidate = truncateStrings(value ?? {}, limit);
    if (Buffer.byteLength(JSON.stringify(candidate) ?? "", "utf8") <= maxBytes) return candidate;
  }
  const json = JSON.stringify(value) ?? "";
  return { truncated: true, preview: json.slice(0, Math.max(0, Math.floor(maxBytes / 2) - 64)) };
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

async function envOf(deps?: SocialGenerationDeps): Promise<SocialAiEnv> {
  return deps?.env ?? loadSocialAiEnv();
}

// ---------------------------------------------------------------------------
// Begin / complete / fail
// ---------------------------------------------------------------------------

export interface BeginGenerationInput {
  organizationId: string;
  actorUserId: string | null;
  agentId?: string | null;
  brandProfileId?: string | null;
  campaignId?: string | null;
  contentItemId?: string | null;
  contentVariantId?: string | null;
  generationType: SocialGenerationType;
  provider: string;
  model: string;
  request: unknown;
  estimatedCostUsd?: number | null;
  providerTaskId?: string | null;
  env?: SocialAiEnv;
  now?: Date;
}

export async function getDailyMediaSpendUsd(db: Db, input: { organizationId: string; now?: Date }): Promise<number> {
  const since = startOfUtcDay(input.now ?? new Date());
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${socialAiGenerations.costUsd}), 0)` })
    .from(socialAiGenerations)
    .where(and(eq(socialAiGenerations.organizationId, input.organizationId), inArray(socialAiGenerations.generationType, [...MEDIA_TYPES]), inArray(socialAiGenerations.status, ["queued", "running", "succeeded"]), gte(socialAiGenerations.createdAt, since)));
  return Number(row?.total ?? 0);
}

export function dailyBudgetUsd(env: SocialAiEnv): number {
  const v = env.SOCIAL_AI_DAILY_BUDGET_USD;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_SOCIAL_AI_DAILY_BUDGET_USD;
}

/** Records a generation as `running` after the dedupe and daily-budget guards. Internal: callers have already checked authority. */
export async function beginGeneration(db: Db, input: BeginGenerationInput): Promise<SocialGeneration> {
  const fingerprint = requestFingerprint({ organizationId: input.organizationId, generationType: input.generationType, provider: input.provider, model: input.model, request: input.request });
  const [dupe] = await db
    .select({ id: socialAiGenerations.id })
    .from(socialAiGenerations)
    .where(and(eq(socialAiGenerations.organizationId, input.organizationId), eq(socialAiGenerations.requestFingerprint, fingerprint), inArray(socialAiGenerations.status, ["queued", "running"])))
    .limit(1);
  if (dupe) throw new SocialGenerationLimitError("an identical generation is already running");

  const estimate = input.estimatedCostUsd ?? null;
  if (MEDIA_TYPES.includes(input.generationType)) {
    const env = input.env ?? (await loadSocialAiEnv());
    const budget = dailyBudgetUsd(env);
    const spent = await getDailyMediaSpendUsd(db, { organizationId: input.organizationId, now: input.now });
    if (spent + (estimate ?? 0) > budget) throw new SocialGenerationLimitError(`today's media generation spend is ${money(spent)} and this request is estimated at ${money(estimate ?? 0)}, which exceeds the daily budget of ${money(budget)} (SOCIAL_AI_DAILY_BUDGET_USD)`);
  }

  const now = input.now ?? new Date();
  let row: GenerationRow;
  try {
    [row] = await db
      .insert(socialAiGenerations)
      .values({
        organizationId: input.organizationId,
        brandProfileId: input.brandProfileId ?? null,
        campaignId: input.campaignId ?? null,
        contentItemId: input.contentItemId ?? null,
        contentVariantId: input.contentVariantId ?? null,
        generationType: input.generationType,
        status: "running",
        provider: input.provider.slice(0, 60),
        model: input.model.slice(0, 200),
        requestFingerprint: fingerprint,
        request: boundJson(input.request, MAX_REQUEST_JSON_BYTES),
        providerTaskId: input.providerTaskId ?? null,
        // A running media generation counts against today's budget at its estimate until the provider reports the real figure.
        costUsd: estimate !== null ? estimate.toFixed(6) : null,
        usage: estimate !== null ? { costUsd: estimate, estimated: true } : {},
        requestedByUserId: input.actorUserId,
        requestedByAgentId: input.agentId ?? null,
        startedAt: now,
      })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SocialGenerationLimitError("an identical generation is already running");
    throw err;
  }
  await recordAuditEvent(db, {
    eventType: "social_generation_requested",
    actorUserId: input.actorUserId ?? undefined,
    actorAgentId: input.agentId ?? undefined,
    organizationId: input.organizationId,
    targetType: "social_ai_generation",
    targetId: row.id,
    metadata: { generationType: row.generationType, provider: row.provider, model: row.model, contentItemId: row.contentItemId, contentVariantId: row.contentVariantId, estimatedCostUsd: estimate },
  });
  return toView(row);
}

/** Stores the provider's task id on a running generation (async video renders). */
export async function recordProviderTask(db: Db, input: { organizationId: string; generationId: string; providerTaskId: string; model?: string }): Promise<void> {
  await db
    .update(socialAiGenerations)
    .set({ providerTaskId: input.providerTaskId.slice(0, 200), ...(input.model ? { model: input.model.slice(0, 200) } : {}), updatedAt: new Date() })
    .where(and(eq(socialAiGenerations.id, input.generationId), eq(socialAiGenerations.organizationId, input.organizationId)));
}

async function resolveGenerationRow(db: Db, organizationId: string, generationId: string): Promise<GenerationRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(socialAiGenerations).where(and(eq(socialAiGenerations.id, generationId), eq(socialAiGenerations.organizationId, organizationId)));
    return row;
  });
}

export async function completeGeneration(
  db: Db,
  input: { organizationId: string; generationId: string; output: unknown; usage: AiUsage; costUsd?: number | null; assetId?: string | null; providerTaskId?: string | null; model?: string }
): Promise<SocialGeneration> {
  const existing = await resolveGenerationRow(db, input.organizationId, input.generationId);
  if (existing.status === "succeeded") return toView(existing);
  const cost = input.costUsd ?? input.usage.costUsd ?? null;
  const [row] = await db
    .update(socialAiGenerations)
    .set({
      status: "succeeded",
      output: boundJson(input.output ?? {}, MAX_OUTPUT_JSON_BYTES),
      usage: boundJson(input.usage ?? {}, 4096),
      costUsd: cost !== null && Number.isFinite(cost) ? cost.toFixed(6) : null,
      ...(input.assetId !== undefined ? { assetId: input.assetId } : {}),
      ...(input.providerTaskId ? { providerTaskId: input.providerTaskId } : {}),
      ...(input.model ? { model: input.model.slice(0, 200) } : {}),
      errorCode: null,
      errorMessage: null,
      completedAt: new Date(),
      updatedAt: new Date(),
      revision: existing.revision + 1,
    })
    .where(and(eq(socialAiGenerations.id, existing.id), eq(socialAiGenerations.organizationId, input.organizationId), inArray(socialAiGenerations.status, ["queued", "running"])))
    .returning();
  if (!row) return toView(await resolveGenerationRow(db, input.organizationId, input.generationId));
  await recordAuditEvent(db, {
    eventType: "social_generation_completed",
    actorUserId: row.requestedByUserId ?? undefined,
    organizationId: input.organizationId,
    targetType: "social_ai_generation",
    targetId: row.id,
    metadata: { generationType: row.generationType, provider: row.provider, model: row.model, costUsd: cost, assetId: row.assetId, inputTokens: input.usage.inputTokens ?? null, outputTokens: input.usage.outputTokens ?? null },
  });
  return toView(row);
}

export async function failGeneration(db: Db, input: { organizationId: string; generationId: string; errorCode: string; errorMessage: string }): Promise<SocialGeneration> {
  const existing = await resolveGenerationRow(db, input.organizationId, input.generationId);
  if (existing.status === "failed" || existing.status === "succeeded" || existing.status === "cancelled") return toView(existing);
  const [row] = await db
    .update(socialAiGenerations)
    .set({ status: "failed", errorCode: input.errorCode.slice(0, 60), errorMessage: input.errorMessage.slice(0, 1000), costUsd: null, completedAt: new Date(), updatedAt: new Date(), revision: existing.revision + 1 })
    .where(and(eq(socialAiGenerations.id, existing.id), eq(socialAiGenerations.organizationId, input.organizationId), inArray(socialAiGenerations.status, ["queued", "running"])))
    .returning();
  if (!row) return toView(await resolveGenerationRow(db, input.organizationId, input.generationId));
  await recordAuditEvent(db, {
    eventType: "social_generation_failed",
    actorUserId: row.requestedByUserId ?? undefined,
    organizationId: input.organizationId,
    targetType: "social_ai_generation",
    targetId: row.id,
    metadata: { generationType: row.generationType, provider: row.provider, model: row.model, errorCode: row.errorCode, errorMessage: row.errorMessage },
  });
  return toView(row);
}

export function errorCodeFor(err: unknown): string {
  if (err && typeof err === "object" && "reason" in err && typeof (err as { reason: unknown }).reason === "string") return (err as { reason: string }).reason;
  return err instanceof Error ? err.name : "error";
}

export function errorMessageFor(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listGenerations(
  db: Db,
  input: { organizationId: string; actorUserId: string; brandProfileId?: string; contentItemId?: string; contentVariantId?: string; generationType?: SocialGenerationType; limit?: number }
): Promise<SocialGeneration[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_ai_generation", "list");
  const conditions = [eq(socialAiGenerations.organizationId, input.organizationId)];
  if (input.brandProfileId) conditions.push(eq(socialAiGenerations.brandProfileId, input.brandProfileId));
  if (input.contentItemId) conditions.push(eq(socialAiGenerations.contentItemId, input.contentItemId));
  if (input.contentVariantId) conditions.push(eq(socialAiGenerations.contentVariantId, input.contentVariantId));
  if (input.generationType) conditions.push(eq(socialAiGenerations.generationType, input.generationType));
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db.select().from(socialAiGenerations).where(and(...conditions)).orderBy(desc(socialAiGenerations.createdAt)).limit(limit);
  return rows.map(toView);
}

export async function getGenerationForUser(db: Db, input: { organizationId: string; generationId: string; actorUserId: string }): Promise<SocialGeneration> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_ai_generation", input.generationId);
  return toView(await resolveGenerationRow(db, input.organizationId, input.generationId));
}

export interface SocialGenerationUsageSummary {
  days: number;
  byProvider: { provider: string; model: string; count: number; succeeded: number; failed: number; costUsd: number }[];
  todaySpendUsd: number;
  dailyBudgetUsd: number;
}

export async function summarizeGenerationUsage(db: Db, input: { organizationId: string; actorUserId: string; days?: number; env?: SocialAiEnv; now?: Date }): Promise<SocialGenerationUsageSummary> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_ai_generation", "usage");
  const now = input.now ?? new Date();
  const days = Math.min(Math.max(Math.floor(input.days ?? 30), 1), 365);
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const rows = await db
    .select({
      provider: socialAiGenerations.provider,
      model: socialAiGenerations.model,
      count: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${socialAiGenerations.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${socialAiGenerations.status} = 'failed')::int`,
      costUsd: sql<string>`coalesce(sum(${socialAiGenerations.costUsd}) filter (where ${socialAiGenerations.status} = 'succeeded'), 0)`,
    })
    .from(socialAiGenerations)
    .where(and(eq(socialAiGenerations.organizationId, input.organizationId), gte(socialAiGenerations.createdAt, since)))
    .groupBy(socialAiGenerations.provider, socialAiGenerations.model)
    .orderBy(socialAiGenerations.provider, socialAiGenerations.model);
  const env = input.env ?? (await loadSocialAiEnv());
  return {
    days,
    byProvider: rows.map((r) => ({ provider: r.provider, model: r.model, count: Number(r.count), succeeded: Number(r.succeeded), failed: Number(r.failed), costUsd: Math.round(Number(r.costUsd) * 1e6) / 1e6 })),
    todaySpendUsd: Math.round((await getDailyMediaSpendUsd(db, { organizationId: input.organizationId, now })) * 1e6) / 1e6,
    dailyBudgetUsd: dailyBudgetUsd(env),
  };
}

// ---------------------------------------------------------------------------
// Recorded text generation
// ---------------------------------------------------------------------------

export interface GenerationScope {
  brandProfileId?: string | null;
  contentItemId?: string | null;
  contentVariantId?: string | null;
  campaignId?: string | null;
}

export interface RecordedTextResult<T = unknown> {
  generationId: string;
  text: string;
  json: T;
  provider: AiProviderId;
  model: string;
  usage: AiUsage;
}

/**
 * Runs one text generation through the resolved provider with a recorded
 * `social_ai_generations` row around it. `parse` (optional) validates the
 * JSON before the row is marked succeeded — an invalid output is recorded
 * as a failed generation, never a successful one.
 */
export async function generateTextRecorded<T = unknown>(
  db: Db,
  input: {
    organizationId: string;
    actorUserId: string | null;
    agentId?: string | null;
    scope?: GenerationScope;
    generationType: SocialGenerationType;
    system: string;
    prompt: string;
    jsonSchema?: Record<string, unknown>;
    maxOutputTokens?: number;
    temperature?: number;
    provider?: AiProviderId;
    parse?: (json: unknown, text: string) => T;
    deps?: SocialGenerationDeps;
  }
): Promise<RecordedTextResult<T>> {
  const provider = input.deps?.textProvider ?? resolveTextProvider(await envOf(input.deps), input.provider);
  const request = { system: input.system, prompt: input.prompt, jsonSchema: input.jsonSchema ?? null, maxOutputTokens: input.maxOutputTokens ?? null };
  const generation = await beginGeneration(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    agentId: input.agentId,
    brandProfileId: input.scope?.brandProfileId,
    contentItemId: input.scope?.contentItemId,
    contentVariantId: input.scope?.contentVariantId,
    campaignId: input.scope?.campaignId,
    generationType: input.generationType,
    provider: provider.id,
    model: provider.defaultModel,
    request,
    env: input.deps?.env,
    now: input.deps?.now,
  });
  try {
    const result = await provider.generateText({ system: input.system, prompt: input.prompt, jsonSchema: input.jsonSchema, maxOutputTokens: input.maxOutputTokens, temperature: input.temperature, idempotencyKey: generation.id });
    let parsed: T;
    try {
      parsed = input.parse ? input.parse(result.json, result.text) : (result.json as T);
    } catch (err) {
      throw new SocialGenerationFailedError(provider.label, `the model returned output that does not match the expected shape${err instanceof Error && err.message ? ` (${err.message.slice(0, 200)})` : ""}`, true);
    }
    await completeGeneration(db, { organizationId: input.organizationId, generationId: generation.id, output: { text: result.text, json: result.json ?? null, model: result.model }, usage: result.usage, model: result.model });
    return { generationId: generation.id, text: result.text, json: parsed, provider: result.provider, model: result.model, usage: result.usage };
  } catch (err) {
    await failGeneration(db, { organizationId: input.organizationId, generationId: generation.id, errorCode: errorCodeFor(err), errorMessage: errorMessageFor(err) });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Variant media helpers (shared with studio.ts)
// ---------------------------------------------------------------------------

/** Puts `assetId` at position 0 as the primary media, dropping any previous primary and keeping the rest (renumbered). */
export function withPrimaryMedia(media: SocialVariantMedia, assetId: string): SocialVariantMedia {
  const rest = media.filter((m) => m.role !== "primary" && m.assetId !== assetId);
  const ordered = [...rest].sort((a, b) => a.position - b.position);
  return [{ assetId, position: 0, role: "primary" as const }, ...ordered.map((m, i) => ({ ...m, position: Math.min(i + 1, 49) }))].slice(0, 50);
}

/** The format a variant should take once it carries a generated video. */
export function videoFormatFor(platform: string, current: string): SocialVariantFormat {
  const p = socialOrganicPlatformSchema.safeParse(platform);
  if (!p.success) return "video";
  const rules = SOCIAL_PLATFORM_RULES[p.data];
  if (["reel", "short_video", "video", "story"].includes(current) && (rules.formats as readonly string[]).includes(current)) return current as SocialVariantFormat;
  if (p.data === "instagram") return "reel";
  if (p.data === "tiktok") return "short_video";
  if (p.data === "youtube") return "short_video";
  return rules.formats.includes("video") ? "video" : rules.formats[0];
}

/** Attaches a generated asset to a variant as its primary media (direct CAS update preserving other media), clears `generating`, recomputes warnings and audits. Returns false when the variant moved on (archived / no longer editable). */
export async function attachGeneratedMedia(
  db: Db,
  input: { organizationId: string; contentVariantId: string; assetId: string; generationId: string; actorUserId: string | null; format?: SocialVariantFormat }
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [variant] = await db.select().from(socialContentVariants).where(and(eq(socialContentVariants.id, input.contentVariantId), eq(socialContentVariants.organizationId, input.organizationId)));
    if (!variant || variant.archivedAt) return false;
    if (!["draft", "generating", "changes_requested"].includes(variant.status)) return false;
    const current = socialVariantMediaSchema.safeParse(variant.media);
    const media = withPrimaryMedia(current.success ? current.data : [], input.assetId);
    const [row] = await db
      .update(socialContentVariants)
      .set({ media, ...(input.format ? { format: input.format } : {}), status: variant.status === "generating" ? "draft" : variant.status, lastGenerationId: input.generationId, revision: variant.revision + 1, updatedAt: new Date() })
      .where(and(eq(socialContentVariants.id, variant.id), eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.revision, variant.revision)))
      .returning();
    if (!row) continue;
    const warnings = await computeStoredVariantWarnings(db, input.organizationId, row);
    await db.update(socialContentVariants).set({ warnings }).where(and(eq(socialContentVariants.id, row.id), eq(socialContentVariants.organizationId, input.organizationId)));
    await recordAuditEvent(db, { eventType: "social_variant_updated", actorUserId: input.actorUserId ?? undefined, organizationId: input.organizationId, targetType: "social_content_variant", targetId: row.id, metadata: { fields: ["media", ...(input.format ? ["format"] : [])], generationId: input.generationId, assetId: input.assetId, from: variant.status, to: row.status } });
    await syncContentItemStatus(db, input.organizationId, row.contentItemId);
    return true;
  }
  return false;
}

/** Returns a variant left in `generating` by a failed render to `draft`. */
async function releaseGeneratingVariant(db: Db, organizationId: string, contentVariantId: string | null): Promise<void> {
  if (!contentVariantId) return;
  const [variant] = await db.select().from(socialContentVariants).where(and(eq(socialContentVariants.id, contentVariantId), eq(socialContentVariants.organizationId, organizationId)));
  if (!variant || variant.status !== "generating") return;
  await db
    .update(socialContentVariants)
    .set({ status: "draft", revision: variant.revision + 1, updatedAt: new Date() })
    .where(and(eq(socialContentVariants.id, variant.id), eq(socialContentVariants.organizationId, organizationId), eq(socialContentVariants.revision, variant.revision), eq(socialContentVariants.status, "generating")));
}

// ---------------------------------------------------------------------------
// Worker entry: finish an async video render
// ---------------------------------------------------------------------------

export async function runGenerationJob(db: Db, input: { organizationId: string; generationId: string; runtimeJobId?: string; deps?: SocialGenerationDeps }): Promise<Record<string, unknown>> {
  const row = await resolveGenerationRow(db, input.organizationId, input.generationId);
  if (row.status !== "queued" && row.status !== "running") return { generationId: row.id, status: row.status, skipped: true };
  if (row.generationType !== "video") {
    await failGeneration(db, { organizationId: input.organizationId, generationId: row.id, errorCode: "not_async", errorMessage: "only video generations run in the background" });
    throw new SocialGenerationFailedError(row.provider, "only video generations run in the background", false);
  }
  if (!row.providerTaskId) {
    await failGeneration(db, { organizationId: input.organizationId, generationId: row.id, errorCode: "missing_task", errorMessage: "the provider task id was never recorded" });
    await releaseGeneratingVariant(db, input.organizationId, row.contentVariantId);
    throw new SocialGenerationFailedError(row.provider, "the provider task id was never recorded", false);
  }
  const env = await envOf(input.deps);
  const provider = input.deps?.videoProvider ?? resolveProviderById(env, row.provider as AiProviderId, "video");
  if (!provider) {
    await failGeneration(db, { organizationId: input.organizationId, generationId: row.id, errorCode: "unknown_provider", errorMessage: `unknown video provider "${row.provider}"` });
    await releaseGeneratingVariant(db, input.organizationId, row.contentVariantId);
    throw new SocialGenerationFailedError(row.provider, "unknown video provider", false);
  }

  const status = await provider.pollVideo(row.providerTaskId);
  const now = input.deps?.now ?? new Date();
  if (status.status === "pending" || status.status === "running") {
    if (row.startedAt && now.getTime() - row.startedAt.getTime() > VIDEO_RENDER_TIMEOUT_MS) {
      if (provider.cancelVideo) await provider.cancelVideo(row.providerTaskId).catch(() => undefined);
      await failGeneration(db, { organizationId: input.organizationId, generationId: row.id, errorCode: "timeout", errorMessage: "the render did not finish within 3 hours" });
      await releaseGeneratingVariant(db, input.organizationId, row.contentVariantId);
      throw new SocialGenerationFailedError(provider.label, "the render did not finish in time", false);
    }
    throw new SocialGenerationFailedError(provider.label, "still rendering", true);
  }
  if (status.status === "failed" || status.status === "cancelled") {
    const message = status.status === "cancelled" ? "the render was cancelled" : (status.failureMessage ?? "the render failed");
    await failGeneration(db, { organizationId: input.organizationId, generationId: row.id, errorCode: status.failureCode ?? status.status, errorMessage: message });
    await releaseGeneratingVariant(db, input.organizationId, row.contentVariantId);
    throw new SocialGenerationFailedError(provider.label, message, false);
  }
  if (!status.outputUrl) throw new SocialGenerationFailedError(provider.label, "the render finished without an output URL", true);

  const download = await provider.downloadVideo(status.outputUrl, { maxBytes: SOCIAL_ASSET_MAX_BYTES });
  const contentType = download.contentType === "video/quicktime" ? "video/quicktime" : "video/mp4";
  const request = (row.request && typeof row.request === "object" ? row.request : {}) as Record<string, unknown>;
  const duration = typeof request.durationSeconds === "number" ? request.durationSeconds : null;
  const perSecond = provider.estimatedCostPerSecondUsd(row.model);
  const costUsd = perSecond !== null && duration !== null ? Math.round(perSecond * duration * 1e6) / 1e6 : null;
  const asset = await createGeneratedAsset(db, {
    organizationId: input.organizationId,
    brandProfileId: row.brandProfileId,
    contentItemId: row.contentItemId,
    contentVariantId: row.contentVariantId,
    assetType: "video",
    title: typeof request.title === "string" && request.title ? request.title : "Generated video",
    provider: row.provider,
    model: row.model,
    generationId: row.id,
    file: { bytes: download.bytes, contentType, filename: "generated.mp4" },
    actorUserId: row.requestedByUserId,
    storage: input.deps?.storage,
  });
  await completeGeneration(db, { organizationId: input.organizationId, generationId: row.id, output: { assetId: asset.id, outputUrlHost: safeHost(status.outputUrl) }, usage: { units: duration ?? undefined, ...(costUsd !== null ? { costUsd, estimated: true } : {}) }, costUsd, assetId: asset.id });
  let attached = false;
  if (row.contentVariantId) {
    const [variant] = await db.select({ platform: socialContentVariants.platform, format: socialContentVariants.format }).from(socialContentVariants).where(and(eq(socialContentVariants.id, row.contentVariantId), eq(socialContentVariants.organizationId, input.organizationId)));
    if (variant) attached = await attachGeneratedMedia(db, { organizationId: input.organizationId, contentVariantId: row.contentVariantId, assetId: asset.id, generationId: row.id, actorUserId: row.requestedByUserId, format: videoFormatFor(variant.platform, variant.format) });
  }
  return { generationId: row.id, status: "succeeded", assetId: asset.id, attachedToVariant: attached };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
