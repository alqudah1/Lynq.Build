import { describe, expect, it } from "vitest";
import { decisionCallbackData, normalizeTelegramUpdate, redactForEventLog } from "./updates";

/**
 * Everything Jarvis is willing to act on from a chat is named here. What
 * matters most is the other side of that: anything it does not recognise
 * becomes `unsupported` and gets a polite answer, never a guess.
 */

function message(text: string, chatId = 4242) {
  return { update_id: 1, message: { message_id: 9, chat: { id: chatId }, from: { id: 7, username: "mustafa" }, text } };
}

describe("reading a message", () => {
  it("treats ordinary text as work to be done", () => {
    const update = normalizeTelegramUpdate(message("Find a good restaurant in Little Italy and build them a demo."))!;
    expect(update.chatId).toBe("4242");
    expect(update.username).toBe("mustafa");
    expect(update.action).toEqual({ kind: "directive", instruction: "Find a good restaurant in Little Italy and build them a demo." });
  });

  it("keeps the update id as the idempotency key, whatever the shape", () => {
    expect(normalizeTelegramUpdate({ update_id: 99, message: { chat: { id: 1 }, text: "hi" } })!.eventId).toBe("99");
    expect(normalizeTelegramUpdate({ update_id: "99", message: { chat: { id: 1 }, text: "hi" } })!.eventId).toBe("99");
  });

  it("reads a pairing code out of /start, digits only", () => {
    expect(normalizeTelegramUpdate(message("/start 4172 9608"))!.action).toEqual({ kind: "link", code: "41729608" });
    expect(normalizeTelegramUpdate(message("/link 41729608"))!.action).toEqual({ kind: "link", code: "41729608" });
  });

  it("understands the commands it advertises, including group-addressed ones", () => {
    expect(normalizeTelegramUpdate(message("/status"))!.action).toEqual({ kind: "status" });
    expect(normalizeTelegramUpdate(message("/status@lynq_jarvis_bot"))!.action).toEqual({ kind: "status" });
    expect(normalizeTelegramUpdate(message("/help"))!.action).toEqual({ kind: "help" });
    expect(normalizeTelegramUpdate(message("/unlink"))!.action).toEqual({ kind: "unlink" });
    expect(normalizeTelegramUpdate(message("/start"))!.action).toEqual({ kind: "help" });
  });

  it("refuses a command it does not know rather than treating it as work", () => {
    expect(normalizeTelegramUpdate(message("/deploy"))!.action).toEqual({ kind: "unsupported", reason: "unknown_command:deploy" });
  });

  it("handles an edited message, an empty one, and a malformed update", () => {
    expect(normalizeTelegramUpdate({ update_id: 2, edited_message: { chat: { id: 5 }, text: "changed my mind" } })!.action)
      .toEqual({ kind: "directive", instruction: "changed my mind" });
    expect(normalizeTelegramUpdate(message("   "))!.action).toEqual({ kind: "unsupported", reason: "empty_message" });
    expect(normalizeTelegramUpdate({ update_id: 3 })!.action).toEqual({ kind: "unsupported", reason: "no_message" });
    expect(normalizeTelegramUpdate({ nothing: true })).toBeNull();
  });

  it("bounds how much of one message becomes a directive", () => {
    const update = normalizeTelegramUpdate(message("x".repeat(5000)))!;
    if (update.action.kind !== "directive") throw new Error("expected a directive");
    expect(update.action.instruction).toHaveLength(2000);
  });
});

describe("reading a button press", () => {
  const callback = (data: string) => ({ update_id: 8, callback_query: { id: "cb-1", data, from: { username: "mustafa" }, message: { chat: { id: 4242 } } } });
  const approvalId = "7f1b3d2e-8a4c-4f11-9a0e-2b6d5c8e9f01";

  it("round-trips a decision through its callback payload", () => {
    const data = decisionCallbackData({ decision: "approve", approvalId, confirmed: false });
    const update = normalizeTelegramUpdate(callback(data))!;
    expect(update.callbackId).toBe("cb-1");
    expect(update.action).toEqual({ kind: "decision", decision: "approve", approvalId, confirmed: false });
  });

  it("carries the second-tap confirmation separately", () => {
    const data = decisionCallbackData({ decision: "approve", approvalId, confirmed: true });
    expect(normalizeTelegramUpdate(callback(data))!.action).toMatchObject({ confirmed: true });
  });

  it("refuses a payload that is not one of ours", () => {
    expect(normalizeTelegramUpdate(callback("approve:not-a-uuid"))!.action).toEqual({ kind: "unsupported", reason: "unrecognised_button" });
    expect(normalizeTelegramUpdate(callback(`delete:${approvalId}`))!.action).toEqual({ kind: "unsupported", reason: "unrecognised_button" });
    expect(normalizeTelegramUpdate(callback(""))!.action).toEqual({ kind: "unsupported", reason: "unrecognised_button" });
  });
});

describe("what reaches the event log", () => {
  it("never records a pairing code or the words of a directive", () => {
    expect(redactForEventLog({ kind: "link", code: "41729608" })).toBe("link attempt");
    expect(redactForEventLog({ kind: "link", code: "41729608" })).not.toContain("41729608");
    const logged = redactForEventLog({ kind: "directive", instruction: "Email Sumac & Stone about the demo" });
    expect(logged).toBe("directive (34 characters)");
    expect(logged).not.toContain("Sumac");
  });

  it("records a decision by what it was, not by who it was about", () => {
    expect(redactForEventLog({ kind: "decision", decision: "approve", approvalId: "abc", confirmed: true })).toBe("approve confirmed on abc");
  });
});
