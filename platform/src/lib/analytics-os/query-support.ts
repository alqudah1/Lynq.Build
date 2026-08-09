import "server-only";
import { sql, and, eq, gte, lte, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { AnalyticsTimeGrain } from "./validation";
import type { MetricSeriesPoint } from "./metrics/types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Workspace scope — applied at the canonical source query, never after
 * aggregation.
 * ============================================================================
 * When a caller requests a specific workspace (`workspaceId` set), only rows
 * explicitly tagged with that workspace are counted — a row with
 * `workspaceId = NULL` (an organization-level record not tied to any single
 * workspace) is EXCLUDED from a workspace-scoped view, since it does not
 * belong to that workspace. When no workspace is requested (`workspaceId`
 * null — an org-wide query), no filter is added at all: both workspace-
 * tagged and NULL-workspace rows are included, matching every other org-wide
 * read in this codebase (e.g. `requireCrmViewAuthority`'s own "any
 * organization member may view an org-wide record" rule).
 *
 * Returns `undefined` (a true no-op `and()` skips it) when either no
 * workspace was requested, or the table being queried has no `workspaceId`
 * column of its own — the latter case exists for CRM leads/follow-ups,
 * Marketing attribution/budget records, and Agent Runtime approval requests,
 * and MUST be paired with a code comment at the call site documenting that
 * exact inclusion behavior (an organization-scoped record type stays
 * organization-wide even under a workspace-scoped query — never silently
 * narrowed by a column that doesn't exist).
 */
export function workspaceScopeCondition(column: PgColumn | null | undefined, workspaceId: string | null): SQL | undefined {
  if (!workspaceId || !column) return undefined;
  return eq(column, workspaceId);
}

/** Exported so a metric needing a joined (multi-table) time series — beyond what `seriesByDay`/`seriesSumByDay`'s single-table shape supports — can build its own `date_trunc` bucket expression against the identical fixed, validated grain map. */
export const GRAIN_TO_POSTGRES_MAP: Record<AnalyticsTimeGrain, string> = {
  day: "day",
  week: "week",
  month: "month",
  quarter: "quarter",
};

/**
 * A bounded, safe `date_trunc`-based bucketing helper — the ONE place raw
 * SQL is used in this module, and only for a fixed, validated grain value
 * (never caller-supplied text interpolated directly) against a real,
 * typed timestamp column. Every metric's own `computeSeries` calls this
 * rather than hand-rolling its own grouped query.
 */
export async function seriesByDay(db: Db, table: PgTable, dateColumn: PgColumn, whereCondition: SQL, from: Date, to: Date, grain: AnalyticsTimeGrain): Promise<MetricSeriesPoint[]> {
  const postgresGrain = GRAIN_TO_POSTGRES_MAP[grain];
  const bucket = sql<string>`date_trunc(${postgresGrain}, ${dateColumn})`;

  const rows = await db
    .select({ bucket, value: sql<number>`count(*)::int` })
    .from(table)
    .where(and(whereCondition, gte(dateColumn, from), lte(dateColumn, to)))
    .groupBy(bucket)
    .orderBy(bucket);

  return rows.map((r) => ({ bucketStart: new Date(r.bucket).toISOString(), value: r.value }));
}

/** Same shape, for a SUM aggregation instead of a count. */
export async function seriesSumByDay(db: Db, table: PgTable, dateColumn: PgColumn, sumColumn: PgColumn, whereCondition: SQL, from: Date, to: Date, grain: AnalyticsTimeGrain): Promise<MetricSeriesPoint[]> {
  const postgresGrain = GRAIN_TO_POSTGRES_MAP[grain];
  const bucket = sql<string>`date_trunc(${postgresGrain}, ${dateColumn})`;

  const rows = await db
    .select({ bucket, value: sql<number>`coalesce(sum(${sumColumn}), 0)::float` })
    .from(table)
    .where(and(whereCondition, gte(dateColumn, from), lte(dateColumn, to)))
    .groupBy(bucket)
    .orderBy(bucket);

  return rows.map((r) => ({ bucketStart: new Date(r.bucket).toISOString(), value: r.value }));
}
