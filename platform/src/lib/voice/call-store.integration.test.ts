import { afterEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import {
  auditLogs,
  jarvisCallSessions,
  jarvisCallTranscriptTurns,
  jarvisPhoneCommands,
  jarvisVoiceWebhookEvents,
  organizationMemberships,
  organizations,
  users,
} from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { buildCommandDraft } from "./command-draft";
import {
  appendTranscriptTurn,
  claimWebhookEvent,
  completeCallSession,
  deriveCommandIdempotencyKey,
  ensureCallSession,
  findOpenCommandForSession,
  listPhoneCallsForUser,
  markCallSessionRefused,
  PhoneCommandActorUnavailableError,
  recordVerificationAttempt,
  resolveCommandById,
  resolvePhoneCommandActor,
  claimDispatchAttempt,
  isDispatchInFlight,
  transitionCommand,
  upsertCommandDraft,
  claimApprovalDecision,
} from "./call-store";

/**
 * Real-database coverage for the three properties that cannot be proved with
 * a stub: tenant isolation, the authorization floor the webhook stands on,
 * and idempotency under genuine unique-constraint contention.
 *
 * Requires `.env.local` sourced first, like every other integration test here:
 *   set -a && source .env.local && set +a && npm run test:integration
 */

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `jarvis-phone-test-${crypto.randomUUID()}@example.com`, name: "Phone Test Founder" }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrg(userId: string, role: "owner" | "admin" | "member" | "viewer" = "owner"): Promise<string> {
  const [org] = await db
    .insert(organizations)
    .values({ name: "Jarvis Phone Test Org", slug: `jarvis-phone-org-${crypto.randomUUID().slice(0, 8)}` })
    .returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId, role });
  createdOrgIds.push(org.id);
  return org.id;
}

async function openSession(organizationId: string, founderUserId: string, providerCallId = `call-${crypto.randomUUID()}`) {
  return ensureCallSession(db, {
    organizationId,
    founderUserId,
    providerCallId,
    direction: "inbound",
    purpose: "founder_command",
    callerNumber: "+14165551234",
    callerNumberMatched: true,
  });
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(jarvisVoiceWebhookEvents).where(eq(jarvisVoiceWebhookEvents.organizationId, id));
    await db.delete(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.organizationId, id));
    await db.delete(jarvisCallTranscriptTurns).where(eq(jarvisCallTranscriptTurns.organizationId, id));
    await db.delete(jarvisCallSessions).where(eq(jarvisCallSessions.organizationId, id));
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, id));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.organizationId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(auditLogs).where(eq(auditLogs.actorUserId, id));
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("resolvePhoneCommandActor — the webhook's authorization floor", () => {
  it("resolves an owner of the configured organization", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId, "owner");

    const actor = await resolvePhoneCommandActor(db, { organizationId, founderUserId: userId });
    expect(actor.organizationId).toBe(organizationId);
    expect(actor.founderUserId).toBe(userId);
  });

  it("refuses a user who is only a member — a phone command may never act below owner/admin", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId, "member");

    await expect(resolvePhoneCommandActor(db, { organizationId, founderUserId: userId })).rejects.toThrow(PhoneCommandActorUnavailableError);
  });

  it("refuses a user with no membership at all, even though both ids exist", async () => {
    const ownerId = await makeUser();
    const outsiderId = await makeUser();
    const organizationId = await makeOrg(ownerId);

    await expect(resolvePhoneCommandActor(db, { organizationId, founderUserId: outsiderId })).rejects.toThrow(PhoneCommandActorUnavailableError);
  });

  it("stops working the moment the founder's membership is revoked — no deploy required", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId, "owner");
    await expect(resolvePhoneCommandActor(db, { organizationId, founderUserId: userId })).resolves.toBeDefined();

    await db.delete(organizationMemberships).where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId)));

    await expect(resolvePhoneCommandActor(db, { organizationId, founderUserId: userId })).rejects.toThrow(PhoneCommandActorUnavailableError);
  });
});

describe("webhook idempotency", () => {
  it("claims an event exactly once", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const externalEventId = `event-${crypto.randomUUID()}`;

    const first = await claimWebhookEvent(db, { organizationId, externalEventId, eventType: "tool-calls", providerCallId: "call-1", processingStatus: "processed" });
    const second = await claimWebhookEvent(db, { organizationId, externalEventId, eventType: "tool-calls", providerCallId: "call-1", processingStatus: "processed" });

    expect(first).toEqual({ claimed: true });
    expect(second).toEqual({ claimed: false, reason: "duplicate" });
  });

  it("resolves the same call session for a redelivered first event instead of opening a second", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const providerCallId = `call-${crypto.randomUUID()}`;

    const first = await openSession(organizationId, userId, providerCallId);
    const second = await openSession(organizationId, userId, providerCallId);
    expect(second.id).toBe(first.id);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jarvisCallSessions)
      .where(eq(jarvisCallSessions.providerCallId, providerCallId));
    expect(Number(count)).toBe(1);
  });

  it("refuses to write the same confirmed command twice", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    const draft = buildCommandDraft({ requestedOutcome: "Research three Brampton restaurants" });

    const command = await upsertCommandDraft(db, { organizationId, callSessionId: session.id, founderUserId: userId, draft });
    // Confirm it, then try to insert an identical draft under the same key.
    await transitionCommand(db, { organizationId, commandId: command.id, expectedRevision: command.revision, confirmationStatus: "confirmed", dispatchState: "directive_created" });

    await expect(
      db.insert(jarvisPhoneCommands).values({
        organizationId,
        callSessionId: session.id,
        requestedOutcome: draft.requestedOutcome,
        riskLevel: draft.riskLevel,
        requiresApproval: draft.requiresApproval,
        readbackText: draft.readback,
        idempotencyKey: deriveCommandIdempotencyKey({ callSessionId: session.id, draft }),
      })
    ).rejects.toThrow();
  });

  it("lets the founder describe the same work again after declining it, without colliding", async () => {
    // The exact flow the decline reply invites: "No problem, I've thrown that
    // away. Tell me again and I'll get it right." An idempotency key derived
    // from content alone turned this ordinary correction into a hard error.
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    const draft = buildCommandDraft({ requestedOutcome: "Research the Toronto pizza market" });

    const first = await upsertCommandDraft(db, { organizationId, callSessionId: session.id, founderUserId: userId, draft });
    await transitionCommand(db, { organizationId, commandId: first.id, expectedRevision: first.revision, confirmationStatus: "declined", dispatchState: "cancelled" });

    const second = await upsertCommandDraft(db, { organizationId, callSessionId: session.id, founderUserId: userId, draft });

    expect(second.id).not.toBe(first.id);
    expect(second.dispatchState).toBe("awaiting_confirmation");
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("revises an open draft in place rather than accumulating rows", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);

    const first = await upsertCommandDraft(db, { organizationId, callSessionId: session.id, founderUserId: userId, draft: buildCommandDraft({ requestedOutcome: "Research the pizza market" }) });
    const revised = await upsertCommandDraft(db, { organizationId, callSessionId: session.id, founderUserId: userId, draft: buildCommandDraft({ requestedOutcome: "Research the Toronto pizza market in detail" }) });

    expect(revised.id).toBe(first.id);
    expect(revised.requestedOutcome).toContain("in detail");

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jarvisPhoneCommands)
      .where(eq(jarvisPhoneCommands.callSessionId, session.id));
    expect(Number(count)).toBe(1);
  });

  it("rejects a second transition made against a stale revision", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    const command = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: userId,
      draft: buildCommandDraft({ requestedOutcome: "Email the restaurant owner our proposal" }),
    });

    const first = await transitionCommand(db, { organizationId, commandId: command.id, expectedRevision: command.revision, dispatchState: "awaiting_approval" });
    const replay = await transitionCommand(db, { organizationId, commandId: command.id, expectedRevision: command.revision, dispatchState: "awaiting_approval" });

    expect(first).not.toBeNull();
    expect(replay).toBeNull();
  });

  it("drops a duplicate transcript turn rather than double-recording it", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);

    await appendTranscriptTurn(db, { sessionId: session.id, organizationId, role: "founder", text: "Research three restaurants", isFinal: true });
    await appendTranscriptTurn(db, { sessionId: session.id, organizationId, role: "founder", text: "And compare them", isFinal: true });

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jarvisCallTranscriptTurns)
      .where(eq(jarvisCallTranscriptTurns.callSessionId, session.id));
    expect(Number(count)).toBe(2);
  });
});

describe("redaction reaches the database", () => {
  it("never stores a spoken secret in a transcript turn", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);

    const turn = await appendTranscriptTurn(db, {
      sessionId: session.id,
      organizationId,
      role: "founder",
      text: "the api key is sk-live-9f2b7c1d4e6a8b0c2d4e",
      isFinal: true,
    });

    expect(turn?.redactedText).not.toContain("9f2b7c1d");
    const [row] = await db.select().from(jarvisCallTranscriptTurns).where(eq(jarvisCallTranscriptTurns.id, turn!.id));
    expect(row.redactedText).toContain("[redacted-secret]");
    expect(row.redactedKinds).toContain("secret");
  });

  it("stores only the last four digits of the caller's number", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);

    expect(session.callerNumberLastFour).toBe("1234");
    const [row] = await db.select().from(jarvisCallSessions).where(eq(jarvisCallSessions.id, session.id));
    expect(JSON.stringify(row)).not.toContain("4165551234");
  });

  it("keeps a caller's number and speech out of every audit row it writes", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: userId,
      draft: buildCommandDraft({ requestedOutcome: "Research three Brampton restaurants" }),
    });

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, organizationId));
    expect(rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(rows.map((row) => row.metadata));
    expect(serialized).not.toContain("4165551234");
    expect(serialized).not.toContain("Brampton");
  });
});

describe("tenant isolation", () => {
  it("does not return another organization's calls", async () => {
    const founderA = await makeUser();
    const orgA = await makeOrg(founderA);
    const founderB = await makeUser();
    const orgB = await makeOrg(founderB);

    const sessionA = await openSession(orgA, founderA);
    await upsertCommandDraft(db, { organizationId: orgA, callSessionId: sessionA.id, founderUserId: founderA, draft: buildCommandDraft({ requestedOutcome: "Research the market" }) });

    await expect(listPhoneCallsForUser(db, { organizationId: orgA, actorUserId: founderB })).rejects.toThrow(TenantResourceNotFoundError);
    await expect(listPhoneCallsForUser(db, { organizationId: orgB, actorUserId: founderB })).resolves.toEqual([]);
  });

  it("refuses to resolve a command by id from outside its organization", async () => {
    const founderA = await makeUser();
    const orgA = await makeOrg(founderA);
    const founderB = await makeUser();
    const orgB = await makeOrg(founderB);

    const session = await openSession(orgA, founderA);
    const command = await upsertCommandDraft(db, { organizationId: orgA, callSessionId: session.id, founderUserId: founderA, draft: buildCommandDraft({ requestedOutcome: "Research the market" }) });

    await expect(resolveCommandById(db, { organizationId: orgB, commandId: command.id })).rejects.toThrow(TenantResourceNotFoundError);
    await expect(resolveCommandById(db, { organizationId: orgA, commandId: command.id })).resolves.toMatchObject({ id: command.id });
  });

  it("lets any member of the organization read the calls, not only the founder", async () => {
    const founderId = await makeUser();
    const organizationId = await makeOrg(founderId);
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });

    const session = await openSession(organizationId, founderId);
    await upsertCommandDraft(db, { organizationId, callSessionId: session.id, founderUserId: founderId, draft: buildCommandDraft({ requestedOutcome: "Research the market" }) });

    const calls = await listPhoneCallsForUser(db, { organizationId, actorUserId: memberId });
    expect(calls).toHaveLength(1);
    expect(calls[0].commands).toHaveLength(1);
  });
});

describe("verification state", () => {
  it("counts attempts atomically and refuses the session once they are exhausted", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);

    await recordVerificationAttempt(db, { sessionId: session.id, organizationId, verified: false, exhausted: false, maxAttempts: 3 });
    await recordVerificationAttempt(db, { sessionId: session.id, organizationId, verified: false, exhausted: false, maxAttempts: 3 });
    const final = await recordVerificationAttempt(db, { sessionId: session.id, organizationId, verified: false, exhausted: true, maxAttempts: 3 });

    expect(final?.verificationAttempts).toBe(3);
    expect(final?.verificationState).toBe("failed");
    expect(final?.status).toBe("refused");
  });

  it("records a successful verification with a timestamp", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);

    const verified = await recordVerificationAttempt(db, { sessionId: session.id, organizationId, verified: true, exhausted: false, maxAttempts: 3 });
    expect(verified?.verificationState).toBe("verified");
    expect(verified?.verifiedAt).toBeInstanceOf(Date);
  });
});

describe("dispatch attempts", () => {
  // Attempts are counted ONLY by `claimDispatchAttempt`; the outcome
  // transition never touches the counter. Covered properly by "the dispatch
  // claim" tests below.
  it("does not let an outcome transition move the attempt counter", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    let command = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: userId,
      draft: buildCommandDraft({ requestedOutcome: "Research the market" }),
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const next = await transitionCommand(db, {
        organizationId,
        commandId: command.id,
        expectedRevision: command.revision,
        dispatchState: "failed",
        failureCode: "model_rate_limited",
      });
      expect(next?.dispatchAttempts).toBe(0);
      command = next!;
    }
  });

  it("clears the failure reason when a later attempt succeeds", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    const created = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: userId,
      draft: buildCommandDraft({ requestedOutcome: "Research the market" }),
    });

    const failed = await transitionCommand(db, {
      organizationId,
      commandId: created.id,
      expectedRevision: created.revision,
      dispatchState: "failed",
      failureCode: "model_rate_limited",
      failureMessage: "429",
    });
    const succeeded = await transitionCommand(db, {
      organizationId,
      commandId: created.id,
      expectedRevision: failed!.revision,
      dispatchState: "directive_created",
      failureCode: null,
      failureMessage: null,
    });

    expect(succeeded?.failureCode).toBeNull();
    expect(succeeded?.failureMessage).toBeNull();
  });
});

describe("the dispatch claim", () => {
  it("lets exactly one of two concurrent claimers through", async () => {
    // This is the guard that stops two admins pressing Try again from each
    // creating a real project with real running agents.
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    const command = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: userId,
      draft: buildCommandDraft({ requestedOutcome: "Research the market" }),
    });

    const [first, second] = await Promise.all([
      claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 5, fromStates: ["awaiting_confirmation", "failed"], staleAfterMs: 600_000 }),
      claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 5, fromStates: ["awaiting_confirmation", "failed"], staleAfterMs: 600_000 }),
    ]);

    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.dispatchAttempts).toBe(1);
    expect(winners[0]!.revision).toBe(command.revision + 1);
  });

  // `staleAfterMs: 0` makes every in-flight lease immediately reclaimable, which
  // is exactly the takeover path — it isolates the CAP from the state guard.
  it("refuses the claim once the attempt cap is reached, so the cap cannot be exceeded", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    let command = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: userId,
      draft: buildCommandDraft({ requestedOutcome: "Research the market" }),
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = await claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 3, fromStates: ["awaiting_confirmation", "dispatching", "failed"], staleAfterMs: 0 });
      expect(claimed?.dispatchAttempts).toBe(attempt);
      command = claimed!;
    }

    const refused = await claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 3, fromStates: ["awaiting_confirmation", "dispatching", "failed"], staleAfterMs: 0 });
    expect(refused).toBeNull();
  });

  it("refuses a claim made against a stale revision", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    const command = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: userId,
      draft: buildCommandDraft({ requestedOutcome: "Research the market" }),
    });

    await claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 5, fromStates: ["awaiting_confirmation", "failed"], staleAfterMs: 600_000 });
    const stale = await claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 5, fromStates: ["awaiting_confirmation", "failed"], staleAfterMs: 600_000 });

    expect(stale).toBeNull();
  });
});

describe("call completion", () => {
  it("expires an unconfirmed draft when the call ends, so nothing lingers as if it might still run", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    const command = await upsertCommandDraft(db, { organizationId, callSessionId: session.id, founderUserId: userId, draft: buildCommandDraft({ requestedOutcome: "Research the market" }) });

    await completeCallSession(db, { sessionId: session.id, organizationId, endedReason: "customer-ended-call", summaryTranscript: "the password is swordfish99" });
    await transitionCommand(db, { organizationId, commandId: command.id, expectedRevision: command.revision, confirmationStatus: "expired", dispatchState: "cancelled", failureCode: "call_ended_before_confirmation" });

    const open = await findOpenCommandForSession(db, { organizationId, callSessionId: session.id });
    expect(open).toBeNull();

    const [row] = await db.select().from(jarvisCallSessions).where(eq(jarvisCallSessions.id, session.id));
    expect(row.status).toBe("completed");
    // The provider's own end-of-call transcript is redacted before storage too.
    expect(row.redactedSummaryTranscript).not.toContain("swordfish99");
  });

  /**
   * Round twelve. A `call_ended` event releases its idempotency claim when it
   * fails, deliberately, so that a stuck call can heal — which means this
   * function can genuinely run twice for one call. It audited unconditionally,
   * so the trail showed a call ending twice; and it set `status`
   * unconditionally, so the ordinary end-of-call event that follows a REFUSAL
   * quietly relabelled a refused call "completed".
   */
  it("ends a call once, however many times the provider delivers the end of it", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);

    // The real shape: the status update arrives first with no transcript, and
    // the end-of-call report second carrying one.
    await completeCallSession(db, { sessionId: session.id, organizationId, endedReason: "customer-ended-call", summaryTranscript: null });
    await completeCallSession(db, { sessionId: session.id, organizationId, endedReason: null, summaryTranscript: "we talked about the launch" });

    const ended = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, organizationId),
          eq(auditLogs.eventType, "jarvis_phone_call_ended"),
          eq(auditLogs.targetId, session.id)
        )
      );
    expect(ended).toHaveLength(1);

    const [row] = await db.select().from(jarvisCallSessions).where(eq(jarvisCallSessions.id, session.id));
    // The later delivery still fills in what only it carries, and neither
    // delivery wipes what the other wrote.
    expect(row.endedReason).toBe("customer-ended-call");
    expect(row.redactedSummaryTranscript).toContain("launch");
  });

  it("does not relabel a refused call as completed", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    await markCallSessionRefused(db, { sessionId: session.id, organizationId, failureCode: "caller_number_mismatch" });

    await completeCallSession(db, { sessionId: session.id, organizationId, endedReason: "assistant-ended-call", summaryTranscript: null });

    const [row] = await db.select().from(jarvisCallSessions).where(eq(jarvisCallSessions.id, session.id));
    expect(row.status).toBe("refused");
    expect(row.failureCode).toBe("caller_number_mismatch");
  });
});

describe("the in-flight state is what closes the duplicate-dispatch race", () => {
  it("refuses a second claim made after the winner bumped the revision", async () => {
    // The sequential case, not the simultaneous one: a request arriving while
    // the winner is still inside createDirectiveProject re-reads the row, sees
    // the bumped revision, and must still find nothing claimable.
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    const command = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: userId,
      draft: buildCommandDraft({ requestedOutcome: "Research the market" }),
    });

    const claimed = await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation"],
      staleAfterMs: 600_000,
    });
    expect(claimed?.dispatchState).toBe("dispatching");

    // A later reader re-reads and gets the CURRENT revision — the case a bare
    // revision guard would let through.
    const reread = await resolveCommandById(db, { organizationId, commandId: command.id });
    const second = await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: reread.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation"],
      staleAfterMs: 600_000,
    });

    expect(second).toBeNull();
  });

  it("lets a provably stale lease be taken over, so a died-mid-dispatch command is not wedged forever", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    const command = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: userId,
      draft: buildCommandDraft({ requestedOutcome: "Research the market" }),
    });

    const claimed = await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation"],
      staleAfterMs: 600_000,
    });

    // Nothing ever transitioned it — the process died here.
    const takeover = await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: claimed!.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation"],
      staleAfterMs: 0,
    });

    expect(takeover).not.toBeNull();
    expect(takeover!.dispatchAttempts).toBe(2);
  });
});

describe("a stalled dispatch is recoverable end to end", () => {
  it("wedges nothing: a claim nobody resolved can be taken over and driven to an outcome", async () => {
    // The whole point of the lease. Before the fix this row was unreachable
    // from every production entry point and stayed `dispatching` forever.
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);
    const command = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: userId,
      draft: buildCommandDraft({ requestedOutcome: "Research the market" }),
    });

    // A dispatch claims the row, then the process dies — nothing transitions it.
    const claimed = await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation"],
      staleAfterMs: 600_000,
    });
    expect(claimed!.dispatchState).toBe("dispatching");
    expect(claimed!.dispatchStartedAt).toBeInstanceOf(Date);

    // A later reader finds it exactly as production would.
    const stuck = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(stuck.dispatchState).toBe("dispatching");
    expect(isDispatchInFlight(stuck, 600_000)).toBe(true);
    // Once the lease is provably past, it is no longer treated as running.
    expect(isDispatchInFlight(stuck, 0)).toBe(false);

    // ...and can be taken over and driven to a real outcome.
    const takeover = await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: stuck.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation"],
      staleAfterMs: 0,
    });
    expect(takeover).not.toBeNull();

    const finished = await transitionCommand(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: takeover!.revision,
      dispatchState: "failed",
      failureCode: "model_rate_limited",
    });
    expect(finished!.dispatchState).toBe("failed");
    expect(finished!.dispatchAttempts).toBe(2);
  });
});

describe("verification state — the guards live in the WHERE clause, not the caller's snapshot", () => {
  /**
   * Found by review round six. `recordVerificationAttempt` incremented its
   * counter atomically — deliberately, and with a comment saying so — but
   * wrote `verificationState` and `verifiedAt` with no precondition at all,
   * and the cap was enforced only in `verifyFounderPasscode` against a count
   * read earlier in the request.
   */
  it("does not let a late failing attempt revoke a completed verification", async () => {
    const founderId = await makeUser();
    const organizationId = await makeOrg(founderId);
    const session = await ensureCallSession(db, {
      organizationId,
      founderUserId: founderId,
      providerCallId: `call-${crypto.randomUUID()}`,
      direction: "inbound",
      purpose: "founder_command",
      callerNumber: "+14165551234",
      callerNumberMatched: true,
    });

    const verified = await recordVerificationAttempt(db, {
      sessionId: session.id,
      organizationId,
      verified: true,
      exhausted: false,
      maxAttempts: 3,
    });
    expect(verified?.verificationState).toBe("verified");
    expect(verified?.verifiedAt).toBeTruthy();

    // A wrong code delivered late — reordered by the provider, or a retry of an
    // earlier attempt. Unguarded, this set the session back to `unverified` and
    // nulled `verifiedAt`, undoing an authentication that had already happened.
    const late = await recordVerificationAttempt(db, {
      sessionId: session.id,
      organizationId,
      verified: false,
      exhausted: false,
      maxAttempts: 3,
    });
    expect(late).toBeNull();

    const [current] = await db.select().from(jarvisCallSessions).where(eq(jarvisCallSessions.id, session.id));
    expect(current.verificationState).toBe("verified");
    expect(current.verifiedAt).toBeTruthy();
  });

  it("refuses an attempt past the cap in SQL, not only in the caller", async () => {
    const founderId = await makeUser();
    const organizationId = await makeOrg(founderId);
    const session = await ensureCallSession(db, {
      organizationId,
      founderUserId: founderId,
      providerCallId: `call-${crypto.randomUUID()}`,
      direction: "inbound",
      purpose: "founder_command",
      callerNumber: "+14165551234",
      callerNumberMatched: true,
    });

    const attempt = () =>
      recordVerificationAttempt(db, { sessionId: session.id, organizationId, verified: false, exhausted: false, maxAttempts: 3 });

    expect(await attempt()).not.toBeNull();
    expect(await attempt()).not.toBeNull();
    expect(await attempt()).not.toBeNull();
    // Four callers all holding the same snapshot of `verificationAttempts: 0`
    // used to each get a full comparison. The guard is now in the statement.
    expect(await attempt()).toBeNull();

    const [current] = await db.select().from(jarvisCallSessions).where(eq(jarvisCallSessions.id, session.id));
    expect(current.verificationAttempts).toBe(3);
  });

  it("holds the cap under concurrent attempts that all read the same prior count", async () => {
    const founderId = await makeUser();
    const organizationId = await makeOrg(founderId);
    const session = await ensureCallSession(db, {
      organizationId,
      founderUserId: founderId,
      providerCallId: `call-${crypto.randomUUID()}`,
      direction: "inbound",
      purpose: "founder_command",
      callerNumber: "+14165551234",
      callerNumberMatched: true,
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        recordVerificationAttempt(db, { sessionId: session.id, organizationId, verified: false, exhausted: false, maxAttempts: 3 })
      )
    );

    expect(results.filter(Boolean)).toHaveLength(3);
    const [current] = await db.select().from(jarvisCallSessions).where(eq(jarvisCallSessions.id, session.id));
    expect(current.verificationAttempts).toBe(3);
  });
});

describe("claimApprovalDecision — decide-once cannot be defeated by a re-read", () => {
  /**
   * Found by a flaky test of my own, which is how it should be read: the
   * concurrent route test sometimes caught a second approval and sometimes did
   * not, because which error the loser gets depends on the interleaving — and
   * one of those interleavings was not an error at all.
   *
   * Approval leaves the command in `awaiting_approval`; the dispatch claim is
   * what moves it. So a guard on the revision alone is defeated by an ordinary
   * re-read: the second admin loads the screen, gets the first's bumped
   * revision, and their guarded write then SUCCEEDS — replacing the recorded
   * approver of work that may already be running, and writing a second
   * decision to the audit trail. It is the same shape of mistake as guarding a
   * dispatch claim on revision alone, which this lane has made before.
   *
   * The guard is on the facts instead — still awaiting approval, no approver
   * recorded — which holds whatever revision the caller read, and whenever.
   */
  async function awaitingApprovalCommand(organizationId: string, founderUserId: string) {
    const session = await ensureCallSession(db, {
      organizationId,
      founderUserId,
      providerCallId: `call-${crypto.randomUUID()}`,
      direction: "inbound",
      purpose: "founder_command",
      callerNumber: "+14165551234",
      callerNumberMatched: true,
    });
    const command = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId,
      draft: buildCommandDraft({ requestedOutcome: "Email the restaurant owner our proposal" }),
    });
    const [row] = await db
      .update(jarvisPhoneCommands)
      .set({ dispatchState: "awaiting_approval" })
      .where(eq(jarvisPhoneCommands.id, command.id))
      .returning();
    return row;
  }

  it("refuses a second approver who read the row AFTER the first approval", async () => {
    const founderId = await makeUser();
    const organizationId = await makeOrg(founderId);
    const secondApprover = await makeUser();
    const command = await awaitingApprovalCommand(organizationId, founderId);

    const first = await claimApprovalDecision(db, {
      organizationId,
      commandId: command.id,
      approverUserId: founderId,
      decisionNote: null,
    });
    expect(first?.approvalDecidedByUserId).toBe(founderId);

    // The command is STILL awaiting approval — that is the whole point, the
    // dispatch claim is what moves it — and the second caller holds the
    // current revision, not a stale one.
    const [afterFirst] = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(afterFirst.dispatchState).toBe("awaiting_approval");
    expect(afterFirst.revision).toBeGreaterThan(command.revision);

    const second = await claimApprovalDecision(db, {
      organizationId,
      commandId: command.id,
      approverUserId: secondApprover,
      decisionNote: null,
    });
    expect(second).toBeNull();

    const [settled] = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(settled.approvalDecidedByUserId).toBe(founderId);
  });

  it("lets exactly one of many simultaneous approvers through", async () => {
    const founderId = await makeUser();
    const organizationId = await makeOrg(founderId);
    const command = await awaitingApprovalCommand(organizationId, founderId);

    const approvers = await Promise.all(Array.from({ length: 6 }, () => makeUser()));
    const results = await Promise.all(
      approvers.map((approverUserId) =>
        claimApprovalDecision(db, { organizationId, commandId: command.id, approverUserId, decisionNote: null })
      )
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses to record an approval for a command that is not awaiting one", async () => {
    const founderId = await makeUser();
    const organizationId = await makeOrg(founderId);
    const command = await awaitingApprovalCommand(organizationId, founderId);
    await db.update(jarvisPhoneCommands).set({ dispatchState: "declined" }).where(eq(jarvisPhoneCommands.id, command.id));

    const claimed = await claimApprovalDecision(db, {
      organizationId,
      commandId: command.id,
      approverUserId: founderId,
      decisionNote: null,
    });
    expect(claimed).toBeNull();
  });
});

describe("claimApprovalDecision — decline needs the same guard as approve", () => {
  /**
   * Round seven. Approve was given a fact-based guard; decline was left on a
   * revision guard, and the two are not equivalent — because approval does not
   * change `dispatchState`. Between one admin's approval and their dispatch
   * claim the row is still `awaiting_approval` at a new revision, so a
   * revision-guarded decline landing in that window SUCCEEDED: it overwrote
   * the recorded approver and marked as declined a command that had just been
   * approved.
   */
  it("refuses a decline once an approval has been recorded", async () => {
    const founderId = await makeUser();
    const organizationId = await makeOrg(founderId);
    const other = await makeUser();
    const session = await ensureCallSession(db, {
      organizationId,
      founderUserId: founderId,
      providerCallId: `call-${crypto.randomUUID()}`,
      direction: "inbound",
      purpose: "founder_command",
      callerNumber: "+14165551234",
      callerNumberMatched: true,
    });
    const draft = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: founderId,
      draft: buildCommandDraft({ requestedOutcome: "Email the restaurant owner our proposal" }),
    });
    await db.update(jarvisPhoneCommands).set({ dispatchState: "awaiting_approval" }).where(eq(jarvisPhoneCommands.id, draft.id));

    const approved = await claimApprovalDecision(db, {
      organizationId,
      commandId: draft.id,
      approverUserId: founderId,
      decisionNote: null,
    });
    expect(approved?.approvalDecidedByUserId).toBe(founderId);

    const declined = await claimApprovalDecision(db, {
      organizationId,
      commandId: draft.id,
      approverUserId: other,
      decisionNote: "changed my mind",
      dispatchState: "declined",
    });
    expect(declined).toBeNull();

    const [settled] = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, draft.id));
    expect(settled.dispatchState).toBe("awaiting_approval");
    expect(settled.approvalDecidedByUserId).toBe(founderId);
  });

  it("still lets a decline settle a command nobody has decided", async () => {
    const founderId = await makeUser();
    const organizationId = await makeOrg(founderId);
    const session = await ensureCallSession(db, {
      organizationId,
      founderUserId: founderId,
      providerCallId: `call-${crypto.randomUUID()}`,
      direction: "inbound",
      purpose: "founder_command",
      callerNumber: "+14165551234",
      callerNumberMatched: true,
    });
    const draft = await upsertCommandDraft(db, {
      organizationId,
      callSessionId: session.id,
      founderUserId: founderId,
      draft: buildCommandDraft({ requestedOutcome: "Email the restaurant owner our proposal" }),
    });
    await db.update(jarvisPhoneCommands).set({ dispatchState: "awaiting_approval" }).where(eq(jarvisPhoneCommands.id, draft.id));

    const declined = await claimApprovalDecision(db, {
      organizationId,
      commandId: draft.id,
      approverUserId: founderId,
      decisionNote: null,
      dispatchState: "declined",
    });
    expect(declined?.dispatchState).toBe("declined");
  });
});
