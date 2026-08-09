import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { toolInvocations } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveAgentById } from "@/lib/agents/agents";
import { resolveExecutionById } from "@/lib/agent-runtime/executions";
import { requireAssignedAgent, revalidateAgentEligibility, requireExecutionVisibility } from "@/lib/agent-runtime/authz";
import { requestApproval } from "@/lib/agent-runtime/approvals";
import { resolveEffectiveBrainCapabilitiesForAgent } from "@/lib/brain/authz";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveToolForExecution } from "./definitions";
import { resolveToolImplementation } from "./implementations/registry";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import { enforceToolRateLimit, TOOL_READ_RATE_LIMIT, TOOL_WRITE_RATE_LIMIT } from "./rate-limits";
import type { AgentPrincipal } from "@/lib/agents/authentication";
import {
  ToolPermissionDeniedError,
  ToolInvocationError,
  ToolApprovalRequiredError,
  ToolIdempotencyConflictError,
  InvalidToolInputError,
  ToolRuntimeError,
  type ToolErrorClass,
} from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

/**
 * ============================================================================
 * invokeTool — the one entry point every tool call in this codebase goes
 * through. Module 8.
 * ============================================================================
 *
 * Order of checks (task's own explicit list, "Tool Permissions"):
 * assigned-agent + live eligibility → execution state → tool exists/enabled
 * → permission-level floor → input schema → Brain capability (live, per
 * domain the call actually touches) → idempotency → approval. Every one of
 * these reuses an EXISTING gate (Brain Module 16/17, Agent Runtime Core
 * Module 7) — nothing here is a second permission or execution system.
 */

const PERMISSION_LEVEL_ORDER = ["observer", "assistant", "operator", "manager", "executive", "system"] as const;

function permissionLevelAtLeast(actual: string, minimum: string): boolean {
  return PERMISSION_LEVEL_ORDER.indexOf(actual as never) >= PERMISSION_LEVEL_ORDER.indexOf(minimum as never);
}

export interface InvokeToolInput {
  organizationId: string;
  executionId: string;
  planStepId?: string | null;
  agentId: string;
  toolKey: string;
  idempotencyKey: string;
  toolInput: unknown;
}

export interface InvokeToolResult {
  invocationId: string;
  toolKey: string;
  toolVersion: number;
  status: "succeeded";
  output: unknown;
}

function classifyError(err: unknown): { toolErrorClass: ToolErrorClass; message: string } {
  if (err instanceof ToolInvocationError) {
    return { toolErrorClass: err.toolErrorClass, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { toolErrorClass: "runtime_error", message: message.slice(0, 1000) };
}

async function recordDenied(db: Db, eventType: "tool_invocation_permission_denied" | "tool_invocation_approval_required", input: { organizationId: string; agentId: string; toolKey: string; detail?: string }): Promise<void> {
  await recordAuditEvent(db, {
    eventType,
    organizationId: input.organizationId,
    actorAgentId: input.agentId,
    targetType: "tool_definition",
    metadata: { toolKey: input.toolKey, detail: input.detail ?? null },
  });
}

export async function invokeTool(db: Db, rawSql: RawSql, input: InvokeToolInput): Promise<InvokeToolResult> {
  // 1. Execution + assigned-agent + live eligibility — the identical
  // Agent Runtime Core gates every other execution-scoped action uses.
  const execution = await resolveExecutionById(db, input.organizationId, input.executionId);
  requireAssignedAgent(execution, input.agentId);
  await revalidateAgentEligibility(db, input.organizationId, input.agentId);

  if (execution.status !== "executing") {
    await recordDenied(db, "tool_invocation_permission_denied", { organizationId: input.organizationId, agentId: input.agentId, toolKey: input.toolKey, detail: `execution status is "${execution.status}", not "executing"` });
    throw new ToolPermissionDeniedError(`execution is not in a tool-usable state (currently "${execution.status}")`);
  }

  const agent = await resolveAgentById(db, input.agentId);
  if (!agent) {
    throw new ToolPermissionDeniedError("assigned agent could not be resolved");
  }
  const principal: AgentPrincipal = { principalType: "agent", agentId: agent.id, organizationId: agent.organizationId, permissionLevel: agent.permissionLevel, department: agent.department };

  // 2. Tool exists, enabled, current version.
  const tool = await resolveToolForExecution(db, input.toolKey);

  // 2b. Rate limit — keyed by (org, agent, tool), never a raw credential.
  // Read-only tools get the generous budget; anything that writes gets the
  // narrower one, the same "writes cost more budget" judgment Brain
  // Module 16 already applied to its own read/write split.
  const rateLimiter = new PostgresRateLimiter(db);
  await enforceToolRateLimit(db, rateLimiter, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    toolKey: tool.toolKey,
    config: tool.sideEffectClass === "read_only" ? TOOL_READ_RATE_LIMIT : TOOL_WRITE_RATE_LIMIT,
  });

  // 3. Permission-level floor — live, never a snapshot.
  if (tool.minimumPermissionLevel && !permissionLevelAtLeast(agent.permissionLevel, tool.minimumPermissionLevel)) {
    await recordDenied(db, "tool_invocation_permission_denied", { organizationId: input.organizationId, agentId: input.agentId, toolKey: input.toolKey, detail: `agent permission level "${agent.permissionLevel}" is below the required "${tool.minimumPermissionLevel}"` });
    throw new ToolPermissionDeniedError(`requires at least permission level "${tool.minimumPermissionLevel}"`);
  }

  // 4. Implementation resolution — a tool_definitions row with no matching
  // code implementation is an internal consistency failure, never a
  // silent no-op.
  const implementation = resolveToolImplementation(tool.toolKey, tool.version);
  if (!implementation) {
    throw new ToolRuntimeError(`no implementation registered for ${tool.toolKey}@${tool.version}`);
  }

  // 5. Input validation.
  const parsed = implementation.inputSchema.safeParse(input.toolInput);
  if (!parsed.success) {
    throw new InvalidToolInputError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  // 6. Brain capability — live, per domain the call actually touches.
  // Agent permission level and department NEVER substitute for this.
  if (tool.requiredCapabilities.length > 0 && implementation.resolveRequiredDomains) {
    const domains = implementation.resolveRequiredDomains(parsed.data);
    for (const domain of domains) {
      const capabilities = await resolveEffectiveBrainCapabilitiesForAgent(db, { organizationId: input.organizationId, domain, workspaceId: execution.workspaceId }, input.agentId);
      const missing = tool.requiredCapabilities.filter((c) => !capabilities.has(c));
      if (missing.length > 0) {
        await recordDenied(db, "tool_invocation_permission_denied", { organizationId: input.organizationId, agentId: input.agentId, toolKey: input.toolKey, detail: `missing capabilities [${missing.join(",")}] for domain "${domain}"` });
        throw new ToolPermissionDeniedError(`missing required Brain capability [${missing.join(", ")}] for domain "${domain}"`);
      }
    }
  }

  await recordAuditEvent(db, {
    eventType: "tool_invocation_requested",
    organizationId: input.organizationId,
    actorAgentId: input.agentId,
    targetType: "tool_definition",
    targetId: tool.id,
    metadata: { toolKey: tool.toolKey, toolVersion: tool.version, executionId: input.executionId },
  });

  // 7. Approval gate — never bypassable by permission level or track
  // record (§7). Checked BEFORE the idempotency-guarded insert: an
  // approval-gated call that hasn't been approved yet never reaches a
  // "running" attempt at all.
  if (tool.approvalRequired) {
    const [existing] = await db
      .select()
      .from(toolInvocations)
      .where(and(eq(toolInvocations.organizationId, input.organizationId), eq(toolInvocations.executionId, input.executionId), eq(toolInvocations.toolKey, input.toolKey), eq(toolInvocations.idempotencyKey, input.idempotencyKey)));

    if (!existing) {
      const invocationId = randomUUID();
      await db.insert(toolInvocations).values({
        id: invocationId,
        organizationId: input.organizationId,
        workspaceId: execution.workspaceId,
        executionId: input.executionId,
        planStepId: input.planStepId ?? null,
        agentId: input.agentId,
        agentVersionNumber: agent.currentVersionNumber,
        toolKey: tool.toolKey,
        toolVersion: tool.version,
        status: "waiting_for_approval",
        idempotencyKey: input.idempotencyKey,
        inputMetadata: parsed.data as object,
      });

      const { request } = await requestApproval(db, {
        organizationId: input.organizationId,
        executionId: input.executionId,
        requestedAction: `tool:${tool.toolKey}`,
        summary: `Agent requests to call "${tool.name}" (${tool.sideEffectClass})`,
        riskLevel: tool.riskLevel,
        actorAgentId: input.agentId,
      });

      await db.update(toolInvocations).set({ approvalRequestId: request.id, updatedAt: new Date() }).where(eq(toolInvocations.id, invocationId));
      await recordDenied(db, "tool_invocation_approval_required", { organizationId: input.organizationId, agentId: input.agentId, toolKey: input.toolKey });
      throw new ToolApprovalRequiredError();
    }

    if (existing.status !== "ready" && existing.status !== "running" && existing.status !== "succeeded") {
      // Still waiting_for_approval (or the approval was rejected/expired,
      // which never transitions this row forward on its own).
      throw new ToolApprovalRequiredError();
    }
    if (existing.status === "succeeded") {
      return { invocationId: existing.id, toolKey: existing.toolKey, toolVersion: existing.toolVersion, status: "succeeded", output: existing.resultRef };
    }
  }

  // 8. Idempotency-guarded durable insert — written BEFORE the side
  // effect proceeds. A unique-violation here means either a genuinely
  // succeeded prior attempt (replay its cached result) or a concurrent
  // in-flight duplicate (reject, never race the same side effect twice).
  // `attemptNumber` counts every prior row under this exact idempotency
  // key (including failed ones, which is the actual retry history) — a
  // failed attempt frees the unique index for a fresh row, but the
  // attempt count itself must not reset to 1.
  const priorAttempts = await db
    .select({ id: toolInvocations.id })
    .from(toolInvocations)
    .where(and(eq(toolInvocations.organizationId, input.organizationId), eq(toolInvocations.executionId, input.executionId), eq(toolInvocations.toolKey, input.toolKey), eq(toolInvocations.idempotencyKey, input.idempotencyKey)));

  const invocationId = randomUUID();
  let inserted: typeof toolInvocations.$inferSelect | undefined;
  try {
    const [row] = await db
      .insert(toolInvocations)
      .values({
        id: invocationId,
        organizationId: input.organizationId,
        workspaceId: execution.workspaceId,
        executionId: input.executionId,
        planStepId: input.planStepId ?? null,
        agentId: input.agentId,
        agentVersionNumber: agent.currentVersionNumber,
        toolKey: tool.toolKey,
        toolVersion: tool.version,
        status: "running",
        attemptNumber: priorAttempts.length + 1,
        idempotencyKey: input.idempotencyKey,
        inputMetadata: parsed.data as object,
        startedAt: new Date(),
      })
      .returning();
    inserted = row;
  } catch (err) {
    if (!isPostgresUniqueViolation(err)) throw err;

    const [existing] = await db
      .select()
      .from(toolInvocations)
      .where(and(eq(toolInvocations.organizationId, input.organizationId), eq(toolInvocations.executionId, input.executionId), eq(toolInvocations.toolKey, input.toolKey), eq(toolInvocations.idempotencyKey, input.idempotencyKey)));

    if (existing?.status === "succeeded") {
      return { invocationId: existing.id, toolKey: existing.toolKey, toolVersion: existing.toolVersion, status: "succeeded", output: existing.resultRef };
    }
    throw new ToolIdempotencyConflictError();
  }

  await recordAuditEvent(db, { eventType: "tool_invocation_started", organizationId: input.organizationId, actorAgentId: input.agentId, targetType: "tool_definition", targetId: tool.id, metadata: { toolKey: tool.toolKey, invocationId } });

  // 9. Execute.
  try {
    const output = await implementation.execute(
      { db, rawSql, organizationId: input.organizationId, workspaceId: execution.workspaceId, executionId: input.executionId, planStepId: input.planStepId ?? null, principal, idempotencyKey: input.idempotencyKey },
      parsed.data
    );

    const artifactId = output && typeof output === "object" && "artifactId" in output ? (output as { artifactId: string }).artifactId : null;

    await db
      .update(toolInvocations)
      .set({ status: "succeeded", completedAt: new Date(), resultRef: output as object, artifactId, revision: (inserted?.revision ?? 1) + 1, updatedAt: new Date() })
      .where(eq(toolInvocations.id, invocationId));

    await recordAuditEvent(db, { eventType: "tool_invocation_succeeded", organizationId: input.organizationId, actorAgentId: input.agentId, targetType: "tool_definition", targetId: tool.id, metadata: { toolKey: tool.toolKey, invocationId } });

    return { invocationId, toolKey: tool.toolKey, toolVersion: tool.version, status: "succeeded", output };
  } catch (err) {
    const { toolErrorClass, message } = classifyError(err);

    await db
      .update(toolInvocations)
      .set({ status: "failed", completedAt: new Date(), errorClass: toolErrorClass, errorMessage: message, revision: (inserted?.revision ?? 1) + 1, updatedAt: new Date() })
      .where(eq(toolInvocations.id, invocationId));

    await recordAuditEvent(db, { eventType: "tool_invocation_failed", organizationId: input.organizationId, actorAgentId: input.agentId, targetType: "tool_definition", targetId: tool.id, metadata: { toolKey: tool.toolKey, invocationId, errorClass: toolErrorClass } });

    throw err;
  }
}

export type ToolInvocationRecord = typeof toolInvocations.$inferSelect;

/** Human-readable view of an execution's tool call history — the same visibility gate every other execution-scoped human read uses. */
export async function listToolInvocationsForExecution(db: Db, input: { organizationId: string; executionId: string; actorUserId: string }): Promise<ToolInvocationRecord[]> {
  const execution = await resolveExecutionById(db, input.organizationId, input.executionId);
  await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId: execution.workspaceId, actorUserId: input.actorUserId });

  return db
    .select()
    .from(toolInvocations)
    .where(and(eq(toolInvocations.organizationId, input.organizationId), eq(toolInvocations.executionId, input.executionId)))
    .orderBy(toolInvocations.createdAt);
}
