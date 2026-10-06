import { describe, it, expect } from "vitest";
import { approvalKeyboard, buildApprovalCaption, draftKeyboard, nextPostPerBrand, runMorningTelegramSend, encodeDecision, handleTelegramUpdate, parseDecision, registerTelegramWebhook, telegramEnabled, telegramWebhookSecret, verifyTelegramWebhookSecret, type TelegramEnv } from "./telegram";

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
    const draft = draftKeyboard(VID, 2).inline_keyboard.flat();
    expect(draft.map((b) => parseDecision(b.callback_data))).toEqual([{ decision: "submit", contentVariantId: VID, revision: 2 }]);
    expect(Buffer.byteLength(draft[0].callback_data)).toBeLessThanOrEqual(64);
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

  it("setup always targets this deployment's own URL, adds the Vercel bypass, and never returns it", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const first = await registerTelegramWebhook(env, { fetchImpl, bypassSecret: "byp4ss" });
    expect(first).toMatchObject({ url: "https://office.example/api/social/telegram/webhook", changed: true, lastError: null });
    expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo", "setWebhook", "setMyCommands"]);
    expect(calls[1].body.url).toBe(`${first.url}?x-vercel-protection-bypass=byp4ss`);
    expect(JSON.stringify(first)).not.toContain("byp4ss");
    const target = `${first.url}?x-vercel-protection-bypass=byp4ss`;
    const already = (async () => new Response(JSON.stringify({ ok: true, result: { url: target, last_error_message: `Wrong response from the webhook: 401 Unauthorized ${target}`, pending_update_count: 2 } }), { status: 200 })) as unknown as typeof fetch;
    const again = await registerTelegramWebhook(env, { fetchImpl: already, bypassSecret: "byp4ss" });
    expect(again).toMatchObject({ changed: false, pendingUpdates: 2 });
    expect(again.lastError).toContain("401");
    expect(again.lastError).not.toContain("byp4ss");
  });

  it("a post planned for later gets 'Approve for its time' first, then 'Post now instead'", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    const later = approvalKeyboard(VID, 3, new Date("2026-10-12T16:15:00Z"), now).inline_keyboard;
    expect(parseDecision(later[0][0].callback_data)?.decision).toBe("approve");
    expect(later[0][0].text).toContain("12:15");
    expect(parseDecision(later[1][0].callback_data)?.decision).toBe("publish");
    const soon = approvalKeyboard(VID, 3, new Date("2026-10-12T12:05:00Z"), now).inline_keyboard;
    expect(parseDecision(soon[0][0].callback_data)?.decision).toBe("publish");
  });

  it("captions show the planned time in Toronto and the story's highlight", () => {
    const caption = buildApprovalCaption({ title: "Story · Kingsbridge → WORK", brandName: "LYNQ", brief: { keyPoints: ["After it posts, add this story to the WORK highlight (Instagram app → story → Highlight)."] }, variant: { platform: "instagram", format: "story", accountDisplayName: "lynqbuild", body: "", hashtags: [], scheduledFor: new Date("2026-10-12T16:25:00Z") } });
    expect(caption).toContain("Instagram Story");
    expect(caption).toContain("12:25");
    expect(caption).toContain("WORK highlight");
  });

  it("the morning send does nothing before 8:00 Toronto or without a chat", async () => {
    const { calls, fetchImpl } = fakeFetch();
    expect(await runMorningTelegramSend(noDb, env, { fetchImpl, now: () => new Date("2026-10-12T11:30:00Z") })).toEqual({ sent: 0, blocked: 0 });
    expect(await runMorningTelegramSend(noDb, { ...env, TELEGRAM_CHAT_ID: undefined }, { fetchImpl, now: () => new Date("2026-10-12T13:00:00Z") })).toEqual({ sent: 0, blocked: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe("/drafts default: the next post per brand", () => {
  const img = [{ id: "a", title: "", assetType: "image", contentType: "image/png", width: 1, height: 1, previewUrl: "" }];
  const d = (o: { item: string; brand: string; platform: string; format: string; at: string; assets?: typeof img }) =>
    ({ contentItemId: o.item, brandProfileId: o.brand, brandName: o.brand, title: o.item, brief: {}, submittedAt: new Date(), assets: o.assets ?? img, variant: { id: `${o.item}-${o.platform}`, platform: o.platform, format: o.format, scheduledFor: new Date(o.at) } }) as unknown as Parameters<typeof nextPostPerBrand>[0][number];

  it("returns both platform versions of the soonest ready post for each brand, skipping stories, reels and posts without an image", () => {
    const out = nextPostPerBrand([
      d({ item: "lynq-2", brand: "lynq", platform: "instagram", format: "image", at: "2026-10-13T11:30Z" }),
      d({ item: "lynq-1", brand: "lynq", platform: "instagram", format: "image", at: "2026-10-12T16:15Z" }),
      d({ item: "lynq-1", brand: "lynq", platform: "facebook", format: "image", at: "2026-10-12T16:15Z" }),
      d({ item: "lynq-1-story", brand: "lynq", platform: "instagram", format: "story", at: "2026-10-12T16:25Z" }),
      d({ item: "codeit-0", brand: "codeit", platform: "instagram", format: "image", at: "2026-10-12T10:00Z", assets: [] }),
      d({ item: "codeit-1", brand: "codeit", platform: "instagram", format: "image", at: "2026-10-12T23:30Z" }),
      d({ item: "codeit-reel", brand: "codeit", platform: "instagram", format: "reel", at: "2026-10-12T09:00Z" }),
      d({ item: "li", brand: "lynq", platform: "linkedin", format: "text", at: "2026-10-12T08:00Z" }),
    ]);
    expect(out.map((x) => x.variant.id)).toEqual(["lynq-1-facebook", "lynq-1-instagram", "codeit-1-instagram"]);
  });

  it("is empty when nothing has an image yet", () => {
    expect(nextPostPerBrand([d({ item: "x", brand: "lynq", platform: "instagram", format: "image", at: "2026-10-12T16:15Z", assets: [] })])).toEqual([]);
  });
});
