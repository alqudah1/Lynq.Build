import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { salesLeadQualificationRuns, salesLeadQualificationItems, salesPlaybookSteps } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { getLeadForUser, qualifyLeadFromSales, disqualifyLeadFromSales, type CrmLead } from "@/lib/crm/leads";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { resolveSalesAuthContext, requireSalesLeadWorkAuthority, requireSalesLeadQualificationAuthority } from "./authz";
import { resolvePlaybookVersionById, resolvePublishedPlaybookVersion, listPlaybookSteps, type SalesPlaybookStep } from "./playbooks";
import { resolveEffectiveSalesConfiguration } from "./configuration";
import { DuplicateActiveRunError, StaleSalesUpdateError, InvalidSalesTransitionError, PlaybookNotPublishedError, QualificationChecklistIncompleteError } from "./errors";
import type { SalesQualificationRunStatus, SalesChecklistItemStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface SalesLeadQualificationRun {
  id: string;
  organizationId: string;
  leadId: string;
  playbookVersionId: string;
  assignedUserId: string | null;
  status: SalesQualificationRunStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  missingInformation: string[];
  workflowExecutionId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesLeadQualificationItem {
  id: string;
  organizationId: string;
  qualificationRunId: string;
  playbookStepId: string;
  status: SalesChecklistItemStatus;
  completedByUserId: string | null;
  completedAt: Date | null;
  evidenceActivityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

async function refreshMissingInformation(db: Db, organizationId: string, runId: string): Promise<void> {
  const items = await db
    .select({ status: salesLeadQualificationItems.status, stepKey: salesPlaybookSteps.stepKey, required: salesPlaybookSteps.required })
    .from(salesLeadQualificationItems)
    .innerJoin(salesPlaybookSteps, eq(salesPlaybookSteps.id, salesLeadQualificationItems.playbookStepId))
    .where(and(eq(salesLeadQualificationItems.organizationId, organizationId), eq(salesLeadQualificationItems.qualificationRunId, runId)));

  const missing = items.filter((i) => i.required && i.status === "pending").map((i) => i.stepKey);
  await db.update(salesLeadQualificationRuns).set({ missingInformation: missing, updatedAt: new Date() }).where(eq(salesLeadQualificationRuns.id, runId));
}

export interface StartQualificationRunInput {
  organizationId: string;
  workspaceId?: string | null;
  leadId: string;
  playbookVersionId?: string;
  actorUserId: string;
}

/** Opens a new qualification run against a real CRM lead and seeds one checklist item per playbook step. The CRM lead's own status is untouched until the rep explicitly qualifies/disqualifies through this run. */
export async function startQualificationRun(db: Db, input: StartQualificationRunInput): Promise<{ run: SalesLeadQualificationRun; items: SalesLeadQualificationItem[] }> {
  const lead = await getLeadForUser(db, { organizationId: input.organizationId, leadId: input.leadId, actorUserId: input.actorUserId });
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesLeadWorkAuthority(db, ctx, lead);

  const version = input.playbookVersionId
    ? await resolvePlaybookVersionById(db, input.organizationId, input.playbookVersionId)
    : await (async () => {
        const config = await resolveEffectiveSalesConfiguration(db, input.organizationId, input.workspaceId ?? null);
        if (!config.defaultQualificationPlaybookId) throw new PlaybookNotPublishedError();
        return resolvePublishedPlaybookVersion(db, input.organizationId, config.defaultQualificationPlaybookId);
      })();
  if (version.status !== "published") throw new PlaybookNotPublishedError();

  let run: SalesLeadQualificationRun;
  try {
    [run] = (await db
      .insert(salesLeadQualificationRuns)
      .values({ organizationId: input.organizationId, leadId: lead.id, playbookVersionId: version.id, assignedUserId: lead.ownerUserId ?? input.actorUserId, status: "in_progress", startedAt: new Date() })
      .returning()) as unknown as SalesLeadQualificationRun[];
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateActiveRunError("lead");
    throw err;
  }

  const steps = await listPlaybookSteps(db, { organizationId: input.organizationId, playbookVersionId: version.id, actorUserId: input.actorUserId });
  const items: SalesLeadQualificationItem[] = [];
  for (const step of steps) {
    const [item] = await db.insert(salesLeadQualificationItems).values({ organizationId: input.organizationId, qualificationRunId: run.id, playbookStepId: step.id }).returning();
    items.push(item as SalesLeadQualificationItem);
  }
  await refreshMissingInformation(db, input.organizationId, run.id);

  await recordAuditEvent(db, { eventType: "sales_qualification_started", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: lead.id, metadata: { runId: run.id, playbookVersionId: version.id, stepCount: steps.length } });

  const [refreshed] = await db.select().from(salesLeadQualificationRuns).where(eq(salesLeadQualificationRuns.id, run.id));
  return { run: refreshed as unknown as SalesLeadQualificationRun, items };
}

export async function resolveQualificationRunById(db: Db, organizationId: string, runId: string): Promise<SalesLeadQualificationRun> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(salesLeadQualificationRuns).where(and(eq(salesLeadQualificationRuns.id, runId), eq(salesLeadQualificationRuns.organizationId, organizationId)));
    return row as unknown as SalesLeadQualificationRun | undefined;
  });
}

export async function listQualificationItems(db: Db, organizationId: string, runId: string): Promise<(SalesLeadQualificationItem & { step: SalesPlaybookStep })[]> {
  const rows = await db
    .select({ item: salesLeadQualificationItems, step: salesPlaybookSteps })
    .from(salesLeadQualificationItems)
    .innerJoin(salesPlaybookSteps, eq(salesPlaybookSteps.id, salesLeadQualificationItems.playbookStepId))
    .where(and(eq(salesLeadQualificationItems.organizationId, organizationId), eq(salesLeadQualificationItems.qualificationRunId, runId)))
    .orderBy(salesPlaybookSteps.sequence);
  return rows.map((r) => ({ ...(r.item as unknown as SalesLeadQualificationItem), step: r.step as unknown as SalesPlaybookStep }));
}

export async function listQualificationRunsForLead(db: Db, input: { organizationId: string; leadId: string; actorUserId: string }): Promise<SalesLeadQualificationRun[]> {
  const lead = await getLeadForUser(db, { organizationId: input.organizationId, leadId: input.leadId, actorUserId: input.actorUserId });
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesLeadWorkAuthority(db, ctx, lead);
  const rows = await db.select().from(salesLeadQualificationRuns).where(and(eq(salesLeadQualificationRuns.organizationId, input.organizationId), eq(salesLeadQualificationRuns.leadId, lead.id)));
  return rows as unknown as SalesLeadQualificationRun[];
}

export async function listQualificationRunsForAssignee(db: Db, input: { organizationId: string; assignedUserId: string; status?: SalesQualificationRunStatus; actorUserId: string }): Promise<SalesLeadQualificationRun[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesLeadWorkAuthority(db, ctx, { id: "list", ownerUserId: input.assignedUserId });
  const conditions = [eq(salesLeadQualificationRuns.organizationId, input.organizationId), eq(salesLeadQualificationRuns.assignedUserId, input.assignedUserId)];
  if (input.status) conditions.push(eq(salesLeadQualificationRuns.status, input.status));
  const rows = await db.select().from(salesLeadQualificationRuns).where(and(...conditions));
  return rows as unknown as SalesLeadQualificationRun[];
}

/** Marks one checklist item complete/skipped — the run must still be open. Evidence is a loose pointer to a real CRM activity id, never copied content. */
export async function completeQualificationItem(db: Db, input: { organizationId: string; itemId: string; status: Exclude<SalesChecklistItemStatus, "pending">; evidenceActivityId?: string; actorUserId: string }): Promise<SalesLeadQualificationItem> {
  const [existingItem] = await db.select().from(salesLeadQualificationItems).where(and(eq(salesLeadQualificationItems.id, input.itemId), eq(salesLeadQualificationItems.organizationId, input.organizationId)));
  if (!existingItem) throw new StaleSalesUpdateError("qualification item");

  const run = await resolveQualificationRunById(db, input.organizationId, existingItem.qualificationRunId);
  if (run.status !== "in_progress" && run.status !== "waiting") throw new InvalidSalesTransitionError("qualification run", run.status, "item update");

  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesLeadWorkAuthority(db, ctx, { id: run.leadId, ownerUserId: run.assignedUserId });

  const [item] = await db
    .update(salesLeadQualificationItems)
    .set({ status: input.status, completedByUserId: input.actorUserId, completedAt: new Date(), evidenceActivityId: input.evidenceActivityId ?? null, updatedAt: new Date() })
    .where(eq(salesLeadQualificationItems.id, input.itemId))
    .returning();

  await refreshMissingInformation(db, input.organizationId, run.id);
  return item as unknown as SalesLeadQualificationItem;
}

/**
 * ============================================================================
 * Module 14 — dual-gate qualify/disqualify through the run
 * ============================================================================
 * Gate 1 (here): `requireSalesLeadQualificationAuthority` — a rep may act
 * on a lead assigned to them, a manager only within their own real Sales
 * team, an admin org-wide; never the broader `sales_assign_leads`-implies-
 * any-lead rule `requireSalesLeadWorkAuthority` still uses for ordinary
 * lead-working actions (checklist updates, notes). Gate 2 (inside
 * `qualifyLeadFromSales`/`disqualifyLeadFromSales`): CRM Core's own narrow
 * `requireCrmLeadQualificationAuthority`. Both must pass; either denial is
 * recorded as `sales_qualification_permission_denied` in addition to
 * whichever gate's own generic denial event fired.
 */
async function requireQualificationOutcomeAuthority(db: Db, organizationId: string, run: SalesLeadQualificationRun, actorUserId: string): Promise<void> {
  const ctx = await resolveSalesAuthContext(db, { organizationId, actorUserId });
  try {
    await requireSalesLeadQualificationAuthority(db, ctx, { id: run.leadId, ownerUserId: run.assignedUserId });
  } catch (err) {
    if (err instanceof InsufficientRoleError) {
      await recordAuditEvent(db, { eventType: "sales_qualification_permission_denied", actorUserId, organizationId, targetType: "crm_lead", targetId: run.leadId, metadata: { runId: run.id } });
    }
    throw err;
  }
}

/** Qualifies the lead through CRM Core's own `qualifyLeadFromSales` — this run only documents the trail; CRM's `crm_leads.status` remains the sole source of truth. Requires every mandatory checklist item to be complete first (Module 14). */
export async function qualifyLeadViaRun(db: Db, input: { organizationId: string; runId: string; expectedRevision: number; actorUserId: string }): Promise<{ run: SalesLeadQualificationRun; lead: CrmLead }> {
  const run = await resolveQualificationRunById(db, input.organizationId, input.runId);
  await requireQualificationOutcomeAuthority(db, input.organizationId, run, input.actorUserId);

  if (run.missingInformation.length > 0) {
    throw new QualificationChecklistIncompleteError(run.missingInformation);
  }

  const lead = await getLeadForUser(db, { organizationId: input.organizationId, leadId: run.leadId, actorUserId: input.actorUserId });
  let qualifiedLead: CrmLead;
  try {
    qualifiedLead = await qualifyLeadFromSales(db, { organizationId: input.organizationId, leadId: lead.id, expectedRevision: lead.revision, actorUserId: input.actorUserId, qualificationRunId: run.id, playbookVersionId: run.playbookVersionId });
  } catch (err) {
    if (err instanceof InsufficientRoleError) {
      await recordAuditEvent(db, { eventType: "sales_qualification_permission_denied", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: run.leadId, metadata: { runId: run.id } });
    }
    throw err;
  }

  const [updatedRun] = await db
    .update(salesLeadQualificationRuns)
    .set({ status: "qualified", completedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(salesLeadQualificationRuns.id, run.id), eq(salesLeadQualificationRuns.revision, input.expectedRevision)))
    .returning();
  if (!updatedRun) throw new StaleSalesUpdateError("qualification run");

  await recordAuditEvent(db, { eventType: "sales_qualification_completed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: lead.id, metadata: { runId: run.id, outcome: "qualified" } });
  await recordAuditEvent(db, { eventType: "sales_qualification_outcome_applied", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: lead.id, metadata: { runId: run.id, playbookVersionId: run.playbookVersionId, outcome: "qualified" } });
  return { run: updatedRun as unknown as SalesLeadQualificationRun, lead: qualifiedLead };
}

export async function disqualifyLeadViaRun(db: Db, input: { organizationId: string; runId: string; expectedRevision: number; reason?: string; actorUserId: string }): Promise<{ run: SalesLeadQualificationRun; lead: CrmLead }> {
  const run = await resolveQualificationRunById(db, input.organizationId, input.runId);
  await requireQualificationOutcomeAuthority(db, input.organizationId, run, input.actorUserId);

  const lead = await getLeadForUser(db, { organizationId: input.organizationId, leadId: run.leadId, actorUserId: input.actorUserId });
  let disqualifiedLead: CrmLead;
  try {
    disqualifiedLead = await disqualifyLeadFromSales(db, { organizationId: input.organizationId, leadId: lead.id, expectedRevision: lead.revision, reason: input.reason, actorUserId: input.actorUserId, qualificationRunId: run.id, playbookVersionId: run.playbookVersionId });
  } catch (err) {
    if (err instanceof InsufficientRoleError) {
      await recordAuditEvent(db, { eventType: "sales_qualification_permission_denied", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: run.leadId, metadata: { runId: run.id } });
    }
    throw err;
  }

  const [updatedRun] = await db
    .update(salesLeadQualificationRuns)
    .set({ status: "disqualified", completedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(salesLeadQualificationRuns.id, run.id), eq(salesLeadQualificationRuns.revision, input.expectedRevision)))
    .returning();
  if (!updatedRun) throw new StaleSalesUpdateError("qualification run");

  await recordAuditEvent(db, { eventType: "sales_qualification_completed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: lead.id, metadata: { runId: run.id, outcome: "disqualified" } });
  await recordAuditEvent(db, { eventType: "sales_qualification_outcome_applied", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: lead.id, metadata: { runId: run.id, playbookVersionId: run.playbookVersionId, outcome: "disqualified" } });
  return { run: updatedRun as unknown as SalesLeadQualificationRun, lead: disqualifiedLead };
}

export async function abandonQualificationRun(db: Db, input: { organizationId: string; runId: string; expectedRevision: number; actorUserId: string }): Promise<SalesLeadQualificationRun> {
  const run = await resolveQualificationRunById(db, input.organizationId, input.runId);
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesLeadWorkAuthority(db, ctx, { id: run.leadId, ownerUserId: run.assignedUserId });

  if (!inArrayStatus(run.status, ["not_started", "in_progress", "waiting"])) throw new InvalidSalesTransitionError("qualification run", run.status, "abandoned");

  const [updated] = await db
    .update(salesLeadQualificationRuns)
    .set({ status: "abandoned", completedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(salesLeadQualificationRuns.id, run.id), eq(salesLeadQualificationRuns.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleSalesUpdateError("qualification run");
  return updated as unknown as SalesLeadQualificationRun;
}

function inArrayStatus(status: SalesQualificationRunStatus, allowed: SalesQualificationRunStatus[]): boolean {
  return allowed.includes(status);
}
