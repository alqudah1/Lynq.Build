import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmLeads } from "@/db/schema";
import { requireOrganizationMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority, requireCrmLeadQualificationAuthority } from "./authz";
import { StaleCrmUpdateError, InvalidLeadTransitionError, LeadNotQualifiedError } from "./errors";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { createOpportunity, type CrmOpportunity, resolveOpportunityById } from "./opportunities";
import type { CrmLeadStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CrmLead {
  id: string;
  organizationId: string;
  contactId: string | null;
  companyId: string | null;
  ownerUserId: string | null;
  sourceId: string | null;
  status: CrmLeadStatus;
  score: number | null;
  estimatedValueAmount: string | null;
  estimatedValueCurrency: string | null;
  qualificationNotes: string | null;
  nextAction: string | null;
  convertedOpportunityId: string | null;
  createdByUserId: string | null;
  revision: number;
  qualifiedAt: Date | null;
  disqualifiedAt: Date | null;
  convertedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const SOFT_PROGRESSION: Record<string, string[]> = {
  new: ["contacted"],
  contacted: ["engaged"],
};

const QUALIFIABLE_FROM: CrmLeadStatus[] = ["new", "contacted", "engaged"];
const DISQUALIFIABLE_FROM: CrmLeadStatus[] = ["new", "contacted", "engaged", "qualified"];

export interface CreateLeadInput {
  organizationId: string;
  contactId?: string | null;
  companyId?: string | null;
  ownerUserId?: string | null;
  sourceId?: string | null;
  score?: number | null;
  estimatedValueAmount?: number | null;
  estimatedValueCurrency?: string | null;
  qualificationNotes?: string;
  nextAction?: string;
  idempotencyKey?: string | null;
  actorUserId: string;
}

/** An explicit qualification object — never merely a contact status. Not workspace-scoped directly (a lead inherits scope from whichever linked contact/company governs the manage-authority check). */
export async function createLead(db: Db, input: CreateLeadInput): Promise<CrmLead> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_lead", "new");
  if (input.ownerUserId) await requireOrganizationMembership(db, input.organizationId, input.ownerUserId);

  if (input.idempotencyKey) {
    const [existing] = await db.select().from(crmLeads).where(and(eq(crmLeads.organizationId, input.organizationId), eq(crmLeads.idempotencyKey, input.idempotencyKey)));
    if (existing) return existing as CrmLead;
  }

  let row;
  try {
    [row] = await db
      .insert(crmLeads)
      .values({
        organizationId: input.organizationId,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        sourceId: input.sourceId ?? null,
        score: input.score ?? null,
        estimatedValueAmount: input.estimatedValueAmount != null ? String(input.estimatedValueAmount) : null,
        estimatedValueCurrency: input.estimatedValueCurrency ?? null,
        qualificationNotes: input.qualificationNotes ?? null,
        nextAction: input.nextAction ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdByUserId: input.actorUserId,
      })
      .returning();
  } catch (err) {
    if (input.idempotencyKey && isPostgresUniqueViolation(err)) {
      const [existing] = await db.select().from(crmLeads).where(and(eq(crmLeads.organizationId, input.organizationId), eq(crmLeads.idempotencyKey, input.idempotencyKey)));
      if (existing) return existing as CrmLead;
    }
    throw err;
  }

  await recordAuditEvent(db, { eventType: "crm_lead_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: row.id, metadata: { status: row.status } });
  return row as CrmLead;
}

export async function resolveLeadById(db: Db, organizationId: string, leadId: string): Promise<CrmLead> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(crmLeads).where(and(eq(crmLeads.id, leadId), eq(crmLeads.organizationId, organizationId)));
    return row as CrmLead | undefined;
  });
}

export async function getLeadForUser(db: Db, input: { organizationId: string; leadId: string; actorUserId: string }): Promise<CrmLead> {
  const lead = await resolveLeadById(db, input.organizationId, input.leadId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_lead", lead.id);
  return lead;
}

export interface UpdateLeadInput {
  organizationId: string;
  leadId: string;
  expectedRevision: number;
  actorUserId: string;
  status?: "contacted" | "engaged";
  contactId?: string | null;
  companyId?: string | null;
  ownerUserId?: string | null;
  sourceId?: string | null;
  score?: number | null;
  estimatedValueAmount?: number | null;
  estimatedValueCurrency?: string | null;
  qualificationNotes?: string | null;
  nextAction?: string | null;
}

/** General field update, plus the two "soft" in-progress transitions (`new`→`contacted`→`engaged`) — qualification, disqualification, and conversion are their own dedicated, separately-audited operations below. */
export async function updateLead(db: Db, input: UpdateLeadInput): Promise<CrmLead> {
  const existing = await resolveLeadById(db, input.organizationId, input.leadId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_lead", existing.id);
  if (input.ownerUserId) await requireOrganizationMembership(db, input.organizationId, input.ownerUserId);

  if (input.status && !(SOFT_PROGRESSION[existing.status] ?? []).includes(input.status)) {
    throw new InvalidLeadTransitionError(existing.status, input.status);
  }

  const values: Record<string, unknown> = { updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.status !== undefined) values.status = input.status;
  if (input.contactId !== undefined) values.contactId = input.contactId;
  if (input.companyId !== undefined) values.companyId = input.companyId;
  if (input.ownerUserId !== undefined) values.ownerUserId = input.ownerUserId;
  if (input.sourceId !== undefined) values.sourceId = input.sourceId;
  if (input.score !== undefined) values.score = input.score;
  if (input.estimatedValueAmount !== undefined) values.estimatedValueAmount = input.estimatedValueAmount != null ? String(input.estimatedValueAmount) : null;
  if (input.estimatedValueCurrency !== undefined) values.estimatedValueCurrency = input.estimatedValueCurrency;
  if (input.qualificationNotes !== undefined) values.qualificationNotes = input.qualificationNotes;
  if (input.nextAction !== undefined) values.nextAction = input.nextAction;

  const [updated] = await db
    .update(crmLeads)
    .set(values)
    .where(and(eq(crmLeads.id, input.leadId), eq(crmLeads.organizationId, input.organizationId), eq(crmLeads.revision, input.expectedRevision)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("lead");
  await recordAuditEvent(db, { eventType: "crm_lead_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: updated.id, metadata: { fields: Object.keys(values).filter((k) => k !== "updatedAt" && k !== "revision") } });
  return updated as CrmLead;
}

export interface QualifyLeadInput {
  organizationId: string;
  leadId: string;
  expectedRevision: number;
  actorUserId: string;
}

/**
 * ============================================================================
 * Module 14 — one private transition primitive, two authorized entry points
 * ============================================================================
 * `qualifyLead`/`disqualifyLead` (org-admin/workspace-manage authority) and
 * `qualifyLeadFromSales`/`disqualifyLeadFromSales` (the narrow Sales-OS-rep/
 * manager authority added in Module 14) both route through this one
 * private function for the actual lifecycle validation, revision guard,
 * status write, and audit — CRM Core remains the single source of truth
 * for the transition itself; only the AUTHORITY CHECK differs between the
 * two pairs of entry points, and each entry point resolves its own
 * authority before calling in. This is "the smallest design that preserves
 * one source of truth" the Module 14 spec asks for — never a second,
 * duplicated qualify/disqualify implementation in Sales OS.
 */
async function applyLeadQualificationTransition(db: Db, input: { organizationId: string; leadId: string; expectedRevision: number; actorUserId: string; toStatus: "qualified" | "disqualified"; reason?: string; eventType: "crm_lead_qualified" | "crm_lead_disqualified" | "crm_lead_qualified_via_sales" | "crm_lead_disqualified_via_sales"; auditMetadata?: Record<string, unknown> }): Promise<CrmLead> {
  const existing = await resolveLeadById(db, input.organizationId, input.leadId);
  const allowedFrom = input.toStatus === "qualified" ? QUALIFIABLE_FROM : DISQUALIFIABLE_FROM;
  if (!allowedFrom.includes(existing.status)) throw new InvalidLeadTransitionError(existing.status, input.toStatus);

  const values: Record<string, unknown> = { status: input.toStatus, updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.toStatus === "qualified") {
    values.qualifiedAt = new Date();
  } else {
    values.disqualifiedAt = new Date();
    values.qualificationNotes = input.reason ?? existing.qualificationNotes;
  }

  const [updated] = await db
    .update(crmLeads)
    .set(values)
    .where(and(eq(crmLeads.id, input.leadId), eq(crmLeads.organizationId, input.organizationId), eq(crmLeads.revision, input.expectedRevision), eq(crmLeads.status, existing.status)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("lead");
  await recordAuditEvent(db, { eventType: input.eventType, actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: updated.id, metadata: input.auditMetadata });
  return updated as CrmLead;
}

/** Explicit, auditable qualification — never silently inferred, never performed by an agent without an approved future automation rule (no agent-callable path exists for this in this module). Requires full CRM manage authority (org owner/admin) — see `qualifyLeadFromSales` for the narrower Sales OS rep/manager path added in Module 14. */
export async function qualifyLead(db: Db, input: QualifyLeadInput): Promise<CrmLead> {
  const existing = await resolveLeadById(db, input.organizationId, input.leadId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_lead", existing.id);
  return applyLeadQualificationTransition(db, { organizationId: input.organizationId, leadId: input.leadId, expectedRevision: input.expectedRevision, actorUserId: input.actorUserId, toStatus: "qualified", eventType: "crm_lead_qualified" });
}

export interface DisqualifyLeadInput {
  organizationId: string;
  leadId: string;
  expectedRevision: number;
  reason?: string;
  actorUserId: string;
}

export async function disqualifyLead(db: Db, input: DisqualifyLeadInput): Promise<CrmLead> {
  const existing = await resolveLeadById(db, input.organizationId, input.leadId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_lead", existing.id);
  return applyLeadQualificationTransition(db, { organizationId: input.organizationId, leadId: input.leadId, expectedRevision: input.expectedRevision, actorUserId: input.actorUserId, toStatus: "disqualified", reason: input.reason, eventType: "crm_lead_disqualified" });
}

export interface QualifyLeadFromSalesInput {
  organizationId: string;
  leadId: string;
  expectedRevision: number;
  actorUserId: string;
  /** Actor attribution (Module 14) — bounded ids and a bounded outcome code only; never PII, free-text notes, checklist answers, or reasoning. */
  qualificationRunId: string;
  playbookVersionId: string | null;
}

/**
 * The Sales OS entry point (Module 14) — routes through the exact same
 * `applyLeadQualificationTransition` primitive as `qualifyLead`, gated by
 * the narrower `requireCrmLeadQualificationAuthority` (org admin, this
 * lead's own assigned owner, or — since team scope is a Sales OS concept
 * CRM cannot verify itself — an already-completed Sales OS authorization
 * decision) instead of full manage authority. Callers MUST have already
 * passed Sales OS's own authority gate (`requireSalesLeadQualificationAuthority`
 * — capability + team scope) before ever reaching this function; it is not
 * part of any public/user-facing API.
 */
export async function qualifyLeadFromSales(db: Db, input: QualifyLeadFromSalesInput): Promise<CrmLead> {
  const existing = await resolveLeadById(db, input.organizationId, input.leadId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmLeadQualificationAuthority(db, ctx, existing, { preAuthorizedBySalesOs: true });
  return applyLeadQualificationTransition(db, {
    organizationId: input.organizationId,
    leadId: input.leadId,
    expectedRevision: input.expectedRevision,
    actorUserId: input.actorUserId,
    toStatus: "qualified",
    eventType: "crm_lead_qualified_via_sales",
    auditMetadata: { sourceSubsystem: "sales_os", qualificationRunId: input.qualificationRunId, playbookVersionId: input.playbookVersionId },
  });
}

export async function disqualifyLeadFromSales(db: Db, input: QualifyLeadFromSalesInput & { reason?: string }): Promise<CrmLead> {
  const existing = await resolveLeadById(db, input.organizationId, input.leadId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmLeadQualificationAuthority(db, ctx, existing, { preAuthorizedBySalesOs: true });
  return applyLeadQualificationTransition(db, {
    organizationId: input.organizationId,
    leadId: input.leadId,
    expectedRevision: input.expectedRevision,
    actorUserId: input.actorUserId,
    toStatus: "disqualified",
    reason: input.reason,
    eventType: "crm_lead_disqualified_via_sales",
    auditMetadata: { sourceSubsystem: "sales_os", qualificationRunId: input.qualificationRunId, playbookVersionId: input.playbookVersionId },
  });
}

export interface ConvertLeadInput {
  organizationId: string;
  leadId: string;
  expectedRevision: number;
  pipelineId: string;
  stageId: string;
  opportunityName?: string;
  amount?: number | null;
  currency?: string | null;
  expectedCloseDate?: Date | null;
  actorUserId: string;
}

/**
 * Converts a qualified lead into a real opportunity — idempotent by
 * construction: if this lead has already been converted, returns the
 * existing linked opportunity rather than erroring or creating a second
 * one, regardless of how many times conversion is (re-)requested.
 */
export async function convertLead(db: Db, input: ConvertLeadInput): Promise<{ lead: CrmLead; opportunity: CrmOpportunity }> {
  const existing = await resolveLeadById(db, input.organizationId, input.leadId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_lead", existing.id);

  if (existing.status === "converted" && existing.convertedOpportunityId) {
    const opportunity = await resolveOpportunityById(db, input.organizationId, existing.convertedOpportunityId);
    return { lead: existing, opportunity };
  }

  if (existing.status !== "qualified") throw new LeadNotQualifiedError();

  const opportunity = await createOpportunity(db, {
    organizationId: input.organizationId,
    pipelineId: input.pipelineId,
    stageId: input.stageId,
    name: input.opportunityName ?? `Opportunity from lead ${existing.id.slice(0, 8)}`,
    primaryContactId: existing.contactId,
    companyId: existing.companyId,
    ownerUserId: existing.ownerUserId,
    amount: input.amount ?? (existing.estimatedValueAmount ? Number(existing.estimatedValueAmount) : null),
    currency: input.currency ?? existing.estimatedValueCurrency,
    expectedCloseDate: input.expectedCloseDate ?? null,
    sourceId: existing.sourceId,
    idempotencyKey: `lead-conversion:${existing.id}`,
    actorUserId: input.actorUserId,
  });

  const [updated] = await db
    .update(crmLeads)
    .set({ status: "converted", convertedAt: new Date(), convertedOpportunityId: opportunity.id, updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(crmLeads.id, input.leadId), eq(crmLeads.organizationId, input.organizationId), eq(crmLeads.revision, input.expectedRevision), eq(crmLeads.status, "qualified")))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("lead");
  await recordAuditEvent(db, { eventType: "crm_lead_converted", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: updated.id, metadata: { opportunityId: opportunity.id } });
  return { lead: updated as CrmLead, opportunity };
}

export interface ListLeadsInput {
  organizationId: string;
  actorUserId: string;
  status?: CrmLeadStatus;
  ownerUserId?: string;
  contactId?: string;
  companyId?: string;
  limit?: number;
}

export async function listLeadsForUser(db: Db, input: ListLeadsInput): Promise<CrmLead[]> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_lead", "list");

  const conditions = [eq(crmLeads.organizationId, input.organizationId)];
  if (input.status) conditions.push(eq(crmLeads.status, input.status));
  if (input.ownerUserId) conditions.push(eq(crmLeads.ownerUserId, input.ownerUserId));
  if (input.contactId) conditions.push(eq(crmLeads.contactId, input.contactId));
  if (input.companyId) conditions.push(eq(crmLeads.companyId, input.companyId));

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 1000);
  const rows = await db.select().from(crmLeads).where(and(...conditions)).limit(limit);
  return rows as CrmLead[];
}
