import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmCompanies, crmContacts } from "@/db/schema";
import { resolveExecutionById } from "@/lib/agent-runtime/executions";
import { resolveLeadById, type CrmLead } from "@/lib/crm/leads";
import type { CrmCompany } from "@/lib/crm/companies";
import type { ToolExecutionContext } from "@/lib/tools/implementation-types";
import { resolveCompanyOutreachContext, type CompanyOutreachContext } from "../company-facts";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Shared plumbing for the lead-gen tools
 * ============================================================================
 * Every lead-gen tool runs through `invokeTool`, which has already
 * enforced the assigned agent, live eligibility, the execution state, the
 * permission floor, the rate limit, the input schema and the idempotency
 * guard before `execute` is called. What is left for a tool to do is the
 * DOMAIN work — and to do it as the launching human, through the existing
 * CRM / Communications OS service functions, so their authority checks,
 * revision guards and audit events all still apply. No lead-gen tool
 * writes to a table directly.
 */

/**
 * The human whose authority the agent acts under: the execution's owner.
 * This is the pattern Sales OS, Marketing OS and Communications OS agents
 * already use — never a separate agent-only bypass, so revoking a person's
 * CRM access immediately revokes what their agents can do on their behalf.
 */
export async function resolveActingUserId(ctx: ToolExecutionContext): Promise<string> {
  const execution = await resolveExecutionById(ctx.db, ctx.organizationId, ctx.executionId);
  return execution.ownerUserId;
}

export interface LeadBundle {
  lead: CrmLead;
  company: CrmCompany | null;
  contact: { id: string; displayName: string; primaryEmail: string | null; primaryPhone: string | null } | null;
  outreach: CompanyOutreachContext | null;
}

/** Reads a lead with everything outreach reasons about, tenant-scoped by construction. */
export async function loadLeadBundle(db: Db, organizationId: string, leadId: string): Promise<LeadBundle> {
  const lead = await resolveLeadById(db, organizationId, leadId);

  const company = lead.companyId
    ? ((await db.select().from(crmCompanies).where(and(eq(crmCompanies.id, lead.companyId), eq(crmCompanies.organizationId, organizationId))))[0] as CrmCompany | undefined) ?? null
    : null;

  const contactRow = lead.contactId
    ? (await db
        .select({ id: crmContacts.id, displayName: crmContacts.displayName, primaryEmail: crmContacts.primaryEmail, primaryPhone: crmContacts.primaryPhone })
        .from(crmContacts)
        .where(and(eq(crmContacts.id, lead.contactId), eq(crmContacts.organizationId, organizationId))))[0] ?? null
    : null;

  return {
    lead,
    company,
    contact: contactRow,
    outreach: company ? resolveCompanyOutreachContext(company, contactRow) : null,
  };
}

/** A bounded, credential-free lead projection — what a tool is allowed to hand back to a model. */
export function summarizeLead(bundle: LeadBundle) {
  const { lead, company, contact, outreach } = bundle;
  return {
    leadId: lead.id,
    status: lead.status,
    score: lead.score,
    revision: lead.revision,
    qualificationNotes: lead.qualificationNotes,
    nextAction: lead.nextAction,
    company: company
      ? {
          companyId: company.id,
          name: company.name,
          revision: company.revision,
          industry: company.industry,
          website: company.website,
          phone: company.phone,
          city: outreach?.facts.city ?? null,
          countryCode: outreach?.facts.countryCode ?? null,
          rating: outreach?.facts.rating ?? null,
          reviewCount: outreach?.facts.reviewCount ?? null,
        }
      : null,
    contact: contact ? { contactId: contact.id, displayName: contact.displayName, email: contact.primaryEmail, phone: contact.primaryPhone } : null,
    market: outreach?.market ? { code: outreach.market.code, priceDisplay: outreach.market.priceDisplay, senderPhone: outreach.market.senderPhoneDisplay } : null,
    demo: {
      url: outreach?.demoUrl ?? null,
      reviewed: Boolean(outreach?.review),
      qualityScore: outreach?.eligibility.score ?? null,
      eligibleForOutreach: outreach?.eligibility.eligible ?? false,
      eligibilityReason: outreach?.eligibility.reason ?? "never_reviewed",
      eligibilityDetail: outreach?.eligibility.detail ?? "No prospect company is linked to this lead.",
    },
  };
}

export class LeadGenToolError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "LeadGenToolError";
    this.reason = reason;
  }
}
