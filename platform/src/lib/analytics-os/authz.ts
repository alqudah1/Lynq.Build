import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { analyticsRoleAssignments } from "@/db/schema";
import { requireOrganizationMembership, type OrganizationRole } from "@/lib/authz/helpers";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import type { AnalyticsRole, AnalyticsCapability } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Analytics OS authorization — Module 17
 * ============================================================================
 * Independent from CRM/Sales/Marketing/Communications/Brain authorization —
 * an Analytics role never implies any of those, and none of those imply
 * Analytics access. "Analytics permission alone must NOT bypass source-
 * module privacy" is the load-bearing rule: every metric compute function
 * that reads a source module's own tables ALSO calls that module's own
 * aggregate-safe view-authority check (`requireCrmViewAuthority`,
 * `requireSalesXAuthority`, etc.) — composed, never substituted. Drill-down
 * additionally goes through the source module's own real per-record read
 * function (`getLeadForUser`, `getOpportunityForUser`, …), inheriting its
 * full authorization, never a bypass.
 */
export interface AnalyticsAuthContext {
  organizationId: string;
  actorUserId: string;
  orgRole: OrganizationRole;
  analyticsRole: AnalyticsRole | null;
}

const ROLE_CAPABILITIES: Record<AnalyticsRole, AnalyticsCapability[]> = {
  analytics_admin: [
    "analytics_view",
    "analytics_view_sales",
    "analytics_view_marketing",
    "analytics_view_crm",
    "analytics_view_communications",
    "analytics_view_projects",
    "analytics_view_workflows",
    "analytics_view_agents",
    "analytics_manage_reports",
    "analytics_admin",
  ],
  analytics_manager: [
    "analytics_view",
    "analytics_view_sales",
    "analytics_view_marketing",
    "analytics_view_crm",
    "analytics_view_communications",
    "analytics_view_projects",
    "analytics_view_workflows",
    "analytics_view_agents",
    "analytics_manage_reports",
  ],
  viewer: ["analytics_view", "analytics_view_sales", "analytics_view_marketing", "analytics_view_crm", "analytics_view_communications", "analytics_view_projects", "analytics_view_workflows", "analytics_view_agents"],
};

function isOrgAdmin(ctx: Pick<AnalyticsAuthContext, "orgRole">): boolean {
  return ctx.orgRole === "owner" || ctx.orgRole === "admin";
}

export function hasAnalyticsCapability(ctx: AnalyticsAuthContext, capability: AnalyticsCapability): boolean {
  if (isOrgAdmin(ctx)) return true;
  if (!ctx.analyticsRole) return false;
  return ROLE_CAPABILITIES[ctx.analyticsRole].includes(capability);
}

export async function resolveAnalyticsAuthContext(db: Db, input: { organizationId: string; actorUserId: string }): Promise<AnalyticsAuthContext> {
  const orgMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const [roleRow] = await db
    .select({ role: analyticsRoleAssignments.role })
    .from(analyticsRoleAssignments)
    .where(and(eq(analyticsRoleAssignments.organizationId, input.organizationId), eq(analyticsRoleAssignments.userId, input.actorUserId), isNull(analyticsRoleAssignments.revokedAt)));

  return { organizationId: input.organizationId, actorUserId: input.actorUserId, orgRole: orgMembership.role, analyticsRole: roleRow?.role ?? null };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function denyAndAudit(db: Db, ctx: AnalyticsAuthContext, targetType: string, targetId: string, capability: AnalyticsCapability): Promise<never> {
  const isRealId = UUID_PATTERN.test(targetId);
  const detail = `requires the "${capability}" Analytics capability`;
  await recordAuditEvent(db, {
    eventType: "analytics_permission_denied",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType,
    targetId: isRealId ? targetId : null,
    metadata: isRealId ? { detail, capability } : { detail, capability, attemptedTarget: targetId },
  });
  throw new InsufficientRoleError(detail);
}

export async function requireAnalyticsCapability(db: Db, ctx: AnalyticsAuthContext, capability: AnalyticsCapability, targetType: string, targetId: string): Promise<void> {
  if (hasAnalyticsCapability(ctx, capability)) return;
  await denyAndAudit(db, ctx, targetType, targetId, capability);
}

export async function requireAnalyticsViewAuthority(db: Db, ctx: AnalyticsAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireAnalyticsCapability(db, ctx, "analytics_view", targetType, targetId);
}
export async function requireAnalyticsManageReportsAuthority(db: Db, ctx: AnalyticsAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireAnalyticsCapability(db, ctx, "analytics_manage_reports", targetType, targetId);
}
export async function requireAnalyticsAdminAuthority(db: Db, ctx: AnalyticsAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireAnalyticsCapability(db, ctx, "analytics_admin", targetType, targetId);
}
