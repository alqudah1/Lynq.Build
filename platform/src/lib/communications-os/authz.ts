import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationRoleAssignments } from "@/db/schema";
import { requireOrganizationMembership, type OrganizationRole } from "@/lib/authz/helpers";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import type { CommunicationRole, CommunicationCapability } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Communications OS authorization — Module 16
 * ============================================================================
 * Independent from CRM/Sales/Marketing/Brain/Workflow/Projects authorization
 * — a Communications role never implies any of those, and none of those
 * imply Communications access. This is the load-bearing rule the spec
 * states explicitly: "Do not let Sales or Marketing permissions
 * automatically grant sending ability." Where Sales OS or Marketing OS
 * initiates a communication (a sequence step, approved content), the
 * calling module's OWN permission must ALSO pass, composed with this gate
 * — never substituted by it. Where CRM data is touched (identity
 * resolution, CRM activity creation), CRM Core's own authority check must
 * ALSO pass, via the real CRM Core function it always calls.
 */
export interface CommunicationAuthContext {
  organizationId: string;
  actorUserId: string;
  orgRole: OrganizationRole;
  communicationRole: CommunicationRole | null;
}

const ROLE_CAPABILITIES: Record<CommunicationRole, CommunicationCapability[]> = {
  communications_admin: [
    "communications_view",
    "communications_draft",
    "communications_send",
    "communications_manage_templates",
    "communications_manage_connections",
    "communications_manage_consent",
    "communications_manage_bulk",
    "communications_admin",
  ],
  communications_manager: ["communications_view", "communications_draft", "communications_send", "communications_manage_templates", "communications_manage_consent", "communications_manage_bulk"],
  communications_agent: ["communications_view", "communications_draft", "communications_send"],
  viewer: ["communications_view"],
};

function isOrgAdmin(ctx: Pick<CommunicationAuthContext, "orgRole">): boolean {
  return ctx.orgRole === "owner" || ctx.orgRole === "admin";
}

export function hasCommunicationCapability(ctx: CommunicationAuthContext, capability: CommunicationCapability): boolean {
  if (isOrgAdmin(ctx)) return true;
  if (!ctx.communicationRole) return false;
  return ROLE_CAPABILITIES[ctx.communicationRole].includes(capability);
}

export async function resolveCommunicationAuthContext(db: Db, input: { organizationId: string; actorUserId: string }): Promise<CommunicationAuthContext> {
  const orgMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const [roleRow] = await db
    .select({ role: communicationRoleAssignments.role })
    .from(communicationRoleAssignments)
    .where(and(eq(communicationRoleAssignments.organizationId, input.organizationId), eq(communicationRoleAssignments.userId, input.actorUserId), isNull(communicationRoleAssignments.revokedAt)));

  return { organizationId: input.organizationId, actorUserId: input.actorUserId, orgRole: orgMembership.role, communicationRole: roleRow?.role ?? null };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function denyAndAudit(db: Db, ctx: CommunicationAuthContext, targetType: string, targetId: string, capability: CommunicationCapability): Promise<never> {
  const isRealId = UUID_PATTERN.test(targetId);
  const detail = `requires the "${capability}" Communications capability`;
  await recordAuditEvent(db, {
    eventType: "communication_send_permission_denied",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType,
    targetId: isRealId ? targetId : null,
    metadata: isRealId ? { detail, capability } : { detail, capability, attemptedTarget: targetId },
  });
  throw new InsufficientRoleError(detail);
}

export async function requireCommunicationCapability(db: Db, ctx: CommunicationAuthContext, capability: CommunicationCapability, targetType: string, targetId: string): Promise<void> {
  if (hasCommunicationCapability(ctx, capability)) return;
  await denyAndAudit(db, ctx, targetType, targetId, capability);
}

export async function requireCommunicationsViewAuthority(db: Db, ctx: CommunicationAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireCommunicationCapability(db, ctx, "communications_view", targetType, targetId);
}
export async function requireCommunicationsDraftAuthority(db: Db, ctx: CommunicationAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireCommunicationCapability(db, ctx, "communications_draft", targetType, targetId);
}
export async function requireCommunicationsSendAuthority(db: Db, ctx: CommunicationAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireCommunicationCapability(db, ctx, "communications_send", targetType, targetId);
}
export async function requireCommunicationsManageTemplatesAuthority(db: Db, ctx: CommunicationAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireCommunicationCapability(db, ctx, "communications_manage_templates", targetType, targetId);
}
export async function requireCommunicationsManageConnectionsAuthority(db: Db, ctx: CommunicationAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireCommunicationCapability(db, ctx, "communications_manage_connections", targetType, targetId);
}
export async function requireCommunicationsManageConsentAuthority(db: Db, ctx: CommunicationAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireCommunicationCapability(db, ctx, "communications_manage_consent", targetType, targetId);
}
export async function requireCommunicationsManageBulkAuthority(db: Db, ctx: CommunicationAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireCommunicationCapability(db, ctx, "communications_manage_bulk", targetType, targetId);
}
export async function requireCommunicationsAdminAuthority(db: Db, ctx: CommunicationAuthContext, targetType: string, targetId: string): Promise<void> {
  return requireCommunicationCapability(db, ctx, "communications_admin", targetType, targetId);
}
