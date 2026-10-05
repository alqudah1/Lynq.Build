import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingBrandProfiles, marketingContentItems, organizationMemberships, organizations, socialContentVariants, users } from "@/db/schema";
import { loadAuthEnv } from "@/lib/auth/env";
import { loadEnv } from "@/lib/env";
import { assetPublicUrl } from "./assets";
import { decideVariantApproval, listDraftsAwaitingReview, listPendingApprovals, submitVariantForReview, type SocialPendingApproval } from "./content";
import { zonedDateTimeToUtc } from "./studio";
import { SOCIAL_PLATFORM_LABELS } from "./validation";

/**
 * Telegram approvals: every post submitted for review is sent to the owner's
 * Telegram chat with its image, caption and buttons. Tapping a button calls the
 * same `decideVariantApproval` the Approval Center uses, as the configured
 * approver, so every authority check, blocking-warning check and audit event
 * still applies. Telegram is a remote control for the existing flow, never a
 * second approval path.
 *
 * Only one chat (TELEGRAM_CHAT_ID) is obeyed; the webhook is authenticated with
 * a secret derived from AUTH_SECRET that Telegram echoes in a header.
 */

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface TelegramEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_APPROVER_EMAIL?: string;
  TELEGRAM_ORGANIZATION_SLUG?: string;
  AUTH_SECRET: string;
  AUTH_BASE_URL: string;
}

export interface TelegramDeps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

type Decision = "publish" | "approve" | "changes" | "reject" | "submit";
const DECISION_CODES: Record<string, Decision> = { p: "publish", a: "approve", c: "changes", r: "reject", s: "submit" };
const CODE_FOR: Record<Decision, string> = { publish: "p", approve: "a", changes: "c", reject: "r", submit: "s" };
/** Times in captions and buttons are shown in the owner's timezone. */
export const TELEGRAM_TIMEZONE = "America/Toronto";

export function formatLocal(d: Date, timeZone = TELEGRAM_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPTION_LIMIT = 1024;

/** Telegram settings plus the auth base URL/secret (signed media links, webhook secret). */
export function loadTelegramEnv(): TelegramEnv {
  const env = loadEnv();
  const auth = loadAuthEnv();
  return { TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID, TELEGRAM_APPROVER_EMAIL: env.TELEGRAM_APPROVER_EMAIL, TELEGRAM_ORGANIZATION_SLUG: env.TELEGRAM_ORGANIZATION_SLUG, AUTH_SECRET: auth.AUTH_SECRET, AUTH_BASE_URL: auth.AUTH_BASE_URL };
}

export function telegramEnabled(env: Pick<TelegramEnv, "TELEGRAM_BOT_TOKEN">): boolean {
  return /^\d+:[A-Za-z0-9_-]{30,}$/.test(env.TELEGRAM_BOT_TOKEN?.trim() ?? "");
}

/** The value Telegram sends back in X-Telegram-Bot-Api-Secret-Token (1-256 chars of A-Za-z0-9_-). */
export function telegramWebhookSecret(authSecret: string): string {
  return createHmac("sha256", `telegram-webhook:${authSecret}`).update("lynq-social-approvals").digest("base64url");
}

export function verifyTelegramWebhookSecret(authSecret: string, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(telegramWebhookSecret(authSecret));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function encodeDecision(decision: Decision, contentVariantId: string, revision: number): string {
  return `${CODE_FOR[decision]}:${contentVariantId}:${revision}`;
}

export function parseDecision(data: string | undefined): { decision: Decision; contentVariantId: string; revision: number } | null {
  if (!data) return null;
  const [code, id, rev] = data.split(":");
  const decision = DECISION_CODES[code ?? ""];
  const revision = Number(rev);
  if (!decision || !UUID.test(id ?? "") || !Number.isSafeInteger(revision) || revision < 0) return null;
  return { decision, contentVariantId: id!, revision };
}

/** Caption for the approval message: where it goes, the post itself, and nothing secret. Fits Telegram's 1024-char photo caption. */
export function buildApprovalCaption(p: Pick<SocialPendingApproval, "title" | "brandName"> & { brief?: Pick<SocialPendingApproval["brief"], "keyPoints">; variant: Pick<SocialPendingApproval["variant"], "platform" | "accountDisplayName" | "body" | "hashtags" | "scheduledFor"> & { format?: string } }): string {
  const v = p.variant;
  const where = `${SOCIAL_PLATFORM_LABELS[v.platform]}${v.format === "story" ? " Story" : v.format === "reel" ? " Reel" : ""}${v.accountDisplayName ? ` → ${v.accountDisplayName}` : ""}`;
  const when = v.scheduledFor ? `Planned: ${formatLocal(v.scheduledFor)}` : "Not scheduled — 'Post now' publishes immediately";
  const extra = v.format === "story" ? (p.brief?.keyPoints?.find((k) => /highlight/i.test(k)) ?? "") : v.format === "reel" ? "Reel — stays off the grid." : "";
  const head = [`${p.brandName ?? "LYNQ"} · ${where}`, p.title, when, extra].filter(Boolean).join("\n");
  const tags = v.hashtags.length ? `\n\n${v.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}` : "";
  const room = CAPTION_LIMIT - head.length - tags.length - 4;
  const body = v.body.length > room ? `${v.body.slice(0, Math.max(0, room - 1)).trimEnd()}…` : v.body;
  return `${head}${body ? `\n\n${body}` : ""}${tags}`.slice(0, CAPTION_LIMIT);
}

export function draftKeyboard(contentVariantId: string, revision: number) {
  return { inline_keyboard: [[{ text: "📤 Send for review", callback_data: encodeDecision("submit", contentVariantId, revision) }]] };
}

export function approvalKeyboard(contentVariantId: string, revision: number, scheduledFor?: Date | null, now: Date = new Date()) {
  const later = scheduledFor && scheduledFor.getTime() - now.getTime() > 10 * 60_000;
  const decide = [
    { text: "✏️ Request changes", callback_data: encodeDecision("changes", contentVariantId, revision) },
    { text: "✖️ Reject", callback_data: encodeDecision("reject", contentVariantId, revision) },
  ];
  if (later) {
    return {
      inline_keyboard: [
        [{ text: `🗓 Approve — posts ${formatLocal(scheduledFor!)}`, callback_data: encodeDecision("approve", contentVariantId, revision) }],
        [{ text: "🚀 Post now instead", callback_data: encodeDecision("publish", contentVariantId, revision) }],
        decide,
      ],
    };
  }
  return { inline_keyboard: [[{ text: "✅ Post now", callback_data: encodeDecision("publish", contentVariantId, revision) }], decide] };
}

async function telegram<T = unknown>(env: TelegramEnv, method: string, body: Record<string, unknown>, deps: TelegramDeps = {}): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!res.ok || !json.ok) throw new Error(`telegram_${method}_failed: ${(json.description ?? res.status).toString().slice(0, 200)}`);
  return json.result as T;
}

/**
 * The LYNQ user decisions are made as, and every organization they belong to
 * (narrowed to TELEGRAM_ORGANIZATION_SLUG when set). Authority to approve or
 * publish is still enforced per post by listPendingApprovals/decideVariantApproval.
 */
type Approver = { userId: string; organizationIds: string[] };
async function resolveApprover(db: Db, env: TelegramEnv): Promise<Approver | { error: string }> {
  const email = env.TELEGRAM_APPROVER_EMAIL?.trim().toLowerCase();
  if (!email) return { error: "TELEGRAM_APPROVER_EMAIL isn't set on this deployment." };
  const [user] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!user) return { error: "TELEGRAM_APPROVER_EMAIL doesn't match any LYNQ account. Use the email you sign in to LYNQ with." };
  const slug = env.TELEGRAM_ORGANIZATION_SLUG?.trim();
  const memberships: { organizationId: string; slug: string }[] = await db
    .select({ organizationId: organizations.id, slug: organizations.slug })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(eq(organizationMemberships.userId, user.id), isNull(organizations.deletedAt)));
  const orgs = slug ? memberships.filter((m) => m.slug === slug) : memberships;
  if (!orgs.length) return { error: slug ? `The approver isn't a member of the "${slug}" organization.` : "The approver account isn't in any LYNQ organization." };
  return { userId: user.id, organizationIds: orgs.map((m) => m.organizationId) };
}

async function sendPending(db: Db, env: TelegramEnv, chatId: string, pending: SocialPendingApproval, deps: TelegramDeps, mode: "approve" | "draft" = "approve"): Promise<void> {
  const caption = mode === "draft" ? `📝 DRAFT — not sent for review yet\n${buildApprovalCaption(pending)}`.slice(0, CAPTION_LIMIT) : buildApprovalCaption(pending);
  const reply_markup = mode === "draft" ? draftKeyboard(pending.variant.id, pending.variant.revision) : approvalKeyboard(pending.variant.id, pending.variant.revision, pending.variant.scheduledFor);
  const video = pending.assets.find((a) => a.contentType.startsWith("video/"));
  const image = pending.assets.find((a) => a.contentType.startsWith("image/"));
  try {
    if (video) return void (await telegram(env, "sendVideo", { chat_id: chatId, video: assetPublicUrl(env, video.id), caption, reply_markup, supports_streaming: true }, deps));
    if (image) return void (await telegram(env, "sendPhoto", { chat_id: chatId, photo: assetPublicUrl(env, image.id), caption, reply_markup }, deps));
  } catch {
    // Telegram couldn't fetch the media (too large, unreachable) — still deliver the post and its buttons.
    const note = video ? "🎬 Video attached in LYNQ (couldn't preview it here)" : "🖼 Image attached in LYNQ (couldn't preview it here)";
    await telegram(env, "sendMessage", { chat_id: chatId, text: `${note}\n\n${caption}`, reply_markup, link_preview_options: { is_disabled: true } }, deps);
    return;
  }
  await telegram(env, "sendMessage", { chat_id: chatId, text: caption, reply_markup, link_preview_options: { is_disabled: true } }, deps);
}

/**
 * Best-effort: called right after a post is submitted for review. Never throws —
 * a Telegram outage must not undo or block the submission.
 */
export async function notifyTelegramOfReview(db: Db, env: TelegramEnv, input: { organizationId: string; contentVariantId: string }, deps: TelegramDeps = {}): Promise<boolean> {
  try {
    if (!telegramEnabled(env) || !env.TELEGRAM_CHAT_ID) return false;
    const approver = await resolveApprover(db, env);
    if ("error" in approver || !approver.organizationIds.includes(input.organizationId)) return false;
    const pending = (await listPendingApprovals(db, { organizationId: input.organizationId, actorUserId: approver.userId })).find((p) => p.variant.id === input.contentVariantId);
    if (!pending) return false;
    await sendPending(db, env, env.TELEGRAM_CHAT_ID, pending, deps);
    return true;
  } catch (err) {
    console.error("[telegram] review notification failed:", err instanceof Error ? err.message.split(":")[0] : "unknown");
    return false;
  }
}

interface TelegramUpdate {
  message?: { chat?: { id?: number | string }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat?: { id?: number | string }; message_id?: number; caption?: string; text?: string } };
}

const OUTCOME: Record<Decision, string> = { publish: "✅ Approved — publishing now", approve: "🗓 Approved — it will post at its planned time", changes: "✏️ Sent back for changes", reject: "✖️ Rejected", submit: "📤 Sent for review — approve it below" };

function friendlyError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "StaleSocialUpdateError") return "This post changed since it was sent. Use /pending for the latest version.";
  if (name === "InvalidSocialTransitionError") return "This post was already decided.";
  if (name === "SocialVariantNotPublishableError") return "Blocked: the post has a problem to fix in LYNQ first (account or media).";
  if (/Authority|Forbidden|Capability|Permission/i.test(name)) return "The approver account isn't allowed to approve or publish this.";
  return "Couldn't complete that — open LYNQ Approvals to finish.";
}

/** Handles one webhook update. Returns what it did (for logs/tests). */
export async function handleTelegramUpdate(db: Db, env: TelegramEnv, update: TelegramUpdate, deps: TelegramDeps = {}): Promise<{ action: string }> {
  if (!telegramEnabled(env)) return { action: "disabled" };
  const allowed = env.TELEGRAM_CHAT_ID?.trim();

  if (update.message) {
    const chatId = String(update.message.chat?.id ?? "");
    const text = (update.message.text ?? "").trim();
    if (!allowed) {
      // Setup aid: the only thing the bot does before a chat is configured is tell you your chat id.
      if (chatId && /^\/start\b/.test(text)) await telegram(env, "sendMessage", { chat_id: chatId, text: `Your chat id is ${chatId}. Add it to LYNQ as TELEGRAM_CHAT_ID, then send /pending.` }, deps);
      return { action: "setup" };
    }
    if (chatId !== allowed) return { action: "ignored_chat" };
    if (/^\/(start|help)\b/.test(text)) {
      await telegram(env, "sendMessage", { chat_id: chatId, text: "LYNQ approvals are on.\nEvery morning at 8, that day's posts arrive here — approve them for their time or post now.\n/week — the next 7 days at a glance\n/pending — posts waiting for your approval\n/drafts — every draft, with a button to send it for review" }, deps);
      return { action: "help" };
    }
    if (/^\/pending\b/.test(text)) {
      const approver = await resolveApprover(db, env);
      if ("error" in approver) {
        await telegram(env, "sendMessage", { chat_id: chatId, text: approver.error }, deps);
        return { action: "no_approver" };
      }
      const pending: SocialPendingApproval[] = [];
      for (const organizationId of approver.organizationIds) {
        // One org the approver can't review in must not hide the others.
        pending.push(...(await listPendingApprovals(db, { organizationId, actorUserId: approver.userId }).catch(() => [])));
      }
      if (!pending.length) await telegram(env, "sendMessage", { chat_id: chatId, text: "Nothing is waiting for review." }, deps);
      for (const p of pending.slice(0, 20)) await sendPending(db, env, chatId, p, deps);
      return { action: `pending:${pending.length}` };
    }
    if (/^\/week\b/.test(text)) {
      const approver = await resolveApprover(db, env);
      if ("error" in approver) {
        await telegram(env, "sendMessage", { chat_id: chatId, text: approver.error }, deps);
        return { action: "no_approver" };
      }
      const lines = await weekOverview(db, approver.organizationIds, deps.now?.() ?? new Date());
      await telegram(env, "sendMessage", { chat_id: chatId, text: lines.length ? lines.join("\n").slice(0, 4000) : "Nothing planned for the next 7 days." }, deps);
      return { action: `week:${lines.length}` };
    }
    if (/^\/drafts\b/.test(text)) {
      const approver = await resolveApprover(db, env);
      if ("error" in approver) {
        await telegram(env, "sendMessage", { chat_id: chatId, text: approver.error }, deps);
        return { action: "no_approver" };
      }
      const drafts: SocialPendingApproval[] = [];
      for (const organizationId of approver.organizationIds) drafts.push(...(await listDraftsAwaitingReview(db, { organizationId, actorUserId: approver.userId }).catch(() => [])));
      if (!drafts.length) await telegram(env, "sendMessage", { chat_id: chatId, text: "No drafts. Everything is either waiting in /pending or already decided." }, deps);
      else if (drafts.length > 20) await telegram(env, "sendMessage", { chat_id: chatId, text: `Showing the first 20 of ${drafts.length} drafts.` }, deps);
      for (const d of drafts.slice(0, 20)) await sendPending(db, env, chatId, d, deps, "draft");
      return { action: `drafts:${drafts.length}` };
    }
    return { action: "ignored_text" };
  }

  const cb = update.callback_query;
  if (!cb) return { action: "ignored" };
  const chatId = String(cb.message?.chat?.id ?? "");
  if (!allowed || chatId !== allowed) {
    await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id, text: "Not allowed." }, deps).catch(() => undefined);
    return { action: "ignored_chat" };
  }
  const parsed = parseDecision(cb.data);
  if (!parsed) {
    await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id }, deps).catch(() => undefined);
    return { action: "bad_data" };
  }
  const approver = await resolveApprover(db, env);
  const [variant] = await db.select({ organizationId: socialContentVariants.organizationId }).from(socialContentVariants).where(eq(socialContentVariants.id, parsed.contentVariantId)).limit(1);
  let result: string;
  if ("error" in approver) {
    result = approver.error;
  } else if (!variant || !approver.organizationIds.includes(variant.organizationId)) {
    result = "This post isn't in the approver's organization.";
  } else {
    try {
      if (parsed.decision === "submit") {
        await submitVariantForReview(db, { organizationId: variant.organizationId, contentVariantId: parsed.contentVariantId, actorUserId: approver.userId, expectedRevision: parsed.revision, summary: "Sent for review from Telegram" });
        result = OUTCOME.submit;
        const next = (await listPendingApprovals(db, { organizationId: variant.organizationId, actorUserId: approver.userId })).find((p) => p.variant.id === parsed.contentVariantId);
        if (next) await sendPending(db, env, chatId, next, deps).catch(() => undefined);
      } else {
      await decideVariantApproval(db, {
        organizationId: variant.organizationId,
        contentVariantId: parsed.contentVariantId,
        actorUserId: approver.userId,
        expectedRevision: parsed.revision,
        decision: parsed.decision === "publish" || parsed.decision === "approve" ? "approve" : parsed.decision === "reject" ? "reject" : "request_changes",
        publishNow: parsed.decision === "publish",
        note: "Decided from Telegram",
      });
      result = OUTCOME[parsed.decision];
      }
    } catch (err) {
      result = friendlyError(err);
    }
  }
  await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id, text: result.slice(0, 190) }, deps).catch(() => undefined);
  if (cb.message?.message_id) {
    // Remove the buttons so a post can't be decided twice, and stamp the outcome.
    await telegram(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }, deps).catch(() => undefined);
    await telegram(env, "sendMessage", { chat_id: chatId, text: result, reply_parameters: { message_id: cb.message.message_id } }, deps).catch(() => undefined);
  }
  return { action: `decided:${parsed.decision}:${result === OUTCOME[parsed.decision] ? "ok" : "failed"}` };
}

/** Points the bot's webhook at this deployment. Called by the signed-in owner from LYNQ. */
export interface TelegramWebhookStatus {
  url: string;
  changed: boolean;
  /** Telegram's own report of the last delivery failure, if any. */
  lastError: string | null;
  pendingUpdates: number;
}

/**
 * Points the bot at this deployment and reports what Telegram last saw.
 * The target is always this deployment's own configured base URL — never
 * anything from the request. When Vercel Deployment Protection is on, the
 * project's "Protection Bypass for Automation" secret (exposed by Vercel as
 * VERCEL_AUTOMATION_BYPASS_SECRET) is added so Telegram can get through; it is
 * never returned.
 */
export async function registerTelegramWebhook(env: TelegramEnv, deps: TelegramDeps & { bypassSecret?: string } = {}): Promise<TelegramWebhookStatus> {
  const url = `${env.AUTH_BASE_URL.replace(/\/+$/, "")}/api/social/telegram/webhook`;
  const bypass = deps.bypassSecret ?? process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  const target = bypass ? `${url}?x-vercel-protection-bypass=${encodeURIComponent(bypass)}` : url;
  type Info = { url?: string; last_error_message?: string; pending_update_count?: number };
  const before = await telegram<Info>(env, "getWebhookInfo", {}, deps).catch((): Info => ({}));
  const changed = before.url !== target;
  if (changed) {
    await telegram(env, "setWebhook", { url: target, secret_token: telegramWebhookSecret(env.AUTH_SECRET), allowed_updates: ["message", "callback_query"], drop_pending_updates: false }, deps);
  }
  await telegram(env, "setMyCommands", { commands: [{ command: "pending", description: "Posts waiting for your approval" }, { command: "drafts", description: "Every draft — send any for review" }, { command: "help", description: "How approvals work" }] }, deps).catch(() => undefined);
  const redact = (m?: string) => (m ? m.replace(/x-vercel-protection-bypass=[^&\s]+/g, "x-vercel-protection-bypass=***").slice(0, 200) : null);
  return { url, changed, lastError: changed ? null : redact(before.last_error_message), pendingUpdates: before.pending_update_count ?? 0 };
}


const STATUS_ICON: Record<string, string> = { draft: "📝", changes_requested: "✏️", ready_for_review: "👀", approved: "✅", scheduled: "🗓", publishing: "⏫", published: "🟢", failed: "⚠️", rejected: "✖️" };

/** One line per planned post for the next 7 days, grouped by day, in the owner's timezone. */
async function weekOverview(db: Db, organizationIds: string[], now: Date): Promise<string[]> {
  if (!organizationIds.length) return [];
  const until = new Date(now.getTime() + 7 * 86_400_000);
  const rows = await db
    .select({ title: marketingContentItems.title, brand: marketingBrandProfiles.name, platform: socialContentVariants.platform, format: socialContentVariants.format, status: socialContentVariants.status, at: socialContentVariants.scheduledFor, media: socialContentVariants.media })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)))
    .leftJoin(marketingBrandProfiles, eq(marketingBrandProfiles.id, marketingContentItems.brandProfileId))
    .where(and(inArray(socialContentVariants.organizationId, organizationIds), isNull(socialContentVariants.archivedAt), isNull(marketingContentItems.archivedAt), gt(socialContentVariants.scheduledFor, now), lte(socialContentVariants.scheduledFor, until)))
    .orderBy(asc(socialContentVariants.scheduledFor))
    .limit(200);
  // Collapse Instagram + Facebook versions of the same post into one line.
  const merged = new Map<string, { title: string; brand: string; at: Date; platforms: Set<string>; status: string; needsMedia: boolean }>();
  for (const r of rows) {
    if (!r.at) continue;
    const key = `${r.title}|${r.at.toISOString()}`;
    const entry = merged.get(key) ?? { title: r.title, brand: r.brand ?? "", at: r.at, platforms: new Set<string>(), status: r.status, needsMedia: false };
    entry.platforms.add(r.format === "story" ? "Story" : r.format === "reel" ? "Reel" : SOCIAL_PLATFORM_LABELS[r.platform as keyof typeof SOCIAL_PLATFORM_LABELS] ?? r.platform);
    if (!Array.isArray(r.media) || r.media.length === 0) entry.needsMedia = r.platform !== "linkedin" || entry.needsMedia;
    merged.set(key, entry);
  }
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TELEGRAM_TIMEZONE, weekday: "long", month: "short", day: "numeric" });
  const timeFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TELEGRAM_TIMEZONE, hour: "numeric", minute: "2-digit" });
  const lines: string[] = [];
  let lastDay = "";
  for (const e of merged.values()) {
    const day = dayFmt.format(e.at);
    if (day !== lastDay) {
      lines.push(`${lines.length ? "\n" : ""}📅 ${day}`);
      lastDay = day;
    }
    lines.push(`${STATUS_ICON[e.status] ?? "•"} ${timeFmt.format(e.at)} · ${e.brand} · ${[...e.platforms].join("+")} — ${e.title}${e.needsMedia ? (e.platforms.has("Reel") ? " 🎬 needs video" : " 🖼 needs image") : ""}`);
  }
  return lines;
}

/**
 * Called by the runtime cron. From 8:00 in the owner's timezone, every draft
 * planned for later today is submitted for review as the approver, which
 * sends it to Telegram with an "Approve for its time" button. Posts that
 * can't be submitted yet (no video, no image, no account) are listed in one
 * reminder sent in the first run after 8:00. Idempotent: a submitted post is
 * no longer a draft.
 */
export async function runMorningTelegramSend(db: Db, env: TelegramEnv, deps: TelegramDeps = {}): Promise<{ sent: number; blocked: number }> {
  if (!telegramEnabled(env) || !env.TELEGRAM_CHAT_ID) return { sent: 0, blocked: 0 };
  const now = deps.now?.() ?? new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TELEGRAM_TIMEZONE, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  if (hour < 8) return { sent: 0, blocked: 0 };
  const approver = await resolveApprover(db, env);
  if ("error" in approver) return { sent: 0, blocked: 0 };
  // End of today in the owner's timezone: tomorrow 00:00 local.
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: TELEGRAM_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = local.split("-").map(Number);
  const endOfDay = zonedDateTimeToUtc(y, m, d + 1, 0, 0, TELEGRAM_TIMEZONE);
  const soonest = new Date(now.getTime() + 15 * 60_000);
  const rows = await db
    .select({ id: socialContentVariants.id, organizationId: socialContentVariants.organizationId, revision: socialContentVariants.revision, title: marketingContentItems.title, at: socialContentVariants.scheduledFor, format: socialContentVariants.format })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)))
    .where(and(inArray(socialContentVariants.organizationId, approver.organizationIds), eq(socialContentVariants.status, "draft"), isNull(socialContentVariants.archivedAt), isNull(marketingContentItems.archivedAt), gt(socialContentVariants.scheduledFor, soonest), lte(socialContentVariants.scheduledFor, endOfDay)))
    .orderBy(asc(socialContentVariants.scheduledFor))
    .limit(40);
  let sent = 0;
  const blocked: string[] = [];
  for (const r of rows) {
    try {
      await submitVariantForReview(db, { organizationId: r.organizationId, contentVariantId: r.id, actorUserId: approver.userId, expectedRevision: r.revision, summary: `Today's post: ${r.title}` });
      const pending = (await listPendingApprovals(db, { organizationId: r.organizationId, actorUserId: approver.userId })).find((p) => p.variant.id === r.id);
      if (pending) await sendPending(db, env, env.TELEGRAM_CHAT_ID, pending, deps);
      sent++;
    } catch (err) {
      const why = err instanceof Error && err.name === "SocialVariantNotPublishableError" ? (r.format === "reel" || r.format === "video" ? "needs its video" : "needs an image or a linked account") : "couldn't be sent";
      blocked.push(`• ${r.at ? new Intl.DateTimeFormat("en-CA", { timeZone: TELEGRAM_TIMEZONE, hour: "numeric", minute: "2-digit" }).format(r.at) : ""} ${r.title} — ${why}`);
    }
  }
  const firstRunOfDay = hour === 8 && minute < 15;
  if (sent && firstRunOfDay) await telegram(env, "sendMessage", { chat_id: env.TELEGRAM_CHAT_ID, text: `☀️ Good morning — ${sent} post${sent === 1 ? "" : "s"} for today ${sent === 1 ? "is" : "are"} above. Approve each for its time, or post now.` }, deps).catch(() => undefined);
  if (blocked.length && firstRunOfDay) {
    const unique = [...new Set(blocked)];
    await telegram(env, "sendMessage", { chat_id: env.TELEGRAM_CHAT_ID, text: `Today, still needs you in LYNQ:\n${unique.join("\n")}`.slice(0, 4000) }, deps).catch(() => undefined);
  }
  return { sent, blocked: blocked.length };
}
