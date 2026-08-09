import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationConsentRecords, communicationSuppressions } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveCommunicationAuthContext, requireCommunicationsViewAuthority, requireCommunicationsManageConsentAuthority } from "./authz";
import { StaleCommunicationUpdateError } from "./errors";
import { normalizeIdentityForChannel } from "./identity";
import type { CommunicationChannel, CommunicationConsentStatus, CommunicationConsentSource, CommunicationSuppressionReason } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CommunicationConsentRecord {
  id: string;
  organizationId: string;
  channel: CommunicationChannel;
  normalizedIdentity: string;
  contactId: string | null;
  consentStatus: CommunicationConsentStatus;
  consentSource: CommunicationConsentSource | null;
  capturedAt: Date | null;
  revokedAt: Date | null;
  suppressionReason: CommunicationSuppressionReason | null;
  revision: number;
}

export interface CommunicationSuppression {
  id: string;
  organizationId: string;
  channel: CommunicationChannel;
  normalizedIdentity: string;
  suppressionReason: CommunicationSuppressionReason;
  source: string | null;
  suppressedAt: Date;
  liftedAt: Date | null;
}

/** Reads the current consent state for an identity — every identity that has never had a record starts, and remains, `unknown`. Never assumes opt-in from CRM existence. */
export async function getConsentStatus(db: Db, input: { organizationId: string; channel: CommunicationChannel; rawIdentity: string }): Promise<CommunicationConsentRecord | null> {
  const normalizedIdentity = normalizeIdentityForChannel(input.channel, input.rawIdentity);
  const [row] = await db
    .select()
    .from(communicationConsentRecords)
    .where(and(eq(communicationConsentRecords.organizationId, input.organizationId), eq(communicationConsentRecords.channel, input.channel), eq(communicationConsentRecords.normalizedIdentity, normalizedIdentity)));
  return (row as CommunicationConsentRecord) ?? null;
}

export async function upsertConsent(
  db: Db,
  input: { organizationId: string; channel: CommunicationChannel; rawIdentity: string; contactId?: string | null; consentStatus: CommunicationConsentStatus; consentSource: CommunicationConsentSource; actorUserId: string }
): Promise<CommunicationConsentRecord> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageConsentAuthority(db, ctx, "communication_consent_record", "new");

  const normalizedIdentity = normalizeIdentityForChannel(input.channel, input.rawIdentity);
  const now = new Date();

  const [row] = await db
    .insert(communicationConsentRecords)
    .values({
      organizationId: input.organizationId,
      channel: input.channel,
      normalizedIdentity,
      contactId: input.contactId ?? null,
      consentStatus: input.consentStatus,
      consentSource: input.consentSource,
      capturedAt: now,
      revokedAt: input.consentStatus === "opted_out" ? now : null,
    })
    .onConflictDoUpdate({
      target: [communicationConsentRecords.organizationId, communicationConsentRecords.channel, communicationConsentRecords.normalizedIdentity],
      set: {
        consentStatus: input.consentStatus,
        consentSource: input.consentSource,
        capturedAt: now,
        revokedAt: input.consentStatus === "opted_out" ? now : null,
        contactId: input.contactId ?? undefined,
        revision: sql`${communicationConsentRecords.revision} + 1`,
        updatedAt: now,
      },
    })
    .returning();

  await recordAuditEvent(db, { eventType: "communication_consent_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_consent_record", targetId: row.id, metadata: { channel: input.channel, consentStatus: input.consentStatus, consentSource: input.consentSource } });
  return row as CommunicationConsentRecord;
}

export async function suppressIdentity(
  db: Db,
  input: { organizationId: string; channel: CommunicationChannel; rawIdentity: string; suppressionReason: CommunicationSuppressionReason; source?: string; actorUserId: string | null }
): Promise<CommunicationSuppression> {
  const normalizedIdentity = normalizeIdentityForChannel(input.channel, input.rawIdentity);

  // A plain `onConflictDoNothing` cannot target this table's unique index —
  // it's PARTIAL (`WHERE lifted_at IS NULL`), and Postgres can only infer a
  // partial index as the ON CONFLICT arbiter when the insert's own ON
  // CONFLICT clause repeats that exact predicate, which drizzle's target-
  // only form doesn't express. A plain insert + catch is simpler and
  // exactly as safe: a unique-violation here always means an active
  // suppression already exists, so it's resolved and returned unchanged.
  let row: typeof communicationSuppressions.$inferSelect | undefined;
  try {
    [row] = await db
      .insert(communicationSuppressions)
      .values({ organizationId: input.organizationId, channel: input.channel, normalizedIdentity, suppressionReason: input.suppressionReason, source: input.source ?? null, createdByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (!isPostgresUniqueViolation(err)) throw err;
  }

  const result = row ?? (await getActiveSuppression(db, { organizationId: input.organizationId, channel: input.channel, rawIdentity: input.rawIdentity }));
  if (!result) throw new Error("suppression insert/lookup failed unexpectedly");

  await recordAuditEvent(db, { eventType: "communication_suppressed", actorUserId: input.actorUserId ?? undefined, organizationId: input.organizationId, targetType: "communication_suppression", targetId: result.id, metadata: { channel: input.channel, suppressionReason: input.suppressionReason } });
  return result as CommunicationSuppression;
}

export async function liftSuppression(db: Db, input: { organizationId: string; suppressionId: string; actorUserId: string }): Promise<CommunicationSuppression> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageConsentAuthority(db, ctx, "communication_suppression", input.suppressionId);

  const [row] = await db
    .update(communicationSuppressions)
    .set({ liftedAt: new Date(), liftedByUserId: input.actorUserId })
    .where(and(eq(communicationSuppressions.id, input.suppressionId), eq(communicationSuppressions.organizationId, input.organizationId), isNull(communicationSuppressions.liftedAt)))
    .returning();
  if (!row) throw new StaleCommunicationUpdateError("communication suppression");
  return row as CommunicationSuppression;
}

export async function getActiveSuppression(db: Db, input: { organizationId: string; channel: CommunicationChannel; rawIdentity: string }): Promise<CommunicationSuppression | null> {
  const normalizedIdentity = normalizeIdentityForChannel(input.channel, input.rawIdentity);
  const [row] = await db
    .select()
    .from(communicationSuppressions)
    .where(and(eq(communicationSuppressions.organizationId, input.organizationId), eq(communicationSuppressions.channel, input.channel), eq(communicationSuppressions.normalizedIdentity, normalizedIdentity), isNull(communicationSuppressions.liftedAt)));
  return (row as CommunicationSuppression) ?? null;
}

export async function listConsentRecordsForUser(db: Db, input: { organizationId: string; actorUserId: string }): Promise<CommunicationConsentRecord[]> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsViewAuthority(db, ctx, "communication_consent_record", "list");
  return db.select().from(communicationConsentRecords).where(eq(communicationConsentRecords.organizationId, input.organizationId)) as Promise<CommunicationConsentRecord[]>;
}

export async function listSuppressionsForUser(db: Db, input: { organizationId: string; actorUserId: string }): Promise<CommunicationSuppression[]> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsViewAuthority(db, ctx, "communication_suppression", "list");
  return db.select().from(communicationSuppressions).where(and(eq(communicationSuppressions.organizationId, input.organizationId), isNull(communicationSuppressions.liftedAt))) as Promise<CommunicationSuppression[]>;
}
