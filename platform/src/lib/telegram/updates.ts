import { z } from "zod";

/**
 * Normalising a Telegram update into the small set of things Jarvis will
 * act on.
 *
 * Telegram's update object is large, optional almost everywhere, and grows
 * over time. Rather than reach into it at the point of use, everything the
 * lane understands is named here once: a linking attempt, a directive, a
 * question, or a decision on an approval. Anything else normalises to
 * `unsupported` and is answered politely instead of guessed at.
 *
 * Pure over its argument — no network, no database, no environment — so
 * the parsing is unit-tested directly.
 */

const chatSchema = z.object({ id: z.union([z.number(), z.string()]) });
const fromSchema = z.object({ id: z.union([z.number(), z.string()]).optional(), username: z.string().optional(), first_name: z.string().optional() });

const updateSchema = z.object({
  update_id: z.union([z.number(), z.string()]),
  message: z
    .object({
      message_id: z.union([z.number(), z.string()]).optional(),
      chat: chatSchema,
      from: fromSchema.optional(),
      text: z.string().optional(),
    })
    .optional(),
  edited_message: z
    .object({ chat: chatSchema, from: fromSchema.optional(), text: z.string().optional() })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      from: fromSchema.optional(),
      message: z.object({ chat: chatSchema, message_id: z.union([z.number(), z.string()]).optional() }).optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof updateSchema>;

export type NormalizedUpdate = {
  /** Telegram's own `update_id`, the idempotency key for the whole lane. */
  eventId: string;
  chatId: string | null;
  username: string | null;
  /** Telegram's id for the callback, needed to acknowledge a button press. */
  callbackId: string | null;
  action: TelegramAction;
};

export type TelegramAction =
  | { kind: "link"; code: string }
  | { kind: "directive"; instruction: string }
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "unlink" }
  | { kind: "decision"; approvalId: string; decision: "approve" | "reject"; confirmed: boolean }
  | { kind: "unsupported"; reason: string };

/** Callback payloads are bounded and structured, never free text from a chat. */
const CALLBACK = /^(approve|reject)(:confirm)?:([0-9a-f-]{36})$/i;

export function decisionCallbackData(input: { decision: "approve" | "reject"; approvalId: string; confirmed: boolean }): string {
  return `${input.decision}${input.confirmed ? ":confirm" : ""}:${input.approvalId}`;
}

function text(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeTelegramUpdate(raw: unknown): NormalizedUpdate | null {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return null;
  const update = parsed.data;
  const eventId = String(update.update_id);

  if (update.callback_query) {
    const query = update.callback_query;
    const match = CALLBACK.exec(query.data ?? "");
    return {
      eventId,
      chatId: query.message?.chat ? String(query.message.chat.id) : null,
      username: query.from?.username ?? null,
      callbackId: query.id,
      action: match
        ? { kind: "decision", decision: match[1]!.toLowerCase() as "approve" | "reject", confirmed: Boolean(match[2]), approvalId: match[3]!.toLowerCase() }
        : { kind: "unsupported", reason: "unrecognised_button" },
    };
  }

  const message = update.message ?? update.edited_message;
  if (!message) return { eventId, chatId: null, username: null, callbackId: null, action: { kind: "unsupported", reason: "no_message" } };

  const body = text(message.text);
  const chatId = String(message.chat.id);
  const username = message.from?.username ?? null;
  const base = { eventId, chatId, username, callbackId: null };

  if (!body) return { ...base, action: { kind: "unsupported", reason: "empty_message" } };

  const command = /^\/([a-z_]+)(?:@[\w_]+)?\s*(.*)$/i.exec(body);
  if (command) {
    const name = command[1]!.toLowerCase();
    const argument = text(command[2]);
    if (name === "start" || name === "link") {
      return { ...base, action: argument ? { kind: "link", code: argument.replace(/\D/g, "") } : { kind: "help" } };
    }
    if (name === "status") return { ...base, action: { kind: "status" } };
    if (name === "help") return { ...base, action: { kind: "help" } };
    if (name === "unlink" || name === "stop") return { ...base, action: { kind: "unlink" } };
    return { ...base, action: { kind: "unsupported", reason: `unknown_command:${name}` } };
  }

  // Anything else a linked founder types is work he wants done.
  return { ...base, action: { kind: "directive", instruction: body.slice(0, 2000) } };
}

/**
 * What may be written to the event log.
 *
 * A pairing code is a live credential for the length of its window, and a
 * directive can name a person or a business. Neither belongs in a row that
 * exists only to prove an update was handled once, so the log records the
 * shape of what happened and never its content.
 */
export function redactForEventLog(action: TelegramAction): string {
  switch (action.kind) {
    case "link":
      return "link attempt";
    case "directive":
      return `directive (${action.instruction.length} characters)`;
    case "decision":
      return `${action.decision}${action.confirmed ? " confirmed" : " requested"} on ${action.approvalId}`;
    case "unsupported":
      return `unsupported: ${action.reason}`;
    default:
      return action.kind;
  }
}
