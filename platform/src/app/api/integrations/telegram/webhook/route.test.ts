import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The webhook is the front door. Three things have to be true of it before
 * anything else matters: only Telegram gets in, an unconfigured deployment
 * accepts nothing, and a redelivered update never acts twice.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const FOUNDER = "22222222-2222-4222-8222-222222222222";
const WEBHOOK_SECRET = "w".repeat(24);

const handleTelegramUpdate = vi.hoisted(() => vi.fn());
const claimTelegramEvent = vi.hoisted(() => vi.fn());
const resolveTelegramConfig = vi.hoisted(() => vi.fn());
const pollAndProcess = vi.hoisted(() => vi.fn());
const after = vi.hoisted(() => vi.fn());

vi.mock("next/server", () => ({ after }));
vi.mock("@neondatabase/serverless", () => ({ neon: () => ({}) }));
vi.mock("@/db/client", () => ({ createDbClient: () => ({}) }));
vi.mock("@/lib/env", () => ({ loadEnv: () => ({ DATABASE_URL: "postgres://x" }) }));
vi.mock("@/lib/runtime/worker", () => ({ pollAndProcess }));
vi.mock("@/lib/telegram/api", () => ({ createTelegramTransport: () => ({ sendMessage: vi.fn(), answerCallback: vi.fn() }) }));
vi.mock("@/lib/telegram/config", () => ({ resolveTelegramConfig }));
vi.mock("@/lib/telegram/control", () => ({ handleTelegramUpdate }));
vi.mock("@/lib/telegram/link", () => ({ claimTelegramEvent }));

const { POST } = await import("./route");

const update = { update_id: 77, message: { chat: { id: 4242 }, from: { username: "mustafa" }, text: "Build me a demo" } };

function request(body: unknown, secret: string | null = WEBHOOK_SECRET): Request {
  return new Request("https://lynq.build/api/integrations/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { "x-telegram-bot-api-secret-token": secret }),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveTelegramConfig.mockReturnValue({
    ok: true,
    config: { botToken: "1234567890:AAaa", webhookSecret: WEBHOOK_SECRET, organizationId: ORG, founderUserId: FOUNDER, linkSecret: "s".repeat(32) },
  });
  claimTelegramEvent.mockResolvedValue(true);
  handleTelegramUpdate.mockResolvedValue({ outcome: "directive_created", launched: 0, projectId: "project-1" });
});

afterEach(() => vi.unstubAllEnvs());

describe("the Telegram webhook", () => {
  it("refuses a request without the secret token, and does no work", async () => {
    const response = await POST(request(update, null));
    expect(response.status).toBe(401);
    expect(handleTelegramUpdate).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret token", async () => {
    const response = await POST(request(update, "x".repeat(24)));
    expect(response.status).toBe(401);
    expect(handleTelegramUpdate).not.toHaveBeenCalled();
  });

  it("accepts and ignores everything when the lane is not configured", async () => {
    resolveTelegramConfig.mockReturnValue({ ok: false, reason: "disabled", missing: [] });
    const response = await POST(request(update, null));
    // 200 with no work: an error here would make Telegram redeliver forever.
    expect(response.status).toBe(200);
    expect(handleTelegramUpdate).not.toHaveBeenCalled();
  });

  it("handles a valid update once", async () => {
    const response = await POST(request(update));
    expect(response.status).toBe(200);
    expect(claimTelegramEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventId: "77", chatId: "4242", kind: "message" }));
    expect(handleTelegramUpdate).toHaveBeenCalledTimes(1);
  });

  it("never records the words of a message in the event log", async () => {
    await POST(request(update));
    const claimed = claimTelegramEvent.mock.calls[0]![1] as { detail: string };
    expect(claimed.detail).toBe("directive (15 characters)");
    expect(claimed.detail).not.toContain("Build me a demo");
  });

  it("does nothing on a redelivery of an update it already handled", async () => {
    claimTelegramEvent.mockResolvedValue(false);
    const response = await POST(request(update));
    expect(response.status).toBe(200);
    expect(handleTelegramUpdate).not.toHaveBeenCalled();
  });

  it("drains the worker only when a directive actually launched work", async () => {
    handleTelegramUpdate.mockResolvedValue({ outcome: "directive_created", launched: 3, projectId: "project-1" });
    await POST(request(update));
    expect(after).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    claimTelegramEvent.mockResolvedValue(true);
    handleTelegramUpdate.mockResolvedValue({ outcome: "status", launched: 0, projectId: null });
    await POST(request(update));
    expect(after).not.toHaveBeenCalled();
  });

  it("acknowledges rather than looping when handling throws", async () => {
    handleTelegramUpdate.mockRejectedValue(new Error("database is down"));
    const response = await POST(request(update));
    expect(response.status).toBe(200);
  });

  it("acknowledges an unparseable body", async () => {
    const response = await POST(
      new Request("https://lynq.build/api/integrations/telegram/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
        body: "not json",
      }),
    );
    expect(response.status).toBe(200);
    expect(handleTelegramUpdate).not.toHaveBeenCalled();
  });
});
