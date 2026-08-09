import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmContactCompanyRelationships } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority } from "./authz";
import { StaleCrmUpdateError, DuplicateRelationshipError } from "./errors";
import { resolveContactById } from "./contacts";
import { resolveCompanyById } from "./companies";
import type { CrmRelationshipType, CrmRelationshipStatus } from "./validation";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CrmContactCompanyRelationship {
  id: string;
  organizationId: string;
  contactId: string;
  companyId: string;
  relationshipType: CrmRelationshipType;
  status: CrmRelationshipStatus;
  isPrimary: boolean;
  startDate: Date | null;
  endDate: Date | null;
  createdByUserId: string | null;
  revision: number;
  createdAt: Date;
}

export interface CreateRelationshipInput {
  organizationId: string;
  contactId: string;
  companyId: string;
  relationshipType: CrmRelationshipType;
  isPrimary?: boolean;
  startDate?: Date | null;
  actorUserId: string;
}

/** Many-to-many contact↔company link. Duplicate ACTIVE relationships of the same type between the same pair are rejected by a real partial unique index — caught here and re-thrown as a domain error, not a raw Postgres error. */
export async function createContactCompanyRelationship(db: Db, input: CreateRelationshipInput): Promise<CrmContactCompanyRelationship> {
  const contact = await resolveContactById(db, input.organizationId, input.contactId);
  const company = await resolveCompanyById(db, input.organizationId, input.companyId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: contact.workspaceId ?? company.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_contact_company_relationship", "new");

  try {
    const [row] = await db
      .insert(crmContactCompanyRelationships)
      .values({
        organizationId: input.organizationId,
        contactId: input.contactId,
        companyId: input.companyId,
        relationshipType: input.relationshipType,
        isPrimary: input.isPrimary ?? false,
        startDate: input.startDate ?? null,
        createdByUserId: input.actorUserId,
      })
      .returning();

    await recordAuditEvent(db, {
      eventType: "crm_contact_company_linked",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "crm_contact_company_relationship",
      targetId: row.id,
      metadata: { contactId: input.contactId, companyId: input.companyId, relationshipType: input.relationshipType },
    });
    return row as CrmContactCompanyRelationship;
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateRelationshipError();
    throw err;
  }
}

export async function endContactCompanyRelationship(db: Db, input: { organizationId: string; relationshipId: string; expectedRevision: number; actorUserId: string }): Promise<CrmContactCompanyRelationship> {
  const [existing] = await db.select().from(crmContactCompanyRelationships).where(and(eq(crmContactCompanyRelationships.id, input.relationshipId), eq(crmContactCompanyRelationships.organizationId, input.organizationId)));
  if (!existing) throw new StaleCrmUpdateError("relationship");

  const contact = await resolveContactById(db, input.organizationId, existing.contactId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: contact.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_contact_company_relationship", existing.id);

  const [updated] = await db
    .update(crmContactCompanyRelationships)
    .set({ status: "ended", endDate: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(crmContactCompanyRelationships.id, input.relationshipId), eq(crmContactCompanyRelationships.organizationId, input.organizationId), eq(crmContactCompanyRelationships.revision, input.expectedRevision)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("relationship");
  await recordAuditEvent(db, { eventType: "crm_contact_company_unlinked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_contact_company_relationship", targetId: updated.id });
  return updated as CrmContactCompanyRelationship;
}

export async function listRelationshipsForContact(db: Db, input: { organizationId: string; contactId: string; actorUserId: string }): Promise<CrmContactCompanyRelationship[]> {
  const contact = await resolveContactById(db, input.organizationId, input.contactId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: contact.workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_contact", contact.id);

  const rows = await db.select().from(crmContactCompanyRelationships).where(and(eq(crmContactCompanyRelationships.organizationId, input.organizationId), eq(crmContactCompanyRelationships.contactId, input.contactId)));
  return rows as CrmContactCompanyRelationship[];
}

export async function listRelationshipsForCompany(db: Db, input: { organizationId: string; companyId: string; actorUserId: string }): Promise<CrmContactCompanyRelationship[]> {
  const company = await resolveCompanyById(db, input.organizationId, input.companyId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: company.workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_company", company.id);

  const rows = await db.select().from(crmContactCompanyRelationships).where(and(eq(crmContactCompanyRelationships.organizationId, input.organizationId), eq(crmContactCompanyRelationships.companyId, input.companyId)));
  return rows as CrmContactCompanyRelationship[];
}
