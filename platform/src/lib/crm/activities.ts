import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmActivities } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority, resolveCrmEntityWorkspaceId } from "./authz";
import { NoTargetSpecifiedError } from "./errors";
import type { CrmActivityType, CrmActivityDirection } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CrmActivity {
  id: string;
  organizationId: string;
  contactId: string | null;
  companyId: string | null;
  leadId: string | null;
  opportunityId: string | null;
  activityType: CrmActivityType;
  direction: CrmActivityDirection | null;
  occurredAt: Date;
  subject: string | null;
  summary: string | null;
  createdByUserId: string | null;
  agentId: string | null;
  externalReference: string | null;
  createdAt: Date;
}

async function resolveWorkspaceScope(db: Db, organizationId: string, input: { contactId?: string | null; companyId?: string | null; opportunityId?: string | null }): Promise<string | null> {
  if (input.contactId) return resolveCrmEntityWorkspaceId(db, organizationId, "contact", input.contactId);
  if (input.companyId) return resolveCrmEntityWorkspaceId(db, organizationId, "company", input.companyId);
  if (input.opportunityId) return resolveCrmEntityWorkspaceId(db, organizationId, "opportunity", input.opportunityId);
  return null;
}

export interface CreateActivityInput {
  organizationId: string;
  contactId?: string | null;
  companyId?: string | null;
  leadId?: string | null;
  opportunityId?: string | null;
  activityType: CrmActivityType;
  direction?: CrmActivityDirection;
  occurredAt?: Date;
  subject?: string;
  summary?: string;
  agentId?: string | null;
  externalReference?: string;
  actorUserId: string;
}

/**
 * Records one customer/prospect interaction event — append-only by
 * construction: no update or delete service function exists for this
 * table anywhere in this module, only create + list. Never stores raw
 * email bodies or call recordings; a future integration stores that
 * content separately and references it via `externalReference`.
 */
export async function createActivity(db: Db, input: CreateActivityInput): Promise<CrmActivity> {
  if (!input.contactId && !input.companyId && !input.leadId && !input.opportunityId) throw new NoTargetSpecifiedError("activity");

  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, input);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_activity", "new");

  const [row] = await db
    .insert(crmActivities)
    .values({
      organizationId: input.organizationId,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      leadId: input.leadId ?? null,
      opportunityId: input.opportunityId ?? null,
      activityType: input.activityType,
      direction: input.direction ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      subject: input.subject ?? null,
      summary: input.summary ?? null,
      createdByUserId: input.actorUserId,
      agentId: input.agentId ?? null,
      externalReference: input.externalReference ?? null,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "crm_activity_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_activity", targetId: row.id, metadata: { activityType: row.activityType } });
  return row as CrmActivity;
}

export interface ListActivitiesInput {
  organizationId: string;
  actorUserId: string;
  contactId?: string;
  companyId?: string;
  leadId?: string;
  opportunityId?: string;
  limit?: number;
}

export async function listActivitiesForUser(db: Db, input: ListActivitiesInput): Promise<CrmActivity[]> {
  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, input);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_activity", "list");

  const conditions = [eq(crmActivities.organizationId, input.organizationId)];
  if (input.contactId) conditions.push(eq(crmActivities.contactId, input.contactId));
  if (input.companyId) conditions.push(eq(crmActivities.companyId, input.companyId));
  if (input.leadId) conditions.push(eq(crmActivities.leadId, input.leadId));
  if (input.opportunityId) conditions.push(eq(crmActivities.opportunityId, input.opportunityId));

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db.select().from(crmActivities).where(and(...conditions)).orderBy(desc(crmActivities.occurredAt)).limit(limit);
  return rows as CrmActivity[];
}
