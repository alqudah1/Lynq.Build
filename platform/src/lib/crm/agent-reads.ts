import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmContacts, crmCompanies, crmLeads, crmOpportunities, crmActivities, crmNotes } from "@/db/schema";
import type { AgentPrincipal } from "@/lib/agents/authentication";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { agentHasCrmPermission } from "./agent-permissions";
import type { CrmContact } from "./contacts";
import type { CrmCompany } from "./companies";
import type { CrmLead } from "./leads";
import type { CrmOpportunity } from "./opportunities";
import type { CrmActivity } from "./activities";
import type { CrmNote } from "./notes";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const AGENT_READ_LIMIT = 50;

/**
 * ============================================================================
 * Agent-readable CRM context — Module 12
 * ============================================================================
 * The one gate every agent-facing CRM read goes through: an explicit,
 * active `crmAgentPermissionGrants` row for this exact agent and this
 * exact permission. Default deny — an agent's Brain grants, department,
 * or permission level are never consulted here. A denied read is
 * audited (`crm_permission_denied`) before throwing, mirroring every
 * other CRM authorization denial in this module.
 */
async function requireAgentCrmPermission(db: Db, principal: AgentPrincipal, permission: Parameters<typeof agentHasCrmPermission>[3]): Promise<void> {
  const allowed = await agentHasCrmPermission(db, principal.organizationId, principal.agentId, permission);
  if (allowed) return;
  // `permission` (e.g. "crm_contact_read") is not a UUID — `audit_logs.target_id` is a real uuid column, so the denied permission name is carried in metadata only, never as targetId.
  await recordAuditEvent(db, { eventType: "crm_permission_denied", actorAgentId: principal.agentId, organizationId: principal.organizationId, targetType: "crm_agent_read", metadata: { detail: `agent lacks ${permission}`, permission } });
  throw new InsufficientRoleError(`This agent does not hold the "${permission}" CRM grant`);
}

export async function listContactsForAgent(db: Db, principal: AgentPrincipal): Promise<CrmContact[]> {
  await requireAgentCrmPermission(db, principal, "crm_contact_read");
  const rows = await db.select().from(crmContacts).where(and(eq(crmContacts.organizationId, principal.organizationId), eq(crmContacts.status, "active"))).limit(AGENT_READ_LIMIT);
  return rows as CrmContact[];
}

export async function getContactForAgent(db: Db, principal: AgentPrincipal, contactId: string): Promise<CrmContact | null> {
  await requireAgentCrmPermission(db, principal, "crm_contact_read");
  const [row] = await db.select().from(crmContacts).where(and(eq(crmContacts.id, contactId), eq(crmContacts.organizationId, principal.organizationId)));
  return (row as CrmContact) ?? null;
}

export async function listCompaniesForAgent(db: Db, principal: AgentPrincipal): Promise<CrmCompany[]> {
  await requireAgentCrmPermission(db, principal, "crm_company_read");
  const rows = await db.select().from(crmCompanies).where(and(eq(crmCompanies.organizationId, principal.organizationId), eq(crmCompanies.status, "active"))).limit(AGENT_READ_LIMIT);
  return rows as CrmCompany[];
}

export async function getCompanyForAgent(db: Db, principal: AgentPrincipal, companyId: string): Promise<CrmCompany | null> {
  await requireAgentCrmPermission(db, principal, "crm_company_read");
  const [row] = await db.select().from(crmCompanies).where(and(eq(crmCompanies.id, companyId), eq(crmCompanies.organizationId, principal.organizationId)));
  return (row as CrmCompany) ?? null;
}

export async function listLeadsForAgent(db: Db, principal: AgentPrincipal): Promise<CrmLead[]> {
  await requireAgentCrmPermission(db, principal, "crm_lead_read");
  const rows = await db.select().from(crmLeads).where(eq(crmLeads.organizationId, principal.organizationId)).limit(AGENT_READ_LIMIT);
  return rows as CrmLead[];
}

export async function getLeadForAgent(db: Db, principal: AgentPrincipal, leadId: string): Promise<CrmLead | null> {
  await requireAgentCrmPermission(db, principal, "crm_lead_read");
  const [row] = await db.select().from(crmLeads).where(and(eq(crmLeads.id, leadId), eq(crmLeads.organizationId, principal.organizationId)));
  return (row as CrmLead) ?? null;
}

export async function listOpportunitiesForAgent(db: Db, principal: AgentPrincipal): Promise<CrmOpportunity[]> {
  await requireAgentCrmPermission(db, principal, "crm_opportunity_read");
  const rows = await db.select().from(crmOpportunities).where(eq(crmOpportunities.organizationId, principal.organizationId)).limit(AGENT_READ_LIMIT);
  return rows as CrmOpportunity[];
}

export async function getOpportunityForAgent(db: Db, principal: AgentPrincipal, opportunityId: string): Promise<CrmOpportunity | null> {
  await requireAgentCrmPermission(db, principal, "crm_opportunity_read");
  const [row] = await db.select().from(crmOpportunities).where(and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.organizationId, principal.organizationId)));
  return (row as CrmOpportunity) ?? null;
}

export async function listActivitiesForAgent(db: Db, principal: AgentPrincipal, input: { contactId?: string; companyId?: string; leadId?: string; opportunityId?: string }): Promise<CrmActivity[]> {
  await requireAgentCrmPermission(db, principal, "crm_activity_read");
  const conditions = [eq(crmActivities.organizationId, principal.organizationId)];
  if (input.contactId) conditions.push(eq(crmActivities.contactId, input.contactId));
  if (input.companyId) conditions.push(eq(crmActivities.companyId, input.companyId));
  if (input.leadId) conditions.push(eq(crmActivities.leadId, input.leadId));
  if (input.opportunityId) conditions.push(eq(crmActivities.opportunityId, input.opportunityId));
  const rows = await db.select().from(crmActivities).where(and(...conditions)).limit(AGENT_READ_LIMIT);
  return rows as CrmActivity[];
}

export async function listNotesForAgent(db: Db, principal: AgentPrincipal, input: { contactId?: string; companyId?: string; leadId?: string; opportunityId?: string }): Promise<CrmNote[]> {
  await requireAgentCrmPermission(db, principal, "crm_note_read");
  const conditions = [eq(crmNotes.organizationId, principal.organizationId)];
  if (input.contactId) conditions.push(eq(crmNotes.contactId, input.contactId));
  if (input.companyId) conditions.push(eq(crmNotes.companyId, input.companyId));
  if (input.leadId) conditions.push(eq(crmNotes.leadId, input.leadId));
  if (input.opportunityId) conditions.push(eq(crmNotes.opportunityId, input.opportunityId));
  const rows = await db.select().from(crmNotes).where(and(...conditions)).limit(AGENT_READ_LIMIT);
  return (rows as CrmNote[]).filter((n) => !n.archivedAt);
}
