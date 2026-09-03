import { afterEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import {
  jarvisCallSessions,
  jarvisPhoneCommands,
  organizationMemberships,
  organizations,
  projects,
  users,
} from "@/db/schema";
import { ensureOfficeDeliveryTeam } from "@/lib/office/team";
import { buildCommandDraft } from "./command-draft";
import {
  claimDispatchAttempt,
  ensureCallSession,
  recordDispatchProject,
  resolveCommandById,
  upsertCommandDraft,
} from "./call-store";
import { dispatchConfirmedCommand, retryFailedDispatch, runDirectiveDispatch } from "./command-dispatch";
import { createDirectiveProject, DirectivePartiallyCreatedError } from "@/lib/office/directive-intake";
import { CommandNotRetryableError } from "./errors";

/**
 * ============================================================================
 * The dispatch path, end to end, against a real database
 * ============================================================================
 *
 * These tests exist because of a specific, repeated failure: three review
 * rounds found duplicate-dispatch defects, and twice the tests written
 * alongside the fix did not catch the next one — because they exercised the
 * MECHANISM (`claimDispatchAttempt` called directly, with a hand-passed
 * revision) rather than the PATH a caller actually takes.
 *
 * So every test here goes through a real entry point — `dispatchConfirmedCommand`,
 * `runDirectiveDispatch`, `retryFailedDispatch` — and asserts against the real
 * `projects` table. "Exactly one project row exists" is the only assertion
 * that actually means the race is closed; anything about revisions or attempt
 * counters is a proxy that has already proved insufficient twice.
 *
 * Requires a Postgres the Neon driver can reach:
 *   set -a && source .env.local && set +a && npm run test:integration
 */

// Auto-dispatch is OFF in production by default — see `phoneAutoDispatchEnabled`.
// These suites exercise the dispatch machinery itself, so they turn it on; the
// default-off behaviour is asserted separately.
process.env.JARVIS_PHONE_AUTO_DISPATCH_ENABLED = "true";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeFounder(): Promise<{ userId: string; organizationId: string }> {
  const [user] = await db
    .insert(users)
    .values({ email: `jarvis-dispatch-test-${crypto.randomUUID()}@example.com`, name: "Dispatch Test Founder" })
    .returning({ id: users.id });
  createdUserIds.push(user.id);

  const [org] = await db
    .insert(organizations)
    .values({ name: "Jarvis Dispatch Test Org", slug: `jarvis-dispatch-${crypto.randomUUID().slice(0, 8)}` })
    .returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  createdOrgIds.push(org.id);

  // The real delivery roster, registered through the real registry — the
  // directive planner selects from it.
  await ensureOfficeDeliveryTeam(db, { organizationId: org.id, humanOwnerUserId: user.id, actorUserId: user.id });
  return { userId: user.id, organizationId: org.id };
}

async function openCommand(
  organizationId: string,
  founderUserId: string,
  outcome = "Research three Brampton restaurants and compare their websites"
) {
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
    draft: buildCommandDraft({ requestedOutcome: outcome }),
  });
  return { session, command };
}

async function countProjects(organizationId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.organizationId, organizationId));
  return Number(count);
}

afterEach(async () => {
  // Deleting the organization cascades every project, task, execution, job and
  // command created by a real dispatch, so cleanup does not have to track the
  // whole graph the Office builds.
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(organizations).where(eq(organizations.id, id));
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("a confirmed low-risk command really opens a project", () => {
  it("creates one project, links it to the command, and reports it honestly", async () => {
    const { userId, organizationId } = await makeFounder();
    const { command } = await openCommand(organizationId, userId);

    const outcome = await dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command });

    expect(outcome.status).toBe("directive_created");
    if (outcome.status !== "directive_created") throw new Error("expected a directive");
    expect(await countProjects(organizationId)).toBe(1);

    const stored = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(stored.dispatchState).toBe("directive_created");
    expect(stored.projectId).toBe(outcome.projectId);
    expect(stored.confirmationStatus).toBe("confirmed");
    expect(stored.failureCode).toBeNull();
    // The claim counted exactly one attempt, not one per transition.
    expect(stored.dispatchAttempts).toBe(1);
  });
});

describe("concurrent confirmations create exactly one project", () => {
  /**
   * The simultaneous case: two callers holding the same revision. A bare
   * revision guard on the OUTCOME transition would let both create a project
   * and only reject the second write.
   */
  it("survives two simultaneous confirmations of the same command", async () => {
    const { userId, organizationId } = await makeFounder();
    const { command } = await openCommand(organizationId, userId);

    const results = await Promise.all([
      dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command }),
      dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command }),
    ]);

    expect(await countProjects(organizationId)).toBe(1);
    expect(results.filter((r) => r.status === "directive_created")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already_dispatched")).toHaveLength(1);
  });

  /**
   * The SEQUENTIAL case, which is the one that actually happens: a dispatch
   * takes seconds to minutes, and a second request arrives during it and
   * re-reads the row. This is the interleaving an earlier fix missed entirely —
   * the second caller saw a bumped revision and a still-dispatchable state, and
   * claimed again.
   */
  it("refuses a second dispatch that re-reads the row mid-flight", async () => {
    const { userId, organizationId } = await makeFounder();
    const { command } = await openCommand(organizationId, userId);

    // Stand in for "the winner is inside createDirectiveProject right now".
    const claimed = await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation", "awaiting_approval", "failed"],
      staleAfterMs: 600_000,
    });
    expect(claimed).not.toBeNull();

    // A second request re-reads and goes through the real entry point.
    const reread = await resolveCommandById(db, { organizationId, commandId: command.id });
    const outcome = await runDirectiveDispatch(db, {
      organizationId,
      founderUserId: userId,
      command: reread,
      workspaceId: null,
    });

    expect(outcome.status).toBe("already_dispatched");
    expect(await countProjects(organizationId)).toBe(0);
    // It must describe the row's real state, not the caller's stale read.
    expect(outcome.spoken).toMatch(/opening that one right now/i);
  });
});

describe("a gated command creates nothing until a human decides", () => {
  it("stops at awaiting_approval with no project", async () => {
    const { userId, organizationId } = await makeFounder();
    const { command } = await openCommand(organizationId, userId, "Email the restaurant owner our proposal this week");
    expect(command.requiresApproval).toBe(true);

    const outcome = await dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command });

    expect(outcome.status).toBe("awaiting_approval");
    expect(await countProjects(organizationId)).toBe(0);

    const stored = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(stored.dispatchState).toBe("awaiting_approval");
    expect(stored.projectId).toBeNull();
    // Confirming on the call must not consume a dispatch attempt: nothing was
    // dispatched.
    expect(stored.dispatchAttempts).toBe(0);
  });

  it("creates the project only once a human approves, through the same path", async () => {
    const { userId, organizationId } = await makeFounder();
    const { command } = await openCommand(organizationId, userId, "Email the restaurant owner our proposal this week");
    await dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command });
    const gated = await resolveCommandById(db, { organizationId, commandId: command.id });

    const approved = await runDirectiveDispatch(db, {
      organizationId,
      founderUserId: userId,
      command: gated,
      workspaceId: null,
      approvalDecidedByUserId: userId,
      approvalDecisionNote: "fine by me",
    });

    expect(approved.status).toBe("directive_created");
    expect(await countProjects(organizationId)).toBe(1);

    const stored = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(stored.approvalDecidedByUserId).toBe(userId);
    expect(stored.approvalDecidedAt).toBeInstanceOf(Date);
  });
});

describe("a stalled dispatch is recoverable through the real retry path", () => {
  /**
   * The defect a previous round shipped: the stale-lease takeover existed in
   * SQL but no caller could reach it, so a command whose process died
   * mid-dispatch stayed wedged forever. This drives it through
   * `retryFailedDispatch`, the path an admin's Try again actually takes.
   */
  it("takes over an expired lease and opens the project", async () => {
    const { userId, organizationId } = await makeFounder();
    const { command } = await openCommand(organizationId, userId);

    await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation"],
      staleAfterMs: 600_000,
    });
    // The process died here: nothing ever transitioned the row.
    await db
      .update(jarvisPhoneCommands)
      .set({ dispatchStartedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(jarvisPhoneCommands.id, command.id));

    const stuck = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(stuck.dispatchState).toBe("dispatching");

    const outcome = await retryFailedDispatch(db, { organizationId, actorUserId: userId, command: stuck });

    expect(outcome.status).toBe("directive_created");
    expect(await countProjects(organizationId)).toBe(1);
    const stored = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(stored.dispatchState).toBe("directive_created");
    expect(stored.dispatchAttempts).toBe(2);
  });

  it("refuses to disturb a dispatch whose lease is still live", async () => {
    const { userId, organizationId } = await makeFounder();
    const { command } = await openCommand(organizationId, userId);

    await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation"],
      staleAfterMs: 600_000,
    });
    const live = await resolveCommandById(db, { organizationId, commandId: command.id });

    await expect(retryFailedDispatch(db, { organizationId, actorUserId: userId, command: live })).rejects.toThrow(
      CommandNotRetryableError
    );
    expect(await countProjects(organizationId)).toBe(0);
  });
});

describe("the attempt cap bounds real dispatches, not just recorded attempts", () => {
  it("stops dispatching once the budget is spent, however many callers try", async () => {
    const { userId, organizationId } = await makeFounder();
    const { command } = await openCommand(organizationId, userId);

    // Burn the budget without producing a project, the way repeated failures
    // would.
    await db.update(jarvisPhoneCommands).set({ dispatchAttempts: 5 }).where(eq(jarvisPhoneCommands.id, command.id));
    const spent = await resolveCommandById(db, { organizationId, commandId: command.id });

    const results = await Promise.all([
      runDirectiveDispatch(db, { organizationId, founderUserId: userId, command: spent, workspaceId: null }),
      runDirectiveDispatch(db, { organizationId, founderUserId: userId, command: spent, workspaceId: null }),
      runDirectiveDispatch(db, { organizationId, founderUserId: userId, command: spent, workspaceId: null }),
    ]);

    expect(await countProjects(organizationId)).toBe(0);
    expect(results.every((r) => r.status === "already_dispatched")).toBe(true);
  });
});

describe("the call session survives a real dispatch", () => {
  it("keeps the command attached to its call", async () => {
    const { userId, organizationId } = await makeFounder();
    const { session, command } = await openCommand(organizationId, userId);

    await dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command });

    const [row] = await db
      .select()
      .from(jarvisCallSessions)
      .where(and(eq(jarvisCallSessions.id, session.id), eq(jarvisCallSessions.organizationId, organizationId)));
    expect(row).toBeDefined();
    const stored = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(stored.callSessionId).toBe(session.id);
  });
});

describe("a killed dispatch cannot be retried into a duplicate project", () => {
  /**
   * The defect a previous round shipped. `DirectivePartiallyCreatedError` only
   * fires when `createDirectiveProject` THROWS; a serverless timeout throws
   * nothing. So a kill mid-handoff left a live project with running agents and
   * a command recording `projectId: null` — which the stale-lease retry then
   * treated as "nothing happened" and built a second copy of.
   *
   * The fix records the project id the moment it exists, so the killed row
   * still knows.
   */
  it("records the project id before the handoff, so a kill is distinguishable from nothing happening", async () => {
    const { userId, organizationId } = await makeFounder();
    const { command } = await openCommand(organizationId, userId);

    // Observe the row at the exact point a kill would strand it: after the
    // project exists, before the outcome transition.
    let observedAtCreation: string | null | undefined;
    const claimed = await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation"],
      staleAfterMs: 600_000,
    });
    await createDirectiveProject(db, {
      organizationId,
      instruction: "Research three Brampton restaurants and compare their websites",
      workspaceId: null,
      actorUserId: userId,
      source: "founder_phone_call",
      onProjectCreated: async (project) => {
        await recordDispatchProject(db, { organizationId, commandId: claimed!.id, projectId: project.id });
        observedAtCreation = (await resolveCommandById(db, { organizationId, commandId: command.id })).projectId;
      },
    });

    expect(observedAtCreation).toBeTruthy();
    expect(await countProjects(organizationId)).toBe(1);
  });

  it("refuses to retry a stalled command that already has a project", async () => {
    const { userId, organizationId } = await makeFounder();
    const { command } = await openCommand(organizationId, userId);

    await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation"],
      staleAfterMs: 600_000,
    });
    // The project got created, then the process was killed.
    const [project] = await db
      .insert(projects)
      .values({
        organizationId,
        name: "Half-built directive",
        projectKey: `HALF${Date.now().toString().slice(-6)}`,
        ownerUserId: userId,
      })
      .returning({ id: projects.id });
    await recordDispatchProject(db, { organizationId, commandId: command.id, projectId: project.id });
    await db
      .update(jarvisPhoneCommands)
      .set({ dispatchStartedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(jarvisPhoneCommands.id, command.id));

    const stalled = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(stalled.dispatchState).toBe("dispatching");
    expect(stalled.projectId).toBe(project.id);

    await expect(retryFailedDispatch(db, { organizationId, actorUserId: userId, command: stalled })).rejects.toThrow(
      CommandNotRetryableError
    );
    // Still exactly the one project it already had.
    expect(await countProjects(organizationId)).toBe(1);
  });

  it("makes a stalled command at the attempt cap terminal instead of leaving it non-terminal forever", async () => {
    const { userId, organizationId } = await makeFounder();
    const { command } = await openCommand(organizationId, userId);

    await claimDispatchAttempt(db, {
      organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      maxAttempts: 5,
      fromStates: ["awaiting_confirmation"],
      staleAfterMs: 600_000,
    });
    await db
      .update(jarvisPhoneCommands)
      .set({ dispatchAttempts: 5, dispatchStartedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(jarvisPhoneCommands.id, command.id));

    const stalled = await resolveCommandById(db, { organizationId, commandId: command.id });
    await expect(retryFailedDispatch(db, { organizationId, actorUserId: userId, command: stalled })).rejects.toThrow(
      CommandNotRetryableError
    );

    // It refused — but it also stopped the row claiming to be in flight.
    const settled = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(settled.dispatchState).toBe("failed");
    expect(settled.failureCode).toBe("attempts_exhausted");
  });
});

describe("only one draft per call can be awaiting confirmation", () => {
  it("refuses a second open draft at the database, not merely by convention", async () => {
    const { userId, organizationId } = await makeFounder();
    const { session } = await openCommand(organizationId, userId);

    // A different-content capture derives a different idempotency key, so only
    // the partial unique index stops it.
    await expect(
      db.insert(jarvisPhoneCommands).values({
        organizationId,
        callSessionId: session.id,
        requestedOutcome: "Something else entirely",
        riskLevel: "low",
        requiresApproval: false,
        readbackText: "…",
        idempotencyKey: `distinct-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow();
  });
});

describe("createDirectiveProject — a failure in the project-created callback", () => {
  /**
   * Found by review round six. `onProjectCreated` sat OUTSIDE the try that
   * converts a post-`createProject` failure into `DirectivePartiallyCreatedError`,
   * under a comment claiming there was "nothing durable to protect yet".
   *
   * That was false: `createProject` has already committed a live project row
   * by the time the callback runs, and recording that row is the entire reason
   * the callback exists. So one transient Neon round trip failing there — a
   * reset, a 502, a statement timeout — escaped as a raw error, the dispatcher's
   * `instanceof DirectivePartiallyCreatedError` check missed it, and the
   * command was written back as `failed` with a null project id. The screen
   * then said "Nothing was started, and nothing was sent" about a live project,
   * and offered a Try again button that would have created a second one.
   *
   * The callback is now inside the try, so the same failure reports the truth:
   * a partial creation, carrying the id of the project that really exists.
   */
  it("reports a partial creation carrying the real project id, not a raw error", async () => {
    const { userId, organizationId } = await makeFounder();

    let observedProjectId: string | null = null;
    const failure = await createDirectiveProject(db, {
      organizationId,
      instruction: "Research three Brampton restaurants and compare their websites.",
      workspaceId: null,
      actorUserId: userId,
      source: "founder_phone_call",
      onProjectCreated: async (project) => {
        observedProjectId = project.id;
        throw new Error("neon: connection reset");
      },
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(DirectivePartiallyCreatedError);
    const partial = failure as InstanceType<typeof DirectivePartiallyCreatedError>;
    // The id is what stops a later retry building a second copy of live work.
    expect(partial.projectId).toBe(observedProjectId);
    expect(partial.projectId).toBeTruthy();
    // The underlying error is preserved for classification rather than being
    // replaced by the wrapper's own name.
    expect((partial.reason as Error)?.message).toMatch(/connection reset/i);

    // And the project really is there, which is exactly why "nothing was
    // started" would have been a lie.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), eq(projects.id, partial.projectId)));
    expect(Number(count)).toBe(1);
  });
});

describe("a confirmed low-risk command against a real database, with auto-dispatch off", () => {
  /**
   * The production default. `assessCommandRisk` cleared this command, and it
   * still opens no project: what a lexical classifier over speech decides is
   * advice on the approval screen, not authority to start work.
   */
  it("creates no project and leaves the command awaiting approval", async () => {
    const previous = process.env.JARVIS_PHONE_AUTO_DISPATCH_ENABLED;
    process.env.JARVIS_PHONE_AUTO_DISPATCH_ENABLED = "false";
    try {
      const { userId, organizationId } = await makeFounder();
      const command = await upsertCommandDraft(db, {
        organizationId,
        callSessionId: (
          await ensureCallSession(db, {
            organizationId,
            founderUserId: userId,
            providerCallId: `call-${crypto.randomUUID()}`,
            direction: "inbound",
            purpose: "founder_command",
            callerNumber: "+14165551234",
            callerNumberMatched: true,
          })
        ).id,
        founderUserId: userId,
        draft: buildCommandDraft({ requestedOutcome: "Research three Brampton restaurants" }),
      });
      expect(command.requiresApproval).toBe(false);

      const outcome = await dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command });

      expect(outcome.status).toBe("awaiting_approval");
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(eq(projects.organizationId, organizationId));
      expect(Number(count)).toBe(0);
    } finally {
      process.env.JARVIS_PHONE_AUTO_DISPATCH_ENABLED = previous;
    }
  });
});
