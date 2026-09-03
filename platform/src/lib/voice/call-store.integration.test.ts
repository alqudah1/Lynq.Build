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
  PhoneCommandActorUnavailableError,
  recordVerificationAttempt,
  resolveCommandById,
  resolvePhoneCommandActor,
  claimDispatchAttempt,
  transitionCommand,
  upsertCommandDraft,
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

    await recordVerificationAttempt(db, { sessionId: session.id, organizationId, verified: false, exhausted: false });
    await recordVerificationAttempt(db, { sessionId: session.id, organizationId, verified: false, exhausted: false });
    const final = await recordVerificationAttempt(db, { sessionId: session.id, organizationId, verified: false, exhausted: true });

    expect(final?.verificationAttempts).toBe(3);
    expect(final?.verificationState).toBe("failed");
    expect(final?.status).toBe("refused");
  });

  it("records a successful verification with a timestamp", async () => {
    const userId = await makeUser();
    const organizationId = await makeOrg(userId);
    const session = await openSession(organizationId, userId);

    const verified = await recordVerificationAttempt(db, { sessionId: session.id, organizationId, verified: true, exhausted: false });
    expect(verified?.verificationState).toBe("verified");
    expect(verified?.verifiedAt).toBeInstanceOf(Date);
  });
});

describe("dispatch attempts", () => {
  it("counts each attempt atomically so the retry budget cannot be exceeded", async () => {
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
        incrementDispatchAttempts: true,
      });
      expect(next?.dispatchAttempts).toBe(attempt);
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
      incrementDispatchAttempts: true,
    });
    const succeeded = await transitionCommand(db, {
      organizationId,
      commandId: created.id,
      expectedRevision: failed!.revision,
      dispatchState: "directive_created",
      failureCode: null,
      failureMessage: null,
      incrementDispatchAttempts: true,
    });

    expect(succeeded?.failureCode).toBeNull();
    expect(succeeded?.failureMessage).toBeNull();
    expect(succeeded?.dispatchAttempts).toBe(2);
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
      claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 5 }),
      claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 5 }),
    ]);

    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.dispatchAttempts).toBe(1);
    expect(winners[0]!.revision).toBe(command.revision + 1);
  });

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
      const claimed = await claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 3 });
      expect(claimed?.dispatchAttempts).toBe(attempt);
      command = claimed!;
    }

    const refused = await claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 3 });
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

    await claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 5 });
    const stale = await claimDispatchAttempt(db, { organizationId, commandId: command.id, expectedRevision: command.revision, maxAttempts: 5 });

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
});
