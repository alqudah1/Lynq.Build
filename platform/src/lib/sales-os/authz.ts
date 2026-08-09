import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { salesRoleAssignments } from "@/db/schema";
import { requireOrganizationMembership, type OrganizationRole } from "@/lib/authz/helpers";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { isTeamManagerOfRep } from "./teams";
import type { SalesRole, SalesCapability } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Sales OS authorization — Module 13
 * ============================================================================
 * Deliberately independent from CRM/Brain/Workflow/Projects authorization —
 * a Sales OS role never implies any of those, and none of those imply Sales
 * OS access. Any action that also touches a CRM record (converting a lead,
 * moving an opportunity stage, reassigning ownership) must pass BOTH this
 * gate AND CRM Core's own authority check — in practice this happens
 * automatically wherever a Sales OS service function calls through to a
 * real CRM Core service function (e.g. `qualifyLead`, `updateOpportunity`),
 * since those functions enforce `requireCrmManageAuthority` internally on
 * every call. Sales OS never bypasses that by writing to `crm_*` tables
 * directly.
 *
 * One active role per user per organization (`sales_role_assignments`).
 * Capabilities are derived from the role via the static map below — code
 * never checks `role === "sales_admin"` directly except inside this map,
 * so "map capabilities rather than relying only on role labels" holds even
 * though storage is a single role column (the smallest safe model).
 *
 * Organization owner/admin may always bootstrap/manage Sales OS
 * configuration, exactly as the spec requires, even with no explicit
 * sales_role_assignments row yet — modeled as an implicit `sales_admin`
 * capability set for org owner/admin, not as a stored role.
 */
export interface SalesAuthContext {
  organizationId: string;
  actorUserId: string;
  orgRole: OrganizationRole;
  salesRole: SalesRole | null;
}

const ROLE_CAPABILITIES: Record<SalesRole, SalesCapability[]> = {
  sales_admin: [
    "sales_view",
    "sales_work_leads",
    "sales_manage_own_opportunities",
    "sales_manage_team_opportunities",
    "sales_assign_leads",
    "sales_manage_playbooks",
    "sales_manage_forecasts",
    "sales_manage_targets",
    "sales_admin",
  ],
  sales_manager: ["sales_view", "sales_work_leads", "sales_manage_own_opportunities", "sales_manage_team_opportunities", "sales_assign_leads", "sales_manage_forecasts"],
  sales_rep: ["sales_view", "sales_work_leads", "sales_manage_own_opportunities"],
  viewer: ["sales_view"],
};

function isOrgAdmin(ctx: Pick<SalesAuthContext, "orgRole">): boolean {
  return ctx.orgRole === "owner" || ctx.orgRole === "admin";
}

/** True if this context — via org-admin bootstrap authority OR its stored Sales OS role — holds the given capability. */
export function hasSalesCapability(ctx: SalesAuthContext, capability: SalesCapability): boolean {
  if (isOrgAdmin(ctx)) return true;
  if (!ctx.salesRole) return false;
  return ROLE_CAPABILITIES[ctx.salesRole].includes(capability);
}

export async function resolveSalesAuthContext(db: Db, input: { organizationId: string; actorUserId: string }): Promise<SalesAuthContext> {
  const orgMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const [roleRow] = await db
    .select({ role: salesRoleAssignments.role })
    .from(salesRoleAssignments)
    .where(and(eq(salesRoleAssignments.organizationId, input.organizationId), eq(salesRoleAssignments.userId, input.actorUserId), isNull(salesRoleAssignments.revokedAt)));

  return { organizationId: input.organizationId, actorUserId: input.actorUserId, orgRole: orgMembership.role, salesRole: roleRow?.role ?? null };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function denyAndAudit(db: Db, ctx: SalesAuthContext, targetType: string, targetId: string, capability: SalesCapability): Promise<never> {
  const isRealId = UUID_PATTERN.test(targetId);
  const detail = `requires the "${capability}" Sales OS capability`;
  await recordAuditEvent(db, {
    eventType: "sales_permission_denied",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType,
    targetId: isRealId ? targetId : null,
    metadata: isRealId ? { detail, capability } : { detail, capability, attemptedTarget: targetId },
  });
  throw new InsufficientRoleError(detail);
}

/** The one generic guard every specific `requireSalesXAuthority` below delegates to. */
export async function requireSalesCapability(db: Db, ctx: SalesAuthContext, capability: SalesCapability, targetType: string, targetId: string): Promise<void> {
  if (hasSalesCapability(ctx, capability)) return;
  await denyAndAudit(db, ctx, targetType, targetId, capability);
}

export async function requireSalesViewAuthority(db: Db, ctx: SalesAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireSalesCapability(db, ctx, "sales_view", targetType, targetId);
}
export async function requireSalesWorkLeadsAuthority(db: Db, ctx: SalesAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireSalesCapability(db, ctx, "sales_work_leads", targetType, targetId);
}
export async function requireSalesAssignLeadsAuthority(db: Db, ctx: SalesAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireSalesCapability(db, ctx, "sales_assign_leads", targetType, targetId);
}
export async function requireSalesManagePlaybooksAuthority(db: Db, ctx: SalesAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireSalesCapability(db, ctx, "sales_manage_playbooks", targetType, targetId);
}
export async function requireSalesManageForecastsAuthority(db: Db, ctx: SalesAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireSalesCapability(db, ctx, "sales_manage_forecasts", targetType, targetId);
}
export async function requireSalesManageTargetsAuthority(db: Db, ctx: SalesAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireSalesCapability(db, ctx, "sales_manage_targets", targetType, targetId);
}
export async function requireSalesAdminAuthority(db: Db, ctx: SalesAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireSalesCapability(db, ctx, "sales_admin", targetType, targetId);
}

/**
 * A rep may manage an opportunity they own; a manager (or admin) may manage
 * any opportunity within the organization's Sales OS scope. Ownership is
 * read from the CRM opportunity itself (`ownerUserId`), never duplicated —
 * this function only decides Sales OS authority, the underlying CRM write
 * still separately enforces `requireCrmManageAuthority`.
 */
export async function requireSalesOpportunityWorkAuthority(db: Db, ctx: SalesAuthContext, opportunity: { id: string; ownerUserId: string | null }): Promise<void> {
  if (hasSalesCapability(ctx, "sales_manage_team_opportunities")) return;
  if (hasSalesCapability(ctx, "sales_manage_own_opportunities") && opportunity.ownerUserId === ctx.actorUserId) return;
  await denyAndAudit(db, ctx, "crm_opportunity", opportunity.id, "sales_manage_own_opportunities");
}

/** A rep may work a lead they own; sales_assign_leads or an org admin may work/reassign any lead. */
export async function requireSalesLeadWorkAuthority(db: Db, ctx: SalesAuthContext, lead: { id: string; ownerUserId: string | null }): Promise<void> {
  if (hasSalesCapability(ctx, "sales_assign_leads")) return;
  if (hasSalesCapability(ctx, "sales_work_leads") && lead.ownerUserId === ctx.actorUserId) return;
  await denyAndAudit(db, ctx, "crm_lead", lead.id, "sales_work_leads");
}

/**
 * ============================================================================
 * Module 14 — narrow lead qualification/disqualification authority
 * ============================================================================
 * Deliberately NARROWER than `requireSalesLeadWorkAuthority` (which lets
 * `sales_assign_leads` — i.e. any sales_manager/sales_admin — work ANY
 * lead org-wide): the final act of qualifying or disqualifying a lead is
 * scoped to real Sales team membership, never broadened to "manager holds
 * this capability, therefore org-wide." Passes for exactly one of:
 *   - `sales_admin` capability (org admin's implicit bootstrap, or an
 *     explicit sales_admin role) — org-wide, matching CRM's own org-admin
 *     floor for this same action.
 *   - `sales_work_leads` AND the lead is assigned to the caller.
 *   - `sales_assign_leads` (manager-tier) AND the lead has an assigned
 *     owner AND that owner is on a real Sales team this caller manages
 *     (`isTeamManagerOfRep`) — never true for an UNASSIGNED lead, since
 *     there is no rep to check team membership against; an unassigned
 *     lead's qualification requires an explicit admin decision, not an
 *     assumed manager grant. This is the one deliberate difference from
 *     `requireSalesLeadWorkAuthority`'s existing (broader) manager rule —
 *     scoped to qualification/disqualification only, per the Module 14
 *     spec's explicit instruction not to redesign Sales OS authorization
 *     more broadly than this one action.
 * This is only the Sales-OS half of the Module 14 dual gate — the CRM
 * write itself additionally re-derives its own narrow authority via
 * `requireCrmLeadQualificationAuthority` before ever transitioning the
 * lead's status.
 */
export async function requireSalesLeadQualificationAuthority(db: Db, ctx: SalesAuthContext, lead: { id: string; ownerUserId: string | null }): Promise<void> {
  if (hasSalesCapability(ctx, "sales_admin")) return;
  if (hasSalesCapability(ctx, "sales_work_leads") && lead.ownerUserId === ctx.actorUserId) return;
  if (hasSalesCapability(ctx, "sales_assign_leads") && lead.ownerUserId) {
    const managesRepsTeam = await isTeamManagerOfRep(db, { organizationId: ctx.organizationId, managerUserId: ctx.actorUserId, repUserId: lead.ownerUserId });
    if (managesRepsTeam) return;
  }
  await denyAndAudit(db, ctx, "crm_lead", lead.id, "sales_work_leads");
}
