import "server-only";
import { and, eq, or, ilike } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmContacts, crmCompanies, crmLeads, crmOpportunities } from "@/db/schema";
import { resolveCrmAuthContext, requireCrmViewAuthority } from "./authz";
import { normalizeEmail, normalizePhone } from "./normalize";
import type { CrmContact } from "./contacts";
import type { CrmCompany } from "./companies";
import type { CrmLead } from "./leads";
import type { CrmOpportunity } from "./opportunities";
import type { CrmLeadStatus, CrmOpportunityStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 100;

function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? SEARCH_LIMIT_DEFAULT, 1), SEARCH_LIMIT_MAX);
}

/**
 * Deterministic, keyword/exact-filter CRM search — no semantic/vector
 * search, explicitly deferred. Every query is scoped by `organizationId`
 * first, before any other condition, so cross-tenant leakage is
 * structurally impossible regardless of what the caller searches for.
 */
export async function searchContacts(db: Db, input: { organizationId: string; actorUserId: string; query?: string; companyId?: string; ownerUserId?: string; limit?: number; offset?: number }): Promise<{ results: CrmContact[]; total: number }> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_contact", "search");

  const conditions = [eq(crmContacts.organizationId, input.organizationId), eq(crmContacts.status, "active")];
  if (input.query) {
    const q = `%${input.query.trim()}%`;
    const normalizedEmail = normalizeEmail(input.query.trim());
    const normalizedPhone = normalizePhone(input.query.trim());
    conditions.push(or(ilike(crmContacts.displayName, q), eq(crmContacts.normalizedPrimaryEmail, normalizedEmail), eq(crmContacts.normalizedPrimaryPhone, normalizedPhone))!);
  }
  if (input.ownerUserId) conditions.push(eq(crmContacts.ownerUserId, input.ownerUserId));

  const limit = clampLimit(input.limit);
  const offset = Math.max(input.offset ?? 0, 0);
  const rows = await db.select().from(crmContacts).where(and(...conditions)).limit(limit).offset(offset);
  return { results: rows as CrmContact[], total: rows.length };
}

export async function searchCompanies(db: Db, input: { organizationId: string; actorUserId: string; query?: string; ownerUserId?: string; limit?: number; offset?: number }): Promise<{ results: CrmCompany[]; total: number }> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_company", "search");

  const conditions = [eq(crmCompanies.organizationId, input.organizationId), eq(crmCompanies.status, "active")];
  if (input.query) {
    const q = `%${input.query.trim()}%`;
    conditions.push(or(ilike(crmCompanies.name, q), ilike(crmCompanies.normalizedDomain, `%${input.query.trim().toLowerCase()}%`))!);
  }
  if (input.ownerUserId) conditions.push(eq(crmCompanies.ownerUserId, input.ownerUserId));

  const limit = clampLimit(input.limit);
  const offset = Math.max(input.offset ?? 0, 0);
  const rows = await db.select().from(crmCompanies).where(and(...conditions)).limit(limit).offset(offset);
  return { results: rows as CrmCompany[], total: rows.length };
}

export async function searchLeads(db: Db, input: { organizationId: string; actorUserId: string; status?: CrmLeadStatus; ownerUserId?: string; contactId?: string; companyId?: string; limit?: number; offset?: number }): Promise<{ results: CrmLead[]; total: number }> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_lead", "search");

  const conditions = [eq(crmLeads.organizationId, input.organizationId)];
  if (input.status) conditions.push(eq(crmLeads.status, input.status));
  if (input.ownerUserId) conditions.push(eq(crmLeads.ownerUserId, input.ownerUserId));
  if (input.contactId) conditions.push(eq(crmLeads.contactId, input.contactId));
  if (input.companyId) conditions.push(eq(crmLeads.companyId, input.companyId));

  const limit = clampLimit(input.limit);
  const offset = Math.max(input.offset ?? 0, 0);
  const rows = await db.select().from(crmLeads).where(and(...conditions)).limit(limit).offset(offset);
  return { results: rows as CrmLead[], total: rows.length };
}

export async function searchOpportunities(db: Db, input: { organizationId: string; actorUserId: string; query?: string; stageId?: string; pipelineId?: string; status?: CrmOpportunityStatus; ownerUserId?: string; companyId?: string; contactId?: string; limit?: number; offset?: number }): Promise<{ results: CrmOpportunity[]; total: number }> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_opportunity", "search");

  const conditions = [eq(crmOpportunities.organizationId, input.organizationId)];
  if (input.query) conditions.push(ilike(crmOpportunities.name, `%${input.query.trim()}%`));
  if (input.stageId) conditions.push(eq(crmOpportunities.stageId, input.stageId));
  if (input.pipelineId) conditions.push(eq(crmOpportunities.pipelineId, input.pipelineId));
  if (input.status) conditions.push(eq(crmOpportunities.status, input.status));
  if (input.ownerUserId) conditions.push(eq(crmOpportunities.ownerUserId, input.ownerUserId));
  if (input.companyId) conditions.push(eq(crmOpportunities.companyId, input.companyId));
  if (input.contactId) conditions.push(eq(crmOpportunities.primaryContactId, input.contactId));

  const limit = clampLimit(input.limit);
  const offset = Math.max(input.offset ?? 0, 0);
  const rows = await db.select().from(crmOpportunities).where(and(...conditions)).limit(limit).offset(offset);
  return { results: rows as CrmOpportunity[], total: rows.length };
}
