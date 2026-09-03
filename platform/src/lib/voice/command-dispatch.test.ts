import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The approval gate, tested without a database.
 *
 * `dispatchConfirmedCommand` is the single point where a spoken instruction
 * either becomes real work or stops for a human. Its behavior must be
 * verifiable without a Neon connection, so the two collaborators that need
 * one — the command store and the Office directive intake — are stubbed, and
 * every assertion here is about the DECISION, not about persistence.
 *
 * The load-bearing claim these tests defend: `createDirectiveProject` is never
 * called for a gated command.
 */

const createDirectiveProject = vi.fn();
const transitionCommand = vi.fn();
const claimDispatchAttempt = vi.fn();
const isDispatchInFlight = vi.fn();
const resolveCommandById = vi.fn();
const recordAuditEvent = vi.fn();

class DirectivePartiallyCreatedError extends Error {
  constructor(public readonly projectId: string, public readonly projectName: string, public readonly reason: unknown) {
    super("partial");
    this.name = "DirectivePartiallyCreatedError";
  }
}

vi.mock("@/lib/office/directive-intake", () => ({ createDirectiveProject, DirectivePartiallyCreatedError }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent }));
vi.mock("./call-store", () => ({ transitionCommand, claimDispatchAttempt, isDispatchInFlight, resolveCommandById }));

const { dispatchConfirmedCommand, retryFailedDispatch, runDirectiveDispatch, MAX_DISPATCH_ATTEMPTS, DISPATCH_LEASE_MS } = await import("./command-dispatch");
const { CommandNotRetryableError } = await import("./errors");
type Command = Parameters<typeof dispatchConfirmedCommand>[1]["command"];

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: "command-1",
    organizationId: "org-1",
    callSessionId: "session-1",
    requestedOutcome: "Research three Brampton restaurants",
    targetName: null,
    constraints: [],
    requiredIntegrations: [],
    proposedSteps: [],
    missingInformation: [],
    riskLevel: "low",
    requiresApproval: false,
    gatedCategories: [],
    riskReasons: [],
    overrideAttempted: false,
    readbackText: "Here's what I understood.",
    confirmationStatus: "pending",
    confirmedAt: null,
    dispatchState: "awaiting_confirmation",
    approvalDecidedByUserId: null,
    approvalDecidedAt: null,
    approvalDecisionNote: null,
    projectId: null,
    failureCode: null,
    failureMessage: null,
    dispatchAttempts: 0,
    dispatchStartedAt: null,
    idempotencyKey: "key-1",
    revision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Command;
}

const db = {} as never;
const baseInput = { organizationId: "org-1", founderUserId: "user-1", workspaceId: null };

beforeEach(() => {
  // Auto-dispatch is off by default in production — see
  // `phoneAutoDispatchEnabled`. These tests exercise the dispatch path itself,
  // so they turn it on; the default-off behaviour has its own test below.
  vi.stubEnv("JARVIS_PHONE_AUTO_DISPATCH_ENABLED", "true");
  createDirectiveProject.mockReset();
  transitionCommand.mockReset();
  claimDispatchAttempt.mockReset();
  isDispatchInFlight.mockReset();
  isDispatchInFlight.mockReturnValue(false);
  resolveCommandById.mockReset();
  resolveCommandById.mockImplementation(async () => makeCommand({ dispatchState: "dispatching" }));
  recordAuditEvent.mockReset();
  recordAuditEvent.mockResolvedValue(undefined);
  // By default the claim succeeds and returns the row with its revision bumped
  // and the attempt counted — exactly what the real guarded UPDATE does.
  claimDispatchAttempt.mockImplementation(async (_db: unknown, args: { expectedRevision: number }) =>
    makeCommand({ revision: args.expectedRevision + 1, dispatchAttempts: 1, dispatchState: "dispatching" })
  );
});

describe("low-risk commands", () => {
  it("creates a real Office directive through the shared intake", async () => {
    createDirectiveProject.mockResolvedValue({
      assistantReply: "I opened the project.",
      plannedByAI: false,
      executionMode: "advisory",
      project: { id: "project-1", name: "Brampton Restaurants", projectKey: "BRAMP01", status: "active", workspaceId: null },
      assignments: [{ taskId: "task-1" }],
      launchedCount: 1,
    });
    const command = makeCommand();
    transitionCommand.mockResolvedValue({ ...command, dispatchState: "directive_created", projectId: "project-1", revision: 2 });

    const outcome = await dispatchConfirmedCommand(db, { ...baseInput, command });

    expect(outcome.status).toBe("directive_created");
    expect(createDirectiveProject).toHaveBeenCalledTimes(1);
    expect(createDirectiveProject.mock.calls[0][1]).toMatchObject({ organizationId: "org-1", actorUserId: "user-1", source: "founder_phone_call" });
    if (outcome.status !== "directive_created") throw new Error("expected a directive");
    expect(outcome.spoken).toContain("Brampton Restaurants");
  });
});

describe("gated commands", () => {
  it("never creates a directive and stops at awaiting_approval", async () => {
    const command = makeCommand({
      requiresApproval: true,
      riskLevel: "high",
      gatedCategories: ["customer_outreach"],
      riskReasons: ["Contacting a customer or prospect"],
      requestedOutcome: "Email the restaurant owner our proposal",
    });
    transitionCommand.mockResolvedValue({ ...command, dispatchState: "awaiting_approval", confirmationStatus: "confirmed", revision: 2 });

    const outcome = await dispatchConfirmedCommand(db, { ...baseInput, command });

    expect(createDirectiveProject).not.toHaveBeenCalled();
    expect(outcome.status).toBe("awaiting_approval");
    expect(outcome.spoken).toMatch(/nothing has started/i);
    expect(transitionCommand.mock.calls[0][1]).toMatchObject({ dispatchState: "awaiting_approval", confirmationStatus: "confirmed" });
  });

  it("records an override attempt as its own audit event and still gates", async () => {
    const command = makeCommand({ requiresApproval: true, riskLevel: "critical", overrideAttempted: true });
    transitionCommand.mockResolvedValue({ ...command, dispatchState: "awaiting_approval", revision: 2 });

    await dispatchConfirmedCommand(db, { ...baseInput, command });

    const events = recordAuditEvent.mock.calls.map((call) => call[1].eventType);
    expect(events).toContain("jarvis_phone_command_override_attempted");
    expect(createDirectiveProject).not.toHaveBeenCalled();
  });
});

describe("idempotency", () => {
  it("does not act again on a command that already left awaiting_confirmation", async () => {
    const outcome = await dispatchConfirmedCommand(db, { ...baseInput, command: makeCommand({ dispatchState: "directive_created", projectId: "project-1" }) });

    expect(outcome.status).toBe("already_dispatched");
    expect(createDirectiveProject).not.toHaveBeenCalled();
    expect(transitionCommand).not.toHaveBeenCalled();
    expect(outcome.spoken).toMatch(/already opened that project/i);
  });

  it("reports the existing state when the revision guard rejects a concurrent second confirmation", async () => {
    const command = makeCommand({ requiresApproval: true });
    transitionCommand.mockResolvedValue(null);

    const outcome = await dispatchConfirmedCommand(db, { ...baseInput, command });

    expect(outcome.status).toBe("already_dispatched");
    expect(createDirectiveProject).not.toHaveBeenCalled();
  });
});

describe("failures are explicit", () => {
  it("records a rate-limited model as a real failure and never claims success", async () => {
    createDirectiveProject.mockRejectedValue(new Error("Provider returned 429 Too Many Requests"));
    const command = makeCommand();
    transitionCommand.mockResolvedValue({ ...command, dispatchState: "failed", failureCode: "model_rate_limited", revision: 2 });

    const outcome = await dispatchConfirmedCommand(db, { ...baseInput, command });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("expected failure");
    expect(outcome.failureCode).toBe("model_rate_limited");
    expect(outcome.spoken).toMatch(/couldn't open the project/i);
    expect(transitionCommand.mock.calls.at(-1)?.[1]).toMatchObject({ dispatchState: "failed", failureCode: "model_rate_limited" });
    expect(recordAuditEvent.mock.calls.map((call) => call[1].eventType)).toContain("jarvis_phone_command_dispatch_failed");
  });

  it("classifies a timeout, a missing agent roster, and an unrecognized error distinctly", async () => {
    const cases: Array<[Error, string]> = [
      [new Error("The operation timed out"), "timed_out"],
      [new Error("No eligible agents are available"), "no_agents_available"],
      [new Error("something nobody predicted"), "unknown_error"],
    ];

    for (const [error, expectedCode] of cases) {
      createDirectiveProject.mockRejectedValueOnce(error);
      const command = makeCommand();
      transitionCommand.mockResolvedValue({ ...command, dispatchState: "failed", failureCode: expectedCode, revision: 2 });

      const outcome = await dispatchConfirmedCommand(db, { ...baseInput, command });
      expect(outcome.status).toBe("failed");
      if (outcome.status !== "failed") throw new Error("expected failure");
      expect(outcome.failureCode).toBe(expectedCode);
    }
  });
});

describe("retrying a failed dispatch", () => {
  const retryInput = { organizationId: "org-1", actorUserId: "approver-1", workspaceId: null };

  it("re-runs the same directive path and reports the real success", async () => {
    createDirectiveProject.mockResolvedValue({
      assistantReply: "I opened the project.",
      plannedByAI: false,
      executionMode: "advisory",
      project: { id: "project-1", name: "Brampton Restaurants", projectKey: "BRAMP01", status: "active", workspaceId: null },
      assignments: [{ taskId: "task-1" }],
      launchedCount: 1,
    });
    const command = makeCommand({ dispatchState: "failed", failureCode: "model_rate_limited", dispatchAttempts: 1, revision: 2 });
    transitionCommand.mockResolvedValue({ ...command, dispatchState: "directive_created", projectId: "project-1", revision: 3 });

    const outcome = await retryFailedDispatch(db, { ...retryInput, command });

    expect(outcome.status).toBe("directive_created");
    expect(createDirectiveProject).toHaveBeenCalledTimes(1);
    // The person who pressed retry becomes the actor, so downstream
    // authorization resolves against a real current session.
    expect(createDirectiveProject.mock.calls[0][1]).toMatchObject({ actorUserId: "approver-1" });
  });

  it("clears the previous failure rather than leaving a stale reason behind", async () => {
    createDirectiveProject.mockResolvedValue({
      assistantReply: "ok",
      plannedByAI: false,
      executionMode: "advisory",
      project: { id: "project-1", name: "P", projectKey: "P01", status: "active", workspaceId: null },
      assignments: [],
      launchedCount: 0,
    });
    const command = makeCommand({ dispatchState: "failed", failureCode: "model_rate_limited", dispatchAttempts: 1, revision: 2 });
    transitionCommand.mockResolvedValue({ ...command, dispatchState: "directive_created", failureCode: null, revision: 3 });

    await retryFailedDispatch(db, { ...retryInput, command });

    // The attempt is counted by the claim, not by the outcome transition.
    expect(transitionCommand.mock.calls[0][1]).toMatchObject({ failureCode: null, failureMessage: null });
    expect(claimDispatchAttempt).toHaveBeenCalledTimes(1);
  });

  it("refuses to retry a command that is still awaiting approval — retry can never manufacture consent", async () => {
    const command = makeCommand({ dispatchState: "awaiting_approval", requiresApproval: true });

    await expect(retryFailedDispatch(db, { ...retryInput, command })).rejects.toThrow(CommandNotRetryableError);
    expect(createDirectiveProject).not.toHaveBeenCalled();
  });

  it.each(["awaiting_confirmation", "directive_created", "declined", "cancelled"] as const)(
    "refuses to retry a command in %s",
    async (dispatchState) => {
      await expect(retryFailedDispatch(db, { ...retryInput, command: makeCommand({ dispatchState }) })).rejects.toThrow(CommandNotRetryableError);
      expect(createDirectiveProject).not.toHaveBeenCalled();
    }
  );

  it("stops retrying once the attempt budget is spent", async () => {
    const command = makeCommand({ dispatchState: "failed", dispatchAttempts: MAX_DISPATCH_ATTEMPTS });

    await expect(retryFailedDispatch(db, { ...retryInput, command })).rejects.toThrow(CommandNotRetryableError);
    expect(createDirectiveProject).not.toHaveBeenCalled();
  });

  it("reports a second failure honestly instead of claiming success", async () => {
    createDirectiveProject.mockRejectedValue(new Error("Provider returned 429 Too Many Requests"));
    const command = makeCommand({ dispatchState: "failed", dispatchAttempts: 1, revision: 2 });
    transitionCommand.mockResolvedValue({ ...command, dispatchState: "failed", failureCode: "model_rate_limited", dispatchAttempts: 2, revision: 3 });

    const outcome = await retryFailedDispatch(db, { ...retryInput, command });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("expected failure");
    expect(outcome.failureCode).toBe("model_rate_limited");
  });
});

describe("the dispatch claim is what prevents duplicate real work", () => {
  const retryInput = { organizationId: "org-1", actorUserId: "approver-1", workspaceId: null };

  it("does not create a project when the claim is lost to a concurrent caller", async () => {
    // Two admins press Try again at once. Exactly one may dispatch; the loser
    // must not call createDirectiveProject at all — a second project would
    // mean a second set of real, running agent executions.
    claimDispatchAttempt.mockResolvedValue(null);

    const outcome = await retryFailedDispatch(db, { ...retryInput, command: makeCommand({ dispatchState: "failed", dispatchAttempts: 1 }) });

    expect(outcome.status).toBe("already_dispatched");
    expect(createDirectiveProject).not.toHaveBeenCalled();
    expect(transitionCommand).not.toHaveBeenCalled();
  });

  it("claims before creating anything, using the revision it read", async () => {
    createDirectiveProject.mockResolvedValue({
      assistantReply: "ok",
      plannedByAI: false,
      executionMode: "advisory",
      project: { id: "project-1", name: "P", projectKey: "P01", status: "active", workspaceId: null },
      assignments: [],
      launchedCount: 0,
    });
    transitionCommand.mockResolvedValue(makeCommand({ dispatchState: "directive_created", revision: 3 }));

    await dispatchConfirmedCommand(db, { ...baseInput, command: makeCommand({ revision: 7 }) });

    expect(claimDispatchAttempt).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        expectedRevision: 7,
        maxAttempts: MAX_DISPATCH_ATTEMPTS,
        staleAfterMs: DISPATCH_LEASE_MS,
        // The state guard is what stops a caller arriving mid-dispatch from
        // claiming again; `dispatching` is deliberately absent.
        fromStates: ["awaiting_confirmation", "awaiting_approval", "failed"],
      })
    );
    // The claim owns the attempt counter; the outcome transition must not
    // carry one at all.
    expect(Object.keys(transitionCommand.mock.calls[0][1])).not.toContain("incrementDispatchAttempts");
  });
});

describe("a partially created directive is never duplicated", () => {
  const retryInput = { organizationId: "org-1", actorUserId: "approver-1", workspaceId: null };

  it("records the project that already exists when the handoff fails midway", async () => {
    createDirectiveProject.mockRejectedValue(new DirectivePartiallyCreatedError("project-9", "Brampton Restaurants", new Error("fetch failed")));
    transitionCommand.mockResolvedValue(makeCommand({ dispatchState: "failed", projectId: "project-9", revision: 3 }));

    const outcome = await dispatchConfirmedCommand(db, { ...baseInput, command: makeCommand() });

    expect(outcome.status).toBe("failed");
    expect(transitionCommand.mock.calls.at(-1)?.[1]).toMatchObject({ dispatchState: "failed", projectId: "project-9" });
    // It must not claim nothing was started — agents may already be running.
    expect(outcome.spoken).not.toMatch(/nothing/i);
    expect(outcome.spoken).toContain("Brampton Restaurants");
  });

  it("refuses to retry a failure that already produced a project", async () => {
    const command = makeCommand({ dispatchState: "failed", projectId: "project-9", dispatchAttempts: 1 });

    await expect(retryFailedDispatch(db, { ...retryInput, command })).rejects.toThrow(CommandNotRetryableError);
    expect(claimDispatchAttempt).not.toHaveBeenCalled();
    expect(createDirectiveProject).not.toHaveBeenCalled();
  });
});

describe("the approver's identity survives a failed dispatch", () => {
  it("keeps who approved a gated command even when the dispatch fails", async () => {
    createDirectiveProject.mockRejectedValue(new Error("Provider returned 429 Too Many Requests"));
    transitionCommand.mockResolvedValue(makeCommand({ dispatchState: "failed", revision: 3 }));

    await runDirectiveDispatch(db, {
      organizationId: "org-1",
      founderUserId: "approver-1",
      command: makeCommand({ dispatchState: "awaiting_approval", requiresApproval: true }),
      workspaceId: null,
      approvalDecidedByUserId: "approver-1",
      approvalDecisionNote: "fine by me",
    });

    // Otherwise a critical command shows on screen with no record of who
    // approved it, next to a live retry button.
    expect(transitionCommand.mock.calls.at(-1)?.[1]).toMatchObject({
      dispatchState: "failed",
      approvalDecidedByUserId: "approver-1",
      approvalDecisionNote: "fine by me",
    });
  });
});

describe("an in-flight dispatch is never dispatched again", () => {
  const retryInput = { organizationId: "org-1", actorUserId: "approver-1", workspaceId: null };

  it("refuses a retry while a dispatch is still running", async () => {
    isDispatchInFlight.mockReturnValue(true);

    await expect(
      retryFailedDispatch(db, { ...retryInput, command: makeCommand({ dispatchState: "dispatching", dispatchAttempts: 1 }) })
    ).rejects.toThrow(CommandNotRetryableError);
    expect(claimDispatchAttempt).not.toHaveBeenCalled();
  });

  it("never asks to claim from the dispatching state, so a mid-flight caller finds nothing claimable", async () => {
    createDirectiveProject.mockResolvedValue({
      assistantReply: "ok",
      plannedByAI: false,
      executionMode: "advisory",
      project: { id: "project-1", name: "P", projectKey: "P01", status: "active", workspaceId: null },
      assignments: [],
      launchedCount: 0,
    });
    transitionCommand.mockResolvedValue(makeCommand({ dispatchState: "directive_created" }));

    await dispatchConfirmedCommand(db, { ...baseInput, command: makeCommand() });

    expect(claimDispatchAttempt.mock.calls[0][1].fromStates).not.toContain("dispatching");
  });

  it("tells the caller work is under way rather than that nothing started", async () => {
    const outcome = await dispatchConfirmedCommand(db, { ...baseInput, command: makeCommand({ dispatchState: "dispatching" }) });

    expect(outcome.status).toBe("already_dispatched");
    expect(outcome.spoken).toMatch(/opening that one right now/i);
    expect(createDirectiveProject).not.toHaveBeenCalled();
  });

  it("re-reads the row when it loses the claim, so it reports the CURRENT state not its stale read", async () => {
    // The loser holds an `awaiting_approval` snapshot while the winner is
    // already dispatching. Reporting the snapshot would tell a second admin
    // "nothing has started" while agents are being launched.
    claimDispatchAttempt.mockResolvedValue(null);
    resolveCommandById.mockResolvedValue(makeCommand({ dispatchState: "dispatching" }));

    const outcome = await runDirectiveDispatch(db, {
      organizationId: "org-1",
      founderUserId: "approver-2",
      command: makeCommand({ dispatchState: "awaiting_approval", requiresApproval: true }),
      workspaceId: null,
    });

    expect(resolveCommandById).toHaveBeenCalled();
    expect(outcome.spoken).toMatch(/opening that one right now/i);
    expect(outcome.spoken).not.toMatch(/nothing has started/i);
  });
});

describe("failures are classified from the real cause, not the wrapper", () => {
  it("still recognizes an authorization failure that happened after the project was created", async () => {
    class TenantResourceNotFoundError extends Error {
      constructor() {
        super("not found");
        this.name = "TenantResourceNotFoundError";
      }
    }
    createDirectiveProject.mockRejectedValue(new DirectivePartiallyCreatedError("project-9", "P", new TenantResourceNotFoundError()));
    transitionCommand.mockResolvedValue(makeCommand({ dispatchState: "failed" }));

    const outcome = await dispatchConfirmedCommand(db, { ...baseInput, command: makeCommand() });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("expected failure");
    // A tenant-scoped not-found IS an authorization outcome in this codebase —
    // 404 deliberately hides cross-tenant existence. The point of the
    // assertion is that it is classified at all: the wrapper's own name and
    // message match no rule, so without unwrapping this degraded to
    // `unknown_error`.
    expect(outcome.failureCode).toBe("authorization_failed");
  });
});

describe("a stalled dispatch can be recovered", () => {
  const retryInput = { organizationId: "org-1", actorUserId: "approver-1", workspaceId: null };

  /**
   * The lease existed but was unreachable: every entry point pre-gated on a
   * state a `dispatching` row is not in, so `claimDispatchAttempt`'s takeover
   * branch could never fire and a command whose process died mid-dispatch
   * stayed wedged forever — the exact failure the lease was added to prevent.
   */
  it("retries a dispatching command whose lease has expired", async () => {
    isDispatchInFlight.mockReturnValue(false);
    createDirectiveProject.mockResolvedValue({
      assistantReply: "ok",
      plannedByAI: false,
      executionMode: "advisory",
      project: { id: "project-1", name: "P", projectKey: "P01", status: "active", workspaceId: null },
      assignments: [],
      launchedCount: 0,
    });
    transitionCommand.mockResolvedValue(makeCommand({ dispatchState: "directive_created" }));

    const outcome = await retryFailedDispatch(db, {
      ...retryInput,
      command: makeCommand({ dispatchState: "dispatching", dispatchAttempts: 1, dispatchStartedAt: new Date(0) }),
    });

    expect(outcome.status).toBe("directive_created");
    expect(claimDispatchAttempt).toHaveBeenCalledTimes(1);
  });

  it("still refuses while the lease is live, so a running dispatch is never disturbed", async () => {
    isDispatchInFlight.mockReturnValue(true);

    await expect(
      retryFailedDispatch(db, { ...retryInput, command: makeCommand({ dispatchState: "dispatching", dispatchStartedAt: new Date() }) })
    ).rejects.toThrow(CommandNotRetryableError);
    expect(claimDispatchAttempt).not.toHaveBeenCalled();
  });
});

describe("nothing said on a call starts work on its own by default", () => {
  /**
   * `assessCommandRisk` is a lexical classifier over speech. Ten adversarial
   * reviews say it belongs on an approval screen rather than in the decision:
   * against 315 deliberately dangerous phrasings the fifth design cleared 139,
   * while gating 38 of 40 ordinary requests written by someone who had not seen
   * its vocabulary. Both numbers came from the same property — every round was
   * tuned against corpora written alongside it.
   *
   * So a `low` verdict no longer starts anything unless a human has explicitly
   * enabled that, and the classifier's output becomes advice on the approval
   * screen instead of authority.
   */
  it("stops a low-risk command at the approval gate when auto-dispatch is off", async () => {
    vi.stubEnv("JARVIS_PHONE_AUTO_DISPATCH_ENABLED", "");
    transitionCommand.mockResolvedValue({ ...makeCommand(), dispatchState: "awaiting_approval", riskLevel: "low" });

    const outcome = await dispatchConfirmedCommand(db, {
      organizationId: "org-1",
      founderUserId: "user-1",
      command: makeCommand(),
    });

    expect(outcome.status).toBe("awaiting_approval");
    expect(createDirectiveProject).not.toHaveBeenCalled();
  });

  it("says why, without pretending the work was judged risky", async () => {
    vi.stubEnv("JARVIS_PHONE_AUTO_DISPATCH_ENABLED", "");
    transitionCommand.mockResolvedValue({ ...makeCommand(), dispatchState: "awaiting_approval", riskLevel: "low" });

    const outcome = await dispatchConfirmedCommand(db, {
      organizationId: "org-1",
      founderUserId: "user-1",
      command: makeCommand(),
    });

    // The founder is told the truth: this is ordinary work, and nothing said on
    // a call starts on its own. Reporting it as "this needs your approval
    // because it looks risky" would be a lie about work the gate cleared.
    expect(outcome.spoken).toMatch(/ordinary internal work/i);
    expect(outcome.spoken).toMatch(/nothing said on a call starts on its own/i);
  });
});
