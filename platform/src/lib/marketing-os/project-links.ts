import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingProjectLinks, projects } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveMarketingAuthContext, requireMarketingManageCampaignsAuthority } from "./authz";
import type { MarketingProjectLinkEntityType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingProjectLink {
  id: string;
  organizationId: string;
  projectId: string;
  marketingEntityType: MarketingProjectLinkEntityType;
  marketingEntityId: string;
  linkedByUserId: string | null;
  createdAt: Date;
}

/**
 * Additional (non-primary) Projects Core associations — mirrors CRM's own
 * `crm_project_links` pattern exactly. The campaign's own `projectId` and
 * the content item's own `projectTaskId` already cover the common
 * single-project/single-task case; this table is for any further
 * association beyond that. Never duplicates project data — a bare typed
 * pointer only. Idempotent: a duplicate link is a safe no-op.
 */
export async function linkMarketingEntityToProject(db: Db, input: { organizationId: string; projectId: string; marketingEntityType: MarketingProjectLinkEntityType; marketingEntityId: string; actorUserId: string }): Promise<void> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageCampaignsAuthority(db, ctx, input.marketingEntityType === "campaign" ? "marketing_campaign" : "marketing_content_item", input.marketingEntityId);

  const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)));
  if (!project) throw new Error("project not found in this organization");

  try {
    await db.insert(marketingProjectLinks).values({ organizationId: input.organizationId, projectId: input.projectId, marketingEntityType: input.marketingEntityType, marketingEntityId: input.marketingEntityId, linkedByUserId: input.actorUserId });
  } catch (err) {
    if (isPostgresUniqueViolation(err)) return;
    throw err;
  }

  await recordAuditEvent(db, { eventType: "marketing_project_linked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: input.marketingEntityType === "campaign" ? "marketing_campaign" : "marketing_content_item", targetId: input.marketingEntityId, metadata: { projectId: input.projectId } });
}

export async function listProjectLinksForEntity(db: Db, input: { organizationId: string; marketingEntityType: MarketingProjectLinkEntityType; marketingEntityId: string; actorUserId: string }): Promise<MarketingProjectLink[]> {
  await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  return (await db
    .select()
    .from(marketingProjectLinks)
    .where(and(eq(marketingProjectLinks.organizationId, input.organizationId), eq(marketingProjectLinks.marketingEntityType, input.marketingEntityType), eq(marketingProjectLinks.marketingEntityId, input.marketingEntityId)))) as unknown as MarketingProjectLink[];
}
