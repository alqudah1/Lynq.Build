"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { grantFounderRole, revokeFounderRole } from "@/lib/founder-os/roles";
import { upsertFounderWorkspaceConfiguration } from "@/lib/founder-os/configuration";
import { createFounderDecision, updateFounderDecision, supersedeFounderDecision } from "@/lib/founder-os/decisions";
import { createFounderGoal, updateFounderGoal } from "@/lib/founder-os/goals";
import { decideFounderApproval } from "@/lib/founder-os/approval-center";
import { seedFounderAnalystAgent, launchFounderCompanyBriefTask } from "@/lib/founder-os/founder-analyst";
import { FOUNDER_ROLES, FOUNDER_DECISION_STATUSES, FOUNDER_GOAL_STATUSES, titleSchema, decisionTextSchema } from "@/lib/founder-os/validation";
import { ANALYTICS_DATE_RANGE_STRATEGIES } from "@/lib/analytics-os/validation";
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
// Setup
// ---------------------------------------------------------------------------

export async function seedFounderAnalystAction(organizationSlug: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/founder/settings`);
  try {
    await seedFounderAnalystAgent(db, { organizationId: organization.id, humanOwnerUserId: user.userId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/founder/settings`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const grantRoleSchema = z.object({ userId: uuidSchema, role: z.enum(FOUNDER_ROLES) });

export async function grantFounderRoleAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/founder/settings`);
  const parsed = grantRoleSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await grantFounderRole(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/founder/settings`);
  return { ok: true };
}

export async function revokeFounderRoleAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/founder/settings`);
  const parsed = z.object({ roleAssignmentId: uuidSchema, expectedRevision: z.coerce.number().int().min(1) }).safeParse({ roleAssignmentId: formData.get("roleAssignmentId"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await revokeFounderRole(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/founder/settings`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const configSchema = z.object({
  defaultDateRangeStrategy: z.enum(ANALYTICS_DATE_RANGE_STRATEGIES),
  expectedRevision: z.coerce.number().int().min(0),
});

export async function upsertFounderConfigurationAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/founder/settings`);
  const parsed = configSchema.safeParse({ defaultDateRangeStrategy: formData.get("defaultDateRangeStrategy"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await upsertFounderWorkspaceConfiguration(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/founder/settings`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

const decideApprovalSchema = z.object({ approvalId: uuidSchema, decision: z.enum(["approve", "reject", "request_revision"]), decisionNote: z.string().trim().max(2000).optional() });

export async function decideFounderApprovalAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/founder/approvals`);
  const parsed = decideApprovalSchema.safeParse({ approvalId: formData.get("approvalId"), decision: formData.get("decision"), decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await decideFounderApproval(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/founder/approvals`);
  revalidatePath(`/app/${organizationSlug}/founder`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const createDecisionSchema = z.object({
  title: titleSchema,
  decision: decisionTextSchema,
  contextSummary: z.string().trim().max(4000).optional(),
  decisionOwnerUserId: uuidSchema,
});

export async function createFounderDecisionAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/founder/decisions`);
  const parsed = createDecisionSchema.safeParse({
    title: formData.get("title"),
    decision: formData.get("decision"),
    contextSummary: formData.get("contextSummary") || undefined,
    decisionOwnerUserId: formData.get("decisionOwnerUserId"),
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createFounderDecision(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/founder/decisions`);
  return { ok: true };
}

const updateDecisionSchema = z.object({ decisionId: uuidSchema, expectedRevision: z.coerce.number().int().min(1), status: z.enum(FOUNDER_DECISION_STATUSES) });

export async function updateFounderDecisionStatusAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/founder/decisions`);
  const parsed = updateDecisionSchema.safeParse({ decisionId: formData.get("decisionId"), expectedRevision: formData.get("expectedRevision"), status: formData.get("status") });
  if (!parsed.success) return toActionResult(parsed.error);
  const { decisionId, ...rest } = parsed.data;
  try {
    await updateFounderDecision(db, { organizationId: organization.id, decisionId, ...rest, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/founder/decisions`);
  return { ok: true };
}

const supersedeDecisionSchema = z.object({ decisionId: uuidSchema, expectedRevision: z.coerce.number().int().min(1), supersededByDecisionId: uuidSchema });

export async function supersedeFounderDecisionAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/founder/decisions`);
  const parsed = supersedeDecisionSchema.safeParse({ decisionId: formData.get("decisionId"), expectedRevision: formData.get("expectedRevision"), supersededByDecisionId: formData.get("supersededByDecisionId") });
  if (!parsed.success) return toActionResult(parsed.error);
  const { decisionId, ...rest } = parsed.data;
  try {
    await supersedeFounderDecision(db, { organizationId: organization.id, decisionId, ...rest, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/founder/decisions`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

const createGoalSchema = z.object({
  title: titleSchema,
  metricKey: z.string().trim().min(1).max(100),
  targetValue: z.coerce.number(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  ownerUserId: uuidSchema,
});

export async function createFounderGoalAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/founder/goals`);
  const parsed = createGoalSchema.safeParse({
    title: formData.get("title"),
    metricKey: formData.get("metricKey"),
    targetValue: formData.get("targetValue"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    ownerUserId: formData.get("ownerUserId"),
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createFounderGoal(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/founder/goals`);
  return { ok: true };
}

const updateGoalSchema = z.object({ goalId: uuidSchema, expectedRevision: z.coerce.number().int().min(1), status: z.enum(FOUNDER_GOAL_STATUSES) });

export async function updateFounderGoalStatusAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/founder/goals`);
  const parsed = updateGoalSchema.safeParse({ goalId: formData.get("goalId"), expectedRevision: formData.get("expectedRevision"), status: formData.get("status") });
  if (!parsed.success) return toActionResult(parsed.error);
  const { goalId, ...rest } = parsed.data;
  try {
    await updateFounderGoal(db, { organizationId: organization.id, goalId, ...rest, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/founder/goals`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Daily brief
// ---------------------------------------------------------------------------

export async function launchFounderDailyBriefAction(organizationSlug: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/founder`);
  try {
    await launchFounderCompanyBriefTask(db, { organizationId: organization.id, workspaceId: null, ownerUserId: user.userId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/founder`);
  return { ok: true };
}
