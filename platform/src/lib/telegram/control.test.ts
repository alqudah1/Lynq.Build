import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramSend, TelegramTransport } from "./api";
import type { JarvisTelegramConfig } from "./config";
import { handleTelegramUpdate } from "./control";
import { normalizeTelegramUpdate, decisionCallbackData } from "./updates";

/**
 * The lane, driven end to end without a network.
 *
 * The two properties worth protecting are here: an unlinked chat can do
 * nothing at all, and a link is not a role — every action re-proves that
 * the account behind the chat may still act on the workspace.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const FOUNDER = "22222222-2222-4222-8222-222222222222";
const APPROVAL = "7f1b3d2e-8a4c-4f11-9a0e-2b6d5c8e9f01";
const CHAT = "4242";

const resolveActiveLink = vi.hoisted(() => vi.fn());
const linkTelegramChat = vi.hoisted(() => vi.fn());
const recordLinkRefusal = vi.hoisted(() => vi.fn());
const revokeTelegramLink = vi.hoisted(() => vi.fn());
const touchLink = vi.hoisted(() => vi.fn());
const recentEventCount = vi.hoisted(() => vi.fn());
const resolvePhoneCommandActor = vi.hoisted(() => vi.fn());
const createDirectiveProject = vi.hoisted(() => vi.fn());
const decideFounderApproval = vi.hoisted(() => vi.fn());
const listPendingApprovalsForApprover = vi.hoisted(() => vi.fn());

vi.mock("./link", () => ({ resolveActiveLink, linkTelegramChat, recordLinkRefusal, revokeTelegramLink, touchLink, recentEventCount }));
vi.mock("@/lib/voice/call-store", () => ({ resolvePhoneCommandActor }));
vi.mock("@/lib/office/directive-intake", () => ({ createDirectiveProject }));
vi.mock("@/lib/founder-os/approval-center", () => ({ decideFounderApproval }));
vi.mock("@/lib/agent-runtime/approvals", () => ({ listPendingApprovalsForApprover }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));

const config: JarvisTelegramConfig = {
  botToken: "1234567890:AAaaBBbbCCccDDddEEeeFFff",
  webhookSecret: "w".repeat(24),
  organizationId: ORG,
  founderUserId: FOUNDER,
  linkSecret: "s".repeat(32),
};

const sent: TelegramSend[] = [];
const transport: TelegramTransport = {
  sendMessage: async (input) => {
    sent.push(input);
  },
  answerCallback: async () => undefined,
};

const link = { id: "link-1", organizationId: ORG, userId: FOUNDER, telegramChatId: CHAT };

/** Only `renderStatus` reads the database directly. */
const db = {
  select: () => ({
    from: () => ({
      where: () => ({ orderBy: () => ({ limit: async () => [{ id: "project-1", name: "Sumac demo", status: "active" }] }) }),
    }),
  }),
} as never;

function update(text: string) {
  return normalizeTelegramUpdate({ update_id: sent.length + 1, message: { chat: { id: Number(CHAT) }, from: { username: "mustafa" }, text } })!;
}

function press(decision: "approve" | "reject", confirmed: boolean) {
  return normalizeTelegramUpdate({
    update_id: 500,
    callback_query: { id: "cb-1", data: decisionCallbackData({ decision, approvalId: APPROVAL, confirmed }), from: { username: "mustafa" }, message: { chat: { id: Number(CHAT) } } },
  })!;
}

const lastMessage = () => sent[sent.length - 1]!;

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  resolveActiveLink.mockResolvedValue(link);
  recentEventCount.mockResolvedValue(0);
  resolvePhoneCommandActor.mockResolvedValue({ organizationId: ORG, founderUserId: FOUNDER, organizationSlug: "lynq", founderName: "Mustafa" });
  createDirectiveProject.mockResolvedValue({
    assistantReply: "I'll find one and build it.",
    plannedByAI: true,
    executionMode: "delivery",
    project: { id: "project-1", name: "Little Italy demo", projectKey: "LITTLE1", status: "active", workspaceId: null },
    assignments: [{ agentId: "a" }],
    launchedCount: 2,
  });
  listPendingApprovalsForApprover.mockResolvedValue([{ id: APPROVAL, summary: "Send one email to hello@sumac.example.ca", riskLevel: "high" }]);
  decideFounderApproval.mockResolvedValue({ id: APPROVAL, executionId: "exec-1" });
});

describe("an unlinked chat", () => {
  beforeEach(() => resolveActiveLink.mockResolvedValue(null));

  it("can do nothing but link", async () => {
    const result = await handleTelegramUpdate(db, { update: update("Build me a demo for a restaurant"), config, transport });
    expect(result.outcome).toBe("not_linked");
    expect(createDirectiveProject).not.toHaveBeenCalled();
    expect(lastMessage().text).toContain("pairing code");
  });

  it("cannot decide an approval", async () => {
    const result = await handleTelegramUpdate(db, { update: press("approve", true), config, transport });
    expect(result.outcome).toBe("not_linked");
    expect(decideFounderApproval).not.toHaveBeenCalled();
  });

  it("links with the right code and is told what it can do", async () => {
    linkTelegramChat.mockResolvedValue({ ok: true, link, relinked: false });
    const result = await handleTelegramUpdate(db, { update: update("/start 41729608"), config, transport });
    expect(result.outcome).toBe("linked");
    expect(lastMessage().text).toContain("Linked.");
    expect(lastMessage().text).toContain("/status");
  });

  it("is refused, and the attempt is recorded, when the code is wrong", async () => {
    linkTelegramChat.mockResolvedValue({ ok: false, reason: "bad_code" });
    const result = await handleTelegramUpdate(db, { update: update("/start 00000000"), config, transport });
    expect(result.outcome).toBe("link_refused");
    expect(recordLinkRefusal).toHaveBeenCalledTimes(1);
    expect(lastMessage().text).toContain("not right");
  });

  it("is told to wait once it has burned its attempts", async () => {
    linkTelegramChat.mockResolvedValue({ ok: false, reason: "attempts_exhausted" });
    await handleTelegramUpdate(db, { update: update("/start 00000000"), config, transport });
    expect(lastMessage().text).toContain("in an hour");
  });
});

describe("a linked chat", () => {
  it("opens a directive from an ordinary message and says what it will do", async () => {
    const result = await handleTelegramUpdate(db, { update: update("Find a restaurant in Little Italy and build them a demo"), config, transport });

    expect(createDirectiveProject).toHaveBeenCalledWith(db, expect.objectContaining({ organizationId: ORG, actorUserId: FOUNDER }));
    expect(result).toMatchObject({ outcome: "directive_created", launched: 2, projectId: "project-1" });
    expect(lastMessage().text).toContain("Little Italy demo");
    expect(lastMessage().text).toContain("come back to you before anything is sent");
  });

  it("says it will send the outreach itself when the founder handed that over", async () => {
    await handleTelegramUpdate(db, { update: update("Find a restaurant and send the email yourself"), config, transport });
    expect(lastMessage().text).toContain("send the outreach myself");
  });

  it("says it will stop at every step when asked to", async () => {
    await handleTelegramUpdate(db, { update: update("Find a restaurant but check with me first"), config, transport });
    expect(lastMessage().text).toContain("every step");
  });

  it("answers /status with what is running and what is waiting", async () => {
    const result = await handleTelegramUpdate(db, { update: update("/status"), config, transport });
    expect(result.outcome).toBe("status");
    expect(lastMessage().text).toContain("Sumac demo");
    expect(lastMessage().text).toContain("Waiting on you (1)");
  });

  it("unlinks itself on request", async () => {
    const result = await handleTelegramUpdate(db, { update: update("/unlink"), config, transport });
    expect(result.outcome).toBe("unlinked");
    expect(revokeTelegramLink).toHaveBeenCalledWith(db, expect.objectContaining({ link, actorUserId: FOUNDER }));
  });

  it("refuses to open more directives than one chat may start in an hour", async () => {
    recentEventCount.mockResolvedValue(12);
    const result = await handleTelegramUpdate(db, { update: update("Build me another demo"), config, transport });

    expect(result.outcome).toBe("directive_rate_limited");
    expect(createDirectiveProject).not.toHaveBeenCalled();
    expect(lastMessage().text).toContain("12 directives in the last hour");
  });

  it("still opens the twelfth directive", async () => {
    recentEventCount.mockResolvedValue(11);
    const result = await handleTelegramUpdate(db, { update: update("Build me another demo"), config, transport });
    expect(result.outcome).toBe("directive_created");
  });

  it("counts only the directives this chat actually opened", async () => {
    recentEventCount.mockResolvedValue(0);
    await handleTelegramUpdate(db, { update: update("Build me a demo"), config, transport });
    expect(recentEventCount).toHaveBeenCalledWith(db, expect.objectContaining({ chatId: CHAT, outcome: "directive_created" }));
  });

  it("does not spend the directive budget on a /status or a /help", async () => {
    recentEventCount.mockResolvedValue(99);
    expect((await handleTelegramUpdate(db, { update: update("/status"), config, transport })).outcome).toBe("status");
    expect((await handleTelegramUpdate(db, { update: update("/help"), config, transport })).outcome).toBe("help");
  });

  it("stops dead when the linked account may no longer act on the workspace", async () => {
    resolvePhoneCommandActor.mockRejectedValue(new Error("insufficient_role"));
    const result = await handleTelegramUpdate(db, { update: update("Build me a demo"), config, transport });
    expect(result.outcome).toBe("actor_unavailable");
    expect(createDirectiveProject).not.toHaveBeenCalled();
    expect(lastMessage().text).toContain("no longer act");
  });
});

describe("a chat linked to a workspace this deployment no longer serves", () => {
  // Repointing JARVIS_TELEGRAM_ORGANIZATION_ID after a chat was linked would
  // otherwise leave that chat acting on the old tenant — outside what the
  // deployment declares it is for.
  beforeEach(() => resolveActiveLink.mockResolvedValue({ ...link, organizationId: "99999999-9999-4999-8999-999999999999" }));

  it("does nothing, and says why", async () => {
    const result = await handleTelegramUpdate(db, { update: update("Build me a demo"), config, transport });
    expect(result.outcome).toBe("link_tenant_mismatch");
    expect(createDirectiveProject).not.toHaveBeenCalled();
    expect(resolvePhoneCommandActor).not.toHaveBeenCalled();
    expect(lastMessage().text).toContain("different workspace");
  });

  it("cannot decide an approval either", async () => {
    const result = await handleTelegramUpdate(db, { update: press("approve", true), config, transport });
    expect(result.outcome).toBe("link_tenant_mismatch");
    expect(decideFounderApproval).not.toHaveBeenCalled();
  });

  it("can still link again, which is the way out", async () => {
    linkTelegramChat.mockResolvedValue({ ok: true, link, relinked: true });
    const result = await handleTelegramUpdate(db, { update: update("/start 41729608"), config, transport });
    expect(result.outcome).toBe("link_repeated");
  });
});

describe("deciding an approval from a chat", () => {
  it("asks a second time before anything reaches a real business", async () => {
    const result = await handleTelegramUpdate(db, { update: press("approve", false), config, transport });

    expect(decideFounderApproval).not.toHaveBeenCalled();
    expect(result.outcome).toBe("decision_confirm_requested");
    expect(lastMessage().text).toContain("reaches someone outside LYNQ");
    expect(lastMessage().text).toContain("hello@sumac.example.ca");
    expect(lastMessage().buttons?.[0]?.[0]?.text).toBe("Yes, do it");
  });

  it("goes through on the second tap, through the real approval path", async () => {
    const result = await handleTelegramUpdate(db, { update: press("approve", true), config, transport });

    expect(result.outcome).toBe("decision_approve");
    expect(decideFounderApproval).toHaveBeenCalledWith(db, expect.objectContaining({ organizationId: ORG, approvalId: APPROVAL, decision: "approve", actorUserId: FOUNDER }));
    expect(lastMessage().text).toContain("Approved.");
  });

  it("decides a low-risk approval on the first tap", async () => {
    listPendingApprovalsForApprover.mockResolvedValue([{ id: APPROVAL, summary: "Approve the restaurant", riskLevel: "medium" }]);
    const result = await handleTelegramUpdate(db, { update: press("approve", false), config, transport });
    expect(result.outcome).toBe("decision_approve");
    expect(decideFounderApproval).toHaveBeenCalledTimes(1);
  });

  it("never asks twice before stopping something", async () => {
    const result = await handleTelegramUpdate(db, { update: press("reject", false), config, transport });
    expect(result.outcome).toBe("decision_reject");
    expect(decideFounderApproval).toHaveBeenCalledWith(db, expect.objectContaining({ decision: "reject" }));
  });

  it("refuses to decide something that is not this founder's to decide", async () => {
    listPendingApprovalsForApprover.mockResolvedValue([]);
    const result = await handleTelegramUpdate(db, { update: press("approve", true), config, transport });
    expect(result.outcome).toBe("decision_stale");
    expect(decideFounderApproval).not.toHaveBeenCalled();
    expect(lastMessage().text).toContain("already been made");
  });
});
