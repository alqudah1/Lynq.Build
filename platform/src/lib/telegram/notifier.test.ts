import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Jarvis reaching the founder in the chat.
 *
 * Two properties matter here and nothing else does: an outage must never
 * fail a run, and this bot speaks for exactly one workspace — the same one
 * the inbound lane will accept a chat for. Anything else and a chat could
 * keep receiving a workspace's work after it has stopped being able to act
 * on it.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";

const resolveTelegramConfig = vi.hoisted(() => vi.fn());

vi.mock("./config", () => ({ resolveTelegramConfig }));

const { notifyTelegramApprovalNeeded, notifyTelegramRunFinished } = await import("./notifier");

const sent: { chatId: string; text: string; buttons?: { text: string; callbackData: string }[][] }[] = [];
const transport = {
  sendMessage: async (message: { chatId: string; text: string; buttons?: { text: string; callbackData: string }[][] }) => void sent.push(message),
  answerCallback: async () => undefined,
};

let chats: { chatId: string }[] = [];

const db = {
  select: () => ({ from: () => ({ where: async () => chats }) }),
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  chats = [{ chatId: "4242" }];
  resolveTelegramConfig.mockReturnValue({
    ok: true,
    config: { botToken: "1234567890:AAaa", webhookSecret: "w".repeat(24), organizationId: ORG, founderUserId: "founder", linkSecret: "s".repeat(32) },
  });
});

describe("telling the founder in the chat", () => {
  it("sends an approval with the buttons that decide it", async () => {
    const status = await notifyTelegramApprovalNeeded(
      db,
      { organizationId: ORG, projectName: "Sumac & Stone demo", summary: "Send one email to hello@sumac.example.ca", approvalId: "approval-1", riskLevel: "high" },
      transport,
    );

    expect(status).toBe("sent");
    expect(sent[0]!.buttons?.[0]?.map((button) => button.text)).toEqual(["Approve", "Stop"]);
    // Stopping something never asks twice; approving something high-risk does.
    expect(sent[0]!.buttons![0]![0]!.callbackData).toContain("approve");
    expect(sent[0]!.text).toContain("confirm");
  });

  it("says nothing for a workspace this bot does not serve", async () => {
    const status = await notifyTelegramRunFinished(
      db,
      { organizationId: OTHER_ORG, projectName: "Someone else's project", headline: "done", needsFounder: [], projectUrl: "https://lynq.build" },
      transport,
    );

    expect(status).toBe("not_configured");
    expect(sent).toEqual([]);
  });

  it("says so plainly when no chat has been linked", async () => {
    chats = [];
    const status = await notifyTelegramRunFinished(
      db,
      { organizationId: ORG, projectName: "Sumac & Stone demo", headline: "done", needsFounder: [], projectUrl: "https://lynq.build" },
      transport,
    );
    expect(status).toBe("no_link");
  });

  it("never fails a run because Telegram is down", async () => {
    const broken = { sendMessage: async () => { throw new Error("telegram is down"); }, answerCallback: async () => undefined };
    const status = await notifyTelegramRunFinished(
      db,
      { organizationId: ORG, projectName: "Sumac & Stone demo", headline: "done", needsFounder: [], projectUrl: "https://lynq.build" },
      broken,
    );
    expect(status).toBe("failed");
  });

  it("reaches every chat the founder has linked", async () => {
    chats = [{ chatId: "4242" }, { chatId: "8888" }];
    await notifyTelegramRunFinished(
      db,
      { organizationId: ORG, projectName: "Sumac & Stone demo", headline: "done", needsFounder: ["one thing"], projectUrl: "https://lynq.build" },
      transport,
    );
    expect(sent.map((message) => message.chatId)).toEqual(["4242", "8888"]);
    expect(sent[0]!.text).toContain("Still needs you");
  });
});
