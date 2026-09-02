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
const recordAuditEvent = vi.fn();

vi.mock("@/lib/office/directive-intake", () => ({ createDirectiveProject }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent }));
vi.mock("./call-store", () => ({ transitionCommand }));

const { dispatchConfirmedCommand } = await import("./command-dispatch");
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
  createDirectiveProject.mockReset();
  transitionCommand.mockReset();
  recordAuditEvent.mockReset();
  recordAuditEvent.mockResolvedValue(undefined);
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
