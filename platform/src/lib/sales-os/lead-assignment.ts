import "server-only";
import { and, eq, inArray, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmLeads, auditLogs } from "@/db/schema";
import { getLeadForUser, updateLead, type CrmLead } from "@/lib/crm/leads";
import { recordAuditEvent } from "@/lib/audit";
import { resolveSalesAuthContext, requireSalesAssignLeadsAuthority } from "./authz";
import { NoEligibleAssigneeError, IneligibleAssigneeError } from "./errors";
import { listAssignmentEligibleUserIds } from "./roles";
import { resolveEffectiveSalesConfiguration } from "./configuration";
import type { SalesLeadAssignmentStrategy } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const OPEN_LEAD_STATUSES = ["new", "contacted", "engaged", "qualified"] as const;

/**
 * Explicit manual (re)assignment — the only place Sales OS ever changes
 * `crm_leads.owner_user_id`, and it does so exclusively through CRM Core's
 * own revision-guarded `updateLead`, never a direct write. Concurrent
 * assignment of the same lead is safe: both callers read the same
 * `expectedRevision`, and CRM's own `WHERE revision = expectedRevision`
 * guard lets only one succeed — the loser gets `StaleCrmUpdateError`, never
 * a silently-lost double assignment.
 */
export async function assignLead(db: Db, input: { organizationId: string; leadId: string; assigneeUserId: string; actorUserId: string }): Promise<CrmLead> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesAssignLeadsAuthority(db, ctx, "crm_lead", input.leadId);

  const eligible = await listAssignmentEligibleUserIds(db, input.organizationId);
  if (!eligible.includes(input.assigneeUserId)) throw new IneligibleAssigneeError("does not hold an active Sales OS rep/manager/admin role");

  const current = await getLeadForUser(db, { organizationId: input.organizationId, leadId: input.leadId, actorUserId: input.actorUserId });
  const wasUnassigned = current.ownerUserId === null;

  const updated = await updateLead(db, { organizationId: input.organizationId, leadId: input.leadId, expectedRevision: current.revision, ownerUserId: input.assigneeUserId, actorUserId: input.actorUserId });

  await recordAuditEvent(db, {
    eventType: wasUnassigned ? "sales_lead_assigned" : "sales_lead_reassigned",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "crm_lead",
    targetId: updated.id,
    metadata: { assigneeUserId: input.assigneeUserId, previousOwnerUserId: current.ownerUserId, strategy: "manual" },
  });

  return updated;
}

async function pickRoundRobinAssignee(db: Db, organizationId: string, eligible: string[]): Promise<string> {
  const recent = await db
    .select({ metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, organizationId), inArray(auditLogs.eventType, ["sales_lead_assigned", "sales_lead_reassigned"])))
    .orderBy(desc(auditLogs.createdAt))
    .limit(500);

  const lastAssignedAtByUser = new Map<string, number>();
  for (const row of recent) {
    const assigneeUserId = (row.metadata as { assigneeUserId?: string } | null)?.assigneeUserId;
    if (!assigneeUserId || lastAssignedAtByUser.has(assigneeUserId)) continue;
    lastAssignedAtByUser.set(assigneeUserId, row.createdAt.getTime());
  }

  const ranked = [...eligible].sort((a, b) => {
    const aTime = lastAssignedAtByUser.get(a) ?? 0;
    const bTime = lastAssignedAtByUser.get(b) ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.localeCompare(b);
  });
  return ranked[0];
}

async function pickLeastOpenLeadsAssignee(db: Db, organizationId: string, eligible: string[]): Promise<string> {
  const rows = await db
    .select({ ownerUserId: crmLeads.ownerUserId })
    .from(crmLeads)
    .where(and(eq(crmLeads.organizationId, organizationId), inArray(crmLeads.status, [...OPEN_LEAD_STATUSES])));

  const openCountByUser = new Map<string, number>();
  for (const row of rows) {
    if (!row.ownerUserId) continue;
    openCountByUser.set(row.ownerUserId, (openCountByUser.get(row.ownerUserId) ?? 0) + 1);
  }

  const ranked = [...eligible].sort((a, b) => {
    const aCount = openCountByUser.get(a) ?? 0;
    const bCount = openCountByUser.get(b) ?? 0;
    if (aCount !== bCount) return aCount - bCount;
    return a.localeCompare(b);
  });
  return ranked[0];
}

/**
 * Deterministic auto-assignment. The strategy only decides WHICH eligible
 * rep to pick — the actual write still goes through `assignLead`'s own
 * CRM revision guard, so this is safe under concurrent invocation for
 * different leads (each one independently races on its own row) and
 * self-correcting for the same lead (the loser simply doesn't win the
 * `expectedRevision` race and can be retried against the lead's new
 * state by the caller).
 */
export async function autoAssignLead(db: Db, input: { organizationId: string; workspaceId?: string | null; leadId: string; strategy?: SalesLeadAssignmentStrategy; actorUserId: string }): Promise<CrmLead> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesAssignLeadsAuthority(db, ctx, "crm_lead", input.leadId);

  const strategy = input.strategy ?? (await resolveEffectiveSalesConfiguration(db, input.organizationId, input.workspaceId ?? null)).defaultLeadAssignmentStrategy;
  if (strategy === "manual") throw new IneligibleAssigneeError("the manual strategy requires an explicit assigneeUserId — call assignLead directly");

  const eligible = await listAssignmentEligibleUserIds(db, input.organizationId);
  if (eligible.length === 0) throw new NoEligibleAssigneeError();

  const assigneeUserId = strategy === "round_robin" ? await pickRoundRobinAssignee(db, input.organizationId, eligible) : await pickLeastOpenLeadsAssignee(db, input.organizationId, eligible);

  return assignLead(db, { organizationId: input.organizationId, leadId: input.leadId, assigneeUserId, actorUserId: input.actorUserId });
}
