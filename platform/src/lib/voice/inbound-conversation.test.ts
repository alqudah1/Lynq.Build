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
const recordCallerNumberMatch = vi.fn();
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
  recordCallerNumberMatch,
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
const checkRateLimit = vi.fn<(key: string, config?: unknown) => Promise<{ allowed: boolean; remaining: number; resetAt: Date }>>(
  async () => ({ allowed: true, remaining: 5, resetAt: new Date() })
);
vi.mock("@/lib/rate-limit/postgres", () => ({
  PostgresRateLimiter: class {
    recordAttempt = recordRateLimitAttempt;
    checkLimit = checkRateLimit;
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
    startedAt: new Date(NOW),
    // Anchored to the injected clock, not to the wall clock: the post-call
    // guard and the draft reaper both read this, and a fixture minutes (or
    // months) behind `NOW` reads as a call that ended long ago.
    lastEventAt: new Date(NOW),
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
    recordVerificationAttempt, recordCallerNumberMatch, markCallSessionRefused, upsertCommandDraft, findOpenCommandForSession,
    transitionCommand, appendTranscriptTurn, touchCallSession, completeCallSession,
    dispatchConfirmedCommand, recordAuditEvent, countTranscriptTurns,
    recordRateLimitAttempt, resetRateLimit, checkRateLimit,
  ]) {
    mock.mockReset();
  }
  countTranscriptTurns.mockResolvedValue(0);
  recordRateLimitAttempt.mockResolvedValue({ allowed: true, remaining: 11, resetAt: new Date() });
  resetRateLimit.mockResolvedValue(undefined);
  checkRateLimit.mockResolvedValue({ allowed: true, remaining: 5, resetAt: new Date() });
  findCallSessionByProviderCallId.mockResolvedValue(null);
  findLatestCommandForSession.mockResolvedValue(null);
  resolvePhoneCommandActor.mockResolvedValue({ organizationId: CONFIG.organizationId, founderUserId: CONFIG.founderUserId, organizationSlug: "lynq", founderName: "Mustafa" });
  ensureCallSession.mockResolvedValue(session());
  recordAuditEvent.mockResolvedValue(undefined);
  markCallSessionRefused.mockResolvedValue(undefined);
  recordCallerNumberMatch.mockResolvedValue(null);
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

  /**
   * Round thirteen. The same "absence is not evidence" rule the previous test
   * applies to a LATER event was not applied to the FIRST one: a session opened
   * by a delivery with no `customer` object was stamped unmatched for good, and
   * every subsequent event — including ones carrying the founder's real number
   * — was refused against that stamp, writing the same false
   * `caller_number_mismatch` finding and making the call unusable end to end.
   */
  it("does not brand a call a wrong number just because the first event carried none", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(null);
    ensureCallSession.mockResolvedValue(session({ callerNumberMatched: false, callerNumberLastFour: null }));
    recordCallerNumberMatch.mockResolvedValue(session({ callerNumberMatched: true }));

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } } }),
      nowMs: NOW,
    });

    expect(markCallSessionRefused).not.toHaveBeenCalled();
    // The number arrived on this event, so the session is brought up to date
    // rather than being judged on what the first delivery happened to omit.
    expect(recordCallerNumberMatch).toHaveBeenCalledTimes(1);
    expect(result.payload).toBeDefined();
  });

  /**
   * Round fourteen, and a regression the round-thirteen change introduced. Not
   * refusing a numberless call was right; treating "not refused" as "cleared"
   * was not. A caller who simply withholds caller ID reached
   * `handleAssistantRequest` and was handed the full system prompt, all three
   * tool declarations and a ten-minute model session — the exact exposure
   * `buildRefusalAssistantConfig` exists to end, and one that costs real
   * telephony and model time on every redial.
   */
  it("gives a caller whose number was never established the closed assistant, not the working one", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(null);
    ensureCallSession.mockResolvedValue(session({ callerNumberMatched: false, callerNumberLastFour: null }));

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      // No `customer` object at all — caller ID withheld.
      event: normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1", type: "inboundPhoneCall" } } }),
      nowMs: NOW,
    });

    const assistant = (result.payload as { assistant?: Record<string, unknown> } | undefined)?.assistant;
    expect(assistant).toBeTruthy();
    expect(assistant?.tools).toBeUndefined();
    expect(JSON.stringify(assistant)).not.toMatch(/verify_founder|capture_command|confirm_command/);
    expect(Number(assistant?.maxDurationSeconds)).toBeLessThanOrEqual(60);
    expect(result.failureCode).toBe("caller_number_unestablished");
    // Still not a refusal: no false security finding is recorded.
    expect(markCallSessionRefused).not.toHaveBeenCalled();
  });

  it("does not overtake a concurrent refusal when the promotion loses its race", async () => {
    /**
     * Round fifteen. The re-read replaces the snapshot AFTER the
     * refused-session short-circuit has already run, and
     * `markCallSessionRefused` does not clear `callerNumberMatched` — so a row
     * that comes back reading `refused + matched` was falling through to the
     * working assistant on a call recorded as refused.
     */
    findCallSessionByProviderCallId
      .mockResolvedValueOnce(session({ callerNumberMatched: false, callerNumberLastFour: null }))
      .mockResolvedValueOnce(session({ callerNumberMatched: true, status: "refused" }));
    recordCallerNumberMatch.mockResolvedValue(null);

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } } }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("session_refused");
    const assistant = (result.payload as { assistant?: Record<string, unknown> } | undefined)?.assistant;
    expect(assistant?.tools).toBeUndefined();
  });

  it("takes no instruction while the caller's number is still unestablished", async () => {
    // Not refused — no evidence of a wrong number — but not cleared either.
    // Exactly one line may give instructions on this lane, and a number the
    // provider never sent has not proved to be it.
    findCallSessionByProviderCallId.mockResolvedValue(
      session({ callerNumberMatched: false, callerNumberLastFour: null, verificationState: "verified" })
    );

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({
        message: { type: "tool-calls", call: { id: "call-1" }, toolCalls: [{ id: "tc-1", function: { name: "capture_command", arguments: { requestedOutcome: "Research the market" } } }] },
      }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("caller_number_unestablished");
    expect(upsertCommandDraft).not.toHaveBeenCalled();
    expect(markCallSessionRefused).not.toHaveBeenCalled();
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
    recordRateLimitAttempt.mockImplementation(async (key) =>
      key.startsWith("jarvis-phone:call-seen:")
        ? { allowed: true, remaining: 0, resetAt: new Date() }
        : { allowed: false, remaining: 0, resetAt: new Date() }
    );
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

  /**
   * Round thirteen. The first version keyed this budget on the caller's last
   * four digits and charged it BEFORE the caller-number precondition ran. So
   * six calls from an unrelated line ending in the same four digits exhausted
   * the founder's budget — and the founder, dialling from the real phone, was
   * then refused with "I'll only work with the founder's registered line, and
   * this isn't it", by a branch that had never looked at their number. In the
   * other direction it bounded nothing: rotating the asserted suffix bought a
   * fresh bucket each time.
   */
  it("does not let a call from another number spend the founder's budget", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(null);
    ensureCallSession.mockResolvedValue(session({ callerNumberMatched: false }));

    await handleInboundConversationEvent(db, {
      config: CONFIG,
      // Same last four as the founder's +14165551234, different number.
      event: normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: "+12129991234" } } }),
      nowMs: NOW,
    });

    const charged = recordRateLimitAttempt.mock.calls.map((call) => String(call[0]));
    expect(charged.some((key) => key.startsWith("jarvis-phone:call:"))).toBe(false);
    // It is bounded, just not out of the founder's allowance.
    expect(charged.some((key) => key.startsWith("jarvis-phone:refused:"))).toBe(true);
  });

  it("tells a rate-limited founder the truth instead of the wrong-number refusal", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(null);
    recordRateLimitAttempt.mockImplementation(async (key) =>
      key.startsWith("jarvis-phone:call-seen:")
        ? { allowed: true, remaining: 0, resetAt: new Date() }
        : { allowed: false, remaining: 0, resetAt: new Date() }
    );

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } } }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("call_rate_limited");
    // Not "this isn't the founder's registered line" — it is.
    expect(result.spoken).not.toMatch(/registered line/i);
    expect(result.spoken).toMatch(/paused new ones/i);
    expect(result.spoken).toMatch(/nothing is wrong with your account/i);
    // And the closed assistant says the same thing, not the refusal.
    const assistant = (result.payload as { assistant?: { firstMessage?: string } } | undefined)?.assistant;
    expect(assistant?.firstMessage).toBe(result.spoken);
  });

  it("bounds refused wrong-number calls on a key the caller cannot rotate", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(null);
    recordRateLimitAttempt.mockImplementation(async (key) =>
      key.startsWith("jarvis-phone:call-seen:")
        ? { allowed: true, remaining: 0, resetAt: new Date() }
        : { allowed: false, remaining: 0, resetAt: new Date() }
    );

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: "+14165559999" } } }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("refused_call_rate_limited");
    // Past the cap nothing durable is written at all — not even the refused
    // session row that a wrong-number call normally records.
    expect(ensureCallSession).not.toHaveBeenCalled();
    expect(markCallSessionRefused).not.toHaveBeenCalled();
    expect(result.spoken).toMatch(/registered line/i);
  });

  it("charges a call once, however many deliveries land before its session exists", async () => {
    /**
     * The budget is charged before the session row commits, and several
     * deliveries of one call can be in flight before it does — a statically
     * assigned assistant opens with queued, ringing and in-progress inside a
     * few hundred milliseconds. "No session yet" is not the same as "new call",
     * so which delivery pays is decided by an atomic one-per-call claim.
     */
    findCallSessionByProviderCallId.mockResolvedValue(null);
    // The claim is already taken: this is not the delivery that pays.
    recordRateLimitAttempt.mockImplementation(async (key) =>
      key.startsWith("jarvis-phone:call-seen:")
        ? { allowed: false, remaining: 0, resetAt: new Date() }
        : { allowed: true, remaining: 5, resetAt: new Date() }
    );

    await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } } }),
      nowMs: NOW,
    });

    const charged = recordRateLimitAttempt.mock.calls.map((call) => String(call[0]));
    expect(charged.filter((key) => key.startsWith("jarvis-phone:call:"))).toHaveLength(0);
    // Still subject to the cap, just not charged again for it.
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });

  it("refuses a later delivery of a call whose budget is genuinely spent", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(null);
    recordRateLimitAttempt.mockImplementation(async (key) =>
      key.startsWith("jarvis-phone:call-seen:")
        ? { allowed: false, remaining: 0, resetAt: new Date() }
        : { allowed: true, remaining: 5, resetAt: new Date() }
    );
    // Past the cap, so even the one unit of slack does not admit it.
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() });

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } } }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("call_rate_limited");
    expect(ensureCallSession).not.toHaveBeenCalled();
  });

  it("decides admission from the atomic increment, not from a read of the counter", async () => {
    /**
     * `checkLimit` then `recordAttempt` is two statements with no transaction
     * between them. Forty simultaneous calls all read the same count, all pass,
     * and all are admitted against a cap of twenty — the cap fails in exactly
     * the concurrent case a flood arrives in. The admission answer has to be
     * the increment's own.
     */
    findCallSessionByProviderCallId.mockResolvedValue(null);
    recordRateLimitAttempt.mockImplementation(async (key) =>
      key.startsWith("jarvis-phone:call-seen:")
        ? { allowed: true, remaining: 0, resetAt: new Date() }
        : { allowed: false, remaining: 0, resetAt: new Date() }
    );
    // A stale read that says there is room. It must not be what decides.
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 5, resetAt: new Date() });

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } } }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("call_rate_limited");
    expect(ensureCallSession).not.toHaveBeenCalled();
  });

  it("charges a call that any inbound event opens, not only an assistant request", async () => {
    /**
     * Round fifteen. Gating the charge on the event KIND meant any other
     * inbound-typed delivery landing first created the session unconditionally
     * — after which `existing` was set and the budget was never entered again.
     * A statically assigned assistant produces exactly that shape (no
     * assistant-request is ever sent), so a whole call, and every redial, was
     * free.
     */
    findCallSessionByProviderCallId.mockResolvedValue(null);

    await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({
        message: { type: "status-update", status: "in-progress", call: { id: "call-1", type: "inboundPhoneCall" }, customer: { number: CONFIG.founderPhoneNumber } },
      }),
      nowMs: NOW,
    });

    expect(recordRateLimitAttempt.mock.calls.map((call) => String(call[0])).filter((key) => key.startsWith("jarvis-phone:call:"))).toHaveLength(1);
  });

  it("costs nothing more once a call is over the cap, however many deliveries it has", async () => {
    // Checked before it is charged. A rate-limited call never gets a session,
    // so every later delivery re-enters the block — and with the charge first,
    // one flooding call could burn the whole hourly allowance by itself.
    findCallSessionByProviderCallId.mockResolvedValue(null);
    recordRateLimitAttempt.mockImplementation(async (key) =>
      key.startsWith("jarvis-phone:call-seen:")
        ? { allowed: false, remaining: 0, resetAt: new Date() }
        : { allowed: false, remaining: 0, resetAt: new Date() }
    );
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() });

    for (const message of [
      { type: "assistant-request", call: { id: "call-1", type: "inboundPhoneCall" }, customer: { number: CONFIG.founderPhoneNumber } },
      { type: "status-update", status: "in-progress", call: { id: "call-1", type: "inboundPhoneCall" }, customer: { number: CONFIG.founderPhoneNumber } },
      { type: "status-update", status: "ended", call: { id: "call-1", type: "inboundPhoneCall" }, customer: { number: CONFIG.founderPhoneNumber } },
    ]) {
      await handleInboundConversationEvent(db, { config: CONFIG, event: normalizeVapiEvent({ message }), nowMs: NOW });
    }

    expect(recordRateLimitAttempt.mock.calls.map((call) => String(call[0])).filter((key) => key.startsWith("jarvis-phone:call:"))).toHaveLength(0);
    expect(ensureCallSession).not.toHaveBeenCalled();
  });

  it("never refuses a call by the very increment that call made itself", async () => {
    /**
     * `checkLimit` refuses at the count `recordAttempt` admits, and the paying
     * delivery always charges before the session exists — so a second delivery
     * of the LAST permitted call of the hour was turned away, for a call the
     * budget had just allowed.
     */
    findCallSessionByProviderCallId.mockResolvedValue(null);
    recordRateLimitAttempt.mockImplementation(async (key) =>
      key.startsWith("jarvis-phone:call-seen:")
        ? { allowed: false, remaining: 0, resetAt: new Date() }
        : { allowed: true, remaining: 5, resetAt: new Date() }
    );
    checkRateLimit.mockImplementation(async (_key, config) => {
      // Stored count is 6: the limit, spent by this call's own paying delivery.
      const limit = (config as { limit: number }).limit;
      return { allowed: 6 < limit, remaining: Math.max(0, limit - 6), resetAt: new Date() };
    });

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: normalizeVapiEvent({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } } }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBeUndefined();
    expect(result.payload).toBeDefined();
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
  /**
   * Round sixteen. `lastEventAt` is what the abandoned-draft reaper reads to
   * decide a call has gone silent, and it was written only by transcripts,
   * status updates, and the verification and completion writes — not by
   * `assistant_request`, `capture_command` or `confirm_command`, the three
   * events that bracket the entire confirmation window. On a deployment whose
   * provider subscription omits transcripts, a live call therefore looked
   * silent, and a member loading the Jarvis screen could cancel a draft out
   * from under a founder who was still describing it.
   */
  it.each([
    ["an assistant request", { type: "assistant-request", call: { id: "call-1" }, customer: { number: CONFIG.founderPhoneNumber } }],
    [
      "a tool call",
      {
        type: "tool-calls",
        call: { id: "call-1" },
        customer: { number: CONFIG.founderPhoneNumber },
        toolCalls: [{ id: "tc-1", function: { name: "capture_command", arguments: { requestedOutcome: "Research the market" } } }],
      },
    ],
  ])("marks the call alive on %s", async (_label, message) => {
    findCallSessionByProviderCallId.mockResolvedValue(session({ verificationState: "verified" }));
    upsertCommandDraft.mockResolvedValue({ id: "command-1", readbackText: "ok", riskLevel: "low", requiresApproval: false, overrideAttempted: false });

    await handleInboundConversationEvent(db, { config: CONFIG, event: normalizeVapiEvent({ message }), nowMs: NOW });

    expect(touchCallSession).toHaveBeenCalled();
  });

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

describe("a call whose ending was never delivered", () => {
  /**
   * Round sixteen. `completeCallSession` runs on one provider delivery, and a
   * lost delivery leaves the row `active` forever — so a guard reading only
   * `status` never engages for exactly the call whose ending went missing, on a
   * session whose verification is permanent. A tool call reordered, replayed or
   * forged against it would be fully honoured: capture a fresh draft, confirm
   * it, and open a real project after the call was over.
   */
  it("refuses a tool call on a session silent longer than any call can last, whatever the row says", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(
      session({ status: "active", verificationState: "verified", lastEventAt: new Date(NOW - 21 * 60 * 1000) })
    );

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("capture_command", { requestedOutcome: "Wire the supplier deposit" }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBe("session_not_active");
    expect(upsertCommandDraft).not.toHaveBeenCalled();
  });

  it("still answers a call that is merely mid-pause", async () => {
    findCallSessionByProviderCallId.mockResolvedValue(
      session({ status: "active", verificationState: "verified", lastEventAt: new Date(NOW - 5 * 60 * 1000) })
    );
    upsertCommandDraft.mockResolvedValue({ id: "command-1", readbackText: "ok", riskLevel: "low", requiresApproval: false, overrideAttempted: false });

    const result = await handleInboundConversationEvent(db, {
      config: CONFIG,
      event: toolEvent("capture_command", { requestedOutcome: "Research the market" }),
      nowMs: NOW,
    });

    expect(result.failureCode).toBeUndefined();
    expect(upsertCommandDraft).toHaveBeenCalledTimes(1);
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
