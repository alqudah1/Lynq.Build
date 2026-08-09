import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workspaceMemberships, crmContacts, crmCompanies, crmOpportunities } from "@/db/schema";
import { requireOrganizationMembership, type OrganizationRole, type WorkspaceRole } from "@/lib/authz/helpers";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * CRM authorization — Module 12
 * ============================================================================
 * Deliberately independent from Brain permission grants and from Agent
 * Runtime/Projects/Workflow authorization — a CRM role never implies any of
 * those, and none of those ever imply CRM access.
 *
 * No generic department/CRM-manager role model exists yet in this codebase,
 * and the spec is explicit: do not invent a global role without review. The
 * smallest safe interim authority is therefore a two-tier model, identical
 * in shape to Workflow Engine authorization (Module 11):
 *   - VIEW: org owner/admin, or any org member (org-wide records), or any
 *     workspace member (workspace-scoped records).
 *   - MANAGE (create/update/archive/pipeline administration/custom fields/
 *     agent grants): org owner/admin, or the workspace's own manager for a
 *     workspace-scoped record.
 * Ordinary members get read access and nothing else this phase — granular
 * per-record sales-rep permissions are explicitly deferred to Sales OS.
 * Record ownership (`ownerUserId`) is a label only; it never overrides
 * these boundaries (spec: "ownership does not automatically override CRM
 * permission boundaries").
 */
export interface CrmAuthContext {
  organizationId: string;
  actorUserId: string;
  orgRole: OrganizationRole;
  workspaceRole: WorkspaceRole | null;
  isWorkspaceScoped: boolean;
}

function isOrgAdmin(ctx: Pick<CrmAuthContext, "orgRole">): boolean {
  return ctx.orgRole === "owner" || ctx.orgRole === "admin";
}

function isWorkspaceManager(ctx: Pick<CrmAuthContext, "isWorkspaceScoped" | "workspaceRole">): boolean {
  return ctx.isWorkspaceScoped && ctx.workspaceRole === "manager";
}

export async function resolveCrmAuthContext(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<CrmAuthContext> {
  const orgMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  let workspaceRole: WorkspaceRole | null = null;
  if (input.workspaceId) {
    const [wsRow] = await db.select({ role: workspaceMemberships.role }).from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, input.workspaceId), eq(workspaceMemberships.userId, input.actorUserId)));
    workspaceRole = wsRow?.role ?? null;
  }

  return { organizationId: input.organizationId, actorUserId: input.actorUserId, orgRole: orgMembership.role, workspaceRole, isWorkspaceScoped: Boolean(input.workspaceId) };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `audit_logs.target_id` is a real `uuid` column — a placeholder like
 * `"new"` or `"list"` (used by every create/list authority check below,
 * which has no existing entity to point at yet) must never be written to
 * it, or the INSERT itself fails with a Postgres type error, masking the
 * real `InsufficientRoleError` behind a raw DB exception. Only a
 * genuinely UUID-shaped id is ever passed through; anything else is kept
 * as free-text context in `metadata.detail` instead.
 */
async function denyAndAudit(db: Db, ctx: CrmAuthContext, targetType: string, targetId: string, detail: string): Promise<never> {
  const isRealId = UUID_PATTERN.test(targetId);
  await recordAuditEvent(db, {
    eventType: "crm_permission_denied",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType,
    targetId: isRealId ? targetId : null,
    metadata: isRealId ? { detail } : { detail, attemptedTarget: targetId },
  });
  throw new InsufficientRoleError(detail);
}

/** View a CRM record: org owner/admin, any workspace member (workspace-scoped record), or any organization member (org-wide record). */
export async function requireCrmViewAuthority(db: Db, ctx: CrmAuthContext, targetType: string, targetId: string): Promise<void> {
  if (isOrgAdmin(ctx)) return;
  if (ctx.isWorkspaceScoped ? ctx.workspaceRole !== null : true) return;
  await denyAndAudit(db, ctx, targetType, targetId, "requires workspace visibility");
}

/** Create/update/archive a CRM record, manage a pipeline, define a custom field, or manage a CRM agent grant: org owner/admin, or this workspace's own manager for a workspace-scoped record. */
export async function requireCrmManageAuthority(db: Db, ctx: CrmAuthContext, targetType: string, targetId: string): Promise<void> {
  if (isOrgAdmin(ctx) || isWorkspaceManager(ctx)) return;
  await denyAndAudit(db, ctx, targetType, targetId, "requires organization owner/admin, or workspace manager for a workspace-scoped record");
}

/** Org-wide CRM administration (pipelines, custom field definitions, agent permission grants): org owner/admin only — the one floor with no workspace-manager override, since these are cross-cutting configuration, not a single record. */
export async function requireCrmAdminAuthority(db: Db, ctx: CrmAuthContext, targetType: string, targetId: string): Promise<void> {
  if (isOrgAdmin(ctx)) return;
  await denyAndAudit(db, ctx, targetType, targetId, "requires organization owner/admin");
}

/**
 * ============================================================================
 * Module 14 — narrow lead qualification/disqualification authority
 * ============================================================================
 * A deliberately NARROW, operation-scoped authority for exactly one pair of
 * actions (qualify/disqualify a lead) — NOT a broadening of general CRM
 * manage authority, and not usable for anything else (editing a lead's
 * fields, converting it, or any other CRM write still requires the full
 * `requireCrmManageAuthority` floor). In addition to that same floor (org
 * owner/admin — leads carry no `workspaceId`, so no workspace-manager
 * escape hatch applies to them), the lead's own recorded assigned owner
 * may qualify/disqualify THIS lead and no other CRM record.
 *
 * CRM Core has no knowledge of Sales OS roles, capabilities, or — critically
 * — TEAMS here, so it cannot independently verify "caller manages this
 * lead's assigned rep's team" on its own; that specific condition can only
 * be verified by Sales OS's own authority gate
 * (`requireSalesLeadQualificationAuthority`), which its caller
 * (`sales-os/qualification.ts`) always runs BEFORE ever reaching this
 * function. `preAuthorizedBySalesOs` is how that already-completed Sales
 * decision is threaded through — never a blanket bypass: it only ever
 * fills the ONE gap CRM structurally cannot check itself (team scope);
 * the org-admin and lead-owner-self cases above are still independently
 * verified by CRM using its own data, with or without that flag. This
 * function is not part of any public/user-facing API — its only caller is
 * `qualifyLeadFromSales`/`disqualifyLeadFromSales`, reached only after the
 * Sales gate above has already run.
 */
export async function requireCrmLeadQualificationAuthority(db: Db, ctx: CrmAuthContext, lead: { id: string; ownerUserId: string | null }, options?: { preAuthorizedBySalesOs?: boolean }): Promise<void> {
  if (isOrgAdmin(ctx)) return;
  if (lead.ownerUserId && lead.ownerUserId === ctx.actorUserId) return;
  if (options?.preAuthorizedBySalesOs) return;
  await denyAndAudit(db, ctx, "crm_lead", lead.id, "requires organization owner/admin, or being this lead's own assigned owner");
}

/**
 * Resolves the workspace scope of a CRM entity for authorization purposes.
 * Contacts, companies, and opportunities carry their own `workspaceId`;
 * leads, activities, notes, and follow-ups do not (never denormalized) —
 * a lead/activity/note/follow-up is treated as org-wide-scoped for
 * authorization, since its own authority is really governed by whichever
 * linked contact/company/opportunity manage-authority check the calling
 * service already performs on create.
 */
export async function resolveCrmEntityWorkspaceId(db: Db, organizationId: string, entityType: "contact" | "company" | "opportunity", entityId: string): Promise<string | null> {
  if (entityType === "contact") {
    const [row] = await db.select({ workspaceId: crmContacts.workspaceId }).from(crmContacts).where(and(eq(crmContacts.id, entityId), eq(crmContacts.organizationId, organizationId)));
    return row?.workspaceId ?? null;
  }
  if (entityType === "company") {
    const [row] = await db.select({ workspaceId: crmCompanies.workspaceId }).from(crmCompanies).where(and(eq(crmCompanies.id, entityId), eq(crmCompanies.organizationId, organizationId)));
    return row?.workspaceId ?? null;
  }
  const [row] = await db.select({ workspaceId: crmOpportunities.workspaceId }).from(crmOpportunities).where(and(eq(crmOpportunities.id, entityId), eq(crmOpportunities.organizationId, organizationId)));
  return row?.workspaceId ?? null;
}
