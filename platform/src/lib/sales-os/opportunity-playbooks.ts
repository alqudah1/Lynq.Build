import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { salesOpportunityPlaybookRuns, salesOpportunityPlaybookItems, salesPlaybookSteps } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { getOpportunityForUser, type CrmOpportunity } from "@/lib/crm/opportunities";
import { resolveSalesAuthContext, requireSalesOpportunityWorkAuthority } from "./authz";
import { resolvePlaybookVersionById, resolvePublishedPlaybookVersion, listPlaybookSteps, type SalesPlaybookStep } from "./playbooks";
import { resolveEffectiveSalesConfiguration } from "./configuration";
import { DuplicateActiveRunError, StaleSalesUpdateError, InvalidSalesTransitionError, PlaybookNotPublishedError } from "./errors";
import type { SalesOpportunityPlaybookRunStatus, SalesChecklistItemStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface SalesOpportunityPlaybookRun {
  id: string;
  organizationId: string;
  opportunityId: string;
  playbookVersionId: string;
  assignedUserId: string | null;
  status: SalesOpportunityPlaybookRunStatus;
  currentStepId: string | null;
  lastReviewedAt: Date | null;
  startedAt: Date;
  completedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesOpportunityPlaybookItem {
  id: string;
  organizationId: string;
  opportunityPlaybookRunId: string;
  playbookStepId: string;
  status: SalesChecklistItemStatus;
  completedByUserId: string | null;
  completedAt: Date | null;
  evidenceActivityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StartOpportunityPlaybookRunInput {
  organizationId: string;
  workspaceId?: string | null;
  opportunityId: string;
  playbookVersionId?: string;
  actorUserId: string;
}

/** Opens a new operational playbook run against a real CRM opportunity. The opportunity's CRM stage/status remain solely authoritative — this run never writes to `crm_opportunities` itself. */
export async function startOpportunityPlaybookRun(db: Db, input: StartOpportunityPlaybookRunInput): Promise<{ run: SalesOpportunityPlaybookRun; items: SalesOpportunityPlaybookItem[] }> {
  const opportunity = await getOpportunityForUser(db, { organizationId: input.organizationId, opportunityId: input.opportunityId, actorUserId: input.actorUserId });
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesOpportunityWorkAuthority(db, ctx, opportunity);

  const version = input.playbookVersionId
    ? await resolvePlaybookVersionById(db, input.organizationId, input.playbookVersionId)
    : await (async () => {
        const config = await resolveEffectiveSalesConfiguration(db, input.organizationId, input.workspaceId ?? null);
        if (!config.defaultOpportunityPlaybookId) throw new PlaybookNotPublishedError();
        return resolvePublishedPlaybookVersion(db, input.organizationId, config.defaultOpportunityPlaybookId);
      })();
  if (version.status !== "published") throw new PlaybookNotPublishedError();

  const steps = await listPlaybookSteps(db, { organizationId: input.organizationId, playbookVersionId: version.id, actorUserId: input.actorUserId });
  const firstStep = steps[0] ?? null;

  let run: SalesOpportunityPlaybookRun;
  try {
    [run] = (await db
      .insert(salesOpportunityPlaybookRuns)
      .values({ organizationId: input.organizationId, opportunityId: opportunity.id, playbookVersionId: version.id, assignedUserId: opportunity.ownerUserId ?? input.actorUserId, currentStepId: firstStep?.id ?? null, lastReviewedAt: new Date() })
      .returning()) as unknown as SalesOpportunityPlaybookRun[];
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateActiveRunError("opportunity");
    throw err;
  }

  const items: SalesOpportunityPlaybookItem[] = [];
  for (const step of steps) {
    const [item] = await db.insert(salesOpportunityPlaybookItems).values({ organizationId: input.organizationId, opportunityPlaybookRunId: run.id, playbookStepId: step.id }).returning();
    items.push(item as unknown as SalesOpportunityPlaybookItem);
  }

  await recordAuditEvent(db, {
    eventType: "sales_opportunity_playbook_started",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "crm_opportunity",
    targetId: opportunity.id,
    metadata: { runId: run.id, playbookVersionId: version.id, stepCount: steps.length },
  });

  return { run, items };
}

export async function resolveOpportunityPlaybookRunById(db: Db, organizationId: string, runId: string): Promise<SalesOpportunityPlaybookRun> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(salesOpportunityPlaybookRuns).where(and(eq(salesOpportunityPlaybookRuns.id, runId), eq(salesOpportunityPlaybookRuns.organizationId, organizationId)));
    return row as unknown as SalesOpportunityPlaybookRun | undefined;
  });
}

export async function listOpportunityPlaybookItems(db: Db, organizationId: string, runId: string): Promise<(SalesOpportunityPlaybookItem & { step: SalesPlaybookStep })[]> {
  const rows = await db
    .select({ item: salesOpportunityPlaybookItems, step: salesPlaybookSteps })
    .from(salesOpportunityPlaybookItems)
    .innerJoin(salesPlaybookSteps, eq(salesPlaybookSteps.id, salesOpportunityPlaybookItems.playbookStepId))
    .where(and(eq(salesOpportunityPlaybookItems.organizationId, organizationId), eq(salesOpportunityPlaybookItems.opportunityPlaybookRunId, runId)))
    .orderBy(salesPlaybookSteps.sequence);
  return rows.map((r) => ({ ...(r.item as unknown as SalesOpportunityPlaybookItem), step: r.step as unknown as SalesPlaybookStep }));
}

export async function listOpportunityPlaybookRunsForOpportunity(db: Db, input: { organizationId: string; opportunityId: string; actorUserId: string }): Promise<SalesOpportunityPlaybookRun[]> {
  const opportunity = await getOpportunityForUser(db, { organizationId: input.organizationId, opportunityId: input.opportunityId, actorUserId: input.actorUserId });
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesOpportunityWorkAuthority(db, ctx, opportunity);
  const rows = await db.select().from(salesOpportunityPlaybookRuns).where(and(eq(salesOpportunityPlaybookRuns.organizationId, input.organizationId), eq(salesOpportunityPlaybookRuns.opportunityId, opportunity.id)));
  return rows as unknown as SalesOpportunityPlaybookRun[];
}

export async function listOpportunityPlaybookRunsForAssignee(db: Db, input: { organizationId: string; assignedUserId: string; status?: SalesOpportunityPlaybookRunStatus; actorUserId: string }): Promise<SalesOpportunityPlaybookRun[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesOpportunityWorkAuthority(db, ctx, { id: "list", ownerUserId: input.assignedUserId });
  const conditions = [eq(salesOpportunityPlaybookRuns.organizationId, input.organizationId), eq(salesOpportunityPlaybookRuns.assignedUserId, input.assignedUserId)];
  if (input.status) conditions.push(eq(salesOpportunityPlaybookRuns.status, input.status));
  const rows = await db.select().from(salesOpportunityPlaybookRuns).where(and(...conditions));
  return rows as unknown as SalesOpportunityPlaybookRun[];
}

/**
 * Marks one checklist item complete/skipped and advances `currentStepId` to
 * the next incomplete step, if any. A `stage_recommendation` step is never
 * applied automatically here — completing it only records that the rep
 * reviewed the recommendation; the actual CRM stage move (if taken) always
 * goes through CRM Core's own `moveOpportunityStage`, separately.
 */
export async function completeOpportunityPlaybookItem(db: Db, input: { organizationId: string; itemId: string; status: Exclude<SalesChecklistItemStatus, "pending">; evidenceActivityId?: string; actorUserId: string }): Promise<SalesOpportunityPlaybookItem> {
  const [existingItem] = await db.select().from(salesOpportunityPlaybookItems).where(and(eq(salesOpportunityPlaybookItems.id, input.itemId), eq(salesOpportunityPlaybookItems.organizationId, input.organizationId)));
  if (!existingItem) throw new StaleSalesUpdateError("opportunity playbook item");

  const run = await resolveOpportunityPlaybookRunById(db, input.organizationId, existingItem.opportunityPlaybookRunId);
  if (run.status !== "active") throw new InvalidSalesTransitionError("opportunity playbook run", run.status, "item update");

  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesOpportunityWorkAuthority(db, ctx, { id: run.opportunityId, ownerUserId: run.assignedUserId });

  const [item] = await db
    .update(salesOpportunityPlaybookItems)
    .set({ status: input.status, completedByUserId: input.actorUserId, completedAt: new Date(), evidenceActivityId: input.evidenceActivityId ?? null, updatedAt: new Date() })
    .where(eq(salesOpportunityPlaybookItems.id, input.itemId))
    .returning();

  const remaining = await db
    .select({ stepId: salesOpportunityPlaybookItems.playbookStepId, sequence: salesPlaybookSteps.sequence })
    .from(salesOpportunityPlaybookItems)
    .innerJoin(salesPlaybookSteps, eq(salesPlaybookSteps.id, salesOpportunityPlaybookItems.playbookStepId))
    .where(and(eq(salesOpportunityPlaybookItems.organizationId, input.organizationId), eq(salesOpportunityPlaybookItems.opportunityPlaybookRunId, run.id), eq(salesOpportunityPlaybookItems.status, "pending")))
    .orderBy(salesPlaybookSteps.sequence);

  await db.update(salesOpportunityPlaybookRuns).set({ currentStepId: remaining[0]?.stepId ?? null, lastReviewedAt: new Date(), updatedAt: new Date() }).where(eq(salesOpportunityPlaybookRuns.id, run.id));

  return item as unknown as SalesOpportunityPlaybookItem;
}

export async function completeOpportunityPlaybookRun(db: Db, input: { organizationId: string; runId: string; expectedRevision: number; actorUserId: string }): Promise<SalesOpportunityPlaybookRun> {
  const run = await resolveOpportunityPlaybookRunById(db, input.organizationId, input.runId);
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesOpportunityWorkAuthority(db, ctx, { id: run.opportunityId, ownerUserId: run.assignedUserId });
  if (run.status !== "active") throw new InvalidSalesTransitionError("opportunity playbook run", run.status, "completed");

  const [updated] = await db
    .update(salesOpportunityPlaybookRuns)
    .set({ status: "completed", completedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(salesOpportunityPlaybookRuns.id, run.id), eq(salesOpportunityPlaybookRuns.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleSalesUpdateError("opportunity playbook run");

  await recordAuditEvent(db, { eventType: "sales_opportunity_playbook_completed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_opportunity", targetId: run.opportunityId, metadata: { runId: run.id } });
  return updated as unknown as SalesOpportunityPlaybookRun;
}

export async function abandonOpportunityPlaybookRun(db: Db, input: { organizationId: string; runId: string; expectedRevision: number; actorUserId: string }): Promise<SalesOpportunityPlaybookRun> {
  const run = await resolveOpportunityPlaybookRunById(db, input.organizationId, input.runId);
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesOpportunityWorkAuthority(db, ctx, { id: run.opportunityId, ownerUserId: run.assignedUserId });
  if (run.status !== "active") throw new InvalidSalesTransitionError("opportunity playbook run", run.status, "abandoned");

  const [updated] = await db
    .update(salesOpportunityPlaybookRuns)
    .set({ status: "abandoned", completedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(salesOpportunityPlaybookRuns.id, run.id), eq(salesOpportunityPlaybookRuns.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleSalesUpdateError("opportunity playbook run");
  return updated as unknown as SalesOpportunityPlaybookRun;
}

export type { CrmOpportunity };
