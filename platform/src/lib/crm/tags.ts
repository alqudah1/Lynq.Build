import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmTags, crmTagAssignments } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority, resolveCrmEntityWorkspaceId } from "./authz";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { DuplicateTagAssignmentError } from "./errors";
import type { CrmTagEntityType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export class TagKeyAlreadyTakenError extends DomainRuleViolationError {
  readonly reason = "tag_key_taken";
  constructor(tagKey: string) {
    super(`A tag with key "${tagKey}" already exists in this organization`);
    this.name = "TagKeyAlreadyTakenError";
  }
}

export interface CrmTag {
  id: string;
  organizationId: string;
  name: string;
  tagKey: string;
  color: string | null;
  createdAt: Date;
}

export interface CrmTagAssignment {
  id: string;
  organizationId: string;
  tagId: string;
  entityType: CrmTagEntityType;
  entityId: string;
  assignedByUserId: string | null;
  createdAt: Date;
}

/** Organization-scoped tags — never created globally across tenants; every read/write is scoped by `organizationId`. */
export async function createTag(db: Db, input: { organizationId: string; name: string; tagKey: string; color?: string; actorUserId: string }): Promise<CrmTag> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_tag", "new");

  try {
    const [row] = await db.insert(crmTags).values({ organizationId: input.organizationId, name: input.name, tagKey: input.tagKey, color: input.color ?? null }).returning();
    await recordAuditEvent(db, { eventType: "crm_tag_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_tag", targetId: row.id, metadata: { tagKey: row.tagKey } });
    return row as CrmTag;
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new TagKeyAlreadyTakenError(input.tagKey);
    throw err;
  }
}

export async function listTagsForUser(db: Db, input: { organizationId: string; actorUserId: string }): Promise<CrmTag[]> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_tag", "list");
  const rows = await db.select().from(crmTags).where(eq(crmTags.organizationId, input.organizationId));
  return rows as CrmTag[];
}

async function resolveWorkspaceScope(db: Db, organizationId: string, entityType: CrmTagEntityType, entityId: string): Promise<string | null> {
  if (entityType === "contact" || entityType === "company" || entityType === "opportunity") {
    return resolveCrmEntityWorkspaceId(db, organizationId, entityType, entityId);
  }
  return null;
}

export interface AssignTagInput {
  organizationId: string;
  tagId: string;
  entityType: CrmTagEntityType;
  entityId: string;
  actorUserId: string;
}

/** Duplicate active tag assignments are rejected by `crm_tag_assignments_unique` — caught here and re-thrown as a domain error. */
export async function assignTag(db: Db, input: AssignTagInput): Promise<CrmTagAssignment> {
  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, input.entityType, input.entityId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_tag_assignment", "new");

  try {
    const [row] = await db
      .insert(crmTagAssignments)
      .values({ organizationId: input.organizationId, tagId: input.tagId, entityType: input.entityType, entityId: input.entityId, assignedByUserId: input.actorUserId })
      .returning();
    await recordAuditEvent(db, { eventType: "crm_tag_assigned", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_tag_assignment", targetId: row.id, metadata: { entityType: input.entityType, entityId: input.entityId } });
    return row as CrmTagAssignment;
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateTagAssignmentError();
    throw err;
  }
}

export async function unassignTag(db: Db, input: { organizationId: string; tagId: string; entityType: CrmTagEntityType; entityId: string; actorUserId: string }): Promise<void> {
  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, input.entityType, input.entityId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_tag_assignment", input.tagId);

  await db
    .delete(crmTagAssignments)
    .where(and(eq(crmTagAssignments.organizationId, input.organizationId), eq(crmTagAssignments.tagId, input.tagId), eq(crmTagAssignments.entityType, input.entityType), eq(crmTagAssignments.entityId, input.entityId)));

  await recordAuditEvent(db, { eventType: "crm_tag_unassigned", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_tag_assignment", targetId: input.tagId, metadata: { entityType: input.entityType, entityId: input.entityId } });
}

export async function listTagAssignmentsForEntity(db: Db, input: { organizationId: string; entityType: CrmTagEntityType; entityId: string; actorUserId: string }): Promise<CrmTagAssignment[]> {
  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, input.entityType, input.entityId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_tag_assignment", "list");

  const rows = await db
    .select()
    .from(crmTagAssignments)
    .where(and(eq(crmTagAssignments.organizationId, input.organizationId), eq(crmTagAssignments.entityType, input.entityType), eq(crmTagAssignments.entityId, input.entityId)));
  return rows as CrmTagAssignment[];
}
