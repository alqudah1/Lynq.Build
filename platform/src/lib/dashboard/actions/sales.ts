"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { upsertSalesConfiguration } from "@/lib/sales-os/configuration";
import { createSalesTeam, addSalesTeamMember, removeSalesTeamMember } from "@/lib/sales-os/teams";
import { grantSalesRole, revokeSalesRole } from "@/lib/sales-os/roles";
import { assignLead, autoAssignLead } from "@/lib/sales-os/lead-assignment";
import { createPlaybook, createPlaybookVersion, addPlaybookStep, publishPlaybookVersion } from "@/lib/sales-os/playbooks";
import { startQualificationRun, completeQualificationItem, qualifyLeadViaRun, disqualifyLeadViaRun, abandonQualificationRun } from "@/lib/sales-os/qualification";
import { startOpportunityPlaybookRun, completeOpportunityPlaybookItem, completeOpportunityPlaybookRun, abandonOpportunityPlaybookRun } from "@/lib/sales-os/opportunity-playbooks";
import { setOpportunityForecastCategory } from "@/lib/sales-os/forecasting";
import { createSalesTarget, updateSalesTarget } from "@/lib/sales-os/targets";
import { createFollowUpSequence, addSequenceStep, publishSequenceVersion, enrollInSequence, stopEnrollment } from "@/lib/sales-os/sequences";
import { createLeadResearchTask, createOpportunitySummaryTask, requestOpportunityContinuationApproval } from "@/lib/sales-os/agents";
import { salesLeadAssignmentStrategySchema, salesRoleSchema, salesPlaybookTypeSchema, salesPlaybookStepTypeSchema, salesTeamMemberRoleSchema, salesForecastCategorySchema, salesTargetScopeTypeSchema, salesTargetMetricTypeSchema, salesSequenceTargetTypeSchema, salesSequenceStepActionTypeSchema, salesKeySchema, salesNameSchema, salesTitleSchema } from "@/lib/sales-os/validation";
import { toActionResult } from "./errors";
import type { ActionResult } from "./types";

async function context(organizationSlug: string, path: string) {
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, path);
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
  return { db, user, organization };
}

const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const configSchema = z.object({
  expectedRevision: z.coerce.number().int().min(1).optional(),
  businessTimezone: z.string().trim().min(1).max(100).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  defaultLeadAssignmentStrategy: salesLeadAssignmentStrategySchema.optional(),
  staleLeadThresholdDays: z.coerce.number().int().min(1).max(365).optional(),
  staleOpportunityThresholdDays: z.coerce.number().int().min(1).max(365).optional(),
});

export async function upsertSalesConfigurationAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/settings`);
  const parsed = configSchema.safeParse({
    expectedRevision: formData.get("expectedRevision") || undefined,
    businessTimezone: formData.get("businessTimezone") || undefined,
    currency: formData.get("currency") || undefined,
    defaultLeadAssignmentStrategy: formData.get("defaultLeadAssignmentStrategy") || undefined,
    staleLeadThresholdDays: formData.get("staleLeadThresholdDays") || undefined,
    staleOpportunityThresholdDays: formData.get("staleOpportunityThresholdDays") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await upsertSalesConfiguration(db, { organizationId: organization.id, workspaceId: null, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/settings`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

const createTeamSchema = z.object({ name: salesNameSchema, teamKey: salesKeySchema });

export async function createSalesTeamAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/teams`);
  const parsed = createTeamSchema.safeParse({ name: formData.get("name"), teamKey: formData.get("teamKey") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createSalesTeam(db, { organizationId: organization.id, name: parsed.data.name, teamKey: parsed.data.teamKey, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/teams`);
  return { ok: true };
}

const addMemberSchema = z.object({ userId: uuidSchema, teamRole: salesTeamMemberRoleSchema.optional() });

export async function addSalesTeamMemberAction(organizationSlug: string, teamId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/teams`);
  const parsed = addMemberSchema.safeParse({ userId: formData.get("userId"), teamRole: formData.get("teamRole") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await addSalesTeamMember(db, { organizationId: organization.id, teamId, userId: parsed.data.userId, teamRole: parsed.data.teamRole, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/teams`);
  return { ok: true };
}

const removeMemberSchema = z.object({ expectedRevision: z.coerce.number().int().min(1) });

export async function removeSalesTeamMemberAction(organizationSlug: string, teamMemberId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/teams`);
  const parsed = removeMemberSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await removeSalesTeamMember(db, { organizationId: organization.id, teamMemberId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/teams`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const grantRoleSchema = z.object({ userId: uuidSchema, role: salesRoleSchema });

export async function grantSalesRoleAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/teams`);
  const parsed = grantRoleSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await grantSalesRole(db, { organizationId: organization.id, userId: parsed.data.userId, role: parsed.data.role, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/teams`);
  return { ok: true };
}

export async function revokeSalesRoleAction(organizationSlug: string, roleAssignmentId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/teams`);
  const parsed = removeMemberSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await revokeSalesRole(db, { organizationId: organization.id, roleAssignmentId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/teams`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lead assignment
// ---------------------------------------------------------------------------

const assignLeadSchema = z.object({ assigneeUserId: uuidSchema });

export async function assignLeadAction(organizationSlug: string, leadId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/leads/${leadId}`);
  const parsed = assignLeadSchema.safeParse({ assigneeUserId: formData.get("assigneeUserId") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await assignLead(db, { organizationId: organization.id, leadId, assigneeUserId: parsed.data.assigneeUserId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/leads/${leadId}`);
  return { ok: true };
}

export async function autoAssignLeadAction(organizationSlug: string, leadId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/leads/${leadId}`);
  try {
    await autoAssignLead(db, { organizationId: organization.id, leadId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/leads/${leadId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Playbooks
// ---------------------------------------------------------------------------

const createPlaybookSchema = z.object({ name: salesNameSchema, playbookKey: salesKeySchema, playbookType: salesPlaybookTypeSchema });

export async function createPlaybookAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/playbooks`);
  const parsed = createPlaybookSchema.safeParse({ name: formData.get("name"), playbookKey: formData.get("playbookKey"), playbookType: formData.get("playbookType") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createPlaybook(db, { organizationId: organization.id, name: parsed.data.name, playbookKey: parsed.data.playbookKey, playbookType: parsed.data.playbookType, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/playbooks`);
  return { ok: true };
}

export async function createPlaybookVersionAction(organizationSlug: string, playbookId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/playbooks/${playbookId}`);
  const changeReason = String(formData.get("changeReason") ?? "");
  try {
    await createPlaybookVersion(db, { organizationId: organization.id, playbookId, changeReason: changeReason || undefined, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/playbooks/${playbookId}`);
  return { ok: true };
}

const addStepSchema = z.object({
  stepKey: salesKeySchema,
  stepType: salesPlaybookStepTypeSchema,
  name: salesNameSchema,
  sequence: z.coerce.number().int().min(0),
  required: z.coerce.boolean().optional(),
});

export async function addPlaybookStepAction(organizationSlug: string, playbookId: string, playbookVersionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/playbooks/${playbookId}`);
  const parsed = addStepSchema.safeParse({
    stepKey: formData.get("stepKey"),
    stepType: formData.get("stepType"),
    name: formData.get("name"),
    sequence: formData.get("sequence"),
    required: formData.get("required") ? true : false,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await addPlaybookStep(db, { organizationId: organization.id, playbookVersionId, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/playbooks/${playbookId}`);
  return { ok: true };
}

const publishPlaybookSchema = z.object({ expectedRevision: z.coerce.number().int().min(1) });

export async function publishPlaybookVersionAction(organizationSlug: string, playbookId: string, versionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/playbooks/${playbookId}`);
  const parsed = publishPlaybookSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await publishPlaybookVersion(db, { organizationId: organization.id, playbookId, versionId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/playbooks/${playbookId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lead qualification
// ---------------------------------------------------------------------------

export async function startQualificationRunAction(organizationSlug: string, leadId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/leads/${leadId}`);
  const playbookVersionId = String(formData.get("playbookVersionId") ?? "") || undefined;
  try {
    await startQualificationRun(db, { organizationId: organization.id, leadId, playbookVersionId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/leads/${leadId}`);
  return { ok: true };
}

const completeItemSchema = z.object({ status: z.enum(["complete", "skipped"]), evidenceActivityId: uuidSchema.optional() });

export async function completeQualificationItemAction(organizationSlug: string, leadId: string, itemId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/leads/${leadId}`);
  const parsed = completeItemSchema.safeParse({ status: formData.get("status"), evidenceActivityId: formData.get("evidenceActivityId") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await completeQualificationItem(db, { organizationId: organization.id, itemId, status: parsed.data.status, evidenceActivityId: parsed.data.evidenceActivityId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/leads/${leadId}`);
  return { ok: true };
}

const runDecisionSchema = z.object({ expectedRevision: z.coerce.number().int().min(1), reason: z.string().trim().max(1000).optional() });

export async function qualifyLeadViaRunAction(organizationSlug: string, leadId: string, runId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/leads/${leadId}`);
  const parsed = runDecisionSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await qualifyLeadViaRun(db, { organizationId: organization.id, runId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/leads/${leadId}`);
  return { ok: true };
}

export async function disqualifyLeadViaRunAction(organizationSlug: string, leadId: string, runId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/leads/${leadId}`);
  const parsed = runDecisionSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), reason: formData.get("reason") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await disqualifyLeadViaRun(db, { organizationId: organization.id, runId, expectedRevision: parsed.data.expectedRevision, reason: parsed.data.reason, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/leads/${leadId}`);
  return { ok: true };
}

export async function abandonQualificationRunAction(organizationSlug: string, leadId: string, runId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/leads/${leadId}`);
  const parsed = removeMemberSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await abandonQualificationRun(db, { organizationId: organization.id, runId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/leads/${leadId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Opportunity playbook execution
// ---------------------------------------------------------------------------

export async function startOpportunityPlaybookRunAction(organizationSlug: string, opportunityId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  const playbookVersionId = String(formData.get("playbookVersionId") ?? "") || undefined;
  try {
    await startOpportunityPlaybookRun(db, { organizationId: organization.id, opportunityId, playbookVersionId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  return { ok: true };
}

export async function completeOpportunityPlaybookItemAction(organizationSlug: string, opportunityId: string, itemId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  const parsed = completeItemSchema.safeParse({ status: formData.get("status"), evidenceActivityId: formData.get("evidenceActivityId") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await completeOpportunityPlaybookItem(db, { organizationId: organization.id, itemId, status: parsed.data.status, evidenceActivityId: parsed.data.evidenceActivityId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  return { ok: true };
}

export async function completeOpportunityPlaybookRunAction(organizationSlug: string, opportunityId: string, runId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  const parsed = removeMemberSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await completeOpportunityPlaybookRun(db, { organizationId: organization.id, runId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  return { ok: true };
}

export async function abandonOpportunityPlaybookRunAction(organizationSlug: string, opportunityId: string, runId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  const parsed = removeMemberSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await abandonOpportunityPlaybookRun(db, { organizationId: organization.id, runId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Forecast category
// ---------------------------------------------------------------------------

const forecastCategorySchema = z.object({ forecastCategory: salesForecastCategorySchema });

export async function setOpportunityForecastCategoryAction(organizationSlug: string, opportunityId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  const parsed = forecastCategorySchema.safeParse({ forecastCategory: formData.get("forecastCategory") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await setOpportunityForecastCategory(db, { organizationId: organization.id, opportunityId, forecastCategory: parsed.data.forecastCategory, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

const createTargetSchema = z.object({
  scopeType: salesTargetScopeTypeSchema,
  userId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  metricType: salesTargetMetricTypeSchema,
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  targetValue: z.coerce.number().min(0),
});

export async function createSalesTargetAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/targets`);
  const parsed = createTargetSchema.safeParse({
    scopeType: formData.get("scopeType"),
    userId: formData.get("userId") || undefined,
    teamId: formData.get("teamId") || undefined,
    metricType: formData.get("metricType"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    targetValue: formData.get("targetValue"),
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createSalesTarget(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/targets`);
  return { ok: true };
}

const updateTargetSchema = z.object({ expectedRevision: z.coerce.number().int().min(1), targetValue: z.coerce.number().min(0) });

export async function updateSalesTargetAction(organizationSlug: string, targetId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/targets`);
  const parsed = updateTargetSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), targetValue: formData.get("targetValue") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await updateSalesTarget(db, { organizationId: organization.id, targetId, expectedRevision: parsed.data.expectedRevision, targetValue: parsed.data.targetValue, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/targets`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Follow-up sequences
// ---------------------------------------------------------------------------

const createSequenceSchema = z.object({ name: salesNameSchema, sequenceKey: salesKeySchema, targetType: salesSequenceTargetTypeSchema });

export async function createFollowUpSequenceAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/playbooks`);
  const parsed = createSequenceSchema.safeParse({ name: formData.get("name"), sequenceKey: formData.get("sequenceKey"), targetType: formData.get("targetType") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createFollowUpSequence(db, { organizationId: organization.id, name: parsed.data.name, sequenceKey: parsed.data.sequenceKey, targetType: parsed.data.targetType, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/playbooks`);
  return { ok: true };
}

const addSequenceStepSchema = z.object({
  stepKey: salesKeySchema,
  dayOffset: z.coerce.number().int().min(0).max(365),
  actionType: salesSequenceStepActionTypeSchema,
  title: salesTitleSchema,
  sequence: z.coerce.number().int().min(0),
});

export async function addSequenceStepAction(organizationSlug: string, sequenceVersionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/playbooks`);
  const parsed = addSequenceStepSchema.safeParse({
    stepKey: formData.get("stepKey"),
    dayOffset: formData.get("dayOffset"),
    actionType: formData.get("actionType"),
    title: formData.get("title"),
    sequence: formData.get("sequence"),
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await addSequenceStep(db, { organizationId: organization.id, sequenceVersionId, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/playbooks`);
  return { ok: true };
}

export async function publishSequenceVersionAction(organizationSlug: string, sequenceId: string, versionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/playbooks`);
  const parsed = publishPlaybookSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await publishSequenceVersion(db, { organizationId: organization.id, sequenceId, versionId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/playbooks`);
  return { ok: true };
}

const enrollSchema = z.object({ sequenceId: uuidSchema, targetType: salesSequenceTargetTypeSchema, targetId: uuidSchema });

export async function enrollInSequenceAction(organizationSlug: string, redirectPath: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, redirectPath);
  const parsed = enrollSchema.safeParse({ sequenceId: formData.get("sequenceId"), targetType: formData.get("targetType"), targetId: formData.get("targetId") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await enrollInSequence(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(redirectPath);
  return { ok: true };
}

export async function stopEnrollmentAction(organizationSlug: string, redirectPath: string, enrollmentId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, redirectPath);
  const parsed = runDecisionSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), reason: formData.get("reason") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await stopEnrollment(db, { organizationId: organization.id, enrollmentId, expectedRevision: parsed.data.expectedRevision, reason: parsed.data.reason, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(redirectPath);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Agent-assisted sales
// ---------------------------------------------------------------------------

export async function launchLeadResearchAction(organizationSlug: string, leadId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/leads/${leadId}`);
  try {
    await createLeadResearchTask(db, { organizationId: organization.id, leadId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/leads/${leadId}`);
  return { ok: true };
}

export async function launchOpportunitySummaryAction(organizationSlug: string, opportunityId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  try {
    await createOpportunitySummaryTask(db, { organizationId: organization.id, opportunityId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  return { ok: true };
}

const requestApprovalSchema = z.object({ summary: z.string().trim().min(1).max(1000) });

export async function requestOpportunityContinuationApprovalAction(organizationSlug: string, opportunityId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  const parsed = requestApprovalSchema.safeParse({ summary: formData.get("summary") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await requestOpportunityContinuationApproval(db, { organizationId: organization.id, opportunityId, summary: parsed.data.summary, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/sales/opportunities/${opportunityId}`);
  return { ok: true };
}
