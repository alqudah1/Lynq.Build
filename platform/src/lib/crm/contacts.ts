import "server-only";
import { and, eq, or, inArray, ne } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmContacts } from "@/db/schema";
import { requireOrganizationMembership, requireWorkspaceMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority } from "./authz";
import { StaleCrmUpdateError, NoStableIdentityError } from "./errors";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { normalizeEmail, normalizePhone } from "./normalize";
import type { CrmLifecycleStage } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CrmContact {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  jobTitle: string | null;
  department: string | null;
  lifecycleStage: CrmLifecycleStage;
  status: "active" | "archived";
  ownerUserId: string | null;
  sourceId: string | null;
  createdByUserId: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DuplicateWarning {
  matchedOn: "email" | "phone";
  contactId: string;
  displayName: string;
}

/** Validates the owner (if provided) is an eligible org member, and — for a workspace-scoped record — also a member of that workspace. Ownership is a label only; it grants no permission. */
async function validateOwner(db: Db, organizationId: string, workspaceId: string | null, ownerUserId: string | null | undefined): Promise<void> {
  if (!ownerUserId) return;
  await requireOrganizationMembership(db, organizationId, ownerUserId);
  if (workspaceId) await requireWorkspaceMembership(db, workspaceId, ownerUserId);
}

async function findDuplicateWarnings(db: Db, organizationId: string, normalizedEmail: string | null, normalizedPhone: string | null, excludeContactId?: string): Promise<DuplicateWarning[]> {
  if (!normalizedEmail && !normalizedPhone) return [];
  const conditions = [];
  if (normalizedEmail) conditions.push(eq(crmContacts.normalizedPrimaryEmail, normalizedEmail));
  if (normalizedPhone) conditions.push(eq(crmContacts.normalizedPrimaryPhone, normalizedPhone));

  const rows = await db
    .select({ id: crmContacts.id, displayName: crmContacts.displayName, normalizedPrimaryEmail: crmContacts.normalizedPrimaryEmail, normalizedPrimaryPhone: crmContacts.normalizedPrimaryPhone })
    .from(crmContacts)
    .where(and(eq(crmContacts.organizationId, organizationId), eq(crmContacts.status, "active"), or(...conditions), excludeContactId ? ne(crmContacts.id, excludeContactId) : undefined));

  return rows.map((row) => ({
    matchedOn: normalizedEmail && row.normalizedPrimaryEmail === normalizedEmail ? ("email" as const) : ("phone" as const),
    contactId: row.id,
    displayName: row.displayName,
  }));
}

export interface CreateContactInput {
  organizationId: string;
  workspaceId?: string | null;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  jobTitle?: string;
  department?: string;
  lifecycleStage?: CrmLifecycleStage;
  ownerUserId?: string | null;
  sourceId?: string | null;
  idempotencyKey?: string | null;
  actorUserId: string;
}

export async function createContact(db: Db, input: CreateContactInput): Promise<{ contact: CrmContact; duplicateWarnings: DuplicateWarning[]; idempotentReplay: boolean }> {
  const displayName = input.displayName?.trim() || [input.firstName, input.lastName].filter(Boolean).join(" ").trim() || input.primaryEmail || input.primaryPhone;
  if (!displayName) throw new NoStableIdentityError();

  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_contact", "new");
  await validateOwner(db, input.organizationId, input.workspaceId ?? null, input.ownerUserId);

  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(crmContacts)
      .where(and(eq(crmContacts.organizationId, input.organizationId), eq(crmContacts.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      return { contact: existing as CrmContact, duplicateWarnings: [], idempotentReplay: true };
    }
  }

  const normalizedEmail = input.primaryEmail ? normalizeEmail(input.primaryEmail) : null;
  const normalizedPhone = input.primaryPhone ? normalizePhone(input.primaryPhone) : null;

  let row;
  try {
    [row] = await db
      .insert(crmContacts)
      .values({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        displayName,
        primaryEmail: input.primaryEmail ?? null,
        normalizedPrimaryEmail: normalizedEmail,
        primaryPhone: input.primaryPhone ?? null,
        normalizedPrimaryPhone: normalizedPhone,
        jobTitle: input.jobTitle ?? null,
        department: input.department ?? null,
        lifecycleStage: input.lifecycleStage ?? "lead",
        ownerUserId: input.ownerUserId ?? null,
        sourceId: input.sourceId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdByUserId: input.actorUserId,
      })
      .returning();
  } catch (err) {
    // A genuine concurrent race on the same idempotencyKey: the check above saw no row, but
    // another call's insert committed first. The partial unique index is the real guarantee —
    // re-fetch and return that winner as a replay rather than surfacing a raw constraint error.
    if (input.idempotencyKey && isPostgresUniqueViolation(err)) {
      const [existing] = await db.select().from(crmContacts).where(and(eq(crmContacts.organizationId, input.organizationId), eq(crmContacts.idempotencyKey, input.idempotencyKey)));
      if (existing) return { contact: existing as CrmContact, duplicateWarnings: [], idempotentReplay: true };
    }
    throw err;
  }

  await recordAuditEvent(db, { eventType: "crm_contact_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_contact", targetId: row.id, metadata: { lifecycleStage: row.lifecycleStage } });

  const duplicateWarnings = await findDuplicateWarnings(db, input.organizationId, normalizedEmail, normalizedPhone, row.id);
  return { contact: row as CrmContact, duplicateWarnings, idempotentReplay: false };
}

export async function resolveContactById(db: Db, organizationId: string, contactId: string): Promise<CrmContact> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(crmContacts).where(and(eq(crmContacts.id, contactId), eq(crmContacts.organizationId, organizationId)));
    return row as CrmContact | undefined;
  });
}

export async function getContactForUser(db: Db, input: { organizationId: string; contactId: string; actorUserId: string }): Promise<CrmContact> {
  const contact = await resolveContactById(db, input.organizationId, input.contactId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: contact.workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_contact", contact.id);
  return contact;
}

export interface UpdateContactInput {
  organizationId: string;
  contactId: string;
  expectedRevision: number;
  actorUserId: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  lifecycleStage?: CrmLifecycleStage;
  ownerUserId?: string | null;
  sourceId?: string | null;
}

export async function updateContact(db: Db, input: UpdateContactInput): Promise<CrmContact> {
  const existing = await resolveContactById(db, input.organizationId, input.contactId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_contact", existing.id);
  if (input.ownerUserId !== undefined) await validateOwner(db, input.organizationId, existing.workspaceId, input.ownerUserId);

  const normalizedEmail = input.primaryEmail !== undefined ? (input.primaryEmail ? normalizeEmail(input.primaryEmail) : null) : undefined;
  const normalizedPhone = input.primaryPhone !== undefined ? (input.primaryPhone ? normalizePhone(input.primaryPhone) : null) : undefined;

  const values: Record<string, unknown> = { updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.firstName !== undefined) values.firstName = input.firstName;
  if (input.lastName !== undefined) values.lastName = input.lastName;
  if (input.displayName !== undefined) values.displayName = input.displayName;
  if (input.primaryEmail !== undefined) {
    values.primaryEmail = input.primaryEmail;
    values.normalizedPrimaryEmail = normalizedEmail;
  }
  if (input.primaryPhone !== undefined) {
    values.primaryPhone = input.primaryPhone;
    values.normalizedPrimaryPhone = normalizedPhone;
  }
  if (input.jobTitle !== undefined) values.jobTitle = input.jobTitle;
  if (input.department !== undefined) values.department = input.department;
  if (input.lifecycleStage !== undefined) values.lifecycleStage = input.lifecycleStage;
  if (input.ownerUserId !== undefined) values.ownerUserId = input.ownerUserId;
  if (input.sourceId !== undefined) values.sourceId = input.sourceId;

  const [updated] = await db
    .update(crmContacts)
    .set(values)
    .where(and(eq(crmContacts.id, input.contactId), eq(crmContacts.organizationId, input.organizationId), eq(crmContacts.revision, input.expectedRevision)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("contact");

  await recordAuditEvent(db, { eventType: "crm_contact_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_contact", targetId: updated.id, metadata: { fields: Object.keys(values).filter((k) => k !== "updatedAt" && k !== "revision") } });
  return updated as CrmContact;
}

export async function archiveContact(db: Db, input: { organizationId: string; contactId: string; expectedRevision: number; actorUserId: string }): Promise<CrmContact> {
  const existing = await resolveContactById(db, input.organizationId, input.contactId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_contact", existing.id);

  const [updated] = await db
    .update(crmContacts)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(crmContacts.id, input.contactId), eq(crmContacts.organizationId, input.organizationId), eq(crmContacts.revision, input.expectedRevision), eq(crmContacts.status, "active")))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("contact");
  await recordAuditEvent(db, { eventType: "crm_contact_archived", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_contact", targetId: updated.id });
  return updated as CrmContact;
}

export interface ListContactsInput {
  organizationId: string;
  actorUserId: string;
  workspaceId?: string | null;
  status?: "active" | "archived";
  ownerUserId?: string;
  limit?: number;
}

export async function listContactsForUser(db: Db, input: ListContactsInput): Promise<CrmContact[]> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_contact", "list");

  const conditions = [eq(crmContacts.organizationId, input.organizationId), eq(crmContacts.status, input.status ?? "active")];
  if (input.workspaceId) conditions.push(eq(crmContacts.workspaceId, input.workspaceId));
  if (input.ownerUserId) conditions.push(eq(crmContacts.ownerUserId, input.ownerUserId));

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db.select().from(crmContacts).where(and(...conditions)).limit(limit);
  return rows as CrmContact[];
}

/** Bulk tenant-safe lookup, used by activities/notes/follow-ups/search to resolve display names without N+1 queries. */
export async function listContactsByIds(db: Db, organizationId: string, contactIds: string[]): Promise<CrmContact[]> {
  if (contactIds.length === 0) return [];
  const rows = await db.select().from(crmContacts).where(and(eq(crmContacts.organizationId, organizationId), inArray(crmContacts.id, contactIds)));
  return rows as CrmContact[];
}

export { findDuplicateWarnings as findContactDuplicateWarnings };
