import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { analyticsConfigurations } from "@/db/schema";
import { resolveAnalyticsAuthContext, requireAnalyticsViewAuthority, requireAnalyticsAdminAuthority } from "./authz";
import { StaleAnalyticsUpdateError } from "./errors";
import type { AnalyticsTimeGrain, AnalyticsDateRangeStrategy } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface AnalyticsConfiguration {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  businessTimezone: string;
  defaultTimeGrain: AnalyticsTimeGrain;
  defaultDateRangeStrategy: AnalyticsDateRangeStrategy;
  defaultComparisonEnabled: boolean;
  revision: number;
}

const DEFAULT_CONFIGURATION_SHAPE = {
  businessTimezone: "UTC",
  defaultTimeGrain: "day" as AnalyticsTimeGrain,
  defaultDateRangeStrategy: "last_30_days" as AnalyticsDateRangeStrategy,
  defaultComparisonEnabled: true,
};

export async function getAnalyticsConfiguration(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<AnalyticsConfiguration | null> {
  const ctx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireAnalyticsViewAuthority(db, ctx, "analytics_configuration", input.organizationId);

  if (input.workspaceId) {
    const [workspaceRow] = await db.select().from(analyticsConfigurations).where(and(eq(analyticsConfigurations.organizationId, input.organizationId), eq(analyticsConfigurations.workspaceId, input.workspaceId)));
    if (workspaceRow) return workspaceRow as AnalyticsConfiguration;
  }
  const [orgRow] = await db.select().from(analyticsConfigurations).where(and(eq(analyticsConfigurations.organizationId, input.organizationId), isNull(analyticsConfigurations.workspaceId)));
  return (orgRow as AnalyticsConfiguration) ?? null;
}

/** Never throws for a missing config — resolves to safe in-memory defaults, so every metric query works before an admin ever visits Settings. */
export async function resolveEffectiveAnalyticsConfiguration(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<AnalyticsConfiguration> {
  const found = await getAnalyticsConfiguration(db, input);
  if (found) return found;
  return { id: "default", organizationId: input.organizationId, workspaceId: input.workspaceId, ...DEFAULT_CONFIGURATION_SHAPE, revision: 0 };
}

export async function upsertAnalyticsConfiguration(
  db: Db,
  input: { organizationId: string; workspaceId?: string | null; businessTimezone?: string; defaultTimeGrain?: AnalyticsTimeGrain; defaultDateRangeStrategy?: AnalyticsDateRangeStrategy; defaultComparisonEnabled?: boolean; expectedRevision?: number; actorUserId: string }
): Promise<AnalyticsConfiguration> {
  const ctx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireAnalyticsAdminAuthority(db, ctx, "analytics_configuration", input.organizationId);

  const workspaceId = input.workspaceId ?? null;
  const existing = await getAnalyticsConfiguration(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });

  if (!existing) {
    const [row] = await db
      .insert(analyticsConfigurations)
      .values({
        organizationId: input.organizationId,
        workspaceId,
        businessTimezone: input.businessTimezone ?? DEFAULT_CONFIGURATION_SHAPE.businessTimezone,
        defaultTimeGrain: input.defaultTimeGrain ?? DEFAULT_CONFIGURATION_SHAPE.defaultTimeGrain,
        defaultDateRangeStrategy: input.defaultDateRangeStrategy ?? DEFAULT_CONFIGURATION_SHAPE.defaultDateRangeStrategy,
        defaultComparisonEnabled: input.defaultComparisonEnabled ?? DEFAULT_CONFIGURATION_SHAPE.defaultComparisonEnabled,
      })
      .returning();
    return row as AnalyticsConfiguration;
  }

  const expectedRevision = input.expectedRevision ?? existing.revision;
  const values: Record<string, unknown> = { revision: expectedRevision + 1, updatedAt: new Date() };
  if (input.businessTimezone !== undefined) values.businessTimezone = input.businessTimezone;
  if (input.defaultTimeGrain !== undefined) values.defaultTimeGrain = input.defaultTimeGrain;
  if (input.defaultDateRangeStrategy !== undefined) values.defaultDateRangeStrategy = input.defaultDateRangeStrategy;
  if (input.defaultComparisonEnabled !== undefined) values.defaultComparisonEnabled = input.defaultComparisonEnabled;

  const [row] = await db
    .update(analyticsConfigurations)
    .set(values)
    .where(and(eq(analyticsConfigurations.id, existing.id), eq(analyticsConfigurations.revision, expectedRevision)))
    .returning();
  if (!row) throw new StaleAnalyticsUpdateError("analytics configuration");
  return row as AnalyticsConfiguration;
}
