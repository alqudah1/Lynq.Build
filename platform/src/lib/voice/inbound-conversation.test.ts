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
const countTranscriptTurns = vi.fn(async () => 0);
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
  countTranscriptTurns,
  touchCallSession,
  completeCallSession,
}));
vi.mock("./command-dispatch", () => ({ dispatchConfirmedCommand }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent }));

/** The cross-call verification lockout. Allowed by default; one test drives it to refuse. */
const recordRateLimitAttempt = vi.fn<(key: string, config?: unknown) => Promise<{ allowed: boolean; remaining: number; resetAt: Date }>>(
  async () => ({ allowed: true, remaining: 11, resetAt: new Date() })
);
const resetRateLimit = vi.fn<(key: string) => Promise<void>>(async () => undefined);
vi.mock("@/lib/rate-limit/postgres", () => ({
  PostgresRateLimiter: class {
    recordAttempt = recordRateLimitAttempt;
    resetLimit = resetRateLimit;
  },
}));

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
    dispatchConfirmedCommand, recordAuditEvent, countTranscriptTurns,
    recordRateLimitAttempt, resetRateLimit,
  ]) {
    mock.mockReset();
  }
  countTranscriptTurns.mockResolvedValue(0);
  recordRateLimitAttempt.mockResolvedValue({ allowed: true, remaining: 11, resetAt: new Date() });
  resetRateLimit.mockResolvedValue(undefined);
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

    expect(result.spoken).toMatch(/\d-digit code/i);
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
    expect(result.spoken).toMatch(/\d-digit code/i);
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

    expect(result.spoken).toMatch(/I need all \w+ digits/i);
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
    upsertCommandDraft.mockImplementation(async (_db: unknown, { draft }: { draft: { readback: string } }) => ({
      id: "command-1",
      riskLevel: "low",
      requiresApproval: false,
      overrideAttempted: false,
      readbackText: draft.readback,
    }));

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("capture_command", { requestedOutcome: "Research three Brampton restaurants", proposedSteps: ["Compare their websites"] }),
      nowMs: NOW,
    });

    expect(upsertCommandDraft).toHaveBeenCalledTimes(1);
    expect(result.spoken).toMatch(/here's what i understood/i);
    expect(result.spoken.trim()).toMatch(/did i get that right\?$/i);
  });

  /**
   * Found by review round six. `upsertCommandDraft` can legitimately return a
   * DIFFERENT row than the one it was asked to write: two captures arriving
   * concurrently with different content both find no open draft, and the loser
   * — refused by the one-open-draft-per-call index — recovers by returning the
   * winner's row.
   *
   * Speaking the locally-built draft there meant the founder heard THIS
   * command, said yes, and the confirmation dispatched the OTHER one. On a call
   * whose entire safety story is "you confirm what I read back to you", the
   * read-back must come from the row that will actually be dispatched.
   */
  it("reads back what was stored, not what it just built, when another capture won the race", async () => {
    upsertCommandDraft.mockResolvedValue({
      id: "command-1",
      riskLevel: "low",
      requiresApproval: false,
      overrideAttempted: false,
      readbackText: "Here's what I understood. You want me to audit the supplier list. Did I get that right?",
    });

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("capture_command", { requestedOutcome: "Research three Brampton restaurants" }),
      nowMs: NOW,
    });

    expect(result.spoken).toContain("audit the supplier list");
    expect(result.spoken).not.toContain("Brampton");
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
    // Refused — but what an unauthorized caller said IS recorded, redacted,
    // before the refusal. The refusal used to return above the switch, so
    // `handleTranscript` never ran and nothing they said was stored anywhere:
    // the one call most worth having a transcript of was the one that erased
    // its own forensics. Recording it changes nothing else — a refused session
    // can still capture, confirm or dispatch nothing.
    expect(appendTranscriptTurn).toHaveBeenCalledTimes(1);
  });

  /**
   * Round twelve. The re-check recomputed the match from the CURRENT event, and
   * an event that carries no `customer` object produced `false` — so a delivery
   * without one refused a call that had already matched and verified. Two
   * consequences, both bad: a `caller_number_mismatch` audit row recording a
   * security finding that did not happen, and — because the refusal returns
   * before the switch — `finalizeCall` never running, which leaves an
   * unconfirmed draft in `awaiting_confirmation` with no exit in the entire
   * system.
   */
  it("does not refuse a matched call over an event that simply carries no number", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationState: "verified" }));
    const event = normalizeVapiEvent({ message: { type: "status-update", status: "ended", call: { id: "call-1" } } });
    expect(event.callerNumber).toBeNull();

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(result.failureCode).toBeUndefined();
    expect(markCallSessionRefused).not.toHaveBeenCalled();
    // And the call is actually finalized, which is the part a refusal skipped.
    expect(completeCallSession).toHaveBeenCalledTimes(1);
  });

  /**
   * Round twelve. The session lookup is keyed on (provider, provider call id)
   * with no tenant predicate — it cannot have one, since the tenant is what it
   * is being used to find. Repointing JARVIS_PHONE_ORGANIZATION_ID (a tenant
   * migration, or a second deployment sharing this database) therefore meant a
   * late or replayed event resolved the OLD organization's session, proved
   * membership against the NEW one, and wrote the transcript, the draft and
   * the audit rows into the old tenant. Every check passed on its own; nothing
   * checked that they agreed.
   */
  it("writes nothing through a session that belongs to another organization", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ organizationId: "99999999-9999-4999-8999-999999999999", verificationState: "verified" }));

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("capture_command", { requestedOutcome: "Research the market" }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("session_tenant_mismatch");
    expect(upsertCommandDraft).not.toHaveBeenCalled();
    expect(appendTranscriptTurn).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("still refuses when a number IS supplied and does not match", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationState: "verified" }));
    const event = normalizeVapiEvent({
      message: { type: "status-update", status: "in-progress", call: { id: "call-1" }, customer: { number: "+14165559999" } },
    });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(result.failureCode).toBe("caller_number_mismatch");
    expect(markCallSessionRefused).toHaveBeenCalledTimes(1);
  });

  it("hands a refused caller a closed assistant, not the lane's own instructions", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(null);
    ensureCallSession.mockResolvedValue(session({ callerNumberMatched: false }));
    const event = normalizeVapiEvent({
      message: { type: "assistant-request", call: { id: "call-9", type: "inboundPhoneCall" }, customer: { number: "+14165559999" } },
    });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    const assistant = (result.payload as { assistant?: Record<string, unknown> } | undefined)?.assistant;
    expect(assistant).toBeTruthy();
    // No tools, and no ten-minute window to extract the system prompt from.
    expect(assistant?.tools).toBeUndefined();
    expect(JSON.stringify(assistant)).not.toMatch(/verify_founder|capture_command|confirm_command/);
    expect(JSON.stringify(assistant)).not.toMatch(/LYNQ Office/);
    expect(Number(assistant?.maxDurationSeconds)).toBeLessThanOrEqual(60);
  });
});

describe("the passcode attempt budget survives a redial", () => {
  /**
   * The three-attempt cap was per CALL SESSION only. Hanging up and redialling
   * produced a new provider call id, a new session row, and
   * `verificationAttempts` back at zero — so the cap cost an attacker one
   * redial, and nothing else rate limited this route at all. The cost model for
   * guessing the second factor was an attacker's phone bill.
   */
  it("refuses further attempts from a number that has already spent its budget across calls", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationAttempts: 0 }));
    recordRateLimitAttempt.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: new Date() });

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("verify_founder", { code: "000000" }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("verification_rate_limited");
    expect(recordVerificationAttempt).not.toHaveBeenCalled();
  });

  it("fails closed when the rate-limit backend is unreachable", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationAttempts: 0 }));
    recordRateLimitAttempt.mockRejectedValueOnce(new Error("backend down"));

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("verify_founder", { code: deriveFounderPasscode(CONFIG.verificationSecret, NOW) }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("verification_rate_limited");
    expect(recordVerificationAttempt).not.toHaveBeenCalled();
  });
});

describe("what an unverified caller costs", () => {
  /**
   * Round twelve. Caller ID is spoofable — this file's own comments say so —
   * and a spoofed line matching the founder's number was not refused. Every
   * redial opened a session row, wrote a start audit entry, was handed a
   * ten-minute assistant, and could write unbounded transcript turns that the
   * Jarvis screen renders as the founder's own words. The passcode budget did
   * not bound any of it, because an attacker who never guesses never spends a
   * passcode attempt.
   */
  it("opens no session at all once the caller has spent its hourly call budget", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(null);
    recordRateLimitAttempt.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: new Date() });
    const event = normalizeVapiEvent({
      message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } },
    });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(result.failureCode).toBe("call_rate_limited");
    // Nothing durable is written — no session, no audit row.
    expect(ensureCallSession).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
    // And the caller gets the closed assistant: one sentence, no tools.
    const assistant = (result.payload as { assistant?: Record<string, unknown> } | undefined)?.assistant;
    expect(assistant?.tools).toBeUndefined();
    expect(Number(assistant?.maxDurationSeconds)).toBeLessThanOrEqual(60);
  });

  it("does not spend the call budget on later events of a call already open", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationState: "verified" }));

    await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({
        message: { type: "status-update", status: "in-progress", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } },
      }),
      nowMs: NOW,
    });

    expect(recordRateLimitAttempt).not.toHaveBeenCalled();
  });

  it("gives the call budget back when the founder actually verifies", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationAttempts: 0 }));
    recordVerificationAttempt.mockResolvedValue(session({ verificationState: "verified" }));

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("verify_founder", { code: deriveFounderPasscode(CONFIG.verificationSecret, NOW) }),
      nowMs: NOW,
    });

    expect(result.spoken).toMatch(/you're verified/i);
    // Both budgets, for the same reason: a caller who can read the current code
    // is the founder, and the founder must never be locked out of their own
    // phone by someone spoofing their number into the limits.
    const resetKeys = resetRateLimit.mock.calls.map((call) => String(call[0]));
    expect(resetKeys.some((key) => key.startsWith("jarvis-phone:verify:"))).toBe(true);
    expect(resetKeys.some((key) => key.startsWith("jarvis-phone:call:"))).toBe(true);
  });

  it("stops recording an unverified caller's speech once the cap is reached", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationState: "unverified" }));
    countTranscriptTurns.mockResolvedValue(25);
    const event = normalizeVapiEvent({
      message: {
        type: "transcript",
        transcriptType: "final",
        role: "user",
        transcript: "and here is another paragraph nobody asked for",
        call: { id: "call-1" },
        customer: { number: CONFIG.founderPhoneNumber },
      },
    });

    const result = await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(result.failureCode).toBe("unverified_transcript_capped");
    expect(appendTranscriptTurn).not.toHaveBeenCalled();
    // The call itself is not refused — verification still has to be reachable.
    expect(markCallSessionRefused).not.toHaveBeenCalled();
  });

  /**
   * Round twelve. A failed `transcript` event releases its idempotency claim so
   * the provider can retry it, which is right for an event whose only job is a
   * state update — but with the durable insert first, a failure in anything
   * after it released a claim on work that had already happened, and the retry
   * wrote the identical sentence again. `appendTranscriptTurn` does not dedupe
   * on content by design; the claim was supposed to be what handled that.
   */
  it("does the durable write last, so a released claim can only mean nothing was written", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationState: "verified" }));
    const order: string[] = [];
    touchCallSession.mockImplementation(async () => {
      order.push("touch");
    });
    appendTranscriptTurn.mockImplementation(async () => {
      order.push("insert");
      return null;
    });

    await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({
        message: {
          type: "transcript",
          transcriptType: "final",
          role: "user",
          transcript: "Research three restaurants",
          call: { id: "call-1" },
          customer: { number: CONFIG.founderPhoneNumber },
        },
      }),
      nowMs: NOW,
    });

    expect(order).toEqual(["touch", "insert"]);
  });

  it("keeps recording once the founder is verified, however long the call runs", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationState: "verified" }));
    countTranscriptTurns.mockResolvedValue(500);
    const event = normalizeVapiEvent({
      message: {
        type: "transcript",
        transcriptType: "final",
        role: "user",
        transcript: "and the last thing I need is the launch checklist",
        call: { id: "call-1" },
        customer: { number: CONFIG.founderPhoneNumber },
      },
    });

    await handleInboundConversationEvent(db, { config: CONFIG, event, nowMs: NOW });

    expect(appendTranscriptTurn).toHaveBeenCalledTimes(1);
    expect(countTranscriptTurns).not.toHaveBeenCalled();
  });
});

describe("a call that has ended accepts nothing further", () => {
  /**
   * `completeCallSession` leaves `verificationState` alone and the session
   * lookup has no status or time bound, so a tool call arriving after
   * `call_ended` — reordered by the provider, replayed, or forged — was fully
   * honored: `capture_command` opened a fresh draft and `confirm_command`
   * dispatched it, creating a real project after the call was over.
   */
  it("refuses a tool call that arrives after the call is over", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationState: "verified", status: "completed" }));

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("capture_command", { requestedOutcome: "Research three Brampton restaurants" }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("session_not_active");
    expect(upsertCommandDraft).not.toHaveBeenCalled();
    expect(dispatchConfirmedCommand).not.toHaveBeenCalled();
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

describe("the call says what confirming will actually do", () => {
  /**
   * Round eleven. `JARVIS_PHONE_AUTO_DISPATCH_ENABLED` defaults off, so a
   * confirmed low-risk command parks for a human instead of opening a project.
   * The dispatcher's spoken line and the screen's badge were both updated for
   * that; the READ-BACK was not — and the read-back is the sentence the founder
   * says "yes" to, and the one stored as `readback_text` and shown back under
   * "What Jarvis understood". The false promise outlived the call.
   */
  it("does not promise a project when confirming will not open one", async () => {
    vi.stubEnv("JARVIS_PHONE_AUTO_DISPATCH_ENABLED", "");
    ensureCallSession.mockResolvedValue(session({ verificationState: "verified", verifiedAt: new Date() }));
    upsertCommandDraft.mockImplementation(async (_db: unknown, { draft }: { draft: { readback: string } }) => ({
      id: "command-1",
      riskLevel: "low",
      requiresApproval: false,
      overrideAttempted: false,
      readbackText: draft.readback,
    }));

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("capture_command", { requestedOutcome: "Research three Brampton restaurants" }),
      nowMs: NOW,
    });

    expect(result.spoken).not.toMatch(/i'll open the project/i);
    expect(result.spoken).toMatch(/nothing said on a call starts on its own/i);
  });

  it("promises the project when it really will open one", async () => {
    vi.stubEnv("JARVIS_PHONE_AUTO_DISPATCH_ENABLED", "true");
    ensureCallSession.mockResolvedValue(session({ verificationState: "verified", verifiedAt: new Date() }));
    upsertCommandDraft.mockImplementation(async (_db: unknown, { draft }: { draft: { readback: string } }) => ({
      id: "command-1",
      riskLevel: "low",
      requiresApproval: false,
      overrideAttempted: false,
      readbackText: draft.readback,
    }));

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("capture_command", { requestedOutcome: "Research three Brampton restaurants" }),
      nowMs: NOW,
    });

    expect(result.spoken).toMatch(/i'll open the project/i);
  });

  /**
   * Two commands share `awaiting_approval` and mean different things. Calling
   * both "waiting for your approval" is the conflation the screen goes out of
   * its way to avoid, and for the same reason.
   */
  it("does not call a cleared command an approval when the founder repeats themselves", async () => {
    ensureCallSession.mockResolvedValue(session({ verificationState: "verified", verifiedAt: new Date() }));
    findOpenCommandForSession.mockResolvedValue(null);
    findLatestCommandForSession.mockResolvedValue({ dispatchState: "awaiting_approval", requiresApproval: false });

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("confirm_command", { confirmed: true }),
      nowMs: NOW,
    });

    expect(result.spoken).toMatch(/waiting for you to start it/i);
    expect(result.spoken).not.toMatch(/waiting for your approval/i);
  });

  it("treats a retraction as a retraction, not as another yes", async () => {
    ensureCallSession.mockResolvedValue(session({ verificationState: "verified", verifiedAt: new Date() }));
    findOpenCommandForSession.mockResolvedValue(null);
    findLatestCommandForSession.mockResolvedValue({ dispatchState: "awaiting_approval", requiresApproval: true });

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("confirm_command", { confirmed: false }),
      nowMs: NOW,
    });

    // Saying "no, cancel that" right after a yes used to be answered "that one
    // is already waiting…", which reads as agreement.
    expect(result.spoken).toMatch(/can't undo it from the call/i);
    expect(result.spoken).toMatch(/decline it there/i);
  });
});

describe("a draft is never left open after the call ends", () => {
  /**
   * `finalizeCall` is the only writer that can move a command out of
   * `awaiting_confirmation`, and it discarded the result of its revision-guarded
   * write. A final `capture_command` delivered in parallel with the hangup
   * bumps the revision in between, so the cancel silently did nothing and the
   * row was wedged: tool calls are refused once the session is inactive, the
   * decision route needs `awaiting_approval`, retry needs `failed`, and the
   * reaper only looks at `dispatching`.
   */
  it("re-reads and retries when a concurrent capture wins the revision race", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationState: "verified" }));
    findOpenCommandForSession
      .mockResolvedValueOnce({ id: "command-1", revision: 1 })
      .mockResolvedValueOnce({ id: "command-1", revision: 2 });
    transitionCommand.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "command-1", dispatchState: "cancelled" });

    await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({
        message: { type: "status-update", status: "ended", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } },
      }),
      nowMs: NOW,
    });

    expect(transitionCommand).toHaveBeenCalledTimes(2);
    expect(transitionCommand).toHaveBeenLastCalledWith(db, expect.objectContaining({ expectedRevision: 2, dispatchState: "cancelled" }));
  });
});
