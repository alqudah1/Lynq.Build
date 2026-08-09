import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { salesConfigurations } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveSalesAuthContext, requireSalesViewAuthority, requireSalesAdminAuthority } from "./authz";
import { StaleSalesUpdateError } from "./errors";
import type { SalesLeadAssignmentStrategy, SalesForecastingMode } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface SalesConfiguration {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  defaultPipelineId: string | null;
  businessTimezone: string;
  currency: string;
  defaultLeadAssignmentStrategy: SalesLeadAssignmentStrategy;
  defaultQualificationPlaybookId: string | null;
  defaultOpportunityPlaybookId: string | null;
  staleLeadThresholdDays: number;
  staleOpportunityThresholdDays: number;
  forecastingMode: SalesForecastingMode;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_CONFIGURATION_SHAPE = {
  defaultPipelineId: null as string | null,
  businessTimezone: "UTC",
  currency: "USD",
  defaultLeadAssignmentStrategy: "manual" as SalesLeadAssignmentStrategy,
  defaultQualificationPlaybookId: null as string | null,
  defaultOpportunityPlaybookId: null as string | null,
  staleLeadThresholdDays: 7,
  staleOpportunityThresholdDays: 14,
  forecastingMode: "stage_probability" as SalesForecastingMode,
};

/** The effective configuration for a scope: the workspace-specific row if one exists, else the organization-level row, else safe in-memory defaults (never persisted until an admin explicitly saves). */
export async function getSalesConfiguration(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<SalesConfiguration | null> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_configuration", input.organizationId);

  if (input.workspaceId) {
    const [workspaceRow] = await db.select().from(salesConfigurations).where(and(eq(salesConfigurations.organizationId, input.organizationId), eq(salesConfigurations.workspaceId, input.workspaceId)));
    if (workspaceRow) return workspaceRow;
  }
  const [orgRow] = await db.select().from(salesConfigurations).where(and(eq(salesConfigurations.organizationId, input.organizationId), isNull(salesConfigurations.workspaceId)));
  return orgRow ?? null;
}

/** Effective, always-defined configuration for internal service use (assignment/forecasting/queues) — never throws for a missing row, falls back to defaults. Does not itself perform authorization; callers already resolved their own. */
export async function resolveEffectiveSalesConfiguration(db: Db, organizationId: string, workspaceId: string | null): Promise<typeof DEFAULT_CONFIGURATION_SHAPE> {
  if (workspaceId) {
    const [workspaceRow] = await db.select().from(salesConfigurations).where(and(eq(salesConfigurations.organizationId, organizationId), eq(salesConfigurations.workspaceId, workspaceId)));
    if (workspaceRow) return workspaceRow;
  }
  const [orgRow] = await db.select().from(salesConfigurations).where(and(eq(salesConfigurations.organizationId, organizationId), isNull(salesConfigurations.workspaceId)));
  return orgRow ?? DEFAULT_CONFIGURATION_SHAPE;
}

export interface UpsertSalesConfigurationInput {
  organizationId: string;
  workspaceId: string | null;
  actorUserId: string;
  expectedRevision?: number;
  defaultPipelineId?: string | null;
  businessTimezone?: string;
  currency?: string;
  defaultLeadAssignmentStrategy?: SalesLeadAssignmentStrategy;
  defaultQualificationPlaybookId?: string | null;
  defaultOpportunityPlaybookId?: string | null;
  staleLeadThresholdDays?: number;
  staleOpportunityThresholdDays?: number;
  forecastingMode?: SalesForecastingMode;
}

/** Creates the configuration row for this scope if none exists, or applies a revision-guarded update if one does. Sales-admin (or org owner/admin) only. */
export async function upsertSalesConfiguration(db: Db, input: UpsertSalesConfigurationInput): Promise<SalesConfiguration> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesAdminAuthority(db, ctx, "sales_configuration", input.organizationId);

  const whereScope = input.workspaceId
    ? and(eq(salesConfigurations.organizationId, input.organizationId), eq(salesConfigurations.workspaceId, input.workspaceId))
    : and(eq(salesConfigurations.organizationId, input.organizationId), isNull(salesConfigurations.workspaceId));

  const [existing] = await db.select().from(salesConfigurations).where(whereScope);

  const fields = {
    defaultPipelineId: input.defaultPipelineId,
    businessTimezone: input.businessTimezone,
    currency: input.currency,
    defaultLeadAssignmentStrategy: input.defaultLeadAssignmentStrategy,
    defaultQualificationPlaybookId: input.defaultQualificationPlaybookId,
    defaultOpportunityPlaybookId: input.defaultOpportunityPlaybookId,
    staleLeadThresholdDays: input.staleLeadThresholdDays,
    staleOpportunityThresholdDays: input.staleOpportunityThresholdDays,
    forecastingMode: input.forecastingMode,
  };
  const setValues = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

  let row: SalesConfiguration;
  if (!existing) {
    [row] = await db
      .insert(salesConfigurations)
      .values({ organizationId: input.organizationId, workspaceId: input.workspaceId, ...DEFAULT_CONFIGURATION_SHAPE, ...setValues })
      .returning();
  } else {
    if (input.expectedRevision === undefined) throw new StaleSalesUpdateError("sales configuration");
    const [updated] = await db
      .update(salesConfigurations)
      .set({ ...setValues, revision: existing.revision + 1, updatedAt: new Date() })
      .where(and(eq(salesConfigurations.id, existing.id), eq(salesConfigurations.revision, input.expectedRevision)))
      .returning();
    if (!updated) throw new StaleSalesUpdateError("sales configuration");
    row = updated;
  }

  await recordAuditEvent(db, {
    eventType: "sales_configuration_updated",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "sales_configuration",
    targetId: row.id,
    metadata: { workspaceScoped: Boolean(input.workspaceId), fields: Object.keys(setValues) },
  });

  return row;
}
