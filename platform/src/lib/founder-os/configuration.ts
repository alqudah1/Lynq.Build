import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { founderWorkspaceConfigurations } from "@/db/schema";
import { resolveFounderAuthContext, requireFounderViewAuthority, requireFounderManageLayoutAuthority } from "./authz";
import { StaleFounderUpdateError } from "./errors";
import { recordAuditEvent } from "@/lib/audit";
import type { AnalyticsDateRangeStrategy } from "@/lib/analytics-os/validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface FounderWorkspaceConfiguration {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  visibleKpiGroups: string[];
  widgetOrder: string[];
  selectedSavedReportIds: string[];
  defaultDateRangeStrategy: AnalyticsDateRangeStrategy;
  defaultWorkspaceId: string | null;
  revision: number;
}

const DEFAULT_CONFIGURATION_SHAPE = {
  visibleKpiGroups: ["growth", "sales", "marketing", "delivery", "operations", "communications", "ai"],
  widgetOrder: [] as string[],
  selectedSavedReportIds: [] as string[],
  defaultDateRangeStrategy: "last_30_days" as AnalyticsDateRangeStrategy,
  defaultWorkspaceId: null as string | null,
};

export async function getFounderWorkspaceConfiguration(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<FounderWorkspaceConfiguration | null> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, ctx, "founder_workspace_configuration", input.organizationId);

  if (input.workspaceId) {
    const [workspaceRow] = await db.select().from(founderWorkspaceConfigurations).where(and(eq(founderWorkspaceConfigurations.organizationId, input.organizationId), eq(founderWorkspaceConfigurations.workspaceId, input.workspaceId)));
    if (workspaceRow) return workspaceRow as FounderWorkspaceConfiguration;
  }
  const [orgRow] = await db.select().from(founderWorkspaceConfigurations).where(and(eq(founderWorkspaceConfigurations.organizationId, input.organizationId), isNull(founderWorkspaceConfigurations.workspaceId)));
  return (orgRow as FounderWorkspaceConfiguration) ?? null;
}

/** Never throws for a missing config — resolves to safe in-memory defaults, so the Founder Home works before an admin ever visits Settings. */
export async function resolveEffectiveFounderConfiguration(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<FounderWorkspaceConfiguration> {
  const found = await getFounderWorkspaceConfiguration(db, input);
  if (found) return found;
  return { id: "default", organizationId: input.organizationId, workspaceId: input.workspaceId, ...DEFAULT_CONFIGURATION_SHAPE, revision: 0 };
}

export async function upsertFounderWorkspaceConfiguration(
  db: Db,
  input: {
    organizationId: string;
    workspaceId?: string | null;
    visibleKpiGroups?: string[];
    widgetOrder?: string[];
    selectedSavedReportIds?: string[];
    defaultDateRangeStrategy?: AnalyticsDateRangeStrategy;
    defaultWorkspaceId?: string | null;
    expectedRevision?: number;
    actorUserId: string;
  }
): Promise<FounderWorkspaceConfiguration> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderManageLayoutAuthority(db, ctx, "founder_workspace_configuration", input.organizationId);

  const workspaceId = input.workspaceId ?? null;
  const existing = await getFounderWorkspaceConfiguration(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });

  let row: FounderWorkspaceConfiguration;
  if (!existing) {
    const [inserted] = await db
      .insert(founderWorkspaceConfigurations)
      .values({
        organizationId: input.organizationId,
        workspaceId,
        visibleKpiGroups: input.visibleKpiGroups ?? DEFAULT_CONFIGURATION_SHAPE.visibleKpiGroups,
        widgetOrder: input.widgetOrder ?? DEFAULT_CONFIGURATION_SHAPE.widgetOrder,
        selectedSavedReportIds: input.selectedSavedReportIds ?? DEFAULT_CONFIGURATION_SHAPE.selectedSavedReportIds,
        defaultDateRangeStrategy: input.defaultDateRangeStrategy ?? DEFAULT_CONFIGURATION_SHAPE.defaultDateRangeStrategy,
        defaultWorkspaceId: input.defaultWorkspaceId ?? DEFAULT_CONFIGURATION_SHAPE.defaultWorkspaceId,
      })
      .returning();
    row = inserted as FounderWorkspaceConfiguration;
  } else {
    const expectedRevision = input.expectedRevision ?? existing.revision;
    const values: Record<string, unknown> = { revision: expectedRevision + 1, updatedAt: new Date() };
    if (input.visibleKpiGroups !== undefined) values.visibleKpiGroups = input.visibleKpiGroups;
    if (input.widgetOrder !== undefined) values.widgetOrder = input.widgetOrder;
    if (input.selectedSavedReportIds !== undefined) values.selectedSavedReportIds = input.selectedSavedReportIds;
    if (input.defaultDateRangeStrategy !== undefined) values.defaultDateRangeStrategy = input.defaultDateRangeStrategy;
    if (input.defaultWorkspaceId !== undefined) values.defaultWorkspaceId = input.defaultWorkspaceId;

    const [updated] = await db
      .update(founderWorkspaceConfigurations)
      .set(values)
      .where(and(eq(founderWorkspaceConfigurations.id, existing.id), eq(founderWorkspaceConfigurations.revision, expectedRevision)))
      .returning();
    if (!updated) throw new StaleFounderUpdateError("founder workspace configuration");
    row = updated as FounderWorkspaceConfiguration;
  }

  await recordAuditEvent(db, { eventType: "founder_workspace_configuration_updated", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "founder_workspace_configuration", targetId: row.id, metadata: {} });
  return row;
}
