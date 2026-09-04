import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizations, users } from "@/db/schema";

/**
 * Jarvis rings the phone when it wants something.
 *
 * That is the whole rule this file exists to hold. A founder who hands a
 * directive over and goes to work will accept being called when a decision
 * is needed; being called to be told everything went fine is the behaviour
 * that gets a notification channel muted, and a muted channel is worse than
 * no channel at all.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";

const notifyFounderByVoice = vi.hoisted(() => vi.fn());
const notifyTelegramRunFinished = vi.hoisted(() => vi.fn());

vi.mock("@/lib/voice/notifier", () => ({ notifyFounderByVoice }));
vi.mock("@/lib/telegram/notifier", () => ({
  notifyTelegramApprovalNeeded: vi.fn(async () => "sent"),
  notifyTelegramExecutionStopped: vi.fn(async () => "sent"),
  notifyTelegramRunFinished,
}));
vi.mock("./resend-transport", () => ({ resolveConfiguredEmailTransport: () => null }));

const { notifyJarvisRunFinished } = await import("./jarvis-notifier");

const db = {
  select: () => ({
    from: (table: unknown) => ({
      where: async () => {
        if (table === users) return [{ email: "mustafa@example.com", name: "Mustafa" }];
        if (table === organizations) return [{ slug: "lynq" }];
        throw new Error("unexpected table");
      },
    }),
  }),
} as never;

const sent: string[] = [];
const transport = { send: async (message: { text: string }) => void sent.push(message.text) };

function run(needsFounder: string[]) {
  return notifyJarvisRunFinished(
    db,
    { organizationId: ORG, ownerUserId: OWNER, projectId: PROJECT, projectName: "Sumac & Stone demo", headline: "Concept site built and ready to look at", needsFounder },
    transport,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  notifyFounderByVoice.mockResolvedValue("sent");
  notifyTelegramRunFinished.mockResolvedValue("sent");
});

describe("the one message at the end of a run", () => {
  it("does not ring the phone when nothing is waiting on the founder", async () => {
    const outcome = await run([]);

    expect(notifyFounderByVoice).not.toHaveBeenCalled();
    expect(outcome.voice).toBe("not_needed");
    // The report still reaches him, in the two channels he reads rather
    // than answers.
    expect(outcome.email).toBe("sent");
    expect(notifyTelegramRunFinished).toHaveBeenCalledTimes(1);
    expect(sent[0]).toContain("Nothing is waiting on you.");
  });

  it("calls when the run finished but something still needs him", async () => {
    const outcome = await run(["One email to hello@sumac.example.ca is drafted and waiting for your approval."]);

    expect(outcome.voice).toBe("sent");
    expect(notifyFounderByVoice).toHaveBeenCalledTimes(1);
    const call = notifyFounderByVoice.mock.calls[0]![0] as { kind: string; summary: string };
    // Not "approval_needed": Vapi's script turns on this, and a finished run
    // announced as an approval tells him his decision is required when it is
    // not.
    expect(call.kind).toBe("run_finished");
    expect(call.summary).toContain("1 thing still needs you");
  });

  it("counts more than one outstanding thing in plain English", async () => {
    await run(["The demo is not finished.", "One email is waiting for your approval."]);
    // Read aloud on a call, so it has to be a sentence a person would say.
    expect((notifyFounderByVoice.mock.calls[0]![0] as { summary: string }).summary).toContain("2 things still need you");
  });

  it("still reports the run when every channel is unavailable", async () => {
    notifyFounderByVoice.mockResolvedValue("failed");
    notifyTelegramRunFinished.mockResolvedValue("not_configured");
    const outcome = await notifyJarvisRunFinished(
      db,
      { organizationId: ORG, ownerUserId: OWNER, projectId: PROJECT, projectName: "Sumac & Stone demo", headline: "done", needsFounder: ["something"] },
      null,
    );
    expect(outcome).toEqual({ email: "not_configured", voice: "failed", telegram: "not_configured" });
  });
});
