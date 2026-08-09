import "server-only";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmLeads, crmOpportunities, crmContacts } from "@/db/schema";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { findOrCreateConversation } from "./conversations";
import { createDraftMessage } from "./messages";
import type { CommunicationChannel } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

class NoResolvableContactForSequenceStepError extends DomainRuleViolationError {
  readonly reason = "no_resolvable_contact_for_sequence_step";
  constructor() {
    super("This lead/opportunity has no linked contact with an identity for this channel — cannot draft a communication.");
    this.name = "NoResolvableContactForSequenceStepError";
  }
}

/**
 * ============================================================================
 * Sales OS integration — Module 16
 * ============================================================================
 * The one call Sales OS's own `sequences.ts` makes into Communications OS,
 * for its new `communication_draft` step action type: resolves the real
 * linked CRM contact for a lead/opportunity, finds-or-creates the
 * conversation, and creates a canonical DRAFT message — never sends it.
 * Sales OS never touches a provider adapter, never decides approval, never
 * changes an opportunity's stage because a message was drafted or sent;
 * this function's only job is producing the draft, and the real send goes
 * through Communications OS's own approval → queue → worker path exactly
 * like any other message, initiated separately by a human or a workflow.
 */
export async function createSequenceCommunicationDraft(
  db: Db,
  input: { organizationId: string; workspaceId: string | null; targetType: "lead" | "opportunity"; targetId: string; channel: CommunicationChannel; subject?: string; bodyText: string; systemActorUserId: string }
): Promise<{ messageId: string; conversationId: string }> {
  const contactId = await resolveContactIdForTarget(db, input.organizationId, input.targetType, input.targetId);
  if (!contactId) throw new NoResolvableContactForSequenceStepError();

  const [contact] = await db.select({ primaryEmail: crmContacts.primaryEmail, primaryPhone: crmContacts.primaryPhone }).from(crmContacts).where(eq(crmContacts.id, contactId));
  const recipientReference = input.channel === "email" ? contact?.primaryEmail : contact?.primaryPhone;
  if (!recipientReference) throw new NoResolvableContactForSequenceStepError();

  const conversation = await findOrCreateConversation(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    channel: input.channel,
    contactId,
    leadId: input.targetType === "lead" ? input.targetId : null,
    opportunityId: input.targetType === "opportunity" ? input.targetId : null,
    actorUserId: input.systemActorUserId,
  });

  const message = await createDraftMessage(db, {
    organizationId: input.organizationId,
    conversationId: conversation.id,
    channel: input.channel,
    recipientReference,
    subject: input.subject,
    bodyText: input.bodyText,
    idempotencyKey: `sales-sequence:${input.targetType}:${input.targetId}:${Date.now()}`,
    actorUserId: input.systemActorUserId,
  });

  return { messageId: message.id, conversationId: conversation.id };
}

async function resolveContactIdForTarget(db: Db, organizationId: string, targetType: "lead" | "opportunity", targetId: string): Promise<string | null> {
  if (targetType === "lead") {
    const [lead] = await db.select({ contactId: crmLeads.contactId }).from(crmLeads).where(eq(crmLeads.id, targetId));
    return lead?.contactId ?? null;
  }
  const [opportunity] = await db.select({ primaryContactId: crmOpportunities.primaryContactId }).from(crmOpportunities).where(eq(crmOpportunities.id, targetId));
  return opportunity?.primaryContactId ?? null;
}
