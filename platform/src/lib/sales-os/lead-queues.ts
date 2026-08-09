import "server-only";
import { and, eq, isNull, isNotNull, notInArray, inArray, lt, gte, notExists, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmLeads, salesLeadQualificationRuns, salesTeamMembers } from "@/db/schema";
import type { CrmLead } from "@/lib/crm/leads";
import type { CrmLeadStatus } from "@/lib/crm/validation";
import { resolveSalesAuthContext, requireSalesViewAuthority } from "./authz";
import { resolveEffectiveSalesConfiguration } from "./configuration";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const LEAD_QUEUES = ["unassigned", "new", "contacted", "engaged", "qualification_due", "stale", "qualified", "disqualified"] as const;
export type LeadQueue = (typeof LEAD_QUEUES)[number];

export interface LeadQueueFilters {
  ownerUserId?: string;
  teamId?: string;
  status?: CrmLeadStatus;
  sourceId?: string;
  companyId?: string;
  minAgeDays?: number;
  maxAgeDays?: number;
  limit?: number;
}

const NOT_STARTED_QUALIFICATION_STATUSES = ["in_progress", "waiting", "qualified", "disqualified"] as const;

/** Builds and runs the queue query — no authorization check of its own; every caller in this file performs its own single check first. */
async function queryLeadQueue(db: Db, input: { organizationId: string; workspaceId?: string | null; queue: LeadQueue } & LeadQueueFilters): Promise<CrmLead[]> {
  const conditions = [eq(crmLeads.organizationId, input.organizationId)];

  switch (input.queue) {
    case "unassigned":
      conditions.push(isNull(crmLeads.ownerUserId), notInArray(crmLeads.status, ["converted", "disqualified"]));
      break;
    case "new":
      conditions.push(eq(crmLeads.status, "new"));
      break;
    case "contacted":
      conditions.push(eq(crmLeads.status, "contacted"));
      break;
    case "engaged":
      conditions.push(eq(crmLeads.status, "engaged"));
      break;
    case "qualified":
      conditions.push(eq(crmLeads.status, "qualified"));
      break;
    case "disqualified":
      conditions.push(eq(crmLeads.status, "disqualified"));
      break;
    case "qualification_due":
      conditions.push(
        inArray(crmLeads.status, ["new", "contacted", "engaged"]),
        isNotNull(crmLeads.ownerUserId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(salesLeadQualificationRuns)
            .where(and(eq(salesLeadQualificationRuns.leadId, crmLeads.id), inArray(salesLeadQualificationRuns.status, [...NOT_STARTED_QUALIFICATION_STATUSES])))
        )
      );
      break;
    case "stale": {
      const config = await resolveEffectiveSalesConfiguration(db, input.organizationId, input.workspaceId ?? null);
      const threshold = new Date(Date.now() - config.staleLeadThresholdDays * 24 * 60 * 60 * 1000);
      conditions.push(inArray(crmLeads.status, ["new", "contacted", "engaged", "qualified"]), lt(crmLeads.updatedAt, threshold));
      break;
    }
  }

  if (input.ownerUserId) conditions.push(eq(crmLeads.ownerUserId, input.ownerUserId));
  if (input.status) conditions.push(eq(crmLeads.status, input.status));
  if (input.sourceId) conditions.push(eq(crmLeads.sourceId, input.sourceId));
  if (input.companyId) conditions.push(eq(crmLeads.companyId, input.companyId));
  if (input.minAgeDays !== undefined) conditions.push(lt(crmLeads.createdAt, new Date(Date.now() - input.minAgeDays * 24 * 60 * 60 * 1000)));
  if (input.maxAgeDays !== undefined) conditions.push(gte(crmLeads.createdAt, new Date(Date.now() - input.maxAgeDays * 24 * 60 * 60 * 1000)));

  let ownerFilterFromTeam: string[] | null = null;
  if (input.teamId) {
    const members = await db.select({ userId: salesTeamMembers.userId }).from(salesTeamMembers).where(and(eq(salesTeamMembers.organizationId, input.organizationId), eq(salesTeamMembers.teamId, input.teamId)));
    ownerFilterFromTeam = members.map((m) => m.userId);
    conditions.push(ownerFilterFromTeam.length > 0 ? inArray(crmLeads.ownerUserId, ownerFilterFromTeam) : sql`false`);
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  return db
    .select()
    .from(crmLeads)
    .where(and(...conditions))
    .orderBy(crmLeads.updatedAt)
    .limit(limit) as unknown as Promise<CrmLead[]>;
}

/**
 * Queue membership is always derived at read time from CRM lead state plus
 * bounded Sales OS process state — never a stored/duplicated list. Every
 * queue name maps to one deterministic WHERE clause.
 */
export async function listLeadsInQueue(db: Db, input: { organizationId: string; workspaceId?: string | null; queue: LeadQueue; actorUserId: string } & LeadQueueFilters): Promise<CrmLead[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_lead_queue", input.queue);
  return queryLeadQueue(db, input);
}

/** Counts for every queue in one call — the shape the lead-queues UI/dashboard reads. One authorization check, then eight independent bounded queries. */
export async function countLeadsPerQueue(db: Db, input: { organizationId: string; workspaceId?: string | null; actorUserId: string }): Promise<Record<LeadQueue, number>> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_lead_queue", "counts");

  const results = {} as Record<LeadQueue, number>;
  for (const queue of LEAD_QUEUES) {
    const rows = await queryLeadQueue(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, queue, limit: 200 });
    results[queue] = rows.length;
  }
  return results;
}
