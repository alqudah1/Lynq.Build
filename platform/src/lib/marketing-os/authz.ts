import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingRoleAssignments } from "@/db/schema";
import { requireOrganizationMembership, type OrganizationRole } from "@/lib/authz/helpers";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import type { MarketingRole, MarketingCapability } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Marketing OS authorization — Module 15
 * ============================================================================
 * Deliberately independent from CRM/Sales/Brain/Workflow/Projects
 * authorization — a Marketing OS role never implies any of those, and none
 * of those imply Marketing OS access. Any action that also touches a CRM
 * record must pass BOTH this gate AND CRM Core's own authority check —
 * every Marketing OS service function that reads/writes CRM data does so
 * exclusively through real CRM Core service functions (`getLeadForUser`,
 * `listLeadsForUser`, etc.), which enforce `requireCrmViewAuthority`/
 * `requireCrmManageAuthority` internally on every call. Marketing OS never
 * bypasses that by querying `crm_*` tables directly for anything beyond a
 * safe, reviewed audience-evaluation read (see `audience-filters.ts`).
 *
 * One active role per user per organization (`marketing_role_assignments`).
 * Capabilities are derived from the role via the static map below — code
 * never checks `role === "marketing_admin"` directly except inside this
 * map. Organization owner/admin may always bootstrap/manage Marketing OS
 * configuration, exactly like CRM/Sales OS, even with no explicit
 * `marketing_role_assignments` row yet — modeled as an implicit
 * `marketing_admin` capability set for org owner/admin, not as a stored
 * role.
 */
export interface MarketingAuthContext {
  organizationId: string;
  actorUserId: string;
  orgRole: OrganizationRole;
  marketingRole: MarketingRole | null;
}

const ROLE_CAPABILITIES: Record<MarketingRole, MarketingCapability[]> = {
  marketing_admin: [
    "marketing_view",
    "marketing_create_campaigns",
    "marketing_manage_campaigns",
    "marketing_manage_content",
    "marketing_manage_audiences",
    "marketing_manage_budget",
    "marketing_approve_content",
    "marketing_manage_playbooks",
    "marketing_admin",
  ],
  marketing_manager: ["marketing_view", "marketing_create_campaigns", "marketing_manage_campaigns", "marketing_manage_content", "marketing_manage_audiences", "marketing_manage_budget", "marketing_approve_content"],
  marketing_contributor: ["marketing_view", "marketing_create_campaigns", "marketing_manage_content"],
  viewer: ["marketing_view"],
};

function isOrgAdmin(ctx: Pick<MarketingAuthContext, "orgRole">): boolean {
  return ctx.orgRole === "owner" || ctx.orgRole === "admin";
}

/** True if this context — via org-admin bootstrap authority OR its stored Marketing OS role — holds the given capability. */
export function hasMarketingCapability(ctx: MarketingAuthContext, capability: MarketingCapability): boolean {
  if (isOrgAdmin(ctx)) return true;
  if (!ctx.marketingRole) return false;
  return ROLE_CAPABILITIES[ctx.marketingRole].includes(capability);
}

export async function resolveMarketingAuthContext(db: Db, input: { organizationId: string; actorUserId: string }): Promise<MarketingAuthContext> {
  const orgMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const [roleRow] = await db
    .select({ role: marketingRoleAssignments.role })
    .from(marketingRoleAssignments)
    .where(and(eq(marketingRoleAssignments.organizationId, input.organizationId), eq(marketingRoleAssignments.userId, input.actorUserId), isNull(marketingRoleAssignments.revokedAt)));

  return { organizationId: input.organizationId, actorUserId: input.actorUserId, orgRole: orgMembership.role, marketingRole: roleRow?.role ?? null };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function denyAndAudit(db: Db, ctx: MarketingAuthContext, targetType: string, targetId: string, capability: MarketingCapability): Promise<never> {
  const isRealId = UUID_PATTERN.test(targetId);
  const detail = `requires the "${capability}" Marketing OS capability`;
  await recordAuditEvent(db, {
    eventType: "marketing_permission_denied",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType,
    targetId: isRealId ? targetId : null,
    metadata: isRealId ? { detail, capability } : { detail, capability, attemptedTarget: targetId },
  });
  throw new InsufficientRoleError(detail);
}

/** The one generic guard every specific `requireMarketingXAuthority` below delegates to. */
export async function requireMarketingCapability(db: Db, ctx: MarketingAuthContext, capability: MarketingCapability, targetType: string, targetId: string): Promise<void> {
  if (hasMarketingCapability(ctx, capability)) return;
  await denyAndAudit(db, ctx, targetType, targetId, capability);
}

export async function requireMarketingViewAuthority(db: Db, ctx: MarketingAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireMarketingCapability(db, ctx, "marketing_view", targetType, targetId);
}
export async function requireMarketingCreateCampaignsAuthority(db: Db, ctx: MarketingAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireMarketingCapability(db, ctx, "marketing_create_campaigns", targetType, targetId);
}
export async function requireMarketingManageCampaignsAuthority(db: Db, ctx: MarketingAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireMarketingCapability(db, ctx, "marketing_manage_campaigns", targetType, targetId);
}
export async function requireMarketingManageContentAuthority(db: Db, ctx: MarketingAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireMarketingCapability(db, ctx, "marketing_manage_content", targetType, targetId);
}
export async function requireMarketingManageAudiencesAuthority(db: Db, ctx: MarketingAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireMarketingCapability(db, ctx, "marketing_manage_audiences", targetType, targetId);
}
export async function requireMarketingManageBudgetAuthority(db: Db, ctx: MarketingAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireMarketingCapability(db, ctx, "marketing_manage_budget", targetType, targetId);
}
export async function requireMarketingApproveContentAuthority(db: Db, ctx: MarketingAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireMarketingCapability(db, ctx, "marketing_approve_content", targetType, targetId);
}
export async function requireMarketingManagePlaybooksAuthority(db: Db, ctx: MarketingAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireMarketingCapability(db, ctx, "marketing_manage_playbooks", targetType, targetId);
}
export async function requireMarketingAdminAuthority(db: Db, ctx: MarketingAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireMarketingCapability(db, ctx, "marketing_admin", targetType, targetId);
}
