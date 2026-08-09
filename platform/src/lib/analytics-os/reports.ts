import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq, or, isNull } from "drizzle-orm";
import { analyticsSavedReports } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { resolveAnalyticsAuthContext, requireAnalyticsViewAuthority, requireAnalyticsManageReportsAuthority, hasAnalyticsCapability, type AnalyticsAuthContext } from "./authz";
import { StaleAnalyticsUpdateError } from "./errors";
import { resolveMetric } from "./metrics/registry";
import { isKnownDimension } from "./dimensions";
import { reportNameSchema, MAX_METRIC_KEYS_PER_QUERY, type AnalyticsDateRangeStrategy, type AnalyticsTimeGrain, type AnalyticsVisualization } from "./validation";
import { runAnalyticsQuery, type AnalyticsQueryResult } from "./query";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface SavedReportRecord {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  description: string | null;
  metricKeys: string[];
  dateRangeStrategy: AnalyticsDateRangeStrategy;
  customStartDate: Date | null;
  customEndDate: Date | null;
  comparisonEnabled: boolean;
  timeGrain: AnalyticsTimeGrain;
  dimensions: string[];
  filters: unknown[];
  visualization: AnalyticsVisualization;
  ownerUserId: string;
  visibility: "private" | "organization";
  revision: number;
}

function validateReportShape(input: { metricKeys: string[]; dimensions?: string[] }): void {
  if (input.metricKeys.length === 0) throw new InsufficientRoleError("A saved report requires at least one metric.");
  if (input.metricKeys.length > MAX_METRIC_KEYS_PER_QUERY) throw new InsufficientRoleError(`A saved report may reference at most ${MAX_METRIC_KEYS_PER_QUERY} metrics.`);
  for (const key of input.metricKeys) resolveMetric(key); // throws UnknownMetricError for a bad key
  for (const dim of input.dimensions ?? []) {
    if (!isKnownDimension(dim)) throw new InsufficientRoleError(`"${dim}" is not a known analytics dimension.`);
  }
}

function canView(ctx: AnalyticsAuthContext, report: Pick<SavedReportRecord, "visibility" | "ownerUserId">): boolean {
  if (report.ownerUserId === ctx.actorUserId) return true;
  if (report.visibility === "organization") return true;
  return false;
}

function canManage(ctx: AnalyticsAuthContext, report: Pick<SavedReportRecord, "ownerUserId">): boolean {
  if (report.ownerUserId === ctx.actorUserId) return true;
  return hasAnalyticsCapability(ctx, "analytics_manage_reports") || hasAnalyticsCapability(ctx, "analytics_admin");
}

export async function createSavedReport(
  db: Db,
  input: {
    organizationId: string;
    workspaceId: string | null;
    actorUserId: string;
    name: string;
    description?: string | null;
    metricKeys: string[];
    dateRangeStrategy: AnalyticsDateRangeStrategy;
    customStartDate?: Date | null;
    customEndDate?: Date | null;
    comparisonEnabled: boolean;
    timeGrain: AnalyticsTimeGrain;
    dimensions?: string[];
    visualization: AnalyticsVisualization;
    visibility: "private" | "organization";
  }
): Promise<SavedReportRecord> {
  const ctx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireAnalyticsManageReportsAuthority(db, ctx, "analytics_saved_report", input.organizationId);

  const name = reportNameSchema.parse(input.name);
  validateReportShape({ metricKeys: input.metricKeys, dimensions: input.dimensions });

  const [row] = await db
    .insert(analyticsSavedReports)
    .values({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      name,
      description: input.description ?? null,
      metricKeys: input.metricKeys,
      dateRangeStrategy: input.dateRangeStrategy,
      customStartDate: input.customStartDate ?? null,
      customEndDate: input.customEndDate ?? null,
      comparisonEnabled: input.comparisonEnabled,
      timeGrain: input.timeGrain,
      dimensions: input.dimensions ?? [],
      filters: [], // structurally never executable SQL — a bounded jsonb array reserved for future per-dimension-value filtering, not yet applied by the query engine.
      visualization: input.visualization,
      ownerUserId: input.actorUserId,
      visibility: input.visibility,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "analytics_report_created", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "analytics_saved_report", targetId: row.id, metadata: { name } });
  return row as unknown as SavedReportRecord;
}

async function loadReportRow(db: Db, organizationId: string, reportId: string): Promise<SavedReportRecord> {
  const [row] = await db.select().from(analyticsSavedReports).where(and(eq(analyticsSavedReports.id, reportId), eq(analyticsSavedReports.organizationId, organizationId)));
  if (!row) throw new TenantResourceNotFoundError();
  return row as unknown as SavedReportRecord;
}

export async function getSavedReport(db: Db, input: { organizationId: string; actorUserId: string; reportId: string }): Promise<SavedReportRecord> {
  const ctx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireAnalyticsViewAuthority(db, ctx, "analytics_saved_report", input.reportId);

  const report = await loadReportRow(db, input.organizationId, input.reportId);
  if (!canView(ctx, report)) throw new InsufficientRoleError("This report is private to its owner.");
  return report;
}

export async function listSavedReports(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<SavedReportRecord[]> {
  const ctx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireAnalyticsViewAuthority(db, ctx, "analytics_saved_report", input.organizationId);

  const rows = await db
    .select()
    .from(analyticsSavedReports)
    .where(
      and(
        eq(analyticsSavedReports.organizationId, input.organizationId),
        input.workspaceId ? eq(analyticsSavedReports.workspaceId, input.workspaceId) : isNull(analyticsSavedReports.workspaceId),
        or(eq(analyticsSavedReports.visibility, "organization"), eq(analyticsSavedReports.ownerUserId, input.actorUserId))
      )
    );
  return rows as unknown as SavedReportRecord[];
}

export async function updateSavedReport(
  db: Db,
  input: {
    organizationId: string;
    actorUserId: string;
    reportId: string;
    expectedRevision: number;
    name?: string;
    description?: string | null;
    metricKeys?: string[];
    dateRangeStrategy?: AnalyticsDateRangeStrategy;
    customStartDate?: Date | null;
    customEndDate?: Date | null;
    comparisonEnabled?: boolean;
    timeGrain?: AnalyticsTimeGrain;
    dimensions?: string[];
    visualization?: AnalyticsVisualization;
    visibility?: "private" | "organization";
  }
): Promise<SavedReportRecord> {
  const ctx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  const existing = await loadReportRow(db, input.organizationId, input.reportId);
  if (!canManage(ctx, existing)) throw new InsufficientRoleError("requires being this report's own owner, or an Analytics manager/admin");

  if (input.metricKeys) validateReportShape({ metricKeys: input.metricKeys, dimensions: input.dimensions ?? existing.dimensions });

  const values: Record<string, unknown> = { revision: input.expectedRevision + 1, updatedAt: new Date() };
  if (input.name !== undefined) values.name = reportNameSchema.parse(input.name);
  if (input.description !== undefined) values.description = input.description;
  if (input.metricKeys !== undefined) values.metricKeys = input.metricKeys;
  if (input.dateRangeStrategy !== undefined) values.dateRangeStrategy = input.dateRangeStrategy;
  if (input.customStartDate !== undefined) values.customStartDate = input.customStartDate;
  if (input.customEndDate !== undefined) values.customEndDate = input.customEndDate;
  if (input.comparisonEnabled !== undefined) values.comparisonEnabled = input.comparisonEnabled;
  if (input.timeGrain !== undefined) values.timeGrain = input.timeGrain;
  if (input.dimensions !== undefined) values.dimensions = input.dimensions;
  if (input.visualization !== undefined) values.visualization = input.visualization;
  if (input.visibility !== undefined) values.visibility = input.visibility;

  const [row] = await db
    .update(analyticsSavedReports)
    .set(values)
    .where(and(eq(analyticsSavedReports.id, input.reportId), eq(analyticsSavedReports.organizationId, input.organizationId), eq(analyticsSavedReports.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleAnalyticsUpdateError("saved report");

  await recordAuditEvent(db, { eventType: "analytics_report_updated", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "analytics_saved_report", targetId: row.id, metadata: {} });
  return row as unknown as SavedReportRecord;
}

export async function deleteSavedReport(db: Db, input: { organizationId: string; actorUserId: string; reportId: string }): Promise<void> {
  const ctx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  const existing = await loadReportRow(db, input.organizationId, input.reportId);
  if (!canManage(ctx, existing)) throw new InsufficientRoleError("requires being this report's own owner, or an Analytics manager/admin");

  await db.delete(analyticsSavedReports).where(and(eq(analyticsSavedReports.id, input.reportId), eq(analyticsSavedReports.organizationId, input.organizationId)));
  await recordAuditEvent(db, { eventType: "analytics_report_deleted", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "analytics_saved_report", targetId: input.reportId, metadata: {} });
}

/** Loads a report (recording `analytics_report_viewed`), then runs it through the same bounded query engine every ad-hoc query goes through — a saved report is never itself executable SQL, only a stored, revalidated set of query engine inputs. */
export async function runSavedReport(db: Db, input: { organizationId: string; actorUserId: string; reportId: string }): Promise<{ report: SavedReportRecord; result: AnalyticsQueryResult }> {
  const ctx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireAnalyticsViewAuthority(db, ctx, "analytics_saved_report", input.reportId);

  const report = await loadReportRow(db, input.organizationId, input.reportId);
  if (!canView(ctx, report)) throw new InsufficientRoleError("This report is private to its owner.");

  await recordAuditEvent(db, { eventType: "analytics_report_viewed", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "analytics_saved_report", targetId: report.id, metadata: {} });

  const result = await runAnalyticsQuery(db, {
    organizationId: input.organizationId,
    workspaceId: report.workspaceId,
    actorUserId: input.actorUserId,
    metricKeys: report.metricKeys,
    dateRangeStrategy: report.dateRangeStrategy,
    customFrom: report.customStartDate ?? undefined,
    customTo: report.customEndDate ?? undefined,
    comparisonStrategy: report.comparisonEnabled ? "previous_period" : "none",
    timeGrain: report.timeGrain,
    groupBy: report.dimensions[0],
    includeSeries: false,
  });

  return { report, result };
}
