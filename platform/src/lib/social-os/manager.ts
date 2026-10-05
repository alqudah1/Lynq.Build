import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { z } from "zod";
import { socialManagerMessages, socialManagerThreads } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { resolveMarketingAuthContext, requireMarketingGenerateContentAuthority, requireMarketingViewAuthority } from "@/lib/marketing-os/authz";
import { assembleBrandContext, listBrands, requireActiveBrand, type BrandContext } from "./brands";
import { getSocialCalendar } from "./calendar";
import { listAccountsForBrand } from "./connections";
import { createContentItem, getContentItemForUser, listContentItemsForUser, listPendingApprovals, updateContentItem, updateVariant } from "./content";
import { SocialVariantNotPublishableError } from "./errors";
import { errorMessageFor, generateTextRecorded, type SocialGenerationDeps } from "./generation";
import { extractJsonObject } from "./providers/ai/http";
import { loadSocialAiEnv, resolveTextProvider } from "./providers/ai/registry";
import type { TextGenerationRequest, TextGenerationResult, TextProvider } from "./providers/ai/types";
import { analyzePerformance, gatherPerformanceEvidence, generateContentIdeas, generateVariantsForItem, planWeek } from "./studio";
import { SOCIAL_CONTENT_KINDS, SOCIAL_CONTENT_OBJECTIVES, socialContentBriefSchema, socialOrganicPlatformSchema } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type ThreadRow = typeof socialManagerThreads.$inferSelect;
type MessageRow = typeof socialManagerMessages.$inferSelect;

/**
 * Module 19 — the AI Social Manager: persistent threads and a bounded
 * tool-calling loop. The loop speaks a provider-neutral JSON protocol
 * (`{"tool": name, "input": {...}}` or `{"final": "..."}`) so it works the
 * same on Anthropic, OpenAI and the Office gateway. Every tool calls the
 * real service with the ACTOR's own authority, so marketing permissions
 * apply exactly as in the UI. There is deliberately no publish, approve or
 * advertising tool: publishing needs a human decision in the Approval
 * Center.
 */

export const MANAGER_MAX_STEPS = 8;
export const MANAGER_TOOL_RESULT_MAX_BYTES = 4096;
const HISTORY_LIMIT = 20;
const DEFAULT_THREAD_TITLE = "New conversation";

// ---------------------------------------------------------------------------
// Protocol + loop (provider-neutral, pure apart from the injected calls)
// ---------------------------------------------------------------------------

export interface ManagerProposedAction {
  type: "content_item" | "schedule_proposal" | "ideas" | "analysis";
  id: string;
  label: string;
}

export interface ManagerToolOutcome {
  result: unknown;
  proposedActions?: ManagerProposedAction[];
}

export interface ManagerTool {
  name: string;
  description: string;
  input: z.ZodType;
  execute(input: unknown): Promise<ManagerToolOutcome>;
}

export interface ManagerLoopMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
}

export interface ManagerLoopStep {
  tool: string;
  input: unknown;
  ok: boolean;
  result: unknown;
  error?: string;
}

export interface ManagerLoopResult {
  final: string;
  steps: ManagerLoopStep[];
  proposedActions: ManagerProposedAction[];
  stoppedReason: "final" | "max_steps" | "malformed";
  modelCalls: number;
}

/** Bounds a tool result to `maxBytes` of JSON: arrays are halved (deeply) until it fits, then a truncated preview. Pure. */
export function boundToolResult(value: unknown, maxBytes = MANAGER_TOOL_RESULT_MAX_BYTES): unknown {
  const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v) ?? "null", "utf8");
  if (size(value) <= maxBytes) return value;
  const shrink = (v: unknown, keep: number): unknown => {
    if (Array.isArray(v)) return v.slice(0, keep).map((x) => shrink(x, keep));
    if (typeof v === "string") return v.length > keep * 40 ? `${v.slice(0, keep * 40)}…` : v;
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shrink(x, keep)]));
    return v;
  };
  for (const keep of [20, 10, 5, 3, 1]) {
    const candidate = shrink(value, keep);
    if (size(candidate) <= maxBytes) return { ...(candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : { items: candidate }), _truncated: true };
  }
  return { _truncated: true, preview: (JSON.stringify(value) ?? "").slice(0, maxBytes - 100) };
}

export function protocolInstructions(tools: ManagerTool[]): string {
  const catalog = tools.map((t) => {
    let schema: unknown = {};
    try {
      schema = z.toJSONSchema(t.input, { io: "input", unrepresentable: "any" });
    } catch {
      schema = {};
    }
    const { $schema: _ignored, ...rest } = (schema ?? {}) as Record<string, unknown>;
    void _ignored;
    return `- ${t.name}: ${t.description}\n  input schema: ${JSON.stringify(rest)}`;
  });
  return [
    "TOOL PROTOCOL — every reply you write must be exactly ONE JSON object and nothing else:",
    '  to call a tool: {"tool": "<tool name>", "input": { ... }}',
    '  to answer the user: {"final": "<your reply to the user, plain text>"}',
    "Call one tool at a time; you will see its result, then decide the next step. Use tools to read real data before you state facts about the account.",
    "Available tools:",
    ...catalog,
  ].join("\n");
}

function renderTranscript(messages: ManagerLoopMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === "tool") return `[tool result: ${m.toolName ?? "tool"}]\n${m.content}`;
      return `[${m.role}]\n${m.content}`;
    })
    .join("\n\n");
}

type ParsedReply = { kind: "tool"; tool: string; input: unknown } | { kind: "final"; text: string } | { kind: "malformed" };

/** Parses one model reply under the protocol. Pure. */
export function parseManagerReply(result: { text: string; json?: unknown }): ParsedReply {
  const candidate = result.json && typeof result.json === "object" ? result.json : extractJsonObject(result.text);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { kind: "malformed" };
  const obj = candidate as Record<string, unknown>;
  if (typeof obj.tool === "string" && obj.tool.trim()) return { kind: "tool", tool: obj.tool.trim(), input: obj.input ?? {} };
  if (typeof obj.final === "string") return { kind: "final", text: obj.final };
  return { kind: "malformed" };
}

/**
 * The bounded manager loop. Each model call either requests one tool (run
 * here with schema-validated input; failures become an `{error}` result the
 * model can react to) or produces the final reply. Stops at `maxSteps`
 * model calls, or after two consecutive replies that break the protocol.
 * Provider errors propagate to the caller.
 */
export async function runManagerLoop(input: { textProvider: TextProvider; tools: ManagerTool[]; system: string; messages: ManagerLoopMessage[]; maxSteps?: number; maxOutputTokens?: number }): Promise<ManagerLoopResult> {
  const maxSteps = Math.min(Math.max(input.maxSteps ?? MANAGER_MAX_STEPS, 1), 20);
  const system = `${input.system}\n\n${protocolInstructions(input.tools)}`;
  const transcript: ManagerLoopMessage[] = [...input.messages];
  const steps: ManagerLoopStep[] = [];
  const proposedActions: ManagerProposedAction[] = [];
  const toolsByName = new Map(input.tools.map((t) => [t.name, t]));
  let malformedInARow = 0;

  for (let call = 1; call <= maxSteps; call++) {
    const request: TextGenerationRequest = { system, prompt: `${renderTranscript(transcript)}\n\nReply now with exactly one JSON object.`, maxOutputTokens: input.maxOutputTokens ?? 2000 };
    const reply = await input.textProvider.generateText(request);
    const parsed = parseManagerReply(reply);

    if (parsed.kind === "final") return { final: parsed.text.trim() || "Done.", steps, proposedActions, stoppedReason: "final", modelCalls: call };

    if (parsed.kind === "malformed") {
      malformedInARow++;
      if (malformedInARow >= 2) {
        const plain = reply.text.trim();
        const looksLikeJson = plain.startsWith("{") || plain.startsWith("```");
        return { final: plain && !looksLikeJson ? plain.slice(0, 4000) : "I could not complete that request — please try rephrasing it.", steps, proposedActions, stoppedReason: "malformed", modelCalls: call };
      }
      transcript.push({ role: "assistant", content: reply.text.slice(0, 2000) });
      transcript.push({ role: "user", content: 'PROTOCOL ERROR: your last reply was not a valid protocol object. Reply with {"tool": ..., "input": {...}} or {"final": "..."} only.' });
      continue;
    }

    malformedInARow = 0;
    const tool = toolsByName.get(parsed.tool);
    let step: ManagerLoopStep;
    if (!tool) {
      step = { tool: parsed.tool, input: parsed.input, ok: false, result: { error: `unknown tool "${parsed.tool}"` }, error: `unknown tool "${parsed.tool}"` };
    } else {
      const validated = tool.input.safeParse(parsed.input ?? {});
      if (!validated.success) {
        const message = validated.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ").slice(0, 500);
        step = { tool: tool.name, input: parsed.input, ok: false, result: { error: `invalid input — ${message}` }, error: message };
      } else {
        try {
          const outcome = await tool.execute(validated.data);
          if (outcome.proposedActions?.length) proposedActions.push(...outcome.proposedActions);
          step = { tool: tool.name, input: validated.data, ok: true, result: boundToolResult(outcome.result) };
        } catch (err) {
          const message = errorMessageFor(err).slice(0, 500);
          step = { tool: tool.name, input: validated.data, ok: false, result: { error: message }, error: message };
        }
      }
    }
    steps.push(step);
    transcript.push({ role: "assistant", content: JSON.stringify({ tool: step.tool, input: step.input }) });
    transcript.push({ role: "tool", toolName: step.tool, content: JSON.stringify(step.result) });
  }

  const did = steps.filter((s) => s.ok).map((s) => s.tool);
  const summary = `I reached my limit of ${maxSteps} steps before finishing.${did.length ? ` So far I ran: ${[...new Set(did)].join(", ")}.` : ""}${proposedActions.length ? ` I created ${proposedActions.length} draft record(s) for you to review.` : ""} Ask me to continue if you want me to keep going.`;
  return { final: summary, steps, proposedActions, stoppedReason: "max_steps", modelCalls: maxSteps };
}

// ---------------------------------------------------------------------------
// System prompt (pure)
// ---------------------------------------------------------------------------

export function buildManagerSystemPrompt(input: { brand: BrandContext | null; today: Date; actorCanPublish?: boolean }): string {
  return [
    "You are the AI Social Media Manager inside LYNQ's Social Command Center. You plan, draft and analyse social content for the founder's brands, using the tools provided to read real data and create drafts.",
    `Today is ${input.today.toISOString().slice(0, 10)} (UTC).`,
    "HARD RULES:",
    "1. Publishing always requires the founder's explicit approval in the Approval Center. You cannot publish, approve, schedule for publishing, reply publicly or change ads — never say or imply that you did.",
    "2. Never claim something was published, scheduled to go live, or sent. Drafts you create are drafts awaiting review.",
    "3. Never invent metrics, results or facts. Only cite numbers returned by a tool; if a tool says no data is available, say so.",
    "4. When you create or change records (drafts, proposed dates), list them in your final reply so the founder can review them — they are also recorded as proposed actions.",
    "5. Follow the brand's guardrails, prohibited language and never-claim list in everything you write.",
    "6. Keep final replies concise and practical: what you found, what you created, what the founder should do next.",
    input.brand ? `\nACTIVE BRAND CONTEXT:\n${input.brand.text}\nRecent topics: ${input.brand.recentTopics.join(" | ") || "none yet"}` : "\nNo brand is attached to this conversation; use list_brands and pass brandProfileId to brand-specific tools.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tools (each runs with the actor's own authority)
// ---------------------------------------------------------------------------

const isoDate = z.string().trim().refine((v) => !Number.isNaN(new Date(v).getTime()), "must be an ISO 8601 date/time");
const brandIdField = z.string().uuid().optional().describe("Only needed when the conversation has no brand");

export function buildManagerTools(db: Db, ctx: { organizationId: string; actorUserId: string; threadBrandProfileId: string | null; deps?: SocialGenerationDeps; now?: () => Date }): ManagerTool[] {
  const { organizationId, actorUserId } = ctx;
  const now = ctx.now ?? (() => ctx.deps?.now ?? new Date());
  const deps = ctx.deps;

  async function brandFor(explicit?: string): Promise<string> {
    if (explicit) return (await requireActiveBrand(db, organizationId, explicit)).id;
    if (ctx.threadBrandProfileId) return ctx.threadBrandProfileId;
    const brands = await listBrands(db, { organizationId, actorUserId });
    if (brands.length === 1) return brands[0].id;
    throw new SocialVariantNotPublishableError([brands.length ? "this conversation has no brand — call list_brands and pass brandProfileId" : "no brand exists yet — create one in Brand settings first"]);
  }

  const tools: ManagerTool[] = [
    {
      name: "list_brands",
      description: "List the organization's active brands (id, name, preferred platforms).",
      input: z.object({}).strict(),
      async execute() {
        const brands = await listBrands(db, { organizationId, actorUserId });
        return { result: brands.map((b) => ({ id: b.id, name: b.name, brandKey: b.brandKey, preferredPlatforms: b.preferredPlatforms })) };
      },
    },
    {
      name: "get_brand_context",
      description: "Read the brand's positioning, voice, audience, pillars, guardrails and recent topics.",
      input: z.object({ brandProfileId: brandIdField }).strict(),
      async execute(raw) {
        const input = raw as { brandProfileId?: string };
        const brandProfileId = await brandFor(input.brandProfileId);
        const ctxView = await assembleBrandContext(db, { organizationId, brandProfileId });
        return { result: { brandProfileId, name: ctxView.name, context: ctxView.text, facts: ctxView.facts, recentTopics: ctxView.recentTopics } };
      },
    },
    {
      name: "list_recent_content",
      description: "List the 20 most recent content items for the brand with each platform variant's status and schedule.",
      input: z.object({ brandProfileId: brandIdField }).strict(),
      async execute(raw) {
        const input = raw as { brandProfileId?: string };
        const brandProfileId = await brandFor(input.brandProfileId);
        const items = await listContentItemsForUser(db, { organizationId, actorUserId, brandProfileId, limit: 20 });
        return { result: items.map((i) => ({ id: i.id, title: i.title, status: i.status, kind: i.brief.kind, plannedPublishAt: i.plannedPublishAt?.toISOString() ?? null, variants: i.variants.map((v) => ({ id: v.id, platform: v.platform, status: v.status, scheduledFor: v.scheduledFor?.toISOString() ?? null, publishedAt: v.publishedAt?.toISOString() ?? null, blocking: v.warnings.filter((w) => w.severity === "blocking").length })) })) };
      },
    },
    {
      name: "get_calendar",
      description: "The brand's content calendar for the next 14 days plus detected gaps (preferred platforms with nothing planned).",
      input: z.object({ brandProfileId: brandIdField }).strict(),
      async execute(raw) {
        const input = raw as { brandProfileId?: string };
        const brandProfileId = await brandFor(input.brandProfileId);
        const from = now();
        const to = new Date(from.getTime() + 14 * 24 * 3600 * 1000);
        const cal = await getSocialCalendar(db, { organizationId, actorUserId, brandProfileId, from, to, view: "week", now: from });
        return { result: { range: cal.range, entries: cal.entries.map((e) => ({ date: e.date, title: e.title, platform: e.platform, status: e.status, contentItemId: e.contentItemId, variantId: e.variantId })), undatedDrafts: cal.undated.length, gaps: cal.gaps, countsByStatus: cal.countsByStatus } };
      },
    },
    {
      name: "get_performance_summary",
      description: "Real performance numbers for the brand's recently published posts and accounts (no analysis). Returns empty lists when nothing has been synced.",
      input: z.object({ days: z.number().int().min(1).max(180).optional(), brandProfileId: brandIdField }).strict(),
      async execute(raw) {
        const input = raw as { days?: number; brandProfileId?: string };
        const brandProfileId = await brandFor(input.brandProfileId);
        const evidence = await gatherPerformanceEvidence(db, { organizationId, brandProfileId, actorUserId, days: input.days ?? 30, now: now() });
        return { result: { ...evidence, posts: evidence.posts.slice(0, 10), note: evidence.postsWithMetrics === 0 && evidence.accounts.length === 0 ? "No performance data has been synced or recorded for this window." : undefined } };
      },
    },
    {
      name: "list_connections",
      description: "The brand's social accounts and their honest connection status (connected / manual / token_expired …).",
      input: z.object({ brandProfileId: brandIdField }).strict(),
      async execute(raw) {
        const input = raw as { brandProfileId?: string };
        const brandProfileId = await brandFor(input.brandProfileId);
        const accounts = await listAccountsForBrand(db, { organizationId, brandProfileId, actorUserId });
        return { result: accounts.map((a) => ({ id: a.id, platform: a.platform, displayName: a.displayName, connectionStatus: a.connectionStatus, canPublish: a.canPublish, tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null, lastError: a.lastErrorMessage })) };
      },
    },
    {
      name: "list_pending_approvals",
      description: "Posts waiting for the founder's decision in the Approval Center.",
      input: z.object({ brandProfileId: brandIdField }).strict(),
      async execute(raw) {
        const input = raw as { brandProfileId?: string };
        const brandProfileId = input.brandProfileId ?? ctx.threadBrandProfileId ?? undefined;
        const pending = await listPendingApprovals(db, { organizationId, actorUserId, brandProfileId });
        return { result: pending.slice(0, 20).map((p) => ({ variantId: p.variant.id, contentItemId: p.contentItemId, title: p.title, platform: p.variant.platform, submittedAt: p.submittedAt.toISOString(), scheduledFor: p.variant.scheduledFor?.toISOString() ?? null })) };
      },
    },
    {
      name: "create_content_draft",
      description: "Create a new DRAFT content item for the brand and generate platform-specific copy for each platform. Nothing is submitted or published.",
      input: z
        .object({
          title: z.string().trim().min(1).max(200),
          kind: z.enum(SOCIAL_CONTENT_KINDS).default("text_post"),
          objective: z.enum(SOCIAL_CONTENT_OBJECTIVES).default("engagement"),
          topic: z.string().trim().min(1).max(2000),
          platforms: z.array(socialOrganicPlatformSchema).min(1).max(6),
          hook: z.string().trim().max(400).optional(),
          callToAction: z.string().trim().max(300).optional(),
          scheduledFor: isoDate.optional().describe("Proposed date (ISO); the founder still approves before anything is scheduled to publish"),
          brandProfileId: brandIdField,
        })
        .strict(),
      async execute(raw) {
        const input = raw as { title: string; kind: (typeof SOCIAL_CONTENT_KINDS)[number]; objective: (typeof SOCIAL_CONTENT_OBJECTIVES)[number]; topic: string; platforms: z.infer<typeof socialOrganicPlatformSchema>[]; hook?: string; callToAction?: string; scheduledFor?: string; brandProfileId?: string };
        const brandProfileId = await brandFor(input.brandProfileId);
        const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
        if (scheduledFor && scheduledFor.getTime() <= now().getTime()) throw new SocialVariantNotPublishableError(["the proposed date must be in the future"]);
        const brief = socialContentBriefSchema.parse({ kind: input.kind, objective: input.objective, topic: input.topic, hook: input.hook ?? "", callToAction: input.callToAction ?? "" });
        const item = await createContentItem(db, { organizationId, actorUserId, brandProfileId, title: input.title, brief, platforms: input.platforms, scheduledFor });
        let generated: { generationId: string; platforms: string[] } | { error: string };
        try {
          const g = await generateVariantsForItem(db, { organizationId, contentItemId: item.id, actorUserId, deps });
          generated = { generationId: g.generationId, platforms: g.variants.map((v) => v.platform) };
        } catch (err) {
          generated = { error: `the draft was created but copy generation failed: ${errorMessageFor(err).slice(0, 300)}` };
        }
        const fresh = await getContentItemForUser(db, { organizationId, contentItemId: item.id, actorUserId });
        return {
          result: { contentItemId: item.id, title: item.title, status: fresh.status, generation: generated, variants: fresh.variants.map((v) => ({ id: v.id, platform: v.platform, status: v.status, hook: v.hook, bodyPreview: v.body.slice(0, 200) })) },
          proposedActions: [{ type: "content_item", id: item.id, label: item.title }],
        };
      },
    },
    {
      name: "generate_ideas",
      description: "Brainstorm post ideas for the brand (not saved). Use create_content_draft for the ones worth drafting.",
      input: z.object({ count: z.number().int().min(1).max(10).optional(), theme: z.string().trim().max(500).optional(), platforms: z.array(socialOrganicPlatformSchema).max(6).optional(), brandProfileId: brandIdField }).strict(),
      async execute(raw) {
        const input = raw as { count?: number; theme?: string; platforms?: z.infer<typeof socialOrganicPlatformSchema>[]; brandProfileId?: string };
        const brandProfileId = await brandFor(input.brandProfileId);
        const out = await generateContentIdeas(db, { organizationId, brandProfileId, actorUserId, count: input.count, theme: input.theme, platforms: input.platforms, deps });
        return { result: out };
      },
    },
    {
      name: "plan_week",
      description: "Plan a week of posts: creates DRAFT content items with proposed weekday times and generates their copy. Never submits or publishes.",
      input: z.object({ weekStart: isoDate.describe("The first day of the week to plan (ISO date)"), postsPerWeek: z.number().int().min(1).max(7).optional(), theme: z.string().trim().max(500).optional(), brandProfileId: brandIdField }).strict(),
      async execute(raw) {
        const input = raw as { weekStart: string; postsPerWeek?: number; theme?: string; brandProfileId?: string };
        const brandProfileId = await brandFor(input.brandProfileId);
        const out = await planWeek(db, { organizationId, brandProfileId, actorUserId, weekStart: new Date(input.weekStart), postsPerWeek: input.postsPerWeek, theme: input.theme, deps });
        return { result: out, proposedActions: out.createdContentItemIds.map((id, i) => ({ type: "content_item" as const, id, label: `Weekly plan draft ${i + 1}` })) };
      },
    },
    {
      name: "analyze_performance",
      description: "Analyse the brand's real performance data and recommend next steps. Returns available:false (without guessing) when there is no data.",
      input: z.object({ days: z.number().int().min(1).max(180).optional(), brandProfileId: brandIdField }).strict(),
      async execute(raw) {
        const input = raw as { days?: number; brandProfileId?: string };
        const brandProfileId = await brandFor(input.brandProfileId);
        const out = await analyzePerformance(db, { organizationId, brandProfileId, actorUserId, days: input.days, deps });
        return out.available ? { result: { available: true, analysis: out.analysis, postsAnalysed: out.evidence.postsWithMetrics, accountsAnalysed: out.evidence.accounts.length } } : { result: { available: false, reason: out.reason } };
      },
    },
    {
      name: "propose_schedule",
      description: "Propose a date for a content item: sets its planned date and the scheduled time on its DRAFT variants. It does not schedule publishing — the founder approves first.",
      input: z.object({ contentItemId: z.string().uuid(), scheduledFor: isoDate }).strict(),
      async execute(raw) {
        const input = raw as { contentItemId: string; scheduledFor: string };
        const when = new Date(input.scheduledFor);
        if (when.getTime() <= now().getTime()) throw new SocialVariantNotPublishableError(["the proposed date must be in the future"]);
        const item = await getContentItemForUser(db, { organizationId, contentItemId: input.contentItemId, actorUserId });
        await updateContentItem(db, { organizationId, contentItemId: item.id, actorUserId, expectedRevision: item.revision, changes: { plannedPublishAt: when } });
        const updated: string[] = [];
        const skipped: { variantId: string; status: string }[] = [];
        for (const v of item.variants) {
          if (v.status !== "draft") {
            skipped.push({ variantId: v.id, status: v.status });
            continue;
          }
          await updateVariant(db, { organizationId, contentVariantId: v.id, actorUserId, expectedRevision: v.revision, changes: { scheduledFor: when } });
          updated.push(v.id);
        }
        return { result: { contentItemId: item.id, proposedFor: when.toISOString(), updatedDraftVariants: updated, untouchedVariants: skipped, note: "Proposed only — publishing still requires approval." }, proposedActions: [{ type: "schedule_proposal", id: item.id, label: `${item.title} → ${when.toISOString()}` }] };
      },
    },
  ];
  return tools;
}

/** Names of tools the manager can never have — asserted by tests. */
export const FORBIDDEN_MANAGER_TOOL_PATTERN = /publish|approve|ad_|ads|reply|send|delete|archive|budget/i;

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export interface SocialManagerMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls: unknown[];
  proposedActions: ManagerProposedAction[];
  generationId: string | null;
  createdAt: Date;
}

export interface SocialManagerThread {
  id: string;
  organizationId: string;
  brandProfileId: string | null;
  title: string;
  ownerUserId: string;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  messages?: SocialManagerMessage[];
}

function toThread(row: ThreadRow, messages?: MessageRow[]): SocialManagerThread {
  return {
    id: row.id,
    organizationId: row.organizationId,
    brandProfileId: row.brandProfileId,
    title: row.title,
    ownerUserId: row.ownerUserId,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(messages ? { messages: messages.map(toMessage) } : {}),
  };
}

function toMessage(row: MessageRow): SocialManagerMessage {
  return { id: row.id, role: row.role, content: row.content, toolCalls: Array.isArray(row.toolCalls) ? row.toolCalls : [], proposedActions: Array.isArray(row.proposedActions) ? (row.proposedActions as ManagerProposedAction[]) : [], generationId: row.generationId, createdAt: row.createdAt };
}

/** Threads are private to their owner: anyone else (including another org member) gets a 404. */
async function resolveOwnedThread(db: Db, organizationId: string, threadId: string, actorUserId: string): Promise<ThreadRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(socialManagerThreads).where(and(eq(socialManagerThreads.id, threadId), eq(socialManagerThreads.organizationId, organizationId), eq(socialManagerThreads.ownerUserId, actorUserId)));
    return row && !row.archivedAt ? row : undefined;
  });
}

export async function createManagerThread(db: Db, input: { organizationId: string; actorUserId: string; brandProfileId?: string | null; title?: string }): Promise<SocialManagerThread> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingGenerateContentAuthority(db, ctx, "social_manager_thread", "new");
  const brand = input.brandProfileId ? await requireActiveBrand(db, input.organizationId, input.brandProfileId) : null;
  const title = input.title?.trim().slice(0, 200) || DEFAULT_THREAD_TITLE;
  const [row] = await db.insert(socialManagerThreads).values({ organizationId: input.organizationId, brandProfileId: brand?.id ?? null, title, ownerUserId: input.actorUserId }).returning();
  await recordAuditEvent(db, { eventType: "social_manager_thread_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_manager_thread", targetId: row.id, metadata: { brandProfileId: row.brandProfileId } });
  return toThread(row);
}

export async function listManagerThreads(db: Db, input: { organizationId: string; actorUserId: string; brandProfileId?: string; limit?: number }): Promise<SocialManagerThread[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_manager_thread", "list");
  const conditions = [eq(socialManagerThreads.organizationId, input.organizationId), eq(socialManagerThreads.ownerUserId, input.actorUserId), isNull(socialManagerThreads.archivedAt)];
  if (input.brandProfileId) conditions.push(eq(socialManagerThreads.brandProfileId, input.brandProfileId));
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const rows = await db.select().from(socialManagerThreads).where(and(...conditions)).orderBy(desc(socialManagerThreads.lastMessageAt)).limit(limit);
  return rows.map((r) => toThread(r));
}

export async function getManagerThread(db: Db, input: { organizationId: string; threadId: string; actorUserId: string }): Promise<SocialManagerThread> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_manager_thread", input.threadId);
  const thread = await resolveOwnedThread(db, input.organizationId, input.threadId, input.actorUserId);
  const messages = await db.select().from(socialManagerMessages).where(and(eq(socialManagerMessages.organizationId, input.organizationId), eq(socialManagerMessages.threadId, thread.id))).orderBy(asc(socialManagerMessages.createdAt), asc(socialManagerMessages.id)).limit(500);
  return toThread(thread, messages);
}

export async function sendManagerMessage(db: Db, input: { organizationId: string; threadId: string; actorUserId: string; content: string; deps?: SocialGenerationDeps; maxSteps?: number }): Promise<SocialManagerThread> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingGenerateContentAuthority(db, ctx, "social_manager_thread", input.threadId);
  const thread = await resolveOwnedThread(db, input.organizationId, input.threadId, input.actorUserId);
  const content = input.content.trim().slice(0, 8000);
  if (!content) throw new SocialVariantNotPublishableError(["the message is empty"]);
  // Resolve the provider before writing anything, so "not configured" is an honest 503 with no half-written turn.
  const baseProvider = input.deps?.textProvider ?? resolveTextProvider(input.deps?.env ?? (await loadSocialAiEnv()));

  const [userMessage] = await db.insert(socialManagerMessages).values({ organizationId: input.organizationId, threadId: thread.id, role: "user", content }).returning();
  const history = await db
    .select()
    .from(socialManagerMessages)
    .where(and(eq(socialManagerMessages.organizationId, input.organizationId), eq(socialManagerMessages.threadId, thread.id)))
    .orderBy(desc(socialManagerMessages.createdAt), desc(socialManagerMessages.id))
    .limit(HISTORY_LIMIT * 3);
  const loopMessages: ManagerLoopMessage[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, HISTORY_LIMIT)
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) }));
  if (!loopMessages.some((m) => m.role === "user" && m.content === userMessage.content)) loopMessages.push({ role: "user", content });

  const brand = thread.brandProfileId ? await assembleBrandContext(db, { organizationId: input.organizationId, brandProfileId: thread.brandProfileId }) : null;
  const today = input.deps?.now ?? new Date();
  const generationIds: string[] = [];
  const recordingProvider: TextProvider = {
    ...baseProvider,
    async generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
      const r = await generateTextRecorded(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        scope: { brandProfileId: thread.brandProfileId },
        generationType: "manager_task",
        system: request.system,
        prompt: request.prompt,
        maxOutputTokens: request.maxOutputTokens,
        deps: { ...input.deps, textProvider: baseProvider },
      });
      generationIds.push(r.generationId);
      return { provider: r.provider, model: r.model, text: r.text, json: r.json ?? undefined, usage: r.usage };
    },
  };
  const tools = buildManagerTools(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, threadBrandProfileId: thread.brandProfileId, deps: input.deps });

  let outcome: ManagerLoopResult;
  try {
    outcome = await runManagerLoop({ textProvider: recordingProvider, tools, system: buildManagerSystemPrompt({ brand, today }), messages: loopMessages, maxSteps: input.maxSteps });
  } catch (err) {
    outcome = { final: `I couldn't finish that: ${errorMessageFor(err).slice(0, 400)}`, steps: [], proposedActions: [], stoppedReason: "malformed", modelCalls: generationIds.length };
  }

  for (const step of outcome.steps) {
    await db.insert(socialManagerMessages).values({ organizationId: input.organizationId, threadId: thread.id, role: "tool", content: (JSON.stringify(boundToolResult(step.result)) ?? "null").slice(0, MANAGER_TOOL_RESULT_MAX_BYTES * 2), toolCalls: [{ tool: step.tool, input: boundToolResult(step.input, 2048), ok: step.ok, error: step.error ?? null }] });
  }
  const proposedActions = dedupeActions(outcome.proposedActions);
  await db.insert(socialManagerMessages).values({
    organizationId: input.organizationId,
    threadId: thread.id,
    role: "assistant",
    content: outcome.final.slice(0, 8000),
    toolCalls: outcome.steps.map((s) => ({ tool: s.tool, ok: s.ok, error: s.error ?? null })),
    proposedActions,
    generationId: generationIds.at(-1) ?? null,
  });
  const now = new Date();
  await db
    .update(socialManagerThreads)
    .set({ lastMessageAt: now, updatedAt: now, ...(thread.title === DEFAULT_THREAD_TITLE ? { title: content.slice(0, 80) } : {}) })
    .where(and(eq(socialManagerThreads.id, thread.id), eq(socialManagerThreads.organizationId, input.organizationId)));
  await recordAuditEvent(db, { eventType: "social_manager_message_sent", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_manager_thread", targetId: thread.id, metadata: { toolCalls: outcome.steps.map((s) => s.tool), proposedActions: proposedActions.length, stoppedReason: outcome.stoppedReason, modelCalls: outcome.modelCalls } });
  return getManagerThread(db, { organizationId: input.organizationId, threadId: thread.id, actorUserId: input.actorUserId });
}

function dedupeActions(actions: ManagerProposedAction[]): ManagerProposedAction[] {
  const seen = new Set<string>();
  return actions.filter((a) => {
    const key = `${a.type}:${a.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
