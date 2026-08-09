import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { toolInvocations, agentApprovalRequests } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getToolVersion } from "@/lib/tools/definitions";
import { enqueueJob } from "./queue";
import { startOperationRun, finishOperationRun } from "./operation-runs";
import { hasActiveJobForExecution } from "./job-queries";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

const NON_TERMINAL_INVOCATION_STATUSES = ["requested", "validating", "ready", "running", "waiting_for_approval"] as const;

export type ToolInvocationReconciliationOutcome = {
  invocationId: string;
  executionId: string;
  toolKey: string;
  detectedCase: "resolved_to_succeeded" | "safe_to_retry" | "still_pending_approval" | "requires_human_review" | "active_work_in_progress";
};

/**
 * ============================================================================
 * Tool-invocation reconciliation — Module 9, closing the Module 8 gap
 * ============================================================================
 * Uses the existing idempotency model and artifact records to determine
 * — never guesses — whether a stuck invocation's side effect never
 * started, may have started, definitely completed, or needs a human.
 * `read_only` tools carry no side effect at all, so an orphaned one is
 * always safe to retry. `internal_write` tools are resolved by checking
 * for the artifact their own `execute()` would have created — if it
 * exists, the invocation is marked `succeeded` directly (never repeating
 * the write); if not, it's safe to retry (the write and the invocation
 * row share one database, so "no artifact" means "definitely never
 * happened," not "uncertain"). `external_write` (none exist yet) always
 * requires human review — never blindly retried.
 */
export async function reconcileToolInvocations(db: Db, _rawSql: RawSql, input: { organizationId?: string } = {}): Promise<{ outcomes: ToolInvocationReconciliationOutcome[]; recordsExamined: number }> {
  const run = await startOperationRun(db, "tool_invocation_reconciliation");
  await recordAuditEvent(db, { eventType: "runtime_reconciliation_started", organizationId: input.organizationId ?? undefined, targetType: "runtime_operation_run", targetId: run.id, metadata: { operationType: "tool_invocation_reconciliation" } });

  const outcomes: ToolInvocationReconciliationOutcome[] = [];

  try {
    const candidates = await db
      .select()
      .from(toolInvocations)
      .where(and(inArray(toolInvocations.status, [...NON_TERMINAL_INVOCATION_STATUSES]), input.organizationId ? eq(toolInvocations.organizationId, input.organizationId) : undefined));

    for (const invocation of candidates) {
      if (await hasActiveJobForExecution(db, invocation.executionId)) {
        outcomes.push({ invocationId: invocation.id, executionId: invocation.executionId, toolKey: invocation.toolKey, detectedCase: "active_work_in_progress" });
        continue;
      }

      if (invocation.status === "waiting_for_approval") {
        const approval = invocation.approvalRequestId ? (await db.select().from(agentApprovalRequests).where(eq(agentApprovalRequests.id, invocation.approvalRequestId)))[0] : null;
        if (approval?.status === "pending") {
          outcomes.push({ invocationId: invocation.id, executionId: invocation.executionId, toolKey: invocation.toolKey, detectedCase: "still_pending_approval" });
          continue;
        }
        // The approval was decided (approved/rejected/expired) but no
        // continuation ever re-processed this invocation — safe to
        // re-enqueue; the next continuation call re-derives everything
        // live, including re-checking the approval itself.
        await markInvocationReconciled(db, invocation.id, "failed", "safe_to_retry_after_approval_decision");
        await enqueueResumeFor(db, invocation.organizationId, invocation.executionId);
        outcomes.push({ invocationId: invocation.id, executionId: invocation.executionId, toolKey: invocation.toolKey, detectedCase: "safe_to_retry" });
        continue;
      }

      const tool = await getToolVersion(db, invocation.toolKey, invocation.toolVersion);
      if (!tool) {
        await markInvocationReconciled(db, invocation.id, "failed", "tool_definition_version_missing", true);
        outcomes.push({ invocationId: invocation.id, executionId: invocation.executionId, toolKey: invocation.toolKey, detectedCase: "requires_human_review" });
        continue;
      }

      if (tool.sideEffectClass === "read_only") {
        await markInvocationReconciled(db, invocation.id, "failed", "read_only_safe_to_retry");
        await enqueueResumeFor(db, invocation.organizationId, invocation.executionId);
        outcomes.push({ invocationId: invocation.id, executionId: invocation.executionId, toolKey: invocation.toolKey, detectedCase: "safe_to_retry" });
        continue;
      }

      if (tool.sideEffectClass === "internal_write") {
        // Two ways this invocation's own artifact could already exist:
        // (a) it was set on this exact row (crash happened between the
        // tool's own artifact-creation and the row being marked
        // `succeeded`), or (b) a SIBLING row under the same idempotency
        // key already succeeded — the identical defensive check
        // `artifact.create_report`'s own `execute()` performs.
        let resolvedArtifactId: string | null = invocation.artifactId;
        if (!resolvedArtifactId) {
          const [priorSuccess] = await db
            .select({ artifactId: toolInvocations.artifactId })
            .from(toolInvocations)
            .where(
              and(
                eq(toolInvocations.organizationId, invocation.organizationId),
                eq(toolInvocations.executionId, invocation.executionId),
                eq(toolInvocations.toolKey, invocation.toolKey),
                eq(toolInvocations.idempotencyKey, invocation.idempotencyKey),
                eq(toolInvocations.status, "succeeded")
              )
            );
          resolvedArtifactId = priorSuccess?.artifactId ?? null;
        }

        if (resolvedArtifactId) {
          await markInvocationReconciled(db, invocation.id, "succeeded", "artifact_confirmed_to_exist", false, resolvedArtifactId);
          outcomes.push({ invocationId: invocation.id, executionId: invocation.executionId, toolKey: invocation.toolKey, detectedCase: "resolved_to_succeeded" });
        } else {
          await markInvocationReconciled(db, invocation.id, "failed", "internal_write_no_artifact_found_safe_to_retry");
          await enqueueResumeFor(db, invocation.organizationId, invocation.executionId);
          outcomes.push({ invocationId: invocation.id, executionId: invocation.executionId, toolKey: invocation.toolKey, detectedCase: "safe_to_retry" });
        }
        continue;
      }

      // external_write, destructive, financial, permission_changing — no
      // real implementation of any of these exists yet, but the policy
      // is fixed now: never auto-resolved either way.
      await markInvocationReconciled(db, invocation.id, "failed", "unsafe_uncertain_side_effect_requires_human_review", true);
      outcomes.push({ invocationId: invocation.id, executionId: invocation.executionId, toolKey: invocation.toolKey, detectedCase: "requires_human_review" });
    }

    await recordAuditEvent(db, { eventType: "runtime_reconciliation_completed", organizationId: input.organizationId ?? undefined, targetType: "runtime_operation_run", targetId: run.id, metadata: { outcomeCount: outcomes.length } });
    await finishOperationRun(db, run.id, { recordsExamined: candidates.length, recordsAffected: outcomes.filter((o) => o.detectedCase !== "active_work_in_progress" && o.detectedCase !== "still_pending_approval").length, succeeded: true, outcomeSummary: { outcomes } });

    return { outcomes, recordsExamined: candidates.length };
  } catch (err) {
    await finishOperationRun(db, run.id, { recordsExamined: 0, recordsAffected: 0, succeeded: false, errorMessage: err instanceof Error ? err.message.slice(0, 1000) : String(err) });
    throw err;
  }
}

async function markInvocationReconciled(db: Db, invocationId: string, status: "succeeded" | "failed", detail: string, requiresHumanReview = false, artifactId?: string | null): Promise<void> {
  const [row] = await db
    .update(toolInvocations)
    .set({
      status,
      completedAt: new Date(),
      errorClass: status === "failed" ? "timeout" : null,
      errorMessage: status === "failed" ? `reconciled: ${detail}` : null,
      artifactId: artifactId ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(toolInvocations.id, invocationId))
    .returning();

  await recordAuditEvent(db, {
    eventType: "tool_invocation_reconciled",
    organizationId: row.organizationId,
    targetType: "tool_invocation",
    targetId: invocationId,
    metadata: { toolKey: row.toolKey, resolvedStatus: status, detail, requiresHumanReview },
  });
}

async function enqueueResumeFor(db: Db, organizationId: string, executionId: string): Promise<void> {
  await enqueueJob(db, { organizationId, jobType: "execution_resume", executionId, idempotencyKey: `exec:${executionId}` });
}
