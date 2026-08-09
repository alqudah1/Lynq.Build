import "server-only";
import { and, eq, asc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmFollowUps } from "@/db/schema";
import { requireOrganizationMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority, resolveCrmEntityWorkspaceId } from "./authz";
import { NoTargetSpecifiedError, StaleCrmUpdateError, InvalidCrmTransitionError } from "./errors";
import type { CrmFollowUpStatus, CrmPriority } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/** Customer-facing sales/service follow-up — deliberately distinct from a `project_task` (operational project work) and a `workflow_human_task` (workflow execution work). Never reuses either. */
export interface CrmFollowUp {
  id: string;
  organizationId: string;
  contactId: string | null;
  companyId: string | null;
  leadId: string | null;
  opportunityId: string | null;
  assignedUserId: string;
  title: string;
  dueAt: Date | null;
  status: CrmFollowUpStatus;
  priority: CrmPriority;
  completedAt: Date | null;
  createdByUserId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

async function resolveWorkspaceScope(db: Db, organizationId: string, input: { contactId?: string | null; companyId?: string | null; opportunityId?: string | null }): Promise<string | null> {
  if (input.contactId) return resolveCrmEntityWorkspaceId(db, organizationId, "contact", input.contactId);
  if (input.companyId) return resolveCrmEntityWorkspaceId(db, organizationId, "company", input.companyId);
  if (input.opportunityId) return resolveCrmEntityWorkspaceId(db, organizationId, "opportunity", input.opportunityId);
  return null;
}

export interface CreateFollowUpInput {
  organizationId: string;
  contactId?: string | null;
  companyId?: string | null;
  leadId?: string | null;
  opportunityId?: string | null;
  assignedUserId: string;
  title: string;
  dueAt?: Date | null;
  priority?: CrmPriority;
  actorUserId: string;
}

export async function createFollowUp(db: Db, input: CreateFollowUpInput): Promise<CrmFollowUp> {
  if (!input.contactId && !input.companyId && !input.leadId && !input.opportunityId) throw new NoTargetSpecifiedError("follow-up");

  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, input);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_follow_up", "new");
  await requireOrganizationMembership(db, input.organizationId, input.assignedUserId);

  const [row] = await db
    .insert(crmFollowUps)
    .values({
      organizationId: input.organizationId,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      leadId: input.leadId ?? null,
      opportunityId: input.opportunityId ?? null,
      assignedUserId: input.assignedUserId,
      title: input.title,
      dueAt: input.dueAt ?? null,
      priority: input.priority ?? "normal",
      createdByUserId: input.actorUserId,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "crm_follow_up_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_follow_up", targetId: row.id, metadata: { priority: row.priority } });
  return row as CrmFollowUp;
}

export async function resolveFollowUpById(db: Db, organizationId: string, followUpId: string): Promise<CrmFollowUp> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(crmFollowUps).where(and(eq(crmFollowUps.id, followUpId), eq(crmFollowUps.organizationId, organizationId)));
    return row as CrmFollowUp | undefined;
  });
}

async function transitionFollowUp(db: Db, input: { organizationId: string; followUpId: string; expectedRevision: number; toStatus: "completed" | "cancelled"; actorUserId: string }): Promise<CrmFollowUp> {
  const existing = await resolveFollowUpById(db, input.organizationId, input.followUpId);
  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, existing);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_follow_up", existing.id);

  if (existing.status !== "open") throw new InvalidCrmTransitionError("follow-up", existing.status, input.toStatus);

  const [updated] = await db
    .update(crmFollowUps)
    .set({ status: input.toStatus, completedAt: input.toStatus === "completed" ? new Date() : null, updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(crmFollowUps.id, input.followUpId), eq(crmFollowUps.organizationId, input.organizationId), eq(crmFollowUps.revision, input.expectedRevision), eq(crmFollowUps.status, "open")))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("follow-up");
  await recordAuditEvent(db, { eventType: input.toStatus === "completed" ? "crm_follow_up_completed" : "crm_follow_up_cancelled", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_follow_up", targetId: updated.id });
  return updated as CrmFollowUp;
}

export async function completeFollowUp(db: Db, input: { organizationId: string; followUpId: string; expectedRevision: number; actorUserId: string }): Promise<CrmFollowUp> {
  return transitionFollowUp(db, { ...input, toStatus: "completed" });
}

export async function cancelFollowUp(db: Db, input: { organizationId: string; followUpId: string; expectedRevision: number; actorUserId: string }): Promise<CrmFollowUp> {
  return transitionFollowUp(db, { ...input, toStatus: "cancelled" });
}

export interface ListFollowUpsInput {
  organizationId: string;
  actorUserId: string;
  contactId?: string;
  companyId?: string;
  leadId?: string;
  opportunityId?: string;
  assignedUserId?: string;
  status?: CrmFollowUpStatus;
  limit?: number;
}

export async function listFollowUpsForUser(db: Db, input: ListFollowUpsInput): Promise<CrmFollowUp[]> {
  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, input);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_follow_up", "list");

  const conditions = [eq(crmFollowUps.organizationId, input.organizationId)];
  if (input.contactId) conditions.push(eq(crmFollowUps.contactId, input.contactId));
  if (input.companyId) conditions.push(eq(crmFollowUps.companyId, input.companyId));
  if (input.leadId) conditions.push(eq(crmFollowUps.leadId, input.leadId));
  if (input.opportunityId) conditions.push(eq(crmFollowUps.opportunityId, input.opportunityId));
  if (input.assignedUserId) conditions.push(eq(crmFollowUps.assignedUserId, input.assignedUserId));
  if (input.status) conditions.push(eq(crmFollowUps.status, input.status));

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db.select().from(crmFollowUps).where(and(...conditions)).orderBy(asc(crmFollowUps.dueAt)).limit(limit);
  return rows as CrmFollowUp[];
}
