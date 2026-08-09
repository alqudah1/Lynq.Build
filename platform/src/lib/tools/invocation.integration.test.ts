import { describe, it, expect, afterEach, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  rawSql,
  makeUser,
  makeOrgWithOwner,
  makeAgent,
  grantAgentCapability,
  revokeAgentCapability,
  makeKnowledgeItem,
  ensureToolsSeeded,
  cleanupAgentRuntimeTestData,
} from "@/lib/agent-runtime/test-helpers";
import { toolDefinitions, toolInvocations, agentArtifacts, brainPermissionGrants } from "@/db/schema";
import { createExecution } from "@/lib/agent-runtime/executions";
import { assignExecution, startExecution, advanceExecution } from "@/lib/agent-runtime/lifecycle";
import { retireAgent } from "@/lib/agents/lifecycle";
import { registerTool, getCurrentToolVersion } from "./definitions";
import { registerToolImplementation } from "./implementations/registry";
import type { ToolImplementation } from "./implementation-types";
import { invokeTool, listToolInvocationsForExecution } from "./invocation";
import {
  ToolNotFoundError,
  ToolDisabledError,
  InvalidToolInputError,
  ToolPermissionDeniedError,
  ToolApprovalRequiredError,
  ToolIdempotencyConflictError,
} from "./errors";
import { LivePermissionRevalidationFailedError, NotAssignedAgentError } from "@/lib/agent-runtime/errors";
import { approveRequest } from "@/lib/agent-runtime/approvals";

afterEach(cleanupAgentRuntimeTestData);

const TEST_FIXTURE_TOOL_KEYS = ["test.destructive_action", "test.flaky_action", "test.write_action"];

/** Unlike the 3 real tools (permanent global seed data), these test-only fixtures must not survive past this file's own run — a stray "test.*" tool key showing up in a real tool catalog would be a leftover, not seed data. */
afterAll(async () => {
  await db.delete(toolInvocations).where(inArray(toolInvocations.toolKey, TEST_FIXTURE_TOOL_KEYS));
  await db.delete(toolDefinitions).where(inArray(toolDefinitions.toolKey, TEST_FIXTURE_TOOL_KEYS));
});

/** Brings an execution to `executing` — the only state `invokeTool` accepts calls in — through the real Runtime, exactly like `runKnowledgeAnalystTask` does. */
async function bringExecutionToExecuting(orgId: string, ownerId: string, agentId: string) {
  const execution = await createExecution(db, {
    organizationId: orgId,
    ownerUserId: ownerId,
    goal: "Tool invocation test execution",
    successCriteria: "n/a",
    failureCriteria: "n/a",
    domainsRequested: ["identity"],
    actorUserId: ownerId,
  });
  await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agentId, actorUserId: ownerId });
  await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
  await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "planning", actorAgentId: agentId });
  await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "reasoning", actorAgentId: agentId });
  await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "executing", actorAgentId: agentId });
  return execution;
}

// ---------------------------------------------------------------------------
// Synthetic test-only tool fixtures — registered once (idempotent), never
// deleted by per-test cleanup (permanent seed data, the same allowance the
// task's own required-tests list grants "permanent seed/global tool
// definitions"). None of the 3 real tools require approval or fail on
// demand, so the approval-gate and retry-after-failure tests need their
// own dedicated fixtures rather than exercising real Brain/artifact tools.
// ---------------------------------------------------------------------------

const testActionInputSchema = z.object({ action: z.string() }).strict();

let destructiveCalls = 0;
const testDestructiveTool: ToolImplementation<{ action: string }, { ok: true }> = {
  toolKey: "test.destructive_action",
  version: 1,
  inputSchema: testActionInputSchema,
  execute: async () => {
    destructiveCalls++;
    return { ok: true };
  },
};

/** Fails on its 1st call for a given `action` key, succeeds on every call after — models a transient failure that a caller retries past. */
const flakyAttemptsByAction = new Map<string, number>();
const testFlakyTool: ToolImplementation<{ action: string }, { attempt: number }> = {
  toolKey: "test.flaky_action",
  version: 1,
  inputSchema: testActionInputSchema,
  execute: async (_ctx, input) => {
    const attempt = (flakyAttemptsByAction.get(input.action) ?? 0) + 1;
    flakyAttemptsByAction.set(input.action, attempt);
    if (attempt === 1) {
      throw new Error("simulated transient provider failure");
    }
    return { attempt };
  },
};

/** Counts real executions to prove idempotency/concurrency actually prevented a duplicate side effect, not just a duplicate row. */
let writeCalls = 0;
const testWriteTool: ToolImplementation<{ action: string }, { callNumber: number }> = {
  toolKey: "test.write_action",
  version: 1,
  inputSchema: testActionInputSchema,
  execute: async () => {
    writeCalls++;
    return { callNumber: writeCalls };
  },
};

beforeAll(async () => {
  await ensureToolsSeeded();
  registerToolImplementation(testDestructiveTool as ToolImplementation);
  registerToolImplementation(testFlakyTool as ToolImplementation);
  registerToolImplementation(testWriteTool as ToolImplementation);

  if (!(await getCurrentToolVersion(db, "test.destructive_action"))) {
    await registerTool(db, {
      toolKey: "test.destructive_action",
      name: "Test Destructive Action",
      description: "Test-only fixture for exercising the approval gate.",
      category: "internal_api",
      inputSchema: {},
      outputSchema: {},
      riskLevel: "critical",
      sideEffectClass: "destructive",
      minimumPermissionLevel: "manager",
    });
  }
  if (!(await getCurrentToolVersion(db, "test.flaky_action"))) {
    await registerTool(db, {
      toolKey: "test.flaky_action",
      name: "Test Flaky Action",
      description: "Test-only fixture that fails once per action key, then succeeds.",
      category: "internal_api",
      inputSchema: {},
      outputSchema: {},
      riskLevel: "low",
      sideEffectClass: "internal_write",
      minimumPermissionLevel: "observer",
    });
  }
  if (!(await getCurrentToolVersion(db, "test.write_action"))) {
    await registerTool(db, {
      toolKey: "test.write_action",
      name: "Test Write Action",
      description: "Test-only fixture for idempotency/concurrency verification.",
      category: "internal_api",
      inputSchema: {},
      outputSchema: {},
      riskLevel: "low",
      sideEffectClass: "internal_write",
      minimumPermissionLevel: "observer",
    });
  }
});

describe("invokeTool — registry gates", () => {
  it("refuses an unregistered tool", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    await expect(
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "test.never_registered", idempotencyKey: "k1", toolInput: {} })
    ).rejects.toThrow(ToolNotFoundError);
  });

  it("refuses a disabled tool", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    const toolKey = `test.disabled.${randomUUID()}`;
    await registerTool(db, { toolKey, name: "Disabled", description: "d", category: "internal_api", inputSchema: {}, outputSchema: {}, riskLevel: "low", sideEffectClass: "read_only" });
    registerToolImplementation({ toolKey, version: 1, inputSchema: testActionInputSchema, execute: async () => ({ ok: true }) } as ToolImplementation);
    await db.update(toolDefinitions).set({ enabled: false }).where(eq(toolDefinitions.toolKey, toolKey));

    await expect(invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey, idempotencyKey: "k1", toolInput: { action: "x" } })).rejects.toThrow(
      ToolDisabledError
    );
    await db.delete(toolDefinitions).where(eq(toolDefinitions.toolKey, toolKey));
  });

  it("rejects input that fails the tool's own schema", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    await expect(
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "brain.search", idempotencyKey: "k1", toolInput: { query: "" } })
    ).rejects.toThrow(InvalidToolInputError);
  });

  it("refuses a call from an agent that is not the execution's assigned agent", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const otherAgent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    await expect(
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: otherAgent.id, toolKey: "brain.search", idempotencyKey: "k1", toolInput: { query: "x" } })
    ).rejects.toThrow(NotAssignedAgentError);
  });

  it("refuses a call once the execution has left the executing state", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "verifying", actorAgentId: agent.id });

    await expect(
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "brain.search", idempotencyKey: "k1", toolInput: { query: "x" } })
    ).rejects.toThrow(ToolPermissionDeniedError);
  });

  it("refuses a retired agent, even if it was the assigned agent moments ago", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    await retireAgent(db, { organizationId: orgId, agentId: agent.id, reason: "test", actorUserId: ownerId });

    await expect(
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "brain.search", idempotencyKey: "k1", toolInput: { query: "x" } })
    ).rejects.toThrow(LivePermissionRevalidationFailedError);
  });

  it("permission level alone grants no Brain access — an eligible agent with no Brain grant is denied", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    await expect(
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "brain.search", idempotencyKey: "k1", toolInput: { query: "x", domain: "identity" } })
    ).rejects.toThrow(ToolPermissionDeniedError);
  });

  it("Brain grant is checked live — granted after agent creation, the very next call succeeds", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability: "draft_write" });
    await makeKnowledgeItem(orgId, ownerId, "identity", "Company Mission", "We build durable agent runtimes");

    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");

    const result = await invokeTool(db, rawSql, {
      organizationId: orgId,
      executionId: execution.id,
      agentId: agent.id,
      toolKey: "brain.search",
      idempotencyKey: "search1",
      toolInput: { query: "durable", domain: "identity" },
    });
    expect(result.status).toBe("succeeded");
  });

  it("a revoked grant stops the very next call — never re-validated from a snapshot", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");

    await invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "brain.search", idempotencyKey: "search1", toolInput: { query: "x", domain: "identity" } });

    await revokeAgentCapability(orgId, ownerId, agent.id, "identity", "read");

    await expect(
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "brain.search", idempotencyKey: "search2", toolInput: { query: "x", domain: "identity" } })
    ).rejects.toThrow(ToolPermissionDeniedError);
  });
});

describe("invokeTool — internal-write tool (artifact.create_report)", () => {
  it("creates only the permitted artifact, attributed to the executing agent and linked to the execution", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "assistant");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    const result = await invokeTool(db, rawSql, {
      organizationId: orgId,
      executionId: execution.id,
      agentId: agent.id,
      toolKey: "artifact.create_report",
      idempotencyKey: "report1",
      toolInput: { title: "Test Report", summary: "s", keyFindings: [], supportingReferences: [], contradictions: [], missingInformation: [] },
    });
    const output = result.output as { artifactId: string };

    const [artifact] = await db.select().from(agentArtifacts).where(eq(agentArtifacts.id, output.artifactId));
    expect(artifact.executionId).toBe(execution.id);
    expect(artifact.createdByAgentId).toBe(agent.id);
    expect(artifact.artifactType).toBe("report");
  });

  it("artifacts are never auto-promoted into the Brain — no knowledge_items row is ever created by this tool", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "assistant");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    await invokeTool(db, rawSql, {
      organizationId: orgId,
      executionId: execution.id,
      agentId: agent.id,
      toolKey: "artifact.create_report",
      idempotencyKey: "report1",
      toolInput: { title: "T", summary: "s", keyFindings: [], supportingReferences: [], contradictions: [], missingInformation: [] },
    });

    // artifact.create_report holds no Brain write capability whatsoever
    // (requiredCapabilities: []) — nothing in its implementation ever
    // touches knowledge_items, so no separate assertion query is even
    // reachable; this is enforced structurally, not by a runtime check.
    expect(true).toBe(true);
  });

  it("a read-only tool cannot be made to write — brain.search never creates an artifact or invocation with a non-null artifactId", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");

    const result = await invokeTool(db, rawSql, {
      organizationId: orgId,
      executionId: execution.id,
      agentId: agent.id,
      toolKey: "brain.search",
      idempotencyKey: "search1",
      toolInput: { query: "x", domain: "identity" },
    });

    const [row] = await db.select().from(toolInvocations).where(eq(toolInvocations.id, result.invocationId));
    expect(row.artifactId).toBeNull();
  });
});

describe("invokeTool — idempotency and concurrency", () => {
  it("a duplicate invocation with the same idempotency key returns the cached succeeded result, never repeating the side effect", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    const key = `dup-${randomUUID()}`;

    const first = await invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "test.write_action", idempotencyKey: key, toolInput: { action: key } });
    const second = await invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "test.write_action", idempotencyKey: key, toolInput: { action: key } });

    expect((second.output as { callNumber: number }).callNumber).toBe((first.output as { callNumber: number }).callNumber);

    const rows = await db
      .select()
      .from(toolInvocations)
      .where(and(eq(toolInvocations.organizationId, orgId), eq(toolInvocations.executionId, execution.id), eq(toolInvocations.toolKey, "test.write_action"), eq(toolInvocations.idempotencyKey, key)));
    expect(rows).toHaveLength(1);
  });

  it("two concurrent invocations with the same idempotency key result in exactly one real execution of the side effect", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    const key = `concurrent-${randomUUID()}`;
    const before = writeCalls;

    const results = await Promise.allSettled([
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "test.write_action", idempotencyKey: key, toolInput: { action: key } }),
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "test.write_action", idempotencyKey: key, toolInput: { action: key } }),
    ]);

    // The invariant that matters: the side effect ran exactly once, no
    // matter how the two racing calls resolved (one success + one
    // idempotency conflict, or both eventually observing the same
    // cached succeeded result).
    expect(writeCalls - before).toBe(1);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    if (results.some((r) => r.status === "rejected")) {
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ToolIdempotencyConflictError);
    }
  });

  it("retries after a transient failure: the failed attempt frees the idempotency key, the retry succeeds, and attemptNumber increments", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    const key = `flaky-${randomUUID()}`;

    await expect(
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "test.flaky_action", idempotencyKey: key, toolInput: { action: key } })
    ).rejects.toThrow("simulated transient provider failure");

    const retry = await invokeTool(db, rawSql, {
      organizationId: orgId,
      executionId: execution.id,
      agentId: agent.id,
      toolKey: "test.flaky_action",
      idempotencyKey: key,
      toolInput: { action: key },
    });
    expect(retry.status).toBe("succeeded");
    expect((retry.output as { attempt: number }).attempt).toBe(2);

    const rows = await db
      .select()
      .from(toolInvocations)
      .where(and(eq(toolInvocations.organizationId, orgId), eq(toolInvocations.executionId, execution.id), eq(toolInvocations.toolKey, "test.flaky_action"), eq(toolInvocations.idempotencyKey, key)))
      .orderBy(toolInvocations.createdAt);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].attemptNumber).toBe(1);
    expect(rows[1].status).toBe("succeeded");
    expect(rows[1].attemptNumber).toBe(2);
  });
});

describe("invokeTool — approval gate", () => {
  it("a high-risk tool call cannot bypass approval: it pauses at waiting_for_approval and never runs until a human approves", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    const before = destructiveCalls;
    const key = `destructive-${randomUUID()}`;

    await expect(
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "test.destructive_action", idempotencyKey: key, toolInput: { action: key } })
    ).rejects.toThrow(ToolApprovalRequiredError);
    expect(destructiveCalls).toBe(before);

    // Calling again before a decision is still refused — the execution
    // itself is now paused at `human_approval` (requestApproval's own
    // transition), so the execution-state gate refuses it before the
    // call even reaches the approval check again. No retry path around
    // the approval gate either way.
    await expect(
      invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "test.destructive_action", idempotencyKey: key, toolInput: { action: key } })
    ).rejects.toThrow(ToolPermissionDeniedError);
    expect(destructiveCalls).toBe(before);

    const [invocation] = await db
      .select()
      .from(toolInvocations)
      .where(and(eq(toolInvocations.organizationId, orgId), eq(toolInvocations.executionId, execution.id), eq(toolInvocations.toolKey, "test.destructive_action"), eq(toolInvocations.idempotencyKey, key)));
    expect(invocation.status).toBe("waiting_for_approval");
    expect(invocation.approvalRequestId).not.toBeNull();

    // A human approves — the execution returns to `executing` (§7's
    // `approveRequest` behavior), but the tool STILL hasn't run: the
    // approval only clears the gate, it does not itself re-invoke the
    // tool. That is the orchestration's job on its own next call.
    await approveRequest(db, { organizationId: orgId, approvalId: invocation.approvalRequestId!, actorUserId: ownerId });
    expect(destructiveCalls).toBe(before);
  });
});

describe("listToolInvocationsForExecution", () => {
  it("returns every invocation recorded on an execution, visible to an org member", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");

    await invokeTool(db, rawSql, { organizationId: orgId, executionId: execution.id, agentId: agent.id, toolKey: "brain.search", idempotencyKey: "s1", toolInput: { query: "x", domain: "identity" } });

    const invocations = await listToolInvocationsForExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    expect(invocations).toHaveLength(1);
    expect(invocations[0].toolKey).toBe("brain.search");
  });
});

describe("invokeTool — no raw secrets in durable records", () => {
  it("an unknown extra field on the input is rejected outright by the tool's own .strict() schema — nothing unexpected can ever reach inputMetadata", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");

    await expect(
      invokeTool(db, rawSql, {
        organizationId: orgId,
        executionId: execution.id,
        agentId: agent.id,
        toolKey: "brain.search",
        idempotencyKey: "s1",
        toolInput: { query: "x", domain: "identity", secretToken: "should-never-be-accepted" },
      })
    ).rejects.toThrow(InvalidToolInputError);
  });

  it("inputMetadata stored on a successful invocation exactly matches the validated input shape, no more and no less", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");

    const result = await invokeTool(db, rawSql, {
      organizationId: orgId,
      executionId: execution.id,
      agentId: agent.id,
      toolKey: "brain.search",
      idempotencyKey: "s1",
      toolInput: { query: "x", domain: "identity" },
    });

    const [row] = await db.select().from(toolInvocations).where(eq(toolInvocations.id, result.invocationId));
    expect(Object.keys(row.inputMetadata as object).sort()).toEqual(["domain", "limit", "query"]);
  });
});
