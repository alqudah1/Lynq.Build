import "server-only";
import { and, eq, lte } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { salesFollowUpSequences, salesFollowUpSequenceVersions, salesFollowUpSequenceSteps, salesSequenceEnrollments, salesSequenceStepRuns, workflowDefinitions } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveLeadById } from "@/lib/crm/leads";
import { resolveOpportunityById, getOpportunityForUser } from "@/lib/crm/opportunities";
import { getLeadForUser } from "@/lib/crm/leads";
import { createFollowUp } from "@/lib/crm/follow-ups";
import { startWorkflowWithCrmContext } from "@/lib/crm/workflow-integration";
import { resolveSalesAuthContext, requireSalesManagePlaybooksAuthority, requireSalesLeadWorkAuthority, requireSalesOpportunityWorkAuthority } from "./authz";
import { requestOpportunityContinuationApproval, requestLeadReviewApproval } from "./agents";
import { FOLLOW_UP_SEQUENCE_TEMPLATE_KEY } from "./templates";
import { SalesKeyAlreadyTakenError, PlaybookVersionImmutableError, SequenceNotPublishedError, DuplicateActiveEnrollmentError, StaleSalesUpdateError, SalesWorkflowTemplateNotSeededError } from "./errors";
import type { SalesSequenceTargetType, SalesSequenceLifecycle, SalesSequenceVersionStatus, SalesSequenceStepActionType, SalesEnrollmentStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface SalesFollowUpSequence {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  sequenceKey: string;
  targetType: SalesSequenceTargetType;
  lifecycle: SalesSequenceLifecycle;
  currentPublishedVersionId: string | null;
  ownerUserId: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesFollowUpSequenceVersion {
  id: string;
  organizationId: string;
  sequenceId: string;
  versionNumber: number;
  status: SalesSequenceVersionStatus;
  changeReason: string | null;
  createdByUserId: string | null;
  publishedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesFollowUpSequenceStep {
  id: string;
  organizationId: string;
  sequenceVersionId: string;
  stepKey: string;
  dayOffset: number;
  actionType: SalesSequenceStepActionType;
  title: string;
  instructions: string | null;
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesSequenceEnrollment {
  id: string;
  organizationId: string;
  sequenceVersionId: string;
  targetType: SalesSequenceTargetType;
  targetId: string;
  enrolledByUserId: string | null;
  status: SalesEnrollmentStatus;
  nextStepDueAt: Date | null;
  stoppedReason: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function createFollowUpSequence(db: Db, input: { organizationId: string; workspaceId?: string | null; name: string; sequenceKey: string; targetType: SalesSequenceTargetType; ownerUserId?: string; actorUserId: string }): Promise<{ sequence: SalesFollowUpSequence; version: SalesFollowUpSequenceVersion }> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesManagePlaybooksAuthority(db, ctx, "sales_follow_up_sequence", "new");

  let sequence: SalesFollowUpSequence;
  try {
    [sequence] = (await db
      .insert(salesFollowUpSequences)
      .values({ organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, name: input.name, sequenceKey: input.sequenceKey, targetType: input.targetType, ownerUserId: input.ownerUserId ?? input.actorUserId })
      .returning()) as unknown as SalesFollowUpSequence[];
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SalesKeyAlreadyTakenError("follow-up sequence", input.sequenceKey);
    throw err;
  }

  const [version] = (await db.insert(salesFollowUpSequenceVersions).values({ organizationId: input.organizationId, sequenceId: sequence.id, versionNumber: 1, createdByUserId: input.actorUserId }).returning()) as unknown as SalesFollowUpSequenceVersion[];

  await recordAuditEvent(db, { eventType: "sales_sequence_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "sales_follow_up_sequence", targetId: sequence.id, metadata: { sequenceKey: sequence.sequenceKey, targetType: sequence.targetType } });
  return { sequence, version };
}

export async function resolveSequenceById(db: Db, organizationId: string, sequenceId: string): Promise<SalesFollowUpSequence> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(salesFollowUpSequences).where(and(eq(salesFollowUpSequences.id, sequenceId), eq(salesFollowUpSequences.organizationId, organizationId)));
    return row as unknown as SalesFollowUpSequence | undefined;
  });
}

export async function resolveSequenceVersionById(db: Db, organizationId: string, versionId: string): Promise<SalesFollowUpSequenceVersion> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(salesFollowUpSequenceVersions).where(and(eq(salesFollowUpSequenceVersions.id, versionId), eq(salesFollowUpSequenceVersions.organizationId, organizationId)));
    return row as unknown as SalesFollowUpSequenceVersion | undefined;
  });
}

export async function listSequencesForUser(db: Db, input: { organizationId: string; targetType?: SalesSequenceTargetType; actorUserId: string }): Promise<SalesFollowUpSequence[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesManagePlaybooksAuthority(db, ctx, "sales_follow_up_sequence", "list");
  const conditions = [eq(salesFollowUpSequences.organizationId, input.organizationId)];
  if (input.targetType) conditions.push(eq(salesFollowUpSequences.targetType, input.targetType));
  const rows = await db.select().from(salesFollowUpSequences).where(and(...conditions)).orderBy(salesFollowUpSequences.name);
  return rows as unknown as SalesFollowUpSequence[];
}

export async function addSequenceStep(db: Db, input: { organizationId: string; sequenceVersionId: string; stepKey: string; dayOffset: number; actionType: SalesSequenceStepActionType; title: string; instructions?: string; sequence: number; actorUserId: string }): Promise<SalesFollowUpSequenceStep> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesManagePlaybooksAuthority(db, ctx, "sales_follow_up_sequence_version", input.sequenceVersionId);

  const version = await resolveSequenceVersionById(db, input.organizationId, input.sequenceVersionId);
  if (version.status !== "draft") throw new PlaybookVersionImmutableError();

  let step: typeof salesFollowUpSequenceSteps.$inferSelect;
  try {
    [step] = await db
      .insert(salesFollowUpSequenceSteps)
      .values({ organizationId: input.organizationId, sequenceVersionId: version.id, stepKey: input.stepKey, dayOffset: input.dayOffset, actionType: input.actionType, title: input.title, instructions: input.instructions ?? null, sequence: input.sequence })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SalesKeyAlreadyTakenError("sequence step", input.stepKey);
    throw err;
  }
  return step as SalesFollowUpSequenceStep;
}

export async function listSequenceSteps(db: Db, organizationId: string, sequenceVersionId: string): Promise<SalesFollowUpSequenceStep[]> {
  const rows = await db.select().from(salesFollowUpSequenceSteps).where(and(eq(salesFollowUpSequenceSteps.organizationId, organizationId), eq(salesFollowUpSequenceSteps.sequenceVersionId, sequenceVersionId))).orderBy(salesFollowUpSequenceSteps.sequence);
  return rows as unknown as SalesFollowUpSequenceStep[];
}

export async function publishSequenceVersion(db: Db, input: { organizationId: string; sequenceId: string; versionId: string; expectedRevision: number; actorUserId: string }): Promise<SalesFollowUpSequenceVersion> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesManagePlaybooksAuthority(db, ctx, "sales_follow_up_sequence", input.sequenceId);

  const steps = await db.select({ id: salesFollowUpSequenceSteps.id }).from(salesFollowUpSequenceSteps).where(and(eq(salesFollowUpSequenceSteps.organizationId, input.organizationId), eq(salesFollowUpSequenceSteps.sequenceVersionId, input.versionId)));
  if (steps.length === 0) throw new PlaybookVersionImmutableError();

  const sequence = await resolveSequenceById(db, input.organizationId, input.sequenceId);
  if (sequence.currentPublishedVersionId) {
    await db.update(salesFollowUpSequenceVersions).set({ status: "superseded", updatedAt: new Date() }).where(and(eq(salesFollowUpSequenceVersions.id, sequence.currentPublishedVersionId), eq(salesFollowUpSequenceVersions.status, "published")));
  }

  const [version] = await db
    .update(salesFollowUpSequenceVersions)
    .set({ status: "published", publishedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(salesFollowUpSequenceVersions.id, input.versionId), eq(salesFollowUpSequenceVersions.organizationId, input.organizationId), eq(salesFollowUpSequenceVersions.revision, input.expectedRevision)))
    .returning();
  if (!version) throw new StaleSalesUpdateError("follow-up sequence version");

  await db.update(salesFollowUpSequences).set({ currentPublishedVersionId: version.id, lifecycle: "published", revision: sequence.revision + 1, updatedAt: new Date() }).where(eq(salesFollowUpSequences.id, sequence.id));

  await recordAuditEvent(db, { eventType: "sales_sequence_published", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "sales_follow_up_sequence_version", targetId: version.id, metadata: { sequenceId: sequence.id, versionNumber: version.versionNumber } });
  return version as unknown as SalesFollowUpSequenceVersion;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Enrolls a real CRM lead or opportunity in a published sequence. One active enrollment per target — enforced by the partial unique index, not just an application check. */
export async function enrollInSequence(db: Db, input: { organizationId: string; workspaceId?: string | null; sequenceId: string; targetType: SalesSequenceTargetType; targetId: string; actorUserId: string }): Promise<SalesSequenceEnrollment> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  if (input.targetType === "lead") {
    const lead = await getLeadForUser(db, { organizationId: input.organizationId, leadId: input.targetId, actorUserId: input.actorUserId });
    await requireSalesLeadWorkAuthority(db, ctx, lead);
  } else {
    const opportunity = await getOpportunityForUser(db, { organizationId: input.organizationId, opportunityId: input.targetId, actorUserId: input.actorUserId });
    await requireSalesOpportunityWorkAuthority(db, ctx, opportunity);
  }

  const sequence = await resolveSequenceById(db, input.organizationId, input.sequenceId);
  if (!sequence.currentPublishedVersionId) throw new SequenceNotPublishedError();
  const steps = await listSequenceSteps(db, input.organizationId, sequence.currentPublishedVersionId);
  if (steps.length === 0) throw new SequenceNotPublishedError();

  const firstStep = steps[0];
  const nextStepDueAt = addDays(new Date(), firstStep.dayOffset);

  let enrollment: SalesSequenceEnrollment;
  try {
    [enrollment] = (await db
      .insert(salesSequenceEnrollments)
      .values({ organizationId: input.organizationId, sequenceVersionId: sequence.currentPublishedVersionId, targetType: input.targetType, targetId: input.targetId, enrolledByUserId: input.actorUserId, nextStepDueAt })
      .returning()) as unknown as SalesSequenceEnrollment[];
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateActiveEnrollmentError();
    throw err;
  }

  await recordAuditEvent(db, { eventType: "sales_sequence_enrolled", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: input.targetType === "lead" ? "crm_lead" : "crm_opportunity", targetId: input.targetId, metadata: { sequenceId: sequence.id, enrollmentId: enrollment.id } });
  return enrollment;
}

export async function stopEnrollment(db: Db, input: { organizationId: string; enrollmentId: string; expectedRevision: number; reason?: string; actorUserId: string }): Promise<SalesSequenceEnrollment> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesManagePlaybooksAuthority(db, ctx, "sales_sequence_enrollment", input.enrollmentId);

  const [row] = await db
    .update(salesSequenceEnrollments)
    .set({ status: "stopped", stoppedReason: input.reason ?? null, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(salesSequenceEnrollments.id, input.enrollmentId), eq(salesSequenceEnrollments.organizationId, input.organizationId), eq(salesSequenceEnrollments.revision, input.expectedRevision), eq(salesSequenceEnrollments.status, "active")))
    .returning();
  if (!row) throw new StaleSalesUpdateError("sequence enrollment");

  await recordAuditEvent(db, { eventType: "sales_sequence_stopped", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "sales_sequence_enrollment", targetId: row.id, metadata: { reason: input.reason ?? null } });
  return row as unknown as SalesSequenceEnrollment;
}

/**
 * Stops any active enrollment for a target — called when a lead is
 * qualified/disqualified/converted or an opportunity closes, per this
 * module's own "stop when lead is qualified/disqualified" / "stop when
 * opportunity closes" requirement. Silently a no-op if there is none —
 * callers invoke this unconditionally from the relevant CRM-transition
 * call site.
 */
export async function stopActiveEnrollmentsForTarget(db: Db, input: { organizationId: string; targetType: SalesSequenceTargetType; targetId: string; reason: string; actorUserId: string }): Promise<void> {
  const active = await db.select().from(salesSequenceEnrollments).where(and(eq(salesSequenceEnrollments.organizationId, input.organizationId), eq(salesSequenceEnrollments.targetType, input.targetType), eq(salesSequenceEnrollments.targetId, input.targetId), eq(salesSequenceEnrollments.status, "active")));
  for (const enrollment of active) {
    await stopEnrollment(db, { organizationId: input.organizationId, enrollmentId: enrollment.id, expectedRevision: enrollment.revision, reason: input.reason, actorUserId: input.actorUserId });
  }
}

async function isEnrollmentTargetStillEligible(db: Db, organizationId: string, enrollment: SalesSequenceEnrollment): Promise<boolean> {
  if (enrollment.targetType === "lead") {
    const lead = await resolveLeadById(db, organizationId, enrollment.targetId);
    return lead.status !== "qualified" && lead.status !== "disqualified" && lead.status !== "converted";
  }
  const opportunity = await resolveOpportunityById(db, organizationId, enrollment.targetId);
  return opportunity.status === "open";
}

async function executeSequenceStep(db: Db, input: { organizationId: string; workspaceId: string | null; enrollment: SalesSequenceEnrollment; step: SalesFollowUpSequenceStep; systemActorUserId: string }): Promise<void> {
  const existingRun = await db
    .select({ id: salesSequenceStepRuns.id })
    .from(salesSequenceStepRuns)
    .where(and(eq(salesSequenceStepRuns.organizationId, input.organizationId), eq(salesSequenceStepRuns.enrollmentId, input.enrollment.id), eq(salesSequenceStepRuns.sequenceStepId, input.step.id)));
  if (existingRun.length > 0) return; // Idempotency guard — this step already ran for this enrollment.

  const [runRow] = await db.insert(salesSequenceStepRuns).values({ organizationId: input.organizationId, enrollmentId: input.enrollment.id, sequenceStepId: input.step.id, status: "pending" }).returning();

  const leadId = input.enrollment.targetType === "lead" ? input.enrollment.targetId : undefined;
  const opportunityId = input.enrollment.targetType === "opportunity" ? input.enrollment.targetId : undefined;

  const patch: Partial<typeof salesSequenceStepRuns.$inferInsert> = { status: "completed", completedAt: new Date() };

  if (input.step.actionType === "crm_follow_up") {
    const followUp = await createFollowUp(db, { organizationId: input.organizationId, leadId, opportunityId, assignedUserId: input.enrollment.enrolledByUserId ?? input.systemActorUserId, title: input.step.title, dueAt: new Date(), priority: "normal", actorUserId: input.enrollment.enrolledByUserId ?? input.systemActorUserId });
    patch.crmFollowUpId = followUp.id;
    await recordAuditEvent(db, { eventType: "sales_follow_up_created", organizationId: input.organizationId, actorUserId: input.enrollment.enrolledByUserId ?? input.systemActorUserId, targetType: input.enrollment.targetType === "lead" ? "crm_lead" : "crm_opportunity", targetId: input.enrollment.targetId, metadata: { sequenceStepId: input.step.id, followUpId: followUp.id } });
  } else if (input.step.actionType === "internal_reminder") {
    // Self-contained — surfaced directly from `sales_sequence_step_runs` in the work queue; never a fabricated CRM activity.
  } else if (input.step.actionType === "workflow_human_task") {
    const [definition] = await db.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(and(eq(workflowDefinitions.organizationId, input.organizationId), eq(workflowDefinitions.workflowKey, FOLLOW_UP_SEQUENCE_TEMPLATE_KEY)));
    if (!definition) throw new SalesWorkflowTemplateNotSeededError(FOLLOW_UP_SEQUENCE_TEMPLATE_KEY);
    const execution = await startWorkflowWithCrmContext(db, { organizationId: input.organizationId, definitionId: definition.id, crmLeadId: leadId, crmOpportunityId: opportunityId, input: { stepTitle: input.step.title }, actorUserId: input.enrollment.enrolledByUserId ?? input.systemActorUserId });
    patch.workflowExecutionId = execution.id;
  } else if (input.step.actionType === "approval_request") {
    const actorUserId = input.enrollment.enrolledByUserId ?? input.systemActorUserId;
    if (input.enrollment.targetType === "opportunity") {
      const { approval } = await requestOpportunityContinuationApproval(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, opportunityId: input.enrollment.targetId, summary: input.step.title, actorUserId });
      patch.approvalRequestId = approval.id;
    } else {
      const { approval } = await requestLeadReviewApproval(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, leadId: input.enrollment.targetId, summary: input.step.title, actorUserId });
      patch.approvalRequestId = approval.id;
    }
  } else if (input.step.actionType === "communication_draft") {
    // Module 16 — Communications OS integration. Creates a real outbound
    // DRAFT only; this sequence step never sends anything itself. The
    // draft still has to pass through Communications OS's own approval →
    // queue → worker path, initiated separately, before any provider is
    // ever called.
    const { createSequenceCommunicationDraft } = await import("@/lib/communications-os/sales-integration");
    const { messageId } = await createSequenceCommunicationDraft(db, {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      targetType: input.enrollment.targetType,
      targetId: input.enrollment.targetId,
      channel: "email",
      subject: input.step.title,
      bodyText: input.step.instructions ?? input.step.title,
      systemActorUserId: input.enrollment.enrolledByUserId ?? input.systemActorUserId,
    });
    patch.communicationMessageId = messageId;
  }

  await db.update(salesSequenceStepRuns).set(patch).where(eq(salesSequenceStepRuns.id, runRow.id));
  await recordAuditEvent(db, { eventType: "sales_sequence_step_advanced", organizationId: input.organizationId, actorUserId: input.systemActorUserId, targetType: "sales_sequence_enrollment", targetId: input.enrollment.id, metadata: { sequenceStepId: input.step.id, actionType: input.step.actionType } });
}

/**
 * The durable advancement sweep — safe to call repeatedly (e.g. from a
 * cron/reconciliation tick) and safe under worker restarts: each step's
 * execution is guarded by a unique `(enrollmentId, sequenceStepId)` row in
 * `sales_sequence_step_runs`, so re-processing an enrollment whose current
 * step already ran is a no-op, never a duplicate follow-up/task/approval.
 *
 * Before executing anything, every enrollment's target is re-checked
 * against its OWN live CRM state — not just the state at enrollment time.
 * This is a deliberate belt-and-suspenders design: it stops the
 * enrollment whether the lead was qualified/disqualified/converted or the
 * opportunity was closed through Sales OS's own qualification/playbook
 * flow, through the plain CRM UI directly, or through any other path —
 * the sweep never trusts that `stopActiveEnrollmentsForTarget` was
 * already called by whoever changed the record.
 */
export async function advanceDueSequences(db: Db, input: { organizationId: string; systemActorUserId: string; now?: Date }): Promise<{ processedEnrollments: number; executedSteps: number }> {
  const now = input.now ?? new Date();
  const dueEnrollments = (await db
    .select()
    .from(salesSequenceEnrollments)
    .where(and(eq(salesSequenceEnrollments.organizationId, input.organizationId), eq(salesSequenceEnrollments.status, "active"), lte(salesSequenceEnrollments.nextStepDueAt, now)))) as unknown as SalesSequenceEnrollment[];

  let executedSteps = 0;
  for (const enrollment of dueEnrollments) {
    const stillEligible = await isEnrollmentTargetStillEligible(db, input.organizationId, enrollment);
    if (!stillEligible) {
      await db.update(salesSequenceEnrollments).set({ status: "stopped", stoppedReason: "target no longer eligible (qualified/disqualified/converted/closed)", nextStepDueAt: null, updatedAt: new Date() }).where(eq(salesSequenceEnrollments.id, enrollment.id));
      await recordAuditEvent(db, { eventType: "sales_sequence_stopped", organizationId: input.organizationId, actorUserId: input.systemActorUserId, targetType: "sales_sequence_enrollment", targetId: enrollment.id, metadata: { reason: "target_no_longer_eligible" } });
      continue;
    }

    const version = await resolveSequenceVersionById(db, input.organizationId, enrollment.sequenceVersionId);
    const steps = await listSequenceSteps(db, input.organizationId, version.id);
    const completedStepIds = new Set(
      (await db.select({ sequenceStepId: salesSequenceStepRuns.sequenceStepId }).from(salesSequenceStepRuns).where(and(eq(salesSequenceStepRuns.organizationId, input.organizationId), eq(salesSequenceStepRuns.enrollmentId, enrollment.id)))).map((r) => r.sequenceStepId)
    );

    const nextStep = steps.find((s) => !completedStepIds.has(s.id));
    if (!nextStep) {
      await db.update(salesSequenceEnrollments).set({ status: "completed", nextStepDueAt: null, updatedAt: new Date() }).where(eq(salesSequenceEnrollments.id, enrollment.id));
      continue;
    }

    await executeSequenceStep(db, { organizationId: input.organizationId, workspaceId: null, enrollment, step: nextStep, systemActorUserId: input.systemActorUserId });
    executedSteps += 1;

    const remainingSteps = steps.filter((s) => s.sequence > nextStep.sequence);
    const followingStep = remainingSteps[0] ?? null;
    if (followingStep) {
      await db.update(salesSequenceEnrollments).set({ nextStepDueAt: addDays(enrollment.createdAt, followingStep.dayOffset), updatedAt: new Date() }).where(eq(salesSequenceEnrollments.id, enrollment.id));
    } else {
      await db.update(salesSequenceEnrollments).set({ status: "completed", nextStepDueAt: null, updatedAt: new Date() }).where(eq(salesSequenceEnrollments.id, enrollment.id));
    }
  }

  return { processedEnrollments: dueEnrollments.length, executedSteps };
}
