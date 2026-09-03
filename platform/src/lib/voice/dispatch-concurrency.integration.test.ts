import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jarvisPhoneCommands, organizationMemberships, organizations, projects, users } from "@/db/schema";
import { ensureOfficeDeliveryTeam } from "@/lib/office/team";
import { buildCommandDraft } from "./command-draft";
import { ensureCallSession, resolveCommandById, upsertCommandDraft } from "./call-store";
import { dispatchConfirmedCommand, retryFailedDispatch, runDirectiveDispatch } from "./command-dispatch";

/**
 * Concurrency stress, not a single interleaving.
 *
 * A two-way race test is weak evidence for a safety property: it exercises one
 * schedule out of many, and this lane has already had three separate
 * duplicate-dispatch defects that a two-way test would not have distinguished.
 * These run the real entry points many times over, at several widths, and
 * assert the invariant that actually matters — never more than one project per
 * command — every time.
 *
 * Two shapes, and the second is the one that matters. Callers that all hold
 * the SAME revision are caught by the revision guard alone; a first version of
 * this file only tested that, and passed with the in-flight state guard
 * removed. The staggered cases below re-read the row first, so every caller
 * after the winner holds the winner's bumped revision — the production shape,
 * and the interleaving that has actually defeated a fix here before.
 */

// Auto-dispatch is OFF in production by default — see `phoneAutoDispatchEnabled`.
// These suites exercise the dispatch machinery itself, so they turn it on; the
// default-off behaviour is asserted separately.
process.env.JARVIS_PHONE_AUTO_DISPATCH_ENABLED = "true";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeFounder() {
  const [user] = await db
    .insert(users)
    .values({ email: `jarvis-stress-${crypto.randomUUID()}@example.com`, name: "Stress Founder" })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  const [org] = await db
    .insert(organizations)
    .values({ name: "Jarvis Stress Org", slug: `jarvis-stress-${crypto.randomUUID().slice(0, 8)}` })
    .returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  createdOrgIds.push(org.id);
  await ensureOfficeDeliveryTeam(db, { organizationId: org.id, humanOwnerUserId: user.id, actorUserId: user.id });
  return { userId: user.id, organizationId: org.id };
}

async function openCommand(organizationId: string, founderUserId: string, outcome: string) {
  const session = await ensureCallSession(db, {
    organizationId,
    founderUserId,
    providerCallId: `call-${crypto.randomUUID()}`,
    direction: "inbound",
    purpose: "founder_command",
    callerNumber: "+14165551234",
    callerNumberMatched: true,
  });
  return upsertCommandDraft(db, {
    organizationId,
    callSessionId: session.id,
    founderUserId,
    draft: buildCommandDraft({ requestedOutcome: outcome }),
  });
}

async function countProjects(organizationId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.organizationId, organizationId));
  return Number(count);
}

afterEach(async () => {
  while (createdOrgIds.length > 0) await db.delete(organizations).where(eq(organizations.id, createdOrgIds.pop()!));
  while (createdUserIds.length > 0) await db.delete(users).where(eq(users.id, createdUserIds.pop()!));
});

describe("concurrent dispatch never produces two projects", () => {
  it.each([2, 3, 5, 8])("holds at %i simultaneous confirmations", async (width) => {
    const { userId, organizationId } = await makeFounder();
    const command = await openCommand(organizationId, userId, "Research three Brampton restaurants and compare them");

    const results = await Promise.all(
      Array.from({ length: width }, () => dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command }))
    );

    expect(await countProjects(organizationId)).toBe(1);
    expect(results.filter((r) => r.status === "directive_created")).toHaveLength(1);
    const stored = await resolveCommandById(db, { organizationId, commandId: command.id });
    // Exactly one attempt was consumed, however many callers tried.
    expect(stored.dispatchAttempts).toBe(1);
  });

  /**
   * Staggered callers that each RE-READ the row first — the production shape,
   * and the one a same-revision race cannot reach. Every caller after the
   * first therefore holds the winner's bumped revision, which is exactly the
   * interleaving that defeated an earlier fix: a revision guard alone accepts
   * it, and only the in-flight state guard refuses.
   */
  it.each([3, 6])("holds at %i staggered callers that each re-read the row", async (width) => {
    const { userId, organizationId } = await makeFounder();
    const command = await openCommand(organizationId, userId, "Research three Brampton restaurants and compare them");

    await Promise.all(
      Array.from({ length: width }, async (_unused, index) => {
        // Arrive spread out, the way real requests do, and read for yourself.
        await new Promise((resolve) => setTimeout(resolve, index * 40));
        const fresh = await resolveCommandById(db, { organizationId, commandId: command.id });
        return runDirectiveDispatch(db, { organizationId, founderUserId: userId, command: fresh, workspaceId: null });
      })
    );

    expect(await countProjects(organizationId)).toBe(1);
  });

  it("holds when a caller re-reads well after the winner has claimed", async () => {
    const { userId, organizationId } = await makeFounder();
    const command = await openCommand(organizationId, userId, "Research the market");

    const winner = runDirectiveDispatch(db, { organizationId, founderUserId: userId, command, workspaceId: null });
    // Long enough to be inside the winner's handoff, not racing its claim.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const fresh = await resolveCommandById(db, { organizationId, commandId: command.id });
    const latecomer = await runDirectiveDispatch(db, { organizationId, founderUserId: userId, command: fresh, workspaceId: null });
    await winner;

    expect(latecomer.status).toBe("already_dispatched");
    expect(await countProjects(organizationId)).toBe(1);
  });

  it("holds across repeated independent races", async () => {
    // Different commands, run back to back, to catch a schedule that only
    // shows up occasionally rather than on one lucky interleaving.
    for (let round = 0; round < 6; round += 1) {
      const { userId, organizationId } = await makeFounder();
      const command = await openCommand(organizationId, userId, `Research the market for round ${round}`);

      await Promise.all([
        dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command }),
        dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command }),
        dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command }),
      ]);

      expect(await countProjects(organizationId)).toBe(1);
    }
  });

  it("holds when approvals and retries race each other on one command", async () => {
    // A gated command approved by two admins while a third presses Try again:
    // three different entry points contending for the same row.
    const { userId, organizationId } = await makeFounder();
    const command = await openCommand(organizationId, userId, "Email the restaurant owner our proposal this week");
    await dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command });
    const gated = await resolveCommandById(db, { organizationId, commandId: command.id });

    const outcomes = await Promise.allSettled([
      runDirectiveDispatch(db, { organizationId, founderUserId: userId, command: gated, workspaceId: null, approvalDecidedByUserId: userId }),
      runDirectiveDispatch(db, { organizationId, founderUserId: userId, command: gated, workspaceId: null, approvalDecidedByUserId: userId }),
      retryFailedDispatch(db, { organizationId, actorUserId: userId, command: gated }).catch((error) => error),
    ]);

    expect(await countProjects(organizationId)).toBe(1);
    // The retry must have refused: the command was never in a retryable state.
    expect(outcomes[2].status).toBe("fulfilled");
  });

  it("never exceeds the attempt cap however many callers contend", async () => {
    const { userId, organizationId } = await makeFounder();
    const command = await openCommand(organizationId, userId, "Research the market");
    // One attempt short of the cap.
    await db.update(jarvisPhoneCommands).set({ dispatchAttempts: 4 }).where(eq(jarvisPhoneCommands.id, command.id));
    const nearCap = await resolveCommandById(db, { organizationId, commandId: command.id });

    await Promise.all(
      Array.from({ length: 6 }, () =>
        runDirectiveDispatch(db, { organizationId, founderUserId: userId, command: nearCap, workspaceId: null })
      )
    );

    expect(await countProjects(organizationId)).toBe(1);
    const stored = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(stored.dispatchAttempts).toBeLessThanOrEqual(5);
  });
});

describe("a dispatch that was killed mid-handoff", () => {
  /**
   * The kill window this suite exists for, found by review round six.
   *
   * A serverless process killed between `createProject` and the end of the
   * handoff throws nothing and writes nothing. Every guard in this lane keyed
   * off an exception, so the row simply stayed in `dispatching` — which means
   * "a process is working on this right now" — forever. Nothing could move it:
   * `retryFailedDispatch` threw on `projectId` before writing anything,
   * approve and decline require `awaiting_approval`, and the call-side
   * handlers only look for `awaiting_confirmation`.
   *
   * These tests simulate the kill by putting the row into exactly the state a
   * killed process leaves behind, then assert the row can always be driven to
   * a terminal state and never into a second project.
   */
  async function simulateKilledDispatch(commandId: string, organizationId: string, projectId: string | null) {
    await db
      .update(jarvisPhoneCommands)
      .set({
        dispatchState: "dispatching",
        // Well past DISPATCH_LEASE_MS: nothing is running any more.
        dispatchStartedAt: new Date(Date.now() - 60 * 60 * 1000),
        dispatchAttempts: 1,
        projectId,
        revision: sql`${jarvisPhoneCommands.revision} + 1`,
      })
      .where(eq(jarvisPhoneCommands.id, commandId));
    const reread = await resolveCommandById(db, { organizationId, commandId });
    return reread;
  }

  it("reaps a stalled dispatch that left a project behind, instead of wedging it forever", async () => {
    const { userId, organizationId } = await makeFounder();
    const command = await openCommand(organizationId, userId, "Research three Brampton restaurants");
    const dispatched = await dispatchConfirmedCommand(db, { organizationId, founderUserId: userId, command });
    expect(dispatched.status).toBe("directive_created");
    const projectId = dispatched.status === "directive_created" ? dispatched.projectId : null;
    expect(projectId).toBeTruthy();
    const projectsBefore = await countProjects(organizationId);

    const stalled = await simulateKilledDispatch(command.id, organizationId, projectId);

    // Retry refuses — correctly, the work exists — but it must LEAVE the row
    // terminal on its way out, not throw before writing.
    await expect(retryFailedDispatch(db, { organizationId, actorUserId: userId, command: stalled })).rejects.toMatchObject({
      retryBlockedBy: "partially_created",
    });

    const settled = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(settled.dispatchState).toBe("failed");
    expect(settled.failureCode).toBe("partially_created");
    expect(settled.projectId).toBe(projectId);
    // The refusal is what protects the live work: no second project.
    expect(await countProjects(organizationId)).toBe(projectsBefore);
  });

  it("lets a stalled dispatch that created nothing be retried into a real project", async () => {
    const { userId, organizationId } = await makeFounder();
    const command = await openCommand(organizationId, userId, "Summarize the pipeline for me");
    const stalled = await simulateKilledDispatch(command.id, organizationId, null);

    const outcome = await retryFailedDispatch(db, { organizationId, actorUserId: userId, command: stalled });

    expect(outcome.status).toBe("directive_created");
    expect(await countProjects(organizationId)).toBe(1);
    const settled = await resolveCommandById(db, { organizationId, commandId: command.id });
    expect(settled.dispatchState).toBe("directive_created");
  });

  it("never produces a second project when many callers retry a stalled dispatch at once", async () => {
    const { userId, organizationId } = await makeFounder();
    const command = await openCommand(organizationId, userId, "Compare our competitors' pricing pages");
    await simulateKilledDispatch(command.id, organizationId, null);

    // Staggered: each caller re-reads first, so everyone after the winner holds
    // the winner's bumped revision — the interleaving that has defeated a fix
    // in this file before.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, async (_unused, index) => {
        await new Promise((resolve) => setTimeout(resolve, index * 12));
        const current = await resolveCommandById(db, { organizationId, commandId: command.id });
        return retryFailedDispatch(db, { organizationId, actorUserId: userId, command: current });
      })
    );

    const created = results.filter((r) => r.status === "fulfilled" && r.value.status === "directive_created");
    expect(created).toHaveLength(1);
    expect(await countProjects(organizationId)).toBe(1);
  });
});
