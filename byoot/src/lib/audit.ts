import "server-only";
import { randomUUID } from "node:crypto";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { auditLogs } from "@/db/schema";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

/**
 * Copied pattern (not content) from platform/src/lib/audit.ts: a closed,
 * documented event-type union validated at the application layer, a thin
 * typed wrapper over the insert, and a raw-SQL query builder for use inside
 * a batched transaction. platform/'s own ~250-event taxonomy is entirely
 * product-specific (organizations, Brain, Agent Runtime, CRM, Sales OS,
 * Marketing OS, Communications, Analytics OS, Founder Workspace — none of
 * which exist here) and was not copied; this is a fresh, small taxonomy for
 * what BYOOT actually needs to audit so far.
 *
 * `vow_access_denied` exists specifically so a missing bona-fide-consumer
 * acknowledgment is auditable — BYOOT_TRANSFORMATION_PLAN.md Section C
 * treats the VOW gate as the highest-stakes compliance surface in this
 * codebase; every denial should be recorded, not just every grant.
 */
export type AuditEventType =
  | "sign_up"
  | "session_created"
  | "session_revoked"
  | "bona_fide_consumer_acknowledged"
  | "vow_access_denied"
  | "vow_access_granted"
  | "listing_synced"
  | "sync_failed";

export interface RecordAuditEventInput {
  eventType: AuditEventType;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** Never a token, session secret, or raw feed credential — same rule as platform/'s audit.ts. */
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAuditEvent(db: Db, input: RecordAuditEventInput): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId ?? null,
    eventType: input.eventType,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
}

/** For use inside a rawSql.transaction([...]) batch alongside the row writes it must succeed-or-fail together with. */
export function auditInsertQuery(rawSql: RawSql, input: RecordAuditEventInput) {
  const metadataJson = JSON.stringify(input.metadata ?? null);
  return rawSql`INSERT INTO audit_logs (id, actor_user_id, event_type, target_type, target_id, metadata, ip_address, user_agent)
                VALUES (${randomUUID()}, ${input.actorUserId ?? null}, ${input.eventType}, ${input.targetType ?? null}, ${input.targetId ?? null}, ${metadataJson}::jsonb, ${input.ipAddress ?? null}, ${input.userAgent ?? null})`;
}
