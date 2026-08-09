import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationExternalIdentities, crmContacts } from "@/db/schema";
import { normalizeEmail, normalizePhone } from "@/lib/crm/normalize";
import type { CommunicationChannel, CommunicationExternalIdentityType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

function identityTypeForChannel(channel: CommunicationChannel): CommunicationExternalIdentityType {
  return channel === "email" ? "email" : "phone";
}

export function normalizeIdentityForChannel(channel: CommunicationChannel, rawIdentity: string): string {
  return channel === "email" ? normalizeEmail(rawIdentity) : normalizePhone(rawIdentity);
}

export interface ExternalIdentity {
  id: string;
  organizationId: string;
  identityType: CommunicationExternalIdentityType;
  normalizedIdentity: string;
  contactId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * ============================================================================
 * Conservative identity resolution — Module 16
 * ============================================================================
 * An exact, unique match against CRM Core's own `normalizedPrimaryEmail`/
 * `normalizedPrimaryPhone` indexes may attach a contact. An ambiguous match
 * (more than one active contact shares the identity — already possible
 * today since CRM Core treats duplicate detection as a warning, not a hard
 * uniqueness rule) is left UNRESOLVED rather than guessed at. No CRM
 * contact is ever created or merged by this function — that remains an
 * explicit, separate human/CRM Core action.
 */
export async function resolveContactByIdentity(db: Db, input: { organizationId: string; channel: CommunicationChannel; rawIdentity: string }): Promise<{ contactId: string | null; normalizedIdentity: string }> {
  const normalized = normalizeIdentityForChannel(input.channel, input.rawIdentity);

  const column = input.channel === "email" ? crmContacts.normalizedPrimaryEmail : crmContacts.normalizedPrimaryPhone;
  const rows = await db
    .select({ id: crmContacts.id })
    .from(crmContacts)
    .where(and(eq(crmContacts.organizationId, input.organizationId), eq(crmContacts.status, "active"), eq(column, normalized)));

  const contactId = rows.length === 1 ? rows[0].id : null;
  return { contactId, normalizedIdentity: normalized };
}

/** Upserts the external-identity cache row — always recorded (even when unresolved), so "have we seen this identity before" is answerable without re-querying CRM every time, and `lastSeenAt` tracks recency for future reconciliation. */
export async function recordExternalIdentitySeen(db: Db, input: { organizationId: string; channel: CommunicationChannel; rawIdentity: string; contactId: string | null }): Promise<ExternalIdentity> {
  const identityType = identityTypeForChannel(input.channel);
  const normalizedIdentity = normalizeIdentityForChannel(input.channel, input.rawIdentity);

  const [existing] = await db
    .select()
    .from(communicationExternalIdentities)
    .where(and(eq(communicationExternalIdentities.organizationId, input.organizationId), eq(communicationExternalIdentities.identityType, identityType), eq(communicationExternalIdentities.normalizedIdentity, normalizedIdentity)));

  if (existing) {
    const [updated] = await db
      .update(communicationExternalIdentities)
      .set({ contactId: input.contactId ?? existing.contactId, lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(communicationExternalIdentities.id, existing.id))
      .returning();
    return updated as ExternalIdentity;
  }

  const [row] = await db
    .insert(communicationExternalIdentities)
    .values({ organizationId: input.organizationId, identityType, normalizedIdentity, contactId: input.contactId ?? null })
    .onConflictDoUpdate({
      target: [communicationExternalIdentities.organizationId, communicationExternalIdentities.identityType, communicationExternalIdentities.normalizedIdentity],
      set: { lastSeenAt: new Date(), updatedAt: new Date() },
    })
    .returning();
  return row as ExternalIdentity;
}
