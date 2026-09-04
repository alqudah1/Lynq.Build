import "server-only";

import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { jarvisTelegramLinks } from "@/db/schema";
import { clampMessage, createTelegramTransport, escapeTelegram, type TelegramTransport } from "./api";
import { resolveTelegramConfig } from "./config";
import { decisionCallbackData } from "./updates";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Jarvis reaching the founder on Telegram.
 *
 * Best-effort by design, exactly like the voice and email notifiers: a
 * Telegram outage must never undo Office work or fail a run. When the lane
 * is off, unconfigured, or the founder has not linked a chat, this is a
 * no-op that says so rather than an error anybody has to handle.
 *
 * An approval arrives with buttons, because the entire point is that he
 * can answer it from a bus. A high-risk one still asks twice — that
 * happens on the way back in, in `control.ts`, not here.
 */

export type TelegramDeliveryStatus = "sent" | "not_configured" | "no_link" | "failed";

async function activeChatIds(db: Db, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ chatId: jarvisTelegramLinks.telegramChatId })
    .from(jarvisTelegramLinks)
    .where(and(eq(jarvisTelegramLinks.organizationId, organizationId), eq(jarvisTelegramLinks.status, "active")));
  return rows.map((row) => row.chatId);
}

async function deliver(
  db: Db,
  input: { organizationId: string; text: string; buttons?: { text: string; callbackData: string }[][] },
  transport?: TelegramTransport | null,
): Promise<TelegramDeliveryStatus> {
  const resolution = resolveTelegramConfig();
  // The tenant is fixed at deploy time, and this bot speaks for that one
  // workspace only. Repointing the configuration leaves the old workspace's
  // links in the table; the control lane already refuses those chats, and
  // this is the same refusal in the outbound direction, so a chat cannot
  // keep receiving a workspace's work after it has stopped being able to
  // act on it.
  if (resolution.ok && resolution.config.organizationId !== input.organizationId) return "not_configured";
  const client = transport ?? (resolution.ok ? createTelegramTransport(resolution.config.botToken) : null);
  if (!client) return "not_configured";
  try {
    const chats = await activeChatIds(db, input.organizationId);
    if (chats.length === 0) return "no_link";
    for (const chatId of chats) {
      await client.sendMessage({ chatId, text: clampMessage(input.text), buttons: input.buttons, disablePreview: false });
    }
    return "sent";
  } catch (error) {
    console.error("[jarvis-telegram] notification failed:", error instanceof Error ? error.message : "unknown error");
    return "failed";
  }
}

export async function notifyTelegramApprovalNeeded(
  db: Db,
  input: { organizationId: string; projectName: string; summary: string; approvalId: string; riskLevel: string },
  transport?: TelegramTransport | null,
): Promise<TelegramDeliveryStatus> {
  const text = [
    `<b>${escapeTelegram(input.projectName)}</b> is waiting on you.`,
    "",
    escapeTelegram(input.summary),
    "",
    input.riskLevel === "high" || input.riskLevel === "critical" ? "<i>I'll ask you to confirm before this one goes anywhere.</i>" : "",
  ]
    .filter(Boolean)
    .join("\n");
  return deliver(
    db,
    {
      organizationId: input.organizationId,
      text,
      buttons: [
        [
          { text: "Approve", callbackData: decisionCallbackData({ decision: "approve", approvalId: input.approvalId, confirmed: false }) },
          { text: "Stop", callbackData: decisionCallbackData({ decision: "reject", approvalId: input.approvalId, confirmed: true }) },
        ],
      ],
    },
    transport,
  );
}

export async function notifyTelegramRunFinished(
  db: Db,
  input: { organizationId: string; projectName: string; headline: string; needsFounder: string[]; projectUrl: string },
  transport?: TelegramTransport | null,
): Promise<TelegramDeliveryStatus> {
  const text = [
    `<b>${escapeTelegram(input.projectName)}</b> is done.`,
    "",
    escapeTelegram(input.headline),
    "",
    input.needsFounder.length > 0
      ? `Still needs you:\n${input.needsFounder.map((item) => `• ${escapeTelegram(item)}`).join("\n")}`
      : "Nothing is waiting on you.",
    "",
    input.projectUrl,
  ].join("\n");
  return deliver(db, { organizationId: input.organizationId, text }, transport);
}

export async function notifyTelegramExecutionStopped(
  db: Db,
  input: { organizationId: string; projectName: string; headline: string; detail: string; nextStep: string; projectUrl: string },
  transport?: TelegramTransport | null,
): Promise<TelegramDeliveryStatus> {
  const text = [
    `<b>${escapeTelegram(input.projectName)}</b> — ${escapeTelegram(input.headline)}`,
    "",
    escapeTelegram(input.detail),
    "",
    `What to do: ${escapeTelegram(input.nextStep)}`,
    "",
    input.projectUrl,
  ].join("\n");
  return deliver(db, { organizationId: input.organizationId, text }, transport);
}
