import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationBulkBatches, communicationBulkRecipients, crmContacts } from "@/db/schema";
import { TenantResourceNotFoundError, DomainRuleViolationError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveCommunicationAuthContext, requireCommunicationsManageBulkAuthority } from "./authz";
import { StaleCommunicationUpdateError, DuplicateActiveBulkBatchError, BulkBatchRecipientLimitExceededError } from "./errors";
import { resolvePublishedTemplateVersion, renderTemplate } from "./templates";
import { findOrCreateConversation } from "./conversations";
import { resolveConnectionById, requireConnectionUsable } from "./connections";
import { createDraftMessage } from "./messages";
import { getActiveSuppression, getConsentStatus } from "./consent";
import { requestBulkBatchApproval } from "./agents";
import { approveRequest, rejectRequest } from "@/lib/agent-runtime/approvals";
import { providerTemplateDirectiveSchema } from "./validation";
import type { CommunicationChannel } from "./validation";
import type { ProviderTemplateDirective } from "./providers/types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CommunicationBulkBatch {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  channel: CommunicationChannel;
  campaignId: string | null;
  audienceId: string | null;
  templateVersionId: string;
  status: "draft" | "pending_approval" | "approved" | "queued" | "in_progress" | "paused" | "completed" | "cancelled" | "failed";
  approvalRequestId: string | null;
  recipientSnapshotCount: number;
  maxRecipients: number;
  createdByUserId: string | null;
  revision: number;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

/**
 * ============================================================================
 * Bulk send foundation — Module 16
 * ============================================================================
 * Bounded, conservative batches — never a high-volume ESP. Recipients are
 * a STABLE SNAPSHOT taken once at creation time (via the audience's own
 * `evaluateAudience`), not re-evaluated live at send time — so a batch's
 * membership is reproducible and auditable. One canonical
 * `communication_bulk_recipients` row per (batch, recipient) — duplicates
 * within the same batch are structurally impossible (a unique index), and
 * every recipient is individually consent/suppression-checked before its
 * own message is ever drafted.
 */
export async function createBulkBatch(
  db: Db,
  input: { organizationId: string; workspaceId?: string | null; name: string; channel: CommunicationChannel; campaignId?: string | null; audienceId?: string | null; templateId: string; maxRecipients?: number; actorUserId: string }
): Promise<CommunicationBulkBatch> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageBulkAuthority(db, ctx, "communication_bulk_batch", "new");

  const templateVersion = await resolvePublishedTemplateVersion(db, { organizationId: input.organizationId, templateId: input.templateId });

  let row: CommunicationBulkBatch;
  try {
    [row] = await db
      .insert(communicationBulkBatches)
      .values({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        name: input.name,
        channel: input.channel,
        campaignId: input.campaignId ?? null,
        audienceId: input.audienceId ?? null,
        templateVersionId: templateVersion.id,
        maxRecipients: input.maxRecipients ?? 200,
        createdByUserId: input.actorUserId,
      })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateActiveBulkBatchError();
    throw err;
  }

  await recordAuditEvent(db, { eventType: "communication_bulk_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_bulk_batch", targetId: row.id, metadata: { channel: input.channel, campaignId: input.campaignId ?? null } });
  return row;
}

export async function resolveBulkBatchById(db: Db, organizationId: string, batchId: string): Promise<CommunicationBulkBatch> {
  const [row] = await db.select().from(communicationBulkBatches).where(and(eq(communicationBulkBatches.id, batchId), eq(communicationBulkBatches.organizationId, organizationId)));
  if (!row) throw new TenantResourceNotFoundError();
  return row as CommunicationBulkBatch;
}

export async function getBulkBatchForUser(db: Db, input: { organizationId: string; batchId: string; actorUserId: string }): Promise<CommunicationBulkBatch> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageBulkAuthority(db, ctx, "communication_bulk_batch", input.batchId);
  return resolveBulkBatchById(db, input.organizationId, input.batchId);
}

export async function listBulkBatchesForUser(db: Db, input: { organizationId: string; actorUserId: string }): Promise<CommunicationBulkBatch[]> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageBulkAuthority(db, ctx, "communication_bulk_batch", "list");
  return db.select().from(communicationBulkBatches).where(eq(communicationBulkBatches.organizationId, input.organizationId)) as Promise<CommunicationBulkBatch[]>;
}

/**
 * One snapshotted recipient. `templateValues` and `providerTemplate` are
 * PER RECIPIENT and frozen here with everything else — a personalized
 * campaign gives each business its own name, demo URL and market price,
 * and freezing them at snapshot time is what makes the batch a human can
 * approve identical to the batch the worker later sends.
 */
export interface BulkRecipientInput {
  contactId: string;
  templateValues?: Record<string, string>;
  providerTemplate?: ProviderTemplateDirective | null;
  /** The sender this recipient is messaged from — one connection per market. */
  integrationConnectionId?: string | null;
  /** Provider-native thread key, so the reply lands on the conversation this send opens. */
  externalThreadId?: string | null;
}

/** Snapshots the batch's own recipient list from a real audience evaluation — the audience MUST be a `contact`-entity-type audience, since only contacts carry a resolvable email/phone identity. Never re-evaluated at send time. */
export async function snapshotBulkRecipients(
  db: Db,
  input: { organizationId: string; batchId: string; contactIds?: string[]; recipients?: BulkRecipientInput[]; actorUserId: string }
): Promise<{ recipientCount: number }> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageBulkAuthority(db, ctx, "communication_bulk_batch", input.batchId);
  const batch = await resolveBulkBatchById(db, input.organizationId, input.batchId);

  const requested: BulkRecipientInput[] = input.recipients ?? (input.contactIds ?? []).map((contactId) => ({ contactId }));
  if (requested.length > batch.maxRecipients) throw new BulkBatchRecipientLimitExceededError(batch.maxRecipients);
  if (requested.length === 0) return { recipientCount: 0 };

  const byContactId = new Map(requested.map((entry) => [entry.contactId, entry]));
  const contacts = await db
    .select({ id: crmContacts.id, primaryEmail: crmContacts.primaryEmail, primaryPhone: crmContacts.primaryPhone })
    .from(crmContacts)
    .where(and(eq(crmContacts.organizationId, input.organizationId), inArray(crmContacts.id, [...byContactId.keys()])));

  const column = batch.channel === "email" ? "primaryEmail" : "primaryPhone";
  let inserted = 0;
  for (const contact of contacts) {
    const identity = contact[column];
    if (!identity) continue;
    const entry = byContactId.get(contact.id);
    // Validated at snapshot time, not at send time: a directive Meta would
    // reject must never survive into an approved batch.
    const providerTemplate = entry?.providerTemplate ? providerTemplateDirectiveSchema.parse(entry.providerTemplate) : null;
    try {
      await db.insert(communicationBulkRecipients).values({
        organizationId: input.organizationId,
        batchId: batch.id,
        recipientReference: identity,
        contactId: contact.id,
        templateValues: entry?.templateValues ?? null,
        providerTemplate,
        integrationConnectionId: entry?.integrationConnectionId ?? null,
        externalThreadId: entry?.externalThreadId ?? null,
      });
      inserted += 1;
    } catch (err) {
      if (!isPostgresUniqueViolation(err)) throw err;
    }
  }

  await db.update(communicationBulkBatches).set({ recipientSnapshotCount: inserted, updatedAt: new Date() }).where(and(eq(communicationBulkBatches.id, batch.id), eq(communicationBulkBatches.organizationId, input.organizationId)));
  return { recipientCount: inserted };
}

export async function requestBulkApproval(db: Db, input: { organizationId: string; batchId: string; summary: string; actorUserId: string }): Promise<CommunicationBulkBatch> {
  const batch = await getBulkBatchForUser(db, { organizationId: input.organizationId, batchId: input.batchId, actorUserId: input.actorUserId });
  const { approval } = await requestBulkBatchApproval(db, { organizationId: input.organizationId, batchId: batch.id, summary: input.summary, actorUserId: input.actorUserId });

  const [row] = await db
    .update(communicationBulkBatches)
    .set({ status: "pending_approval", approvalRequestId: approval.id, revision: batch.revision + 1, updatedAt: new Date() })
    .where(and(eq(communicationBulkBatches.id, batch.id), eq(communicationBulkBatches.organizationId, input.organizationId), eq(communicationBulkBatches.revision, batch.revision)))
    .returning();
  if (!row) throw new StaleCommunicationUpdateError("communication bulk batch");
  return row as CommunicationBulkBatch;
}

/** Reads the real Runtime approval decision and applies its consequence — mirrors `messages.ts`'s `applyMessageApprovalDecision` exactly. */
export async function applyBulkApprovalDecision(db: Db, input: { organizationId: string; batchId: string; decision: "approved" | "rejected"; decisionNote?: string; actorUserId: string }): Promise<CommunicationBulkBatch> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageBulkAuthority(db, ctx, "communication_bulk_batch", input.batchId);
  const batch = await resolveBulkBatchById(db, input.organizationId, input.batchId);
  if (!batch.approvalRequestId) throw new TenantResourceNotFoundError();

  if (input.decision === "approved") {
    await approveRequest(db, { organizationId: input.organizationId, approvalId: batch.approvalRequestId, actorUserId: input.actorUserId, decisionNote: input.decisionNote });
    const [row] = await db
      .update(communicationBulkBatches)
      .set({ status: "approved", revision: batch.revision + 1, updatedAt: new Date() })
      .where(and(eq(communicationBulkBatches.id, batch.id), eq(communicationBulkBatches.organizationId, input.organizationId), eq(communicationBulkBatches.revision, batch.revision)))
      .returning();
    if (!row) throw new StaleCommunicationUpdateError("communication bulk batch");
    return row as CommunicationBulkBatch;
  }

  await rejectRequest(db, { organizationId: input.organizationId, approvalId: batch.approvalRequestId, actorUserId: input.actorUserId, decisionNote: input.decisionNote });
  const [row] = await db
    .update(communicationBulkBatches)
    .set({ status: "cancelled", cancelledAt: new Date(), revision: batch.revision + 1, updatedAt: new Date() })
    .where(and(eq(communicationBulkBatches.id, batch.id), eq(communicationBulkBatches.organizationId, input.organizationId), eq(communicationBulkBatches.revision, batch.revision)))
    .returning();
  if (!row) throw new StaleCommunicationUpdateError("communication bulk batch");
  return row as CommunicationBulkBatch;
}

/**
 * Approved -> queued: for each snapshotted recipient, checks
 * consent/suppression INDIVIDUALLY, renders the published template, and
 * creates exactly one canonical draft message + auto-queues it. A
 * recipient already suppressed or lacking required opt-in is marked
 * `skipped_*` — never sent, never blocking the rest of the batch.
 */
export async function startBulkBatch(db: Db, input: { organizationId: string; batchId: string; requireExplicitOptIn: boolean; templateValues?: Record<string, string>; integrationConnectionId?: string | null; actorUserId: string }): Promise<{ queued: number; skipped: number }> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageBulkAuthority(db, ctx, "communication_bulk_batch", input.batchId);
  const batch = await resolveBulkBatchById(db, input.organizationId, input.batchId);
  if (batch.status !== "approved") throw new DomainRuleViolationErrorNotApproved();

  const { communicationTemplateVersions } = await import("@/db/schema");
  const [templateVersion] = await db.select().from(communicationTemplateVersions).where(eq(communicationTemplateVersions.id, batch.templateVersionId));

  const recipients = await db.select().from(communicationBulkRecipients).where(and(eq(communicationBulkRecipients.organizationId, input.organizationId), eq(communicationBulkRecipients.batchId, batch.id), eq(communicationBulkRecipients.status, "pending")));

  let queued = 0;
  let skipped = 0;
  const { queueMessageForSend, approveDraftDirectly } = await import("./messages");

  for (const recipient of recipients) {
    const suppression = await getActiveSuppression(db, { organizationId: input.organizationId, channel: batch.channel, rawIdentity: recipient.recipientReference });
    if (suppression) {
      await db.update(communicationBulkRecipients).set({ status: "skipped_suppressed", skipReason: suppression.suppressionReason }).where(eq(communicationBulkRecipients.id, recipient.id));
      skipped += 1;
      continue;
    }
    if (input.requireExplicitOptIn) {
      const consent = await getConsentStatus(db, { organizationId: input.organizationId, channel: batch.channel, rawIdentity: recipient.recipientReference });
      if (!consent || consent.consentStatus !== "opted_in") {
        await db.update(communicationBulkRecipients).set({ status: "skipped_no_consent", skipReason: "no_explicit_opt_in" }).where(eq(communicationBulkRecipients.id, recipient.id));
        skipped += 1;
        continue;
      }
    }

    // Per-recipient values win over the batch-level defaults — that is what
    // makes one approved batch able to send each business its own name,
    // demo URL and market price rather than one identical body to everyone.
    const recipientValues = (recipient.templateValues ?? null) as Record<string, string> | null;
    const rendered = renderTemplate(templateVersion as never, { ...(input.templateValues ?? {}), ...(recipientValues ?? {}) });

    // The connection is what a send actually dispatches through, so a
    // recipient snapshotted without one can never leave `queued`. Skip it
    // here, visibly, rather than queueing a message that is guaranteed to
    // fail in the worker with "no connection configured".
    const integrationConnectionId = recipient.integrationConnectionId ?? input.integrationConnectionId ?? null;
    if (!integrationConnectionId && batch.channel !== "email") {
      await db.update(communicationBulkRecipients).set({ status: "failed", skipReason: "no_integration_connection" }).where(eq(communicationBulkRecipients.id, recipient.id));
      skipped += 1;
      continue;
    }

    const connection = integrationConnectionId ? await resolveConnectionById(db, input.organizationId, integrationConnectionId) : null;
    if (connection) {
      try {
        requireConnectionUsable(connection);
      } catch {
        await db.update(communicationBulkRecipients).set({ status: "failed", skipReason: `connection_${connection.status}` }).where(eq(communicationBulkRecipients.id, recipient.id));
        skipped += 1;
        continue;
      }
    }

    const conversation = await findOrCreateConversation(db, {
      organizationId: input.organizationId,
      channel: batch.channel,
      integrationConnectionId,
      contactId: recipient.contactId,
      // Matching the key the provider adapter derives from an inbound
      // message is what makes a reply land on THIS conversation instead of
      // opening a second one beside it.
      externalThreadId: recipient.externalThreadId,
      actorUserId: input.actorUserId,
    });
    const draft = await createDraftMessage(db, {
      organizationId: input.organizationId,
      conversationId: conversation.id,
      channel: batch.channel,
      integrationConnectionId,
      senderReference: connection?.externalAccountId ?? null,
      recipientReference: recipient.recipientReference,
      subject: rendered.subject ?? undefined,
      bodyText: rendered.body,
      providerTemplate: (recipient.providerTemplate ?? null) as ProviderTemplateDirective | null,
      idempotencyKey: `bulk:${batch.id}:${recipient.id}`,
      actorUserId: input.actorUserId,
    });
    await approveDraftDirectly(db, { organizationId: input.organizationId, messageId: draft.id, actorUserId: input.actorUserId });
    await queueMessageForSend(db, { organizationId: input.organizationId, messageId: draft.id, actorUserId: input.actorUserId });

    await db.update(communicationBulkRecipients).set({ status: "queued", messageId: draft.id }).where(eq(communicationBulkRecipients.id, recipient.id));
    queued += 1;
  }

  await db
    .update(communicationBulkBatches)
    .set({ status: "in_progress", startedAt: new Date(), revision: batch.revision + 1, updatedAt: new Date() })
    .where(and(eq(communicationBulkBatches.id, batch.id), eq(communicationBulkBatches.organizationId, input.organizationId), eq(communicationBulkBatches.revision, batch.revision)));

  return { queued, skipped };
}

class DomainRuleViolationErrorNotApproved extends DomainRuleViolationError {
  readonly reason = "bulk_batch_not_approved";
  constructor() {
    super("This bulk batch has not been approved and cannot be started.");
    this.name = "DomainRuleViolationErrorNotApproved";
  }
}

export async function cancelBulkBatch(db: Db, input: { organizationId: string; batchId: string; actorUserId: string }): Promise<CommunicationBulkBatch> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageBulkAuthority(db, ctx, "communication_bulk_batch", input.batchId);
  const batch = await resolveBulkBatchById(db, input.organizationId, input.batchId);

  const [row] = await db
    .update(communicationBulkBatches)
    .set({ status: "cancelled", cancelledAt: new Date(), revision: batch.revision + 1, updatedAt: new Date() })
    .where(and(eq(communicationBulkBatches.id, batch.id), eq(communicationBulkBatches.organizationId, input.organizationId), eq(communicationBulkBatches.revision, batch.revision)))
    .returning();
  if (!row) throw new StaleCommunicationUpdateError("communication bulk batch");

  await recordAuditEvent(db, { eventType: "communication_bulk_cancelled", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_bulk_batch", targetId: row.id, metadata: {} });
  return row as CommunicationBulkBatch;
}
