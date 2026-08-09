import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmProjectLinks } from "@/db/schema";
import { resolveProjectById } from "@/lib/projects/projects";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority, resolveCrmEntityWorkspaceId } from "./authz";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { DuplicateProjectLinkError } from "./errors";
import type { CrmProjectLinkEntityType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CrmProjectLink {
  id: string;
  organizationId: string;
  projectId: string;
  crmEntityType: CrmProjectLinkEntityType;
  crmEntityId: string;
  linkedByUserId: string | null;
  createdAt: Date;
}

export interface CreateProjectLinkInput {
  organizationId: string;
  projectId: string;
  crmEntityType: CrmProjectLinkEntityType;
  crmEntityId: string;
  actorUserId: string;
}

/**
 * Typed CRM↔Projects link — never duplicates project data inside CRM, and
 * never duplicates CRM data inside Projects Core. Mirrors
 * `project_artifact_links`'s own typed-pointer pattern exactly. A won
 * opportunity is NOT automatically turned into a project by this
 * function — that automation, if it ever exists, belongs to a future
 * Workflow, never hardcoded here.
 */
export async function createProjectLink(db: Db, input: CreateProjectLinkInput): Promise<CrmProjectLink> {
  await resolveProjectById(db, input.organizationId, input.projectId);
  const workspaceId = await resolveCrmEntityWorkspaceId(db, input.organizationId, input.crmEntityType, input.crmEntityId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_project_link", "new");

  try {
    const [row] = await db
      .insert(crmProjectLinks)
      .values({ organizationId: input.organizationId, projectId: input.projectId, crmEntityType: input.crmEntityType, crmEntityId: input.crmEntityId, linkedByUserId: input.actorUserId })
      .returning();

    await recordAuditEvent(db, { eventType: "crm_project_linked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_project_link", targetId: row.id, metadata: { projectId: input.projectId, crmEntityType: input.crmEntityType } });
    return row as CrmProjectLink;
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateProjectLinkError();
    throw err;
  }
}

export async function listProjectLinksForCrmEntity(db: Db, input: { organizationId: string; crmEntityType: CrmProjectLinkEntityType; crmEntityId: string; actorUserId: string }): Promise<CrmProjectLink[]> {
  const workspaceId = await resolveCrmEntityWorkspaceId(db, input.organizationId, input.crmEntityType, input.crmEntityId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_project_link", "list");

  const rows = await db
    .select()
    .from(crmProjectLinks)
    .where(and(eq(crmProjectLinks.organizationId, input.organizationId), eq(crmProjectLinks.crmEntityType, input.crmEntityType), eq(crmProjectLinks.crmEntityId, input.crmEntityId)));
  return rows as CrmProjectLink[];
}

export async function listProjectLinksForProject(db: Db, input: { organizationId: string; projectId: string; actorUserId: string }): Promise<CrmProjectLink[]> {
  const rows = await db.select().from(crmProjectLinks).where(and(eq(crmProjectLinks.organizationId, input.organizationId), eq(crmProjectLinks.projectId, input.projectId)));
  return rows as CrmProjectLink[];
}
