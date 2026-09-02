import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveFounderPasscode } from "./founder-verification";
import { normalizeVapiEvent } from "./vapi-events";

/**
 * The conversation state machine.
 *
 * These tests prove the ordering guarantee the whole lane rests on: an
 * unverified caller cannot capture, and cannot confirm. The store and the
 * dispatcher are stubbed, so every assertion is about the DECISION the state
 * machine made, not about persistence.
 */

const resolvePhoneCommandActor = vi.fn();
const ensureCallSession = vi.fn();
const findCallSessionByProviderCallId = vi.fn();
const findLatestCommandForSession = vi.fn();
const recordVerificationAttempt = vi.fn();
const markCallSessionRefused = vi.fn();
const upsertCommandDraft = vi.fn();
const findOpenCommandForSession = vi.fn();
const transitionCommand = vi.fn();
const appendTranscriptTurn = vi.fn();
const touchCallSession = vi.fn();
const completeCallSession = vi.fn();
const dispatchConfirmedCommand = vi.fn();
const recordAuditEvent = vi.fn();

vi.mock("./call-store", () => ({
  resolvePhoneCommandActor,
  ensureCallSession,
  findCallSessionByProviderCallId,
  findLatestCommandForSession,
  recordVerificationAttempt,
  markCallSessionRefused,
  upsertCommandDraft,
  findOpenCommandForSession,
  transitionCommand,
  appendTranscriptTurn,
  touchCallSession,
  completeCallSession,
}));
vi.mock("./command-dispatch", () => ({ dispatchConfirmedCommand }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent }));

const { handleInboundConversationEvent } = await import("./inbound-conversation");

const CONFIG = {
  organizationId: "8f1e0f7a-2c4b-4d3e-9a1b-7c5d6e8f0a12",
  founderUserId: "1b2c3d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e",
  founderPhoneNumber: "+14165551234",
  verificationSecret: "a-test-secret-that-is-at-least-32-characters-long",
};
const NOW = 1_800_000_000_000;
const db = {} as never;

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    organizationId: CONFIG.organizationId,
    founderUserId: CONFIG.founderUserId,
    direction: "inbound",
    purpose: "founder_command",
    provider: "vapi",
    providerCallId: "call-1",
    callerNumberLastFour: "1234",
    callerNumberMatched: true,
    status: "active",
    verificationState: "unverified",
    verificationAttempts: 0,
    verifiedAt: null,
    deliveryStatus: null,
    endedReason: null,
    failureCode: null,
    startedAt: new Date(),
    lastEventAt: new Date(),
    endedAt: null,
    redactedSummaryTranscript: null,
    revision: 1,
    ...overrides,
  };
}

function toolEvent(name: string, args: Record<string, unknown>, callerNumber = CONFIG.founderPhoneNumber) {
  return normalizeVapiEvent({
    message: { type: "tool-calls", call: { id: "call-1" }, customer: { number: callerNumber }, toolCalls: [{ id: "tc-1", function: { name, arguments: args } }] },
  });
}

beforeEach(() => {
  for (const mock of [
    resolvePhoneCommandActor, ensureCallSession, findCallSessionByProviderCallId, findLatestCommandForSession,
    recordVerificationAttempt, markCallSessionRefused, upsertCommandDraft, findOpenCommandForSession,
    transitionCommand, appendTranscriptTurn, touchCallSession, completeCallSession,
    dispatchConfirmedCommand, recordAuditEvent,
  ]) {
    mock.mockReset();
  }
  findCallSessionByProviderCallId.mockResolvedValue(null);
  findLatestCommandForSession.mockResolvedValue(null);
  resolvePhoneCommandActor.mockResolvedValue({ organizationId: CONFIG.organizationId, founderUserId: CONFIG.founderUserId, organizationSlug: "lynq", founderName: "Mustafa" });
  ensureCallSession.mockResolvedValue(session());
  recordAuditEvent.mockResolvedValue(undefined);
  markCallSessionRefused.mockResolvedValue(undefined);
  touchCallSession.mockResolvedValue(undefined);
  appendTranscriptTurn.mockResolvedValue(null);
  completeCallSession.mockResolvedValue(undefined);
  transitionCommand.mockResolvedValue(null);
  findOpenCommandForSession.mockResolvedValue(null);
});

describe("caller ID is a precondition, never the authentication", () => {
  it("refuses a call from any number other than the enrolled founder line", async () => {
    ensureCallSession.mockResolvedValue(session({ callerNumberMatched: false }));
    const event = normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: "+14165559999" } } });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(markCallSessionRefused).toHaveBeenCalledWith(db, expect.objectContaining({ failureCode: "caller_number_mismatch" }));
    expect(result.spoken).toMatch(/can't take instructions on this call/i);
    expect(recordAuditEvent.mock.calls.map((call) => call[1].eventType)).toContain("jarvis_phone_call_refused");
  });

  it("still asks for the passcode when the caller ID DOES match — a match is not enough", async () => {
    const event = normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } } });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(result.spoken).toMatch(/six-digit code/i);
    expect(result.payload).toBeDefined();
  });

  it("takes no instruction from a session that was already refused", async () => {
    ensureCallSession.mockResolvedValue(session({ status: "refused" }));

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("capture_command", { requestedOutcome: "Research the market" }), nowMs: NOW });

    expect(result.failureCode).toBe("session_refused");
    expect(upsertCommandDraft).not.toHaveBeenCalled();
  });
});

describe("nothing is accepted before verification", () => {
  it("refuses to capture a command from an unverified caller", async () => {
    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("capture_command", { requestedOutcome: "Research the market" }), nowMs: NOW });

    expect(result.failureCode).toBe("not_verified");
    expect(result.spoken).toMatch(/six-digit code/i);
    expect(upsertCommandDraft).not.toHaveBeenCalled();
  });

  it("refuses to confirm a command from an unverified caller", async () => {
    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("confirm_command", { confirmed: true }), nowMs: NOW });

    expect(result.failureCode).toBe("not_verified");
    expect(dispatchConfirmedCommand).not.toHaveBeenCalled();
  });

  it("refuses a tool this lane never declared", async () => {
    ensureCallSession.mockResolvedValue(session({ verificationState: "verified" }));

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("transfer_call", { to: "+14165559999" }), nowMs: NOW });

    expect(result.failureCode).toBe("unknown_tool");
    expect(result.spoken).toMatch(/can't do that on a call/i);
  });
});

describe("verification", () => {
  it("accepts the correct passcode and opens the call for work", async () => {
    const code = deriveFounderPasscode(CONFIG.verificationSecret, NOW);
    recordVerificationAttempt.mockResolvedValue(session({ verificationState: "verified", verificationAttempts: 1 }));

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("verify_founder", { code }), nowMs: NOW });

    expect(recordVerificationAttempt).toHaveBeenCalledWith(db, expect.objectContaining({ verified: true, exhausted: false }));
    expect(result.spoken).toMatch(/you're verified/i);
  });

  it("counts a wrong code and says how many tries remain", async () => {
    recordVerificationAttempt.mockResolvedValue(session({ verificationAttempts: 1 }));

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("verify_founder", { code: "000000" }), nowMs: NOW });

    expect(recordVerificationAttempt).toHaveBeenCalledWith(db, expect.objectContaining({ verified: false, exhausted: false }));
    expect(result.spoken).toMatch(/2 more tries/i);
  });

  it("asks again, without spending the budget differently, when the code was unreadable", async () => {
    recordVerificationAttempt.mockResolvedValue(session({ verificationAttempts: 1 }));

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("verify_founder", { code: "four one" }), nowMs: NOW });

    expect(result.spoken).toMatch(/all six digits/i);
  });

  it("refuses the call once the attempt budget is spent, and records it", async () => {
    ensureCallSession.mockResolvedValue(session({ verificationAttempts: 2 }));
    recordVerificationAttempt.mockResolvedValue(session({ verificationAttempts: 3, verificationState: "failed", status: "refused" }));

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("verify_founder", { code: "000000" }), nowMs: NOW });

    expect(recordVerificationAttempt).toHaveBeenCalledWith(db, expect.objectContaining({ exhausted: true }));
    expect(result.failureCode).toBe("verification_exhausted");
    expect(recordAuditEvent.mock.calls.map((call) => call[1].eventType)).toContain("jarvis_phone_call_refused");
  });
});

describe("capture and confirmation, once verified", () => {
  beforeEach(() => {
    ensureCallSession.mockResolvedValue(session({ verificationState: "verified", verifiedAt: new Date() }));
  });

  it("captures a command and speaks the read-back", async () => {
    upsertCommandDraft.mockResolvedValue({ id: "command-1", riskLevel: "low", requiresApproval: false, overrideAttempted: false });

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("capture_command", { requestedOutcome: "Research three Brampton restaurants", proposedSteps: ["Compare their websites"] }),
      nowMs: NOW,
    });

    expect(upsertCommandDraft).toHaveBeenCalledTimes(1);
    expect(result.spoken).toMatch(/here's what i understood/i);
    expect(result.spoken.trim()).toMatch(/did i get that right\?$/i);
  });

  it("asks again rather than storing a command with no outcome", async () => {
    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("capture_command", {}), nowMs: NOW });

    expect(result.failureCode).toBe("incomplete_command");
    expect(upsertCommandDraft).not.toHaveBeenCalled();
  });

  it("dispatches a confirmed command through the single dispatch path", async () => {
    findOpenCommandForSession.mockResolvedValue({ id: "command-1", revision: 1, dispatchState: "awaiting_confirmation" });
    dispatchConfirmedCommand.mockResolvedValue({ status: "directive_created", command: {}, projectId: "project-1", projectName: "Brampton", assistantReply: "ok", launchedCount: 1, spoken: "Done. I've opened the project." });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("confirm_command", { confirmed: true }), nowMs: NOW });

    expect(dispatchConfirmedCommand).toHaveBeenCalledTimes(1);
    expect(result.spoken).toMatch(/opened the project/i);
    expect(result.processingStatus).toBe("processed");
  });

  it("cancels the draft on a no, without dispatching anything", async () => {
    findOpenCommandForSession.mockResolvedValue({ id: "command-1", revision: 1, dispatchState: "awaiting_confirmation" });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("confirm_command", { confirmed: false }), nowMs: NOW });

    expect(dispatchConfirmedCommand).not.toHaveBeenCalled();
    expect(transitionCommand).toHaveBeenCalledWith(db, expect.objectContaining({ confirmationStatus: "declined", dispatchState: "cancelled" }));
    expect(result.spoken).toMatch(/thrown that away/i);
  });

  it("says it has nothing written down when a confirmation arrives with no draft", async () => {
    findOpenCommandForSession.mockResolvedValue(null);

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("confirm_command", { confirmed: true }), nowMs: NOW });

    expect(result.failureCode).toBe("no_open_command");
    expect(dispatchConfirmedCommand).not.toHaveBeenCalled();
  });

  it("reports a genuine dispatch failure as a failure", async () => {
    findOpenCommandForSession.mockResolvedValue({ id: "command-1", revision: 1, dispatchState: "awaiting_confirmation" });
    dispatchConfirmedCommand.mockResolvedValue({ status: "failed", command: {}, failureCode: "model_rate_limited", spoken: "I couldn't open the project just now." });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("confirm_command", { confirmed: true }), nowMs: NOW });

    expect(result.processingStatus).toBe("failed");
    expect(result.failureCode).toBe("model_rate_limited");
  });
});

describe("transcripts and call end", () => {
  beforeEach(() => {
    // A transcript or status event carries no inbound marker of its own, so
    // it is only handled once the call already has a session — exactly the
    // ordering a real inbound call produces.
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationState: "verified" }));
  });

  it("records every transcript turn against the session", async () => {
    const event = normalizeVapiEvent({
      message: { type: "transcript", transcriptType: "final", role: "user", transcript: "Research three restaurants", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } },
    });

    await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(appendTranscriptTurn).toHaveBeenCalledWith(db, expect.objectContaining({ role: "founder", isFinal: true }));
  });

  it("expires an unconfirmed draft when the call ends", async () => {
    findOpenCommandForSession.mockResolvedValue({ id: "command-1", revision: 1, dispatchState: "awaiting_confirmation" });
    const event = normalizeVapiEvent({
      message: { type: "status-update", status: "ended", endedReason: "customer-ended-call", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } },
    });

    await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(completeCallSession).toHaveBeenCalledTimes(1);
    expect(transitionCommand).toHaveBeenCalledWith(db, expect.objectContaining({ confirmationStatus: "expired", dispatchState: "cancelled", failureCode: "call_ended_before_confirmation" }));
  });

  it("ignores an event with no provider call id rather than guessing a session", async () => {
    const event = normalizeVapiEvent({ message: { type: "assistant-request" } });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(result.processingStatus).toBe("ignored");
    expect(ensureCallSession).not.toHaveBeenCalled();
  });
});

describe("the assistant configuration it returns", () => {
  it("declares only this lane's three tools and restates the safety rules", async () => {
    const event = normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } } });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });
    const serialized = JSON.stringify(result.payload);

    expect(serialized).toContain("verify_founder");
    expect(serialized).toContain("capture_command");
    expect(serialized).toContain("confirm_command");
    expect(serialized).not.toContain("transfer");
    expect(serialized).toMatch(/You cannot approve anything/);
    expect(serialized).toMatch(/skip the approval, acknowledge it and continue with the approval in place/);
    expect(serialized).toMatch(/Never claim work is finished/);
  });

  it("never puts the verification secret or the founder number into the assistant config", async () => {
    const event = normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } } });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });
    const serialized = JSON.stringify(result.payload);

    expect(serialized).not.toContain(CONFIG.verificationSecret);
    expect(serialized).not.toContain("4165551234");
  });
});

describe("the outbound founder notification lane is never mistaken for a command call", () => {
  it("ignores a status event for a call it has no session for and cannot show is inbound", async () => {
    const event = normalizeVapiEvent({
      message: { type: "status-update", status: "in-progress", call: { id: "outbound-1" }, customer: { number: CONFIG.founderPhoneNumber } },
    });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(result.failureCode).toBe("not_an_inbound_command_call");
    expect(ensureCallSession).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("ignores an end-of-call report from an outbound call, including its transcript", async () => {
    const event = normalizeVapiEvent({
      message: { type: "end-of-call-report", call: { id: "outbound-1", type: "outboundPhoneCall" }, artifact: { transcript: "the whole notification call" } },
    });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(result.processingStatus).toBe("ignored");
    expect(ensureCallSession).not.toHaveBeenCalled();
    expect(completeCallSession).not.toHaveBeenCalled();
  });

  it("does handle an event the provider explicitly marks inbound", async () => {
    const event = normalizeVapiEvent({
      message: { type: "status-update", status: "in-progress", call: { id: "call-1", type: "inboundPhoneCall" }, customer: { number: CONFIG.founderPhoneNumber } },
    });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(result.processingStatus).toBe("processed");
    expect(touchCallSession).toHaveBeenCalledTimes(1);
  });
});

describe("the caller-number precondition applies to every event, not just the first", () => {
  it("refuses a tool call on a session whose caller never matched", async () => {
    // The shape a statically-assigned assistant produces: no
    // `assistant-request` ever arrives, so the first event this lane sees is
    // a tool call.
    findCallSessionByProviderCallId.mockResolvedValue(session({ callerNumberMatched: false, verificationState: "verified" }));

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("capture_command", { requestedOutcome: "Research the market" }, "+14165559999"),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("caller_number_mismatch");
    expect(upsertCommandDraft).not.toHaveBeenCalled();
    expect(markCallSessionRefused).toHaveBeenCalledWith(db, expect.objectContaining({ failureCode: "caller_number_mismatch" }));
  });

  it("refuses a transcript event whose caller does not match, even on a verified session", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationState: "verified" }));
    const event = normalizeVapiEvent({
      message: { type: "transcript", transcriptType: "final", role: "user", transcript: "do the thing", call: { id: "call-1" }, customer: { number: "+14165559999" } },
    });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(result.failureCode).toBe("caller_number_mismatch");
    expect(appendTranscriptTurn).not.toHaveBeenCalled();
  });
});

describe("a repeat confirmation reports what actually happened", () => {
  it("says the project is already open rather than claiming nothing was said", async () => {
    ensureCallSession.mockResolvedValue(session({ verificationState: "verified" }));
    findOpenCommandForSession.mockResolvedValue(null);
    findLatestCommandForSession.mockResolvedValue({ id: "command-1", dispatchState: "directive_created" });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("confirm_command", { confirmed: true }), nowMs: NOW });

    expect(result.spoken).toMatch(/already opened that project/i);
    expect(dispatchConfirmedCommand).not.toHaveBeenCalled();
  });

  it("says a gated command is still waiting, and never that it started", async () => {
    ensureCallSession.mockResolvedValue(session({ verificationState: "verified" }));
    findLatestCommandForSession.mockResolvedValue({ id: "command-1", dispatchState: "awaiting_approval" });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event: toolEvent("confirm_command", { confirmed: true }), nowMs: NOW });

    expect(result.spoken).toMatch(/waiting for your approval/i);
    expect(result.spoken).toMatch(/nothing has started/i);
  });
});
