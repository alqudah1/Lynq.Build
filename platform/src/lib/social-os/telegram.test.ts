import { describe, it, expect } from "vitest";
import { approvalKeyboard, buildApprovalCaption, encodeDecision, handleTelegramUpdate, parseDecision, registerTelegramWebhook, telegramEnabled, telegramWebhookSecret, verifyTelegramWebhookSecret, type TelegramEnv } from "./telegram";

const TOKEN = "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345";
const env: TelegramEnv = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "555", TELEGRAM_APPROVER_EMAIL: "owner@lynq.build", AUTH_SECRET: "s".repeat(40), AUTH_BASE_URL: "https://office.example" };
const VID = "6ce3d4e9-0d42-4f92-ab4b-dcf577e6f1de";

function fakeFetch() {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ method: String(url).split("/").pop()!, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const noDb = {} as never;

describe("telegram approvals", () => {
  it("is enabled only with a well-formed bot token", () => {
    expect(telegramEnabled(env)).toBe(true);
    expect(telegramEnabled({ TELEGRAM_BOT_TOKEN: "not-a-token" })).toBe(false);
    expect(telegramEnabled({})).toBe(false);
  });

  it("webhook secret is derived from AUTH_SECRET, header-safe, and checked in constant time", () => {
    const secret = telegramWebhookSecret(env.AUTH_SECRET);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{20,256}$/);
    expect(verifyTelegramWebhookSecret(env.AUTH_SECRET, secret)).toBe(true);
    expect(verifyTelegramWebhookSecret(env.AUTH_SECRET, `${secret}x`)).toBe(false);
    expect(verifyTelegramWebhookSecret("other".repeat(10), secret)).toBe(false);
    expect(verifyTelegramWebhookSecret(env.AUTH_SECRET, null)).toBe(false);
  });

  it("button data round-trips, fits Telegram's 64 bytes, and rejects anything else", () => {
    const data = encodeDecision("publish", VID, 12);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseDecision(data)).toEqual({ decision: "publish", contentVariantId: VID, revision: 12 });
    expect(parseDecision(encodeDecision("reject", VID, 3))?.decision).toBe("reject");
    for (const bad of [undefined, "", "x:" + VID + ":1", "p:not-a-uuid:1", `p:${VID}:-1`, `p:${VID}:abc`]) expect(parseDecision(bad)).toBeNull();
    const kb = approvalKeyboard(VID, 4).inline_keyboard.flat();
    expect(kb.map((b) => parseDecision(b.callback_data)?.decision)).toEqual(["publish", "changes", "reject"]);
  });

  it("caption names the destination, keeps hashtags, and fits the 1024-char photo limit", () => {
    const caption = buildApprovalCaption({ title: "Kingsbridge", brandName: "LYNQ", variant: { platform: "instagram", accountDisplayName: "LYNQ", body: "word ".repeat(400), hashtags: ["GTA", "#Toronto"], scheduledFor: null } });
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption.startsWith("LYNQ · Instagram → LYNQ\nKingsbridge")).toBe(true);
    expect(caption).toContain("#GTA #Toronto");
    expect(caption).toContain("…");
  });

  it("before a chat is configured, /start only tells you your chat id", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const r = await handleTelegramUpdate(noDb, { ...env, TELEGRAM_CHAT_ID: undefined }, { message: { chat: { id: 777 }, text: "/start" } }, { fetchImpl });
    expect(r.action).toBe("setup");
    expect(calls).toHaveLength(1);
    expect(calls[0].body.chat_id).toBe("777");
    expect(String(calls[0].body.text)).toContain("777");
  });

  it("ignores messages and button taps from any other chat — no approval is attempted", async () => {
    const { calls, fetchImpl } = fakeFetch();
    expect((await handleTelegramUpdate(noDb, env, { message: { chat: { id: 999 }, text: "/pending" } }, { fetchImpl })).action).toBe("ignored_chat");
    expect(calls).toHaveLength(0);
    const r = await handleTelegramUpdate(noDb, env, { callback_query: { id: "cb1", data: encodeDecision("publish", VID, 1), message: { chat: { id: 999 }, message_id: 5 } } }, { fetchImpl });
    expect(r.action).toBe("ignored_chat");
    expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery"]);
  });

  it("drops malformed button data without touching the database", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const r = await handleTelegramUpdate(noDb, env, { callback_query: { id: "cb2", data: "p:../../etc:1", message: { chat: { id: 555 }, message_id: 6 } } }, { fetchImpl });
    expect(r.action).toBe("bad_data");
    expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery"]);
  });

  it("does nothing at all when the bot isn't configured", async () => {
    const { calls, fetchImpl } = fakeFetch();
    expect((await handleTelegramUpdate(noDb, { ...env, TELEGRAM_BOT_TOKEN: undefined }, { message: { chat: { id: 555 }, text: "/pending" } }, { fetchImpl })).action).toBe("disabled");
    expect(calls).toHaveLength(0);
  });

  it("setup always targets this deployment's own URL and is a no-op once set", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const first = await registerTelegramWebhook(env, { fetchImpl });
    expect(first).toEqual({ url: "https://office.example/api/social/telegram/webhook", changed: true });
    expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo", "setWebhook", "setMyCommands"]);
    expect(calls[1].body.url).toBe(first.url);
    const already = (async () => new Response(JSON.stringify({ ok: true, result: { url: first.url } }), { status: 200 })) as unknown as typeof fetch;
    expect(await registerTelegramWebhook(env, { fetchImpl: already })).toEqual({ url: first.url, changed: false });
  });
});
