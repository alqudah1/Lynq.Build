import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import {
  jarvisCallSessions,
  jarvisCallTranscriptTurns,
  jarvisPhoneCommands,
  jarvisVoiceWebhookEvents,
  organizations,
  projects,
  users,
} from "@/db/schema";
import { requireOrganizationMembership, requireOrganizationRole } from "@/lib/authz/helpers";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { redactSensitiveText, phoneNumberLastFour } from "./redaction";
import type { CommandDraft } from "./command-draft";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Tenant-scoped persistence for the phone lane.
 *
 * Two invariants this file is responsible for:
 *
 * 1. **Nothing raw is stored.** Every string that came from speech passes
 *    through `redactSensitiveText` on the way in, and a caller's number is
 *    reduced to four digits plus a match flag before it is ever written.
 * 2. **Every write is idempotent under provider retry.** The provider may
 *    deliver the same event any number of times; each entry point here either
 *    claims the event exactly once (`claimWebhookEvent`) or relies on a real
 *    database unique constraint to make the second attempt a no-op.
 *
 * Reads that serve a browser go through `requireOrganizationMembership` like
 * every other tenant read in this codebase. Writes that come from the webhook
 * are authorized differently — see `resolvePhoneCommandActor`, which proves
 * the configured founder really is an owner/admin of the configured
 * organization before any row is written on their behalf.
 */

export type CallSessionStatus = "active" | "completed" | "failed" | "refused";
export type VerificationState = "unverified" | "verified" | "failed";
export type DispatchState =
  | "awaiting_confirmation"
  | "awaiting_approval"
  | "dispatching"
  | "declined"
  | "directive_created"
  | "cancelled"
  | "failed";

export interface JarvisCallSession {
  id: string;
  organizationId: string;
  founderUserId: string;
  direction: "inbound" | "outbound";
  purpose: "founder_notification" | "founder_command";
  provider: string;
  providerCallId: string;
  callerNumberLastFour: string | null;
  callerNumberMatched: boolean;
  status: CallSessionStatus;
  verificationState: VerificationState;
  verificationAttempts: number;
  verifiedAt: Date | null;
  deliveryStatus: string | null;
  endedReason: string | null;
  failureCode: string | null;
  startedAt: Date;
  lastEventAt: Date;
  endedAt: Date | null;
  redactedSummaryTranscript: string | null;
  revision: number;
}

function toSession(row: typeof jarvisCallSessions.$inferSelect): JarvisCallSession {
  return {
    id: row.id,
    organizationId: row.organizationId,
    founderUserId: row.founderUserId,
    direction: row.direction,
    purpose: row.purpose,
    provider: row.provider,
    providerCallId: row.providerCallId,
    callerNumberLastFour: row.callerNumberLastFour,
    callerNumberMatched: row.callerNumberMatched,
    status: row.status,
    verificationState: row.verificationState,
    verificationAttempts: row.verificationAttempts,
    verifiedAt: row.verifiedAt,
    deliveryStatus: row.deliveryStatus,
    endedReason: row.endedReason,
    failureCode: row.failureCode,
    startedAt: row.startedAt,
    lastEventAt: row.lastEventAt,
    endedAt: row.endedAt,
    redactedSummaryTranscript: row.redactedSummaryTranscript,
    revision: row.revision,
  };
}

// ---------------------------------------------------------------------------
// Actor resolution — the webhook has no session cookie, so authorization is
// proved against real membership rather than assumed from configuration.
// ---------------------------------------------------------------------------

export class PhoneCommandActorUnavailableError extends Error {
  constructor(public readonly reason: "organization_not_found" | "founder_not_a_member" | "insufficient_role") {
    super(`Jarvis phone command actor is unavailable: ${reason}`);
    this.name = "PhoneCommandActorUnavailableError";
  }
}

/**
 * Confirms the configured founder account really is an owner or admin of the
 * configured organization, right now, before anything is written as them.
 *
 * This is the phone lane's substitute for a session cookie, and it is
 * deliberately re-checked on every call rather than cached: if Mustafa's
 * membership is downgraded or removed, inbound phone commands stop working on
 * the very next call without a deploy.
 */
export async function resolvePhoneCommandActor(
  db: Db,
  input: { organizationId: string; founderUserId: string }
): Promise<{ organizationId: string; founderUserId: string; organizationSlug: string; founderName: string | null }> {
  const [organization] = await db
    .select({ id: organizations.id, slug: organizations.slug })
    .from(organizations)
    .where(and(eq(organizations.id, input.organizationId), sql`${organizations.deletedAt} IS NULL`));
  if (!organization) throw new PhoneCommandActorUnavailableError("organization_not_found");

  let membership;
  try {
    membership = await requireOrganizationMembership(db, input.organizationId, input.founderUserId);
  } catch {
    throw new PhoneCommandActorUnavailableError("founder_not_a_member");
  }

  try {
    // The same floor `requireApproverAuthority` applies to an Office approval:
    // a phone command may only ever act as an org owner or admin.
    requireOrganizationRole(membership, ["owner", "admin"]);
  } catch {
    throw new PhoneCommandActorUnavailableError("insufficient_role");
  }

  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, input.founderUserId));
  return { organizationId: organization.id, founderUserId: input.founderUserId, organizationSlug: organization.slug, founderName: user?.name ?? null };
}

// ---------------------------------------------------------------------------
// Webhook event idempotency
// ---------------------------------------------------------------------------

export type WebhookClaim = { claimed: true } | { claimed: false; reason: "duplicate" };

/**
 * Claims one provider event exactly once, by inserting its derived id against
 * a real unique index. A duplicate delivery loses the race at the database,
 * not in application logic, so two concurrent retries cannot both proceed.
 *
 * Modelled on `communication_provider_events` — the precedent this codebase
 * already set for provider-webhook deduplication.
 */
export async function claimWebhookEvent(
  db: Db,
  input: {
    organizationId: string | null;
    externalEventId: string;
    eventType: string;
    providerCallId: string | null;
    callSessionId?: string | null;
    processingStatus: "processed" | "ignored" | "failed";
    failureCode?: string | null;
    provider?: string;
  }
): Promise<WebhookClaim> {
  try {
    await db.insert(jarvisVoiceWebhookEvents).values({
      organizationId: input.organizationId,
      provider: input.provider ?? "vapi",
      externalEventId: input.externalEventId,
      eventType: input.eventType,
      providerCallId: input.providerCallId,
      callSessionId: input.callSessionId ?? null,
      processingStatus: input.processingStatus,
      failureCode: input.failureCode ?? null,
    });
    return { claimed: true };
  } catch (err) {
    if (isPostgresUniqueViolation(err)) return { claimed: false, reason: "duplicate" };
    throw err;
  }
}

/**
 * Records what an already-claimed event actually did — the resolved session,
 * and the real processing outcome. The claim is written before the handler
 * runs (so a retry cannot re-run it), which means the row would otherwise say
 * `processed` for every event including refusals and failures.
 */
export async function recordWebhookEventOutcome(
  db: Db,
  input: {
    externalEventId: string;
    callSessionId?: string | null;
    organizationId: string;
    processingStatus?: "processed" | "ignored" | "failed";
    failureCode?: string | null;
    provider?: string;
  }
): Promise<void> {
  await db
    .update(jarvisVoiceWebhookEvents)
    .set({
      ...(input.callSessionId ? { callSessionId: input.callSessionId } : {}),
      organizationId: input.organizationId,
      ...(input.processingStatus ? { processingStatus: input.processingStatus } : {}),
      ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
    })
    .where(
      and(
        eq(jarvisVoiceWebhookEvents.provider, input.provider ?? "vapi"),
        eq(jarvisVoiceWebhookEvents.externalEventId, input.externalEventId)
      )
    );
}

// ---------------------------------------------------------------------------
// Call sessions
// ---------------------------------------------------------------------------

export interface EnsureCallSessionInput {
  organizationId: string;
  founderUserId: string;
  providerCallId: string;
  direction: "inbound" | "outbound";
  purpose: "founder_notification" | "founder_command";
  callerNumber?: string | null;
  callerNumberMatched: boolean;
  provider?: string;
}

/**
 * Resolves the session for a provider call id, creating it on first sight.
 * Idempotent under concurrency: two simultaneous first events race on
 * `jarvis_call_sessions_provider_call_unique` and the loser re-reads the
 * winner's row rather than creating a second session.
 */
export async function ensureCallSession(db: Db, input: EnsureCallSessionInput): Promise<JarvisCallSession> {
  const provider = input.provider ?? "vapi";
  const existing = await findCallSessionByProviderCallId(db, provider, input.providerCallId);
  if (existing) return existing;

  try {
    const [row] = await db
      .insert(jarvisCallSessions)
      .values({
        organizationId: input.organizationId,
        founderUserId: input.founderUserId,
        direction: input.direction,
        purpose: input.purpose,
        provider,
        providerCallId: input.providerCallId,
        callerNumberLastFour: phoneNumberLastFour(input.callerNumber),
        callerNumberMatched: input.callerNumberMatched,
      })
      .returning();

    await recordAuditEvent(db, {
      eventType: "jarvis_phone_call_started",
      organizationId: input.organizationId,
      actorUserId: input.founderUserId,
      targetType: "jarvis_call_session",
      targetId: row.id,
      // Ids, enums and booleans only — never the caller's number, never speech.
      metadata: { direction: input.direction, purpose: input.purpose, provider, callerNumberMatched: input.callerNumberMatched },
    });

    return toSession(row);
  } catch (err) {
    if (isPostgresUniqueViolation(err)) {
      const row = await findCallSessionByProviderCallId(db, provider, input.providerCallId);
      if (row) return row;
    }
    throw err;
  }
}

export async function findCallSessionByProviderCallId(db: Db, provider: string, providerCallId: string): Promise<JarvisCallSession | null> {
  const [row] = await db
    .select()
    .from(jarvisCallSessions)
    .where(and(eq(jarvisCallSessions.provider, provider), eq(jarvisCallSessions.providerCallId, providerCallId)));
  return row ? toSession(row) : null;
}

export async function touchCallSession(db: Db, input: { sessionId: string; organizationId: string; deliveryStatus?: string | null }): Promise<void> {
  await db
    .update(jarvisCallSessions)
    .set({
      lastEventAt: new Date(),
      updatedAt: new Date(),
      ...(input.deliveryStatus !== undefined ? { deliveryStatus: input.deliveryStatus } : {}),
    })
    .where(and(eq(jarvisCallSessions.id, input.sessionId), eq(jarvisCallSessions.organizationId, input.organizationId)));
}

/**
 * Records one verification attempt.
 *
 * `attempts` is incremented in SQL rather than read-modify-written, AND the
 * WHERE clause carries the cap and the current state, so the guard does not
 * depend on the caller's snapshot. Two things were wrong without that:
 *
 *  - The cap was enforced only in `verifyFounderPasscode`, against a count read
 *    earlier in the request. Concurrent `verify_founder` deliveries all read
 *    the same prior count and all got a full comparison; the increment was
 *    atomic, but nothing stopped the attempts themselves.
 *  - `verificationState` and `verifiedAt` were written with no precondition at
 *    all, so a failing attempt landing after a successful one set the session
 *    back to `unverified` and nulled `verifiedAt`, revoking a completed
 *    verification. It was the only write on a security-relevant column in this
 *    file with no guard, while its sibling counter had deliberately been made
 *    atomic.
 *
 * Returns null when the guard refuses the write, which the caller treats as an
 * attempt that did not happen.
 */
export async function recordVerificationAttempt(
  db: Db,
  input: { sessionId: string; organizationId: string; verified: boolean; exhausted: boolean; maxAttempts: number }
): Promise<JarvisCallSession | null> {
  const [row] = await db
    .update(jarvisCallSessions)
    .set({
      verificationAttempts: sql`${jarvisCallSessions.verificationAttempts} + 1`,
      verificationState: input.verified ? "verified" : input.exhausted ? "failed" : "unverified",
      verifiedAt: input.verified ? new Date() : null,
      status: input.exhausted && !input.verified ? "refused" : undefined,
      lastEventAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jarvisCallSessions.id, input.sessionId),
        eq(jarvisCallSessions.organizationId, input.organizationId),
        // A verified session is never walked back, and one that has spent its
        // attempts never gets another.
        eq(jarvisCallSessions.verificationState, "unverified"),
        lt(jarvisCallSessions.verificationAttempts, input.maxAttempts)
      )
    )
    .returning();

  if (row) {
    await recordAuditEvent(db, {
      eventType: input.verified ? "jarvis_phone_founder_verified" : "jarvis_phone_verification_failed",
      organizationId: input.organizationId,
      actorUserId: row.founderUserId,
      targetType: "jarvis_call_session",
      targetId: row.id,
      metadata: { attempts: row.verificationAttempts, exhausted: input.exhausted },
    });
  }
  return row ? toSession(row) : null;
}

export async function markCallSessionRefused(
  db: Db,
  input: { sessionId: string; organizationId: string; failureCode: string }
): Promise<void> {
  await db
    .update(jarvisCallSessions)
    .set({ status: "refused", failureCode: input.failureCode, lastEventAt: new Date(), endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(jarvisCallSessions.id, input.sessionId), eq(jarvisCallSessions.organizationId, input.organizationId)));
}

export async function completeCallSession(
  db: Db,
  input: { sessionId: string; organizationId: string; endedReason: string | null; summaryTranscript: string | null; failureCode?: string | null }
): Promise<void> {
  const summary = input.summaryTranscript ? redactSensitiveText(input.summaryTranscript).text.slice(0, 20_000) : null;
  await db
    .update(jarvisCallSessions)
    .set({
      status: input.failureCode ? "failed" : "completed",
      // Never overwrite a value already recorded with an empty one. A call ends
      // with up to three provider deliveries and only one of them carries the
      // transcript, so whichever arrives last must not wipe what an earlier one
      // wrote.
      ...(input.endedReason ? { endedReason: input.endedReason } : {}),
      failureCode: input.failureCode ?? null,
      ...(summary ? { redactedSummaryTranscript: summary } : {}),
      deliveryStatus: "ended",
      endedAt: new Date(),
      lastEventAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(jarvisCallSessions.id, input.sessionId), eq(jarvisCallSessions.organizationId, input.organizationId)));

  await recordAuditEvent(db, {
    eventType: "jarvis_phone_call_ended",
    organizationId: input.organizationId,
    targetType: "jarvis_call_session",
    targetId: input.sessionId,
    metadata: { endedReason: input.endedReason, failed: Boolean(input.failureCode) },
  });
}

// ---------------------------------------------------------------------------
// Transcript turns
// ---------------------------------------------------------------------------

export interface TranscriptTurn {
  id: string;
  sequence: number;
  role: "founder" | "jarvis";
  isFinal: boolean;
  redactedText: string;
  redactedKinds: string[];
  spokenAt: Date;
}

/** How many times a transcript insert retries a sequence collision before giving up. */
const TRANSCRIPT_SEQUENCE_ATTEMPTS = 4;

/**
 * Appends one redacted turn.
 *
 * The sequence comes from `max(sequence) + 1` computed inside the INSERT
 * itself, so it is read and written in one statement rather than in two.
 * Vapi streams partial transcripts rapidly and Vercel handles them in
 * parallel, so a read-then-insert would let two DIFFERENT turns pick the same
 * sequence — and the unique constraint would then silently discard a real turn
 * as if it were a duplicate. Two genuinely concurrent inserts can still race
 * at commit time, so a collision is retried rather than swallowed; only after
 * every attempt fails is the turn reported as dropped, and that is logged.
 *
 * Duplicate SUPPRESSION is not this function's job — the webhook's event claim
 * already handles redelivery. This function's job is not to lose anything.
 */
export async function appendTranscriptTurn(
  db: Db,
  input: { sessionId: string; organizationId: string; role: "founder" | "jarvis"; text: string; isFinal: boolean }
): Promise<TranscriptTurn | null> {
  // Bound the input before redacting: the redaction rules run over the whole
  // string, and the provider's declared body limit is 1 MB. The cap is above
  // any real spoken turn.
  const redacted = redactSensitiveText(input.text.slice(0, 8000));
  if (!redacted.text) return null;

  for (let attempt = 0; attempt < TRANSCRIPT_SEQUENCE_ATTEMPTS; attempt += 1) {
    try {
      const [row] = await db
        .insert(jarvisCallTranscriptTurns)
        .values({
          organizationId: input.organizationId,
          callSessionId: input.sessionId,
          sequence: sql<number>`(SELECT COALESCE(MAX(${jarvisCallTranscriptTurns.sequence}) + 1, 0) FROM ${jarvisCallTranscriptTurns} WHERE ${jarvisCallTranscriptTurns.callSessionId} = ${input.sessionId})`,
          role: input.role,
          isFinal: input.isFinal,
          redactedText: redacted.text.slice(0, 8000),
          redactedKinds: redacted.redactedKinds,
        })
        .returning();
      return {
        id: row.id,
        sequence: row.sequence,
        role: row.role,
        isFinal: row.isFinal,
        redactedText: row.redactedText,
        redactedKinds: (row.redactedKinds as string[]) ?? [],
        spokenAt: row.spokenAt,
      };
    } catch (err) {
      if (!isPostgresUniqueViolation(err)) throw err;
      // Another insert took this sequence between our subquery and our commit.
      // Try again with a freshly computed one.
    }
  }

  // Honest about the loss rather than silently returning null: a missing turn
  // is a gap in the record the founder is shown.
  console.warn("[jarvis-phone]", JSON.stringify({ event: "transcript-turn-dropped", reason: "sequence_contention", attempts: TRANSCRIPT_SEQUENCE_ATTEMPTS }));
  return null;
}

export async function listTranscriptTurns(db: Db, input: { sessionId: string; organizationId: string }): Promise<TranscriptTurn[]> {
  const rows = await db
    .select()
    .from(jarvisCallTranscriptTurns)
    .where(and(eq(jarvisCallTranscriptTurns.callSessionId, input.sessionId), eq(jarvisCallTranscriptTurns.organizationId, input.organizationId)))
    .orderBy(jarvisCallTranscriptTurns.sequence);

  return rows.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    role: row.role,
    isFinal: row.isFinal,
    redactedText: row.redactedText,
    redactedKinds: (row.redactedKinds as string[]) ?? [],
    spokenAt: row.spokenAt,
  }));
}

// ---------------------------------------------------------------------------
// Command drafts
// ---------------------------------------------------------------------------

export interface JarvisPhoneCommand {
  id: string;
  organizationId: string;
  callSessionId: string;
  requestedOutcome: string;
  targetName: string | null;
  constraints: string[];
  requiredIntegrations: string[];
  proposedSteps: string[];
  missingInformation: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  gatedCategories: string[];
  riskReasons: string[];
  overrideAttempted: boolean;
  readbackText: string;
  confirmationStatus: "pending" | "confirmed" | "declined" | "expired";
  confirmedAt: Date | null;
  dispatchState: DispatchState;
  approvalDecidedByUserId: string | null;
  approvalDecidedAt: Date | null;
  approvalDecisionNote: string | null;
  projectId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  dispatchAttempts: number;
  dispatchStartedAt: Date | null;
  idempotencyKey: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

function toCommand(row: typeof jarvisPhoneCommands.$inferSelect): JarvisPhoneCommand {
  return {
    id: row.id,
    organizationId: row.organizationId,
    callSessionId: row.callSessionId,
    requestedOutcome: row.requestedOutcome,
    targetName: row.targetName,
    constraints: (row.constraints as string[]) ?? [],
    requiredIntegrations: (row.requiredIntegrations as string[]) ?? [],
    proposedSteps: (row.proposedSteps as string[]) ?? [],
    missingInformation: (row.missingInformation as string[]) ?? [],
    riskLevel: row.riskLevel,
    requiresApproval: row.requiresApproval,
    gatedCategories: (row.gatedCategories as string[]) ?? [],
    riskReasons: (row.riskReasons as string[]) ?? [],
    overrideAttempted: row.overrideAttempted,
    readbackText: row.readbackText,
    confirmationStatus: row.confirmationStatus,
    confirmedAt: row.confirmedAt,
    dispatchState: row.dispatchState,
    approvalDecidedByUserId: row.approvalDecidedByUserId,
    approvalDecidedAt: row.approvalDecidedAt,
    approvalDecisionNote: row.approvalDecisionNote,
    projectId: row.projectId,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    dispatchAttempts: row.dispatchAttempts,
    dispatchStartedAt: row.dispatchStartedAt,
    idempotencyKey: row.idempotencyKey,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The key that keeps one draft row unique per (call, content, attempt).
 *
 * `attempt` matters and is not decoration. Without it, a founder who describes
 * work, says NO to the read-back, and then describes the SAME work again on
 * the same call would hash to the key the cancelled row already holds — and
 * the unique constraint would turn an ordinary correction into a hard error,
 * on exactly the flow the decline reply invites ("tell me again and I'll get
 * it right"). With it, each successive draft on a call gets its own key while
 * a redelivered capture of the same attempt still collides, as intended.
 *
 * Confirmation idempotency does not depend on this key at all: that is the
 * revision guard in `transitionCommand`, which is what actually prevents a
 * second project.
 */
export function deriveCommandIdempotencyKey(input: { callSessionId: string; draft: CommandDraft; attempt?: number }): string {
  return createHash("sha256")
    .update(
      [
        input.callSessionId,
        String(input.attempt ?? 0),
        input.draft.requestedOutcome,
        input.draft.target ?? "",
        input.draft.constraints.join("|"),
        input.draft.proposedSteps.join("|"),
      ].join("\u0000")
    )
    .digest("hex");
}

/**
 * Creates or updates the open draft for a call. A call has at most one draft
 * in `awaiting_confirmation`; capturing again before confirming revises that
 * draft in place rather than accumulating half-finished commands.
 */
export async function upsertCommandDraft(
  db: Db,
  input: { organizationId: string; callSessionId: string; founderUserId: string; draft: CommandDraft }
): Promise<JarvisPhoneCommand> {
  const values = {
    requestedOutcome: input.draft.requestedOutcome,
    targetName: input.draft.target,
    constraints: input.draft.constraints,
    requiredIntegrations: input.draft.requiredIntegrations,
    proposedSteps: input.draft.proposedSteps,
    missingInformation: input.draft.missingInformation,
    riskLevel: input.draft.riskLevel,
    requiresApproval: input.draft.requiresApproval,
    gatedCategories: input.draft.gatedCategories,
    riskReasons: input.draft.riskReasons,
    overrideAttempted: input.draft.overrideAttempted,
    readbackText: input.draft.readback,
  };

  const open = await findOpenCommandForSession(db, { organizationId: input.organizationId, callSessionId: input.callSessionId });
  if (open) {
    const [row] = await db
      .update(jarvisPhoneCommands)
      // The stored key is deliberately left alone: the row already exists and
      // is already unique, and rewriting the key on every revision would let a
      // later attempt collide with an earlier cancelled one.
      .set({ ...values, revision: open.revision + 1, updatedAt: new Date() })
      .where(
        and(
          eq(jarvisPhoneCommands.id, open.id),
          eq(jarvisPhoneCommands.organizationId, input.organizationId),
          eq(jarvisPhoneCommands.revision, open.revision),
          eq(jarvisPhoneCommands.dispatchState, "awaiting_confirmation")
        )
      )
      .returning();
    if (row) {
      await recordAuditEvent(db, {
        eventType: "jarvis_phone_command_captured",
        organizationId: input.organizationId,
        actorUserId: input.founderUserId,
        targetType: "jarvis_phone_command",
        targetId: row.id,
        metadata: { riskLevel: row.riskLevel, requiresApproval: row.requiresApproval, revised: true, overrideAttempted: row.overrideAttempted },
      });
      return toCommand(row);
    }
    // Lost an optimistic-concurrency race; the winner's row is authoritative.
    const current = await findOpenCommandForSession(db, { organizationId: input.organizationId, callSessionId: input.callSessionId });
    if (current) return current;
  }

  // The attempt ordinal is how many drafts this call has already produced, so
  // a fresh description after a decline never reuses a cancelled row's key.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jarvisPhoneCommands)
    .where(and(eq(jarvisPhoneCommands.organizationId, input.organizationId), eq(jarvisPhoneCommands.callSessionId, input.callSessionId)));

  let row;
  try {
    [row] = await db
      .insert(jarvisPhoneCommands)
      .values({
        organizationId: input.organizationId,
        callSessionId: input.callSessionId,
        idempotencyKey: deriveCommandIdempotencyKey({ callSessionId: input.callSessionId, draft: input.draft, attempt: Number(count) }),
        ...values,
      })
      .returning();
  } catch (err) {
    if (!isPostgresUniqueViolation(err)) throw err;
    // A concurrent capture won the race, on either the idempotency key or the
    // one-open-draft-per-call index. Its row is authoritative — return it
    // rather than failing the call over a duplicate the founder never saw.
    const current = await findOpenCommandForSession(db, { organizationId: input.organizationId, callSessionId: input.callSessionId });
    if (current) return current;
    throw err;
  }

  await recordAuditEvent(db, {
    eventType: "jarvis_phone_command_captured",
    organizationId: input.organizationId,
    actorUserId: input.founderUserId,
    targetType: "jarvis_phone_command",
    targetId: row.id,
    metadata: { riskLevel: row.riskLevel, requiresApproval: row.requiresApproval, revised: false, overrideAttempted: row.overrideAttempted },
  });
  return toCommand(row);
}

/** The most recent command on a call, whatever state it is in — used to answer honestly when a repeat confirmation arrives after one was already dispatched. */
export async function findLatestCommandForSession(
  db: Db,
  input: { organizationId: string; callSessionId: string }
): Promise<JarvisPhoneCommand | null> {
  const [row] = await db
    .select()
    .from(jarvisPhoneCommands)
    .where(and(eq(jarvisPhoneCommands.organizationId, input.organizationId), eq(jarvisPhoneCommands.callSessionId, input.callSessionId)))
    .orderBy(desc(jarvisPhoneCommands.createdAt))
    .limit(1);
  return row ? toCommand(row) : null;
}

export async function findOpenCommandForSession(
  db: Db,
  input: { organizationId: string; callSessionId: string }
): Promise<JarvisPhoneCommand | null> {
  const [row] = await db
    .select()
    .from(jarvisPhoneCommands)
    .where(
      and(
        eq(jarvisPhoneCommands.organizationId, input.organizationId),
        eq(jarvisPhoneCommands.callSessionId, input.callSessionId),
        eq(jarvisPhoneCommands.dispatchState, "awaiting_confirmation")
      )
    )
    .orderBy(desc(jarvisPhoneCommands.createdAt));
  return row ? toCommand(row) : null;
}

export async function resolveCommandById(db: Db, input: { organizationId: string; commandId: string }): Promise<JarvisPhoneCommand> {
  const [row] = await db
    .select()
    .from(jarvisPhoneCommands)
    .where(and(eq(jarvisPhoneCommands.id, input.commandId), eq(jarvisPhoneCommands.organizationId, input.organizationId)));
  if (!row) throw new TenantResourceNotFoundError();
  return toCommand(row);
}

/**
 * Claims the exclusive right to dispatch this command, BEFORE any project is
 * created.
 *
 * This exists because "check the attempt count, then dispatch, then record the
 * attempt" is a time-of-check/time-of-use race with real-world consequences.
 * Two concurrent confirmations — or two admins pressing Try again, or one
 * admin double-clicking — would both read the same `dispatchAttempts` and
 * `revision`, both pass the cap check, and both call `createDirectiveProject`.
 * Two real projects, two task sets, two launched agent executions; only one of
 * them ever gets linked to the command, and for an approved gated command the
 * external effect runs twice off a single approval.
 *
 * So the claim IS the guard: a single UPDATE that moves the row into
 * `dispatching`, increments the attempt and bumps the revision, conditional on
 * the revision the caller read, the attempt cap, AND the state it is leaving.
 *
 * The state change is the load-bearing half. A guarded increment alone only
 * stops two callers holding the SAME revision — a request arriving while the
 * winner is still inside `createDirectiveProject` (an LLM plan plus a long
 * chain of writes; `maxDuration` is five minutes) would re-read the bumped
 * revision, find a still-dispatchable state, and claim again. Two projects,
 * two sets of running agents, off one approval. Moving the row to
 * `dispatching` leaves a later reader nothing to claim.
 *
 * `staleAfterMs` is the counterweight: a process that dies between the claim
 * and the outcome would otherwise wedge the command in `dispatching` forever,
 * so a provably stale lease can be taken over.
 */
export async function claimDispatchAttempt(
  db: Db,
  input: {
    organizationId: string;
    commandId: string;
    expectedRevision: number;
    maxAttempts: number;
    /** The states a dispatch may legitimately start from. Anything else is not claimable. */
    fromStates: DispatchState[];
    /** How long an in-flight claim is trusted before it may be taken over. */
    staleAfterMs: number;
  }
): Promise<JarvisPhoneCommand | null> {
  const staleBefore = new Date(Date.now() - input.staleAfterMs);
  const [row] = await db
    .update(jarvisPhoneCommands)
    .set({
      dispatchState: "dispatching",
      dispatchStartedAt: new Date(),
      dispatchAttempts: sql`${jarvisPhoneCommands.dispatchAttempts} + 1`,
      revision: input.expectedRevision + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jarvisPhoneCommands.id, input.commandId),
        eq(jarvisPhoneCommands.organizationId, input.organizationId),
        eq(jarvisPhoneCommands.revision, input.expectedRevision),
        lt(jarvisPhoneCommands.dispatchAttempts, input.maxAttempts),
        or(
          inArray(jarvisPhoneCommands.dispatchState, input.fromStates),
          // A lease nobody finished. Taking it over is safe precisely because
          // the previous holder can no longer transition it: its revision is
          // stale the moment this UPDATE lands.
          and(eq(jarvisPhoneCommands.dispatchState, "dispatching"), lt(jarvisPhoneCommands.dispatchStartedAt, staleBefore))
        )
      )
    )
    .returning();
  return row ? toCommand(row) : null;
}

/** True when a command is mid-dispatch and its lease is still within the trusted window. */
export function isDispatchInFlight(command: JarvisPhoneCommand, staleAfterMs: number, nowMs = Date.now()): boolean {
  if (command.dispatchState !== "dispatching") return false;
  if (!command.dispatchStartedAt) return true;
  return nowMs - command.dispatchStartedAt.getTime() < staleAfterMs;
}

/**
 * Drops the claim on an event whose handler failed, so the provider's own
 * retry can run it again.
 *
 * Only ever used for handlers that are safe to repeat. A side-effecting event
 * keeps its claim instead — see the webhook route, which decides.
 */
export async function releaseWebhookEventClaim(
  db: Db,
  input: { externalEventId: string; provider?: string }
): Promise<void> {
  await db
    .delete(jarvisVoiceWebhookEvents)
    .where(
      and(
        eq(jarvisVoiceWebhookEvents.provider, input.provider ?? "vapi"),
        eq(jarvisVoiceWebhookEvents.externalEventId, input.externalEventId)
      )
    );
}

/**
 * Records the project a dispatch just created, immediately.
 *
 * Deliberately NOT revision-guarded and deliberately not a state change: its
 * only job is to make the fact "a project now exists for this command"
 * durable before the long handoff that follows. A guard here would be actively
 * harmful — losing this write is exactly the case that lets a later retry
 * duplicate live work.
 */
export async function recordDispatchProject(
  db: Db,
  input: { organizationId: string; commandId: string; projectId: string }
): Promise<void> {
  await db
    .update(jarvisPhoneCommands)
    .set({ projectId: input.projectId, updatedAt: new Date() })
    .where(and(eq(jarvisPhoneCommands.id, input.commandId), eq(jarvisPhoneCommands.organizationId, input.organizationId)));
}

/**
 * Moves a claimed command to its next honest state, guarded by the revision
 * it was read at. A second delivery of the same confirmation loses the guard
 * and returns null, so the caller reports the existing outcome instead of
 * creating a second project.
 */
/**
 * Records WHO approved a gated command, and is the decide-once guard for
 * approval.
 *
 * Deliberately not `transitionCommand` with a revision. Approval leaves the
 * command in `awaiting_approval` — the dispatch claim is what moves it — so a
 * revision guard alone is defeated by an ordinary re-read: two admins pressing
 * approve at the same moment both find `awaiting_approval`, the second reads
 * the first's bumped revision, and its guarded write then SUCCEEDS, silently
 * replacing the recorded approver and writing a second decision to the audit
 * trail. This is the same shape of mistake as guarding a claim on revision
 * alone, which this lane has already made once.
 *
 * So the guard is on the facts instead: the command must still be awaiting
 * approval, and no approver may be recorded yet. That holds no matter what
 * revision the caller read, or when.
 *
 * Returns null when another decision got there first.
 */
export async function claimApprovalDecision(
  db: Db,
  input: {
    organizationId: string;
    commandId: string;
    approverUserId: string;
    decisionNote: string | null;
    /** Set for a decline, which is terminal. Omitted for an approval, which leaves the dispatch claim to move the row. */
    dispatchState?: DispatchState;
  }
): Promise<JarvisPhoneCommand | null> {
  const [row] = await db
    .update(jarvisPhoneCommands)
    .set({
      approvalDecidedByUserId: input.approverUserId,
      approvalDecidedAt: new Date(),
      approvalDecisionNote: input.decisionNote,
      ...(input.dispatchState ? { dispatchState: input.dispatchState } : {}),
      revision: sql`${jarvisPhoneCommands.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jarvisPhoneCommands.id, input.commandId),
        eq(jarvisPhoneCommands.organizationId, input.organizationId),
        eq(jarvisPhoneCommands.dispatchState, "awaiting_approval"),
        isNull(jarvisPhoneCommands.approvalDecidedByUserId)
      )
    )
    .returning();
  return row ? toCommand(row) : null;
}

export async function transitionCommand(
  db: Db,
  input: {
    organizationId: string;
    commandId: string;
    expectedRevision: number;
    confirmationStatus?: JarvisPhoneCommand["confirmationStatus"];
    dispatchState: DispatchState;
    projectId?: string | null;
    failureCode?: string | null;
    failureMessage?: string | null;
    approvalDecidedByUserId?: string | null;
    approvalDecisionNote?: string | null;
  }
): Promise<JarvisPhoneCommand | null> {
  const confirming = input.confirmationStatus === "confirmed";
  const decided = input.approvalDecidedByUserId !== undefined && input.approvalDecidedByUserId !== null;
  const [row] = await db
    .update(jarvisPhoneCommands)
    .set({
      ...(input.confirmationStatus ? { confirmationStatus: input.confirmationStatus } : {}),
      ...(confirming ? { confirmedAt: new Date() } : {}),
      dispatchState: input.dispatchState,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
      ...(input.failureMessage !== undefined ? { failureMessage: input.failureMessage } : {}),
      ...(input.approvalDecidedByUserId !== undefined ? { approvalDecidedByUserId: input.approvalDecidedByUserId } : {}),
      ...(decided ? { approvalDecidedAt: new Date() } : {}),
      ...(input.approvalDecisionNote !== undefined ? { approvalDecisionNote: input.approvalDecisionNote } : {}),
      revision: input.expectedRevision + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jarvisPhoneCommands.id, input.commandId),
        eq(jarvisPhoneCommands.organizationId, input.organizationId),
        eq(jarvisPhoneCommands.revision, input.expectedRevision)
      )
    )
    .returning();

  return row ? toCommand(row) : null;
}

// ---------------------------------------------------------------------------
// Browser-facing reads — full tenant authorization, no exceptions
// ---------------------------------------------------------------------------

export interface JarvisPhoneCallView {
  session: JarvisCallSession;
  turns: TranscriptTurn[];
  commands: Array<JarvisPhoneCommand & { projectName: string | null; projectKey: string | null }>;
}

/**
 * "What Mustafa said, what Jarvis understood, what Jarvis proposes, what
 * requires approval, whether work started" — the whole Jarvis phone screen in
 * one permission-checked read.
 */
export async function listPhoneCallsForUser(
  db: Db,
  input: { organizationId: string; actorUserId: string; limit?: number }
): Promise<JarvisPhoneCallView[]> {
  await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const sessions = await db
    .select()
    .from(jarvisCallSessions)
    .where(and(eq(jarvisCallSessions.organizationId, input.organizationId), eq(jarvisCallSessions.purpose, "founder_command")))
    .orderBy(desc(jarvisCallSessions.startedAt))
    .limit(Math.min(input.limit ?? 10, 50));

  if (sessions.length === 0) return [];

  const views: JarvisPhoneCallView[] = [];
  for (const sessionRow of sessions) {
    const session = toSession(sessionRow);
    const [turns, commandRows] = await Promise.all([
      listTranscriptTurns(db, { sessionId: session.id, organizationId: input.organizationId }),
      db
        .select({ command: jarvisPhoneCommands, projectName: projects.name, projectKey: projects.projectKey })
        .from(jarvisPhoneCommands)
        .leftJoin(projects, and(eq(projects.id, jarvisPhoneCommands.projectId), eq(projects.organizationId, input.organizationId)))
        .where(and(eq(jarvisPhoneCommands.organizationId, input.organizationId), eq(jarvisPhoneCommands.callSessionId, session.id)))
        .orderBy(desc(jarvisPhoneCommands.createdAt)),
    ]);

    views.push({
      session,
      turns,
      commands: commandRows.map((row) => ({ ...toCommand(row.command), projectName: row.projectName ?? null, projectKey: row.projectKey ?? null })),
    });
  }
  return views;
}
