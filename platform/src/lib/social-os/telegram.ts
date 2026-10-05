import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { organizationMemberships, organizations, socialContentVariants, users } from "@/db/schema";
import { loadAuthEnv } from "@/lib/auth/env";
import { loadEnv } from "@/lib/env";
import { assetPublicUrl } from "./assets";
import { decideVariantApproval, listPendingApprovals, type SocialPendingApproval } from "./content";
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
}

type Decision = "publish" | "changes" | "reject";
const DECISION_CODES: Record<string, Decision> = { p: "publish", c: "changes", r: "reject" };
const CODE_FOR: Record<Decision, string> = { publish: "p", changes: "c", reject: "r" };
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
export function buildApprovalCaption(p: Pick<SocialPendingApproval, "title" | "brandName"> & { variant: Pick<SocialPendingApproval["variant"], "platform" | "accountDisplayName" | "body" | "hashtags" | "scheduledFor"> }): string {
  const v = p.variant;
  const where = `${SOCIAL_PLATFORM_LABELS[v.platform]}${v.accountDisplayName ? ` → ${v.accountDisplayName}` : ""}`;
  const head = [`${p.brandName ?? "LYNQ"} · ${where}`, p.title, v.scheduledFor ? `Planned: ${v.scheduledFor.toISOString().slice(0, 16).replace("T", " ")} UTC` : "Not scheduled — 'Post now' publishes immediately"].join("\n");
  const tags = v.hashtags.length ? `\n\n${v.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}` : "";
  const room = CAPTION_LIMIT - head.length - tags.length - 4;
  const body = v.body.length > room ? `${v.body.slice(0, Math.max(0, room - 1)).trimEnd()}…` : v.body;
  return `${head}\n\n${body}${tags}`.slice(0, CAPTION_LIMIT);
}

export function approvalKeyboard(contentVariantId: string, revision: number) {
  return {
    inline_keyboard: [
      [{ text: "✅ Post now", callback_data: encodeDecision("publish", contentVariantId, revision) }],
      [
        { text: "✏️ Request changes", callback_data: encodeDecision("changes", contentVariantId, revision) },
        { text: "✖️ Reject", callback_data: encodeDecision("reject", contentVariantId, revision) },
      ],
    ],
  };
}

async function telegram<T = unknown>(env: TelegramEnv, method: string, body: Record<string, unknown>, deps: TelegramDeps = {}): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!res.ok || !json.ok) throw new Error(`telegram_${method}_failed: ${(json.description ?? res.status).toString().slice(0, 200)}`);
  return json.result as T;
}

/** The LYNQ user decisions are made as; must hold approve (and publish) authority in the org. */
async function resolveApprover(db: Db, env: TelegramEnv): Promise<{ userId: string; organizationId: string } | null> {
  const email = env.TELEGRAM_APPROVER_EMAIL?.trim().toLowerCase();
  if (!email) return null;
  const [user] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!user) return null;
  const slug = env.TELEGRAM_ORGANIZATION_SLUG?.trim();
  const memberships = await db
    .select({ organizationId: organizations.id, slug: organizations.slug })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(eq(organizationMemberships.userId, user.id), isNull(organizations.deletedAt)));
  const org = slug ? memberships.find((m: { slug: string }) => m.slug === slug) : memberships.length === 1 ? memberships[0] : undefined;
  return org ? { userId: user.id, organizationId: org.organizationId } : null;
}

async function sendPending(db: Db, env: TelegramEnv, chatId: string, pending: SocialPendingApproval, deps: TelegramDeps): Promise<void> {
  const caption = buildApprovalCaption(pending);
  const reply_markup = approvalKeyboard(pending.variant.id, pending.variant.revision);
  const image = pending.assets.find((a) => a.contentType.startsWith("image/"));
  if (image) {
    await telegram(env, "sendPhoto", { chat_id: chatId, photo: assetPublicUrl(env, image.id), caption, reply_markup }, deps);
  } else {
    await telegram(env, "sendMessage", { chat_id: chatId, text: caption, reply_markup, link_preview_options: { is_disabled: true } }, deps);
  }
}

/**
 * Best-effort: called right after a post is submitted for review. Never throws —
 * a Telegram outage must not undo or block the submission.
 */
export async function notifyTelegramOfReview(db: Db, env: TelegramEnv, input: { organizationId: string; contentVariantId: string }, deps: TelegramDeps = {}): Promise<boolean> {
  try {
    if (!telegramEnabled(env) || !env.TELEGRAM_CHAT_ID) return false;
    const approver = await resolveApprover(db, env);
    if (!approver || approver.organizationId !== input.organizationId) return false;
    const pending = (await listPendingApprovals(db, { organizationId: approver.organizationId, actorUserId: approver.userId })).find((p) => p.variant.id === input.contentVariantId);
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

const OUTCOME: Record<Decision, string> = { publish: "✅ Approved — publishing now", changes: "✏️ Sent back for changes", reject: "✖️ Rejected" };

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
      await telegram(env, "sendMessage", { chat_id: chatId, text: "LYNQ approvals are on. New posts sent for review arrive here. /pending re-sends everything waiting for you." }, deps);
      return { action: "help" };
    }
    if (/^\/pending\b/.test(text)) {
      const approver = await resolveApprover(db, env);
      if (!approver) {
        await telegram(env, "sendMessage", { chat_id: chatId, text: "TELEGRAM_APPROVER_EMAIL doesn't match a LYNQ user in one organization." }, deps);
        return { action: "no_approver" };
      }
      const pending = await listPendingApprovals(db, { organizationId: approver.organizationId, actorUserId: approver.userId });
      if (!pending.length) await telegram(env, "sendMessage", { chat_id: chatId, text: "Nothing is waiting for review." }, deps);
      for (const p of pending.slice(0, 20)) await sendPending(db, env, chatId, p, deps);
      return { action: `pending:${pending.length}` };
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
  if (!approver || !variant || variant.organizationId !== approver.organizationId) {
    result = "This post isn't in the approver's organization.";
  } else {
    try {
      await decideVariantApproval(db, {
        organizationId: approver.organizationId,
        contentVariantId: parsed.contentVariantId,
        actorUserId: approver.userId,
        expectedRevision: parsed.revision,
        decision: parsed.decision === "publish" ? "approve" : parsed.decision === "reject" ? "reject" : "request_changes",
        publishNow: parsed.decision === "publish",
        note: "Decided from Telegram",
      });
      result = OUTCOME[parsed.decision];
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
    await telegram(env, "setMyCommands", { commands: [{ command: "pending", description: "Re-send every post waiting for review" }, { command: "help", description: "How approvals work" }] }, deps).catch(() => undefined);
  }
  const redact = (m?: string) => (m ? m.replace(/x-vercel-protection-bypass=[^&\s]+/g, "x-vercel-protection-bypass=***").slice(0, 200) : null);
  return { url, changed, lastError: changed ? null : redact(before.last_error_message), pendingUpdates: before.pending_update_count ?? 0 };
}
