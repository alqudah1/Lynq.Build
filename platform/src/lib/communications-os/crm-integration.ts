import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { organizationMemberships } from "@/db/schema";
import { createActivity } from "@/lib/crm/activities";
import type { CommunicationChannel, CommunicationDirection } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Resolves a real, CRM-authority-holding actor for genuinely system-
 * triggered writes (an async send completing on a worker, an inbound
 * webhook with no human in the loop) — mirrors Sales OS's own
 * `systemActorUserId` pattern (`sequences.ts`'s `advanceDueSequences`),
 * just resolved from the organization itself rather than passed in from a
 * scheduler, since neither the Runtime worker nor a provider webhook has
 * one to pass. The organization owner always holds CRM manage authority
 * via the org-admin bootstrap rule every module in this codebase already
 * relies on, so `createActivity`'s own authorization gate is satisfied
 * without inventing a "system" identity CRM Core doesn't otherwise know
 * about.
 */
export async function resolveOrganizationOwnerUserId(db: Db, organizationId: string): Promise<string | null> {
  const [row] = await db.select({ userId: organizationMemberships.userId }).from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.role, "owner"))).limit(1);
  return row?.userId ?? null;
}

const CHANNEL_TO_ACTIVITY_TYPE: Record<CommunicationChannel, "email" | "message"> = {
  email: "email",
  sms: "message",
  whatsapp: "message",
};

/**
 * Creates a CRM activity ONLY for a communication that actually happened —
 * called exactly twice in this module: once when an outbound message's
 * provider acceptance is confirmed (never at draft time), and once when an
 * inbound message is ingested. References only — the activity's `summary`
 * never contains the message body, matching CRM Core's own "no full body
 * duplication" rule for every activity type.
 */
export async function recordCommunicationCrmActivity(
  db: Db,
  input: { organizationId: string; channel: CommunicationChannel; direction: CommunicationDirection; contactId?: string | null; companyId?: string | null; leadId?: string | null; opportunityId?: string | null; messageId: string; occurredAt: Date; actorUserId: string; agentId?: string | null }
): Promise<void> {
  if (!input.contactId && !input.companyId && !input.leadId && !input.opportunityId) return;

  await createActivity(db, {
    organizationId: input.organizationId,
    contactId: input.contactId ?? null,
    companyId: input.companyId ?? null,
    leadId: input.leadId ?? null,
    opportunityId: input.opportunityId ?? null,
    activityType: CHANNEL_TO_ACTIVITY_TYPE[input.channel],
    direction: input.direction,
    occurredAt: input.occurredAt,
    summary: `${input.direction === "outbound" ? "Sent" : "Received"} ${input.channel} communication`,
    agentId: input.agentId ?? null,
    externalReference: `communication_message:${input.messageId}`,
    actorUserId: input.actorUserId,
  });
}
