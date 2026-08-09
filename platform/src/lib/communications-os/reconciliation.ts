import "server-only";
import { and, eq, lt, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationMessages } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { startOperationRun, finishOperationRun } from "@/lib/runtime/operation-runs";
import { RUNTIME_CONFIG } from "@/lib/runtime/config";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Communications reconciliation — Module 16
 * ============================================================================
 * Handles exactly the "uncertain outcome" case `processSendJob` leaves
 * behind on purpose: a message stuck at `sending` past the same staleness
 * threshold Module 9 already uses elsewhere (`executionStuckThresholdSeconds`)
 * means the provider's own outcome was never confirmed. This sweep does
 * NOT blindly resend — a duplicate send under an uncertain prior outcome is
 * exactly the failure mode the spec calls out. It marks the message failed
 * with `failureClass: "provider_timeout"` and `requiresHumanReview`-style
 * visibility (the failure event itself, plus the message staying in a
 * terminal, human-inspectable state) — a human must explicitly create a
 * FRESH message (a new idempotency key) to retry, never this sweep on its
 * own authority.
 */
export interface CommunicationReconciliationSummary {
  examined: number;
  markedUncertainFailed: number;
}

export async function reconcileCommunications(db: Db, input: { organizationId?: string } = {}): Promise<CommunicationReconciliationSummary> {
  const run = await startOperationRun(db, "communication_reconcile");
  const threshold = new Date(Date.now() - RUNTIME_CONFIG.executionStuckThresholdSeconds * 1000);

  const conditions = [eq(communicationMessages.status, "sending"), lt(communicationMessages.updatedAt, threshold)];
  if (input.organizationId) conditions.push(eq(communicationMessages.organizationId, input.organizationId));

  const stuck = await db.select().from(communicationMessages).where(and(...conditions));

  let markedUncertainFailed = 0;
  for (const message of stuck) {
    const [updated] = await db
      .update(communicationMessages)
      .set({ status: "failed", failedAt: new Date(), failureClass: "provider_timeout", failureCode: "reconciliation_stuck_sending", revision: message.revision + 1, updatedAt: new Date() })
      .where(and(eq(communicationMessages.id, message.id), eq(communicationMessages.organizationId, message.organizationId), eq(communicationMessages.revision, message.revision), eq(communicationMessages.status, "sending")))
      .returning();
    if (!updated) continue;

    markedUncertainFailed += 1;
    await recordAuditEvent(db, {
      eventType: "communication_message_failed",
      organizationId: message.organizationId,
      targetType: "communication_message",
      targetId: message.id,
      metadata: { failureClass: "provider_timeout", detectedBy: "reconciliation", requiresHumanReview: true },
    });
  }

  await finishOperationRun(db, run.id, { recordsExamined: stuck.length, recordsAffected: markedUncertainFailed, succeeded: true });
  return { examined: stuck.length, markedUncertainFailed };
}

/** True if a message row was already flagged as an unresolved suppressed active suppression (used by dashboard "needs attention" surfaces) — a thin, deterministic read helper, not a second reconciliation pass. */
export async function listMessagesRequiringHumanReview(db: Db, organizationId: string): Promise<Array<typeof communicationMessages.$inferSelect>> {
  return db
    .select()
    .from(communicationMessages)
    .where(and(eq(communicationMessages.organizationId, organizationId), eq(communicationMessages.status, "failed"), eq(communicationMessages.failureClass, "provider_timeout"), isNull(communicationMessages.deliveredAt)));
}
