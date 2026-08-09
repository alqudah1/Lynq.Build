import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { founderRoleAssignments } from "@/db/schema";
import { requireOrganizationMembership, type OrganizationRole } from "@/lib/authz/helpers";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import type { FounderRole, FounderCapability } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Founder Workspace authorization — Module 18
 * ============================================================================
 * Independent from CRM/Sales/Marketing/Communications/Projects/Workflow/
 * Agent Runtime/Analytics OS authorization — a Founder Workspace role never
 * implies any of those, and none of those imply Founder Workspace access.
 * "Founder Workspace permission does not bypass source-module privacy" is
 * the load-bearing rule, identical in shape to Analytics OS's own dual
 * gate: every executive view independently re-checks Analytics OS's own
 * `analytics_view_<domain>` capability (which itself re-checks the SOURCE
 * module's own aggregate-safe view authority) — composed, never
 * substituted. Drill-down additionally requires the underlying source
 * module's own full record-level permission, exactly as Analytics OS's own
 * drill-down already enforces one layer down.
 */
export interface FounderAuthContext {
  organizationId: string;
  actorUserId: string;
  orgRole: OrganizationRole;
  founderRole: FounderRole | null;
}

const ROLE_CAPABILITIES: Record<FounderRole, FounderCapability[]> = {
  founder_viewer: ["founder_workspace_view", "founder_workspace_view_sales", "founder_workspace_view_marketing", "founder_workspace_view_operations", "founder_workspace_view_agents"],
  founder_executive: [
    "founder_workspace_view",
    "founder_workspace_view_financial",
    "founder_workspace_view_sales",
    "founder_workspace_view_marketing",
    "founder_workspace_view_operations",
    "founder_workspace_view_agents",
    "founder_workspace_manage_goals",
    "founder_workspace_manage_decisions",
    "founder_workspace_manage_layout",
  ],
  founder_admin: [
    "founder_workspace_view",
    "founder_workspace_view_financial",
    "founder_workspace_view_sales",
    "founder_workspace_view_marketing",
    "founder_workspace_view_operations",
    "founder_workspace_view_agents",
    "founder_workspace_manage_goals",
    "founder_workspace_manage_decisions",
    "founder_workspace_manage_layout",
    "founder_workspace_admin",
  ],
};

function isOrgAdmin(ctx: Pick<FounderAuthContext, "orgRole">): boolean {
  return ctx.orgRole === "owner" || ctx.orgRole === "admin";
}

export function hasFounderCapability(ctx: FounderAuthContext, capability: FounderCapability): boolean {
  if (isOrgAdmin(ctx)) return true;
  if (!ctx.founderRole) return false;
  return ROLE_CAPABILITIES[ctx.founderRole].includes(capability);
}

export async function resolveFounderAuthContext(db: Db, input: { organizationId: string; actorUserId: string }): Promise<FounderAuthContext> {
  const orgMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const [roleRow] = await db
    .select({ role: founderRoleAssignments.role })
    .from(founderRoleAssignments)
    .where(and(eq(founderRoleAssignments.organizationId, input.organizationId), eq(founderRoleAssignments.userId, input.actorUserId), isNull(founderRoleAssignments.revokedAt)));

  return { organizationId: input.organizationId, actorUserId: input.actorUserId, orgRole: orgMembership.role, founderRole: roleRow?.role ?? null };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function denyAndAudit(db: Db, ctx: FounderAuthContext, targetType: string, targetId: string, capability: FounderCapability): Promise<never> {
  const isRealId = UUID_PATTERN.test(targetId);
  const detail = `requires the "${capability}" Founder Workspace capability`;
  await recordAuditEvent(db, {
    eventType: "founder_permission_denied",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType,
    targetId: isRealId ? targetId : null,
    metadata: isRealId ? { detail, capability } : { detail, capability, attemptedTarget: targetId },
  });
  throw new InsufficientRoleError(detail);
}

export async function requireFounderCapability(db: Db, ctx: FounderAuthContext, capability: FounderCapability, targetType: string, targetId: string): Promise<void> {
  if (hasFounderCapability(ctx, capability)) return;
  await denyAndAudit(db, ctx, targetType, targetId, capability);
}

export async function requireFounderViewAuthority(db: Db, ctx: FounderAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireFounderCapability(db, ctx, "founder_workspace_view", targetType, targetId);
}
export async function requireFounderFinancialViewAuthority(db: Db, ctx: FounderAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireFounderCapability(db, ctx, "founder_workspace_view_financial", targetType, targetId);
}
export async function requireFounderManageGoalsAuthority(db: Db, ctx: FounderAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireFounderCapability(db, ctx, "founder_workspace_manage_goals", targetType, targetId);
}
export async function requireFounderManageDecisionsAuthority(db: Db, ctx: FounderAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireFounderCapability(db, ctx, "founder_workspace_manage_decisions", targetType, targetId);
}
export async function requireFounderManageLayoutAuthority(db: Db, ctx: FounderAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireFounderCapability(db, ctx, "founder_workspace_manage_layout", targetType, targetId);
}
export async function requireFounderAdminAuthority(db: Db, ctx: FounderAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireFounderCapability(db, ctx, "founder_workspace_admin", targetType, targetId);
}
