import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingConfigurations } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveMarketingAuthContext, requireMarketingViewAuthority, requireMarketingAdminAuthority } from "./authz";
import { StaleMarketingUpdateError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingConfiguration {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  businessTimezone: string;
  defaultCurrency: string;
  defaultCampaignOwnerUserId: string | null;
  defaultApprovalPolicy: string;
  defaultContentPlaybookId: string | null;
  staleCampaignThresholdDays: number;
  attributionWindowDays: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_CONFIGURATION_SHAPE = {
  businessTimezone: "UTC",
  defaultCurrency: "USD",
  defaultCampaignOwnerUserId: null as string | null,
  defaultApprovalPolicy: "required",
  defaultContentPlaybookId: null as string | null,
  staleCampaignThresholdDays: 14,
  attributionWindowDays: 30,
};

/** The effective configuration for a scope: the workspace-specific row if one exists, else the organization-level row, else `null` (never a persisted default until an admin explicitly saves). */
export async function getMarketingConfiguration(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<MarketingConfiguration | null> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_configuration", input.organizationId);

  if (input.workspaceId) {
    const [workspaceRow] = await db.select().from(marketingConfigurations).where(and(eq(marketingConfigurations.organizationId, input.organizationId), eq(marketingConfigurations.workspaceId, input.workspaceId)));
    if (workspaceRow) return workspaceRow;
  }
  const [orgRow] = await db.select().from(marketingConfigurations).where(and(eq(marketingConfigurations.organizationId, input.organizationId), isNull(marketingConfigurations.workspaceId)));
  return orgRow ?? null;
}

/** Effective, always-defined configuration for internal service use (health/next-best-action/analytics) — never throws for a missing row, falls back to defaults. Does not itself perform authorization; callers already resolved their own. */
export async function resolveEffectiveMarketingConfiguration(db: Db, organizationId: string, workspaceId: string | null): Promise<typeof DEFAULT_CONFIGURATION_SHAPE> {
  if (workspaceId) {
    const [workspaceRow] = await db.select().from(marketingConfigurations).where(and(eq(marketingConfigurations.organizationId, organizationId), eq(marketingConfigurations.workspaceId, workspaceId)));
    if (workspaceRow) return workspaceRow;
  }
  const [orgRow] = await db.select().from(marketingConfigurations).where(and(eq(marketingConfigurations.organizationId, organizationId), isNull(marketingConfigurations.workspaceId)));
  return orgRow ?? DEFAULT_CONFIGURATION_SHAPE;
}

export interface UpsertMarketingConfigurationInput {
  organizationId: string;
  workspaceId: string | null;
  actorUserId: string;
  expectedRevision?: number;
  businessTimezone?: string;
  defaultCurrency?: string;
  defaultCampaignOwnerUserId?: string | null;
  defaultApprovalPolicy?: string;
  defaultContentPlaybookId?: string | null;
  staleCampaignThresholdDays?: number;
  attributionWindowDays?: number;
}

/** Creates the configuration row for this scope if none exists, or applies a revision-guarded update if one does. Marketing-admin (or org owner/admin) only. */
export async function upsertMarketingConfiguration(db: Db, input: UpsertMarketingConfigurationInput): Promise<MarketingConfiguration> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingAdminAuthority(db, ctx, "marketing_configuration", input.organizationId);

  const whereScope = input.workspaceId
    ? and(eq(marketingConfigurations.organizationId, input.organizationId), eq(marketingConfigurations.workspaceId, input.workspaceId))
    : and(eq(marketingConfigurations.organizationId, input.organizationId), isNull(marketingConfigurations.workspaceId));

  const [existing] = await db.select().from(marketingConfigurations).where(whereScope);

  const fields = {
    businessTimezone: input.businessTimezone,
    defaultCurrency: input.defaultCurrency,
    defaultCampaignOwnerUserId: input.defaultCampaignOwnerUserId,
    defaultApprovalPolicy: input.defaultApprovalPolicy,
    defaultContentPlaybookId: input.defaultContentPlaybookId,
    staleCampaignThresholdDays: input.staleCampaignThresholdDays,
    attributionWindowDays: input.attributionWindowDays,
  };
  const setValues = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

  let row: MarketingConfiguration;
  if (!existing) {
    [row] = await db
      .insert(marketingConfigurations)
      .values({ organizationId: input.organizationId, workspaceId: input.workspaceId, ...DEFAULT_CONFIGURATION_SHAPE, ...setValues })
      .returning();
  } else {
    if (input.expectedRevision === undefined) throw new StaleMarketingUpdateError("marketing configuration");
    const [updated] = await db
      .update(marketingConfigurations)
      .set({ ...setValues, revision: existing.revision + 1, updatedAt: new Date() })
      .where(and(eq(marketingConfigurations.id, existing.id), eq(marketingConfigurations.revision, input.expectedRevision)))
      .returning();
    if (!updated) throw new StaleMarketingUpdateError("marketing configuration");
    row = updated;
  }

  await recordAuditEvent(db, {
    eventType: "marketing_configuration_updated",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "marketing_configuration",
    targetId: row.id,
    metadata: { workspaceScoped: Boolean(input.workspaceId), fields: Object.keys(setValues) },
  });

  return row;
}
