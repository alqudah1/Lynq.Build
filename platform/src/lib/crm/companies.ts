import "server-only";
import { and, eq, ne, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmCompanies } from "@/db/schema";
import { requireOrganizationMembership, requireWorkspaceMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority } from "./authz";
import { StaleCrmUpdateError } from "./errors";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { normalizeDomain } from "./normalize";
import type { CrmLifecycleStage } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CrmCompany {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  legalName: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employeeRange: string | null;
  annualRevenueRange: string | null;
  phone: string | null;
  address: Record<string, unknown> | null;
  lifecycleStage: CrmLifecycleStage;
  status: "active" | "archived";
  ownerUserId: string | null;
  sourceId: string | null;
  idempotencyKey: string | null;
  createdByUserId: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyDuplicateWarning {
  companyId: string;
  name: string;
}

async function validateOwner(db: Db, organizationId: string, workspaceId: string | null, ownerUserId: string | null | undefined): Promise<void> {
  if (!ownerUserId) return;
  await requireOrganizationMembership(db, organizationId, ownerUserId);
  if (workspaceId) await requireWorkspaceMembership(db, workspaceId, ownerUserId);
}

async function findDomainDuplicateWarnings(db: Db, organizationId: string, normalizedDomain: string | null, excludeCompanyId?: string): Promise<CompanyDuplicateWarning[]> {
  if (!normalizedDomain) return [];
  const rows = await db
    .select({ id: crmCompanies.id, name: crmCompanies.name })
    .from(crmCompanies)
    .where(and(eq(crmCompanies.organizationId, organizationId), eq(crmCompanies.status, "active"), eq(crmCompanies.normalizedDomain, normalizedDomain), excludeCompanyId ? ne(crmCompanies.id, excludeCompanyId) : undefined));
  return rows.map((row) => ({ companyId: row.id, name: row.name }));
}

export interface CreateCompanyInput {
  organizationId: string;
  workspaceId?: string | null;
  name: string;
  legalName?: string;
  domain?: string;
  website?: string;
  industry?: string;
  employeeRange?: string;
  annualRevenueRange?: string;
  phone?: string;
  address?: Record<string, unknown>;
  lifecycleStage?: CrmLifecycleStage;
  ownerUserId?: string | null;
  sourceId?: string | null;
  idempotencyKey?: string | null;
  actorUserId: string;
}

export async function createCompany(db: Db, input: CreateCompanyInput): Promise<{ company: CrmCompany; duplicateWarnings: CompanyDuplicateWarning[]; idempotentReplay: boolean }> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_company", "new");
  await validateOwner(db, input.organizationId, input.workspaceId ?? null, input.ownerUserId);

  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(crmCompanies)
      .where(and(eq(crmCompanies.organizationId, input.organizationId), eq(crmCompanies.idempotencyKey, input.idempotencyKey)));
    if (existing) return { company: existing as CrmCompany, duplicateWarnings: [], idempotentReplay: true };
  }

  const normalizedDomain = input.domain ? normalizeDomain(input.domain) : null;

  let row;
  try {
    [row] = await db
      .insert(crmCompanies)
      .values({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        name: input.name,
        legalName: input.legalName ?? null,
        domain: input.domain ?? null,
        normalizedDomain,
        website: input.website ?? null,
        industry: input.industry ?? null,
        employeeRange: input.employeeRange ?? null,
        annualRevenueRange: input.annualRevenueRange ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        lifecycleStage: input.lifecycleStage ?? "lead",
        ownerUserId: input.ownerUserId ?? null,
        sourceId: input.sourceId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdByUserId: input.actorUserId,
      })
      .returning();
  } catch (err) {
    if (input.idempotencyKey && isPostgresUniqueViolation(err)) {
      const [existing] = await db.select().from(crmCompanies).where(and(eq(crmCompanies.organizationId, input.organizationId), eq(crmCompanies.idempotencyKey, input.idempotencyKey)));
      if (existing) return { company: existing as CrmCompany, duplicateWarnings: [], idempotentReplay: true };
    }
    throw err;
  }

  await recordAuditEvent(db, { eventType: "crm_company_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_company", targetId: row.id, metadata: { lifecycleStage: row.lifecycleStage } });

  const duplicateWarnings = await findDomainDuplicateWarnings(db, input.organizationId, normalizedDomain, row.id);
  return { company: row as CrmCompany, duplicateWarnings, idempotentReplay: false };
}

export async function resolveCompanyById(db: Db, organizationId: string, companyId: string): Promise<CrmCompany> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(crmCompanies).where(and(eq(crmCompanies.id, companyId), eq(crmCompanies.organizationId, organizationId)));
    return row as CrmCompany | undefined;
  });
}

export async function getCompanyForUser(db: Db, input: { organizationId: string; companyId: string; actorUserId: string }): Promise<CrmCompany> {
  const company = await resolveCompanyById(db, input.organizationId, input.companyId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: company.workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_company", company.id);
  return company;
}

export interface UpdateCompanyInput {
  organizationId: string;
  companyId: string;
  expectedRevision: number;
  actorUserId: string;
  name?: string;
  legalName?: string | null;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  employeeRange?: string | null;
  annualRevenueRange?: string | null;
  phone?: string | null;
  address?: Record<string, unknown> | null;
  lifecycleStage?: CrmLifecycleStage;
  ownerUserId?: string | null;
  sourceId?: string | null;
}

export async function updateCompany(db: Db, input: UpdateCompanyInput): Promise<CrmCompany> {
  const existing = await resolveCompanyById(db, input.organizationId, input.companyId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_company", existing.id);
  if (input.ownerUserId !== undefined) await validateOwner(db, input.organizationId, existing.workspaceId, input.ownerUserId);

  const values: Record<string, unknown> = { updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.name !== undefined) values.name = input.name;
  if (input.legalName !== undefined) values.legalName = input.legalName;
  if (input.domain !== undefined) {
    values.domain = input.domain;
    values.normalizedDomain = input.domain ? normalizeDomain(input.domain) : null;
  }
  if (input.website !== undefined) values.website = input.website;
  if (input.industry !== undefined) values.industry = input.industry;
  if (input.employeeRange !== undefined) values.employeeRange = input.employeeRange;
  if (input.annualRevenueRange !== undefined) values.annualRevenueRange = input.annualRevenueRange;
  if (input.phone !== undefined) values.phone = input.phone;
  if (input.address !== undefined) values.address = input.address;
  if (input.lifecycleStage !== undefined) values.lifecycleStage = input.lifecycleStage;
  if (input.ownerUserId !== undefined) values.ownerUserId = input.ownerUserId;
  if (input.sourceId !== undefined) values.sourceId = input.sourceId;

  const [updated] = await db
    .update(crmCompanies)
    .set(values)
    .where(and(eq(crmCompanies.id, input.companyId), eq(crmCompanies.organizationId, input.organizationId), eq(crmCompanies.revision, input.expectedRevision)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("company");
  await recordAuditEvent(db, { eventType: "crm_company_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_company", targetId: updated.id, metadata: { fields: Object.keys(values).filter((k) => k !== "updatedAt" && k !== "revision") } });
  return updated as CrmCompany;
}

export async function archiveCompany(db: Db, input: { organizationId: string; companyId: string; expectedRevision: number; actorUserId: string }): Promise<CrmCompany> {
  const existing = await resolveCompanyById(db, input.organizationId, input.companyId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_company", existing.id);

  const [updated] = await db
    .update(crmCompanies)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(crmCompanies.id, input.companyId), eq(crmCompanies.organizationId, input.organizationId), eq(crmCompanies.revision, input.expectedRevision), eq(crmCompanies.status, "active")))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("company");
  await recordAuditEvent(db, { eventType: "crm_company_archived", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_company", targetId: updated.id });
  return updated as CrmCompany;
}

export interface ListCompaniesInput {
  organizationId: string;
  actorUserId: string;
  workspaceId?: string | null;
  status?: "active" | "archived";
  ownerUserId?: string;
  limit?: number;
}

export async function listCompaniesForUser(db: Db, input: ListCompaniesInput): Promise<CrmCompany[]> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_company", "list");

  const conditions = [eq(crmCompanies.organizationId, input.organizationId), eq(crmCompanies.status, input.status ?? "active")];
  if (input.workspaceId) conditions.push(eq(crmCompanies.workspaceId, input.workspaceId));
  if (input.ownerUserId) conditions.push(eq(crmCompanies.ownerUserId, input.ownerUserId));

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db.select().from(crmCompanies).where(and(...conditions)).limit(limit);
  return rows as CrmCompany[];
}

export async function listCompaniesByIds(db: Db, organizationId: string, companyIds: string[]): Promise<CrmCompany[]> {
  if (companyIds.length === 0) return [];
  const rows = await db.select().from(crmCompanies).where(and(eq(crmCompanies.organizationId, organizationId), inArray(crmCompanies.id, companyIds)));
  return rows as CrmCompany[];
}

export { findDomainDuplicateWarnings as findCompanyDuplicateWarnings };
