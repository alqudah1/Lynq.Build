"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { upsertAnalyticsConfiguration } from "@/lib/analytics-os/configuration";
import { grantAnalyticsRole, revokeAnalyticsRole } from "@/lib/analytics-os/roles";
import { createSavedReport, updateSavedReport, deleteSavedReport } from "@/lib/analytics-os/reports";
import { ANALYTICS_ROLES, ANALYTICS_TIME_GRAINS, ANALYTICS_DATE_RANGE_STRATEGIES, ANALYTICS_VISUALIZATIONS, ANALYTICS_REPORT_VISIBILITIES, reportNameSchema } from "@/lib/analytics-os/validation";
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

const configurationSchema = z.object({
  businessTimezone: z.string().trim().min(1).max(100),
  defaultTimeGrain: z.enum(ANALYTICS_TIME_GRAINS),
  defaultDateRangeStrategy: z.enum(ANALYTICS_DATE_RANGE_STRATEGIES),
  defaultComparisonEnabled: z.coerce.boolean(),
  expectedRevision: z.coerce.number().int().min(0),
});

export async function upsertAnalyticsConfigurationAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/analytics/settings`);
  const parsed = configurationSchema.safeParse({
    businessTimezone: formData.get("businessTimezone"),
    defaultTimeGrain: formData.get("defaultTimeGrain"),
    defaultDateRangeStrategy: formData.get("defaultDateRangeStrategy"),
    defaultComparisonEnabled: formData.get("defaultComparisonEnabled") === "on",
    expectedRevision: formData.get("expectedRevision"),
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await upsertAnalyticsConfiguration(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/analytics/settings`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const grantRoleSchema = z.object({ userId: uuidSchema, role: z.enum(ANALYTICS_ROLES) });

export async function grantAnalyticsRoleAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/analytics/settings`);
  const parsed = grantRoleSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await grantAnalyticsRole(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/analytics/settings`);
  return { ok: true };
}

export async function revokeAnalyticsRoleAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/analytics/settings`);
  const parsed = z.object({ roleAssignmentId: uuidSchema, expectedRevision: z.coerce.number().int().min(1) }).safeParse({ roleAssignmentId: formData.get("roleAssignmentId"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await revokeAnalyticsRole(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/analytics/settings`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Saved reports
// ---------------------------------------------------------------------------

const createReportSchema = z.object({
  name: reportNameSchema,
  metricKeys: z
    .string()
    .trim()
    .min(1)
    .transform((v) => v.split(",").map((k) => k.trim()).filter(Boolean)),
  dateRangeStrategy: z.enum(ANALYTICS_DATE_RANGE_STRATEGIES),
  comparisonEnabled: z.coerce.boolean(),
  timeGrain: z.enum(ANALYTICS_TIME_GRAINS),
  visualization: z.enum(ANALYTICS_VISUALIZATIONS),
  visibility: z.enum(ANALYTICS_REPORT_VISIBILITIES),
});

export async function createSavedReportAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/analytics/reports`);
  const parsed = createReportSchema.safeParse({
    name: formData.get("name"),
    metricKeys: formData.get("metricKeys"),
    dateRangeStrategy: formData.get("dateRangeStrategy"),
    comparisonEnabled: formData.get("comparisonEnabled") === "on",
    timeGrain: formData.get("timeGrain"),
    visualization: formData.get("visualization"),
    visibility: formData.get("visibility"),
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createSavedReport(db, { organizationId: organization.id, workspaceId: null, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/analytics/reports`);
  return { ok: true };
}

export async function deleteSavedReportAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/analytics/reports`);
  const parsed = z.object({ reportId: uuidSchema }).safeParse({ reportId: formData.get("reportId") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await deleteSavedReport(db, { organizationId: organization.id, actorUserId: user.userId, reportId: parsed.data.reportId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/analytics/reports`);
  return { ok: true };
}

const renameReportSchema = z.object({ reportId: uuidSchema, expectedRevision: z.coerce.number().int().min(1), name: reportNameSchema, visibility: z.enum(ANALYTICS_REPORT_VISIBILITIES) });

export async function updateSavedReportAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/analytics/reports`);
  const parsed = renameReportSchema.safeParse({
    reportId: formData.get("reportId"),
    expectedRevision: formData.get("expectedRevision"),
    name: formData.get("name"),
    visibility: formData.get("visibility"),
  });
  if (!parsed.success) return toActionResult(parsed.error);
  const { reportId, ...rest } = parsed.data;
  try {
    await updateSavedReport(db, { organizationId: organization.id, actorUserId: user.userId, reportId, ...rest });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/analytics/reports`);
  revalidatePath(`/app/${organizationSlug}/analytics/reports/${reportId}`);
  return { ok: true };
}
