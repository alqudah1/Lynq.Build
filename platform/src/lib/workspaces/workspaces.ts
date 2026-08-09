import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { workspaces, workspaceMemberships } from "@/db/schema";
import {
  requireOrganizationMembership,
  requireOrganizationRole,
  requireWorkspaceMembership,
  requireOrganizationAdminOverride,
  requireTenantScopedResource,
  type WorkspaceMembershipRecord,
  type WorkspaceRole,
} from "@/lib/authz/helpers";
import { auditInsertQuery, recordAuditEvent } from "@/lib/audit";
import { WorkspaceDeletionNotPermittedError, SlugAlreadyTakenError } from "@/lib/authz/errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

const POSTGRES_UNIQUE_VIOLATION = "23505";
function isPostgresUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === POSTGRES_UNIQUE_VIOLATION;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkspaceInput {
  organizationId: string;
  actorUserId: string;
  name: string;
  slug: string;
}

export interface CreateWorkspaceResult {
  workspace: Workspace;
  creatorMembership: WorkspaceMembershipRecord;
}

/**
 * Only organization owners/admins may create a workspace (Module 2 §7's
 * permission matrix). Creates the workspace and grants its creator an
 * explicit `manager` workspace membership atomically — without this, a
 * brand-new workspace would have zero members and be unreachable via
 * `getWorkspaceForUser` even to the org admin who just created it, since
 * organization membership never implies workspace access. This mirrors the
 * same "creator becomes the initial member" pattern already approved for
 * `createOrganization`.
 */
export async function createWorkspace(
  db: Db,
  rawSql: RawSql,
  input: CreateWorkspaceInput
): Promise<CreateWorkspaceResult> {
  const actorMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  requireOrganizationRole(actorMembership, ["owner", "admin"]);

  const workspaceId = randomUUID();
  const membershipId = randomUUID();
  const now = new Date();

  try {
    await rawSql.transaction([
      rawSql`INSERT INTO workspaces (id, organization_id, name, slug, created_at, updated_at)
             VALUES (${workspaceId}, ${input.organizationId}, ${input.name}, ${input.slug}, ${now}, ${now})`,
      rawSql`INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
             VALUES (${membershipId}, ${workspaceId}, ${input.actorUserId}, 'manager'::workspace_role, ${now}, ${now})`,
      auditInsertQuery(rawSql, {
        eventType: "workspace_created",
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        targetType: "workspace",
        targetId: workspaceId,
      }),
    ]);
  } catch (err) {
    if (isPostgresUniqueViolation(err)) {
      throw new SlugAlreadyTakenError(input.slug);
    }
    throw err;
  }

  return {
    workspace: { id: workspaceId, organizationId: input.organizationId, name: input.name, slug: input.slug, deletedAt: null, createdAt: now, updatedAt: now },
    creatorMembership: { workspaceId, organizationId: input.organizationId, userId: input.actorUserId, role: "manager" },
  };
}

/**
 * Explicit workspace membership only — this is a workspace CONTENT read,
 * and organization membership (even owner/admin) never substitutes for it
 * (Step 4A: "organization membership never automatically grants workspace
 * access"). Administering the workspace without holding content access is
 * exactly what `requireOrganizationAdminOverride` is for, used by the
 * management operations below, never by this one.
 */
export async function getWorkspaceForUser(
  db: Db,
  workspaceId: string,
  userId: string
): Promise<{ workspace: Workspace; membership: WorkspaceMembershipRecord }> {
  const membership = await requireWorkspaceMembership(db, workspaceId, userId);

  const workspace = await requireTenantScopedResource(async () => {
    const [row] = await db.select().from(workspaces).where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
    return row;
  });

  return { workspace, membership };
}

/**
 * Slug-keyed variant of `getWorkspaceForUser` (Step 5A: dashboard routes
 * use `/app/{organizationSlug}/{workspaceSlug}`, never a raw ID). Scoped by
 * `organizationId` (workspace slugs are unique only within an organization,
 * not globally) — a slug that exists but belongs to a different
 * organization simply doesn't match the WHERE clause, failing identically
 * to a nonexistent one. Same explicit-membership-only rule as
 * `getWorkspaceForUser`: an organization owner/admin with no workspace
 * membership of their own gets the same not-found result as anyone else —
 * there is no admin-override for workspace CONTENT reads.
 */
export async function getWorkspaceBySlugForUser(
  db: Db,
  organizationId: string,
  slug: string,
  userId: string
): Promise<{ workspace: Workspace; membership: WorkspaceMembershipRecord }> {
  const workspace = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.organizationId, organizationId), eq(workspaces.slug, slug), isNull(workspaces.deletedAt)));
    return row;
  });

  const membership = await requireWorkspaceMembership(db, workspace.id, userId);

  return { workspace, membership };
}

/**
 * Slug-keyed resolution for the workspace ADMINISTRATION surface (Step
 * 5B) — deliberately distinct from `getWorkspaceBySlugForUser` above
 * (workspace CONTENT, explicit membership only, no override). This one
 * succeeds for an explicit workspace `manager` OR an organization owner/
 * admin via the existing `requireWorkspaceManagementAccess` override —
 * exactly the same admin-override rule the `updateWorkspace`/
 * `softDeleteWorkspace` mutations below already enforce internally. Lets
 * an org owner/admin open the settings/members administration pages
 * without an explicit workspace membership, while never granting them
 * workspace CONTENT access merely by doing so (that remains gated by
 * `getWorkspaceBySlugForUser`/`getWorkspaceForUser` alone, untouched).
 */
export async function getWorkspaceForAdministration(
  db: Db,
  organizationId: string,
  slug: string,
  userId: string
): Promise<{ workspace: Workspace; via: "workspace-manager" | "org-admin-override" }> {
  const workspace = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.organizationId, organizationId), eq(workspaces.slug, slug), isNull(workspaces.deletedAt)));
    return row;
  });

  const { via } = await requireWorkspaceManagementAccess(db, workspace.id, organizationId, userId);

  return { workspace, via };
}

export interface UpdateWorkspaceInput {
  workspaceId: string;
  organizationId: string;
  actorUserId: string;
  updates: { name?: string; slug?: string };
}

/**
 * A workspace manager may update settings directly; an organization
 * owner/admin may also do so via the admin-override, without needing an
 * explicit workspace membership of their own (Module 2 §7's admin-override
 * pattern, restated as a Step 4A rule).
 */
export async function updateWorkspace(db: Db, rawSql: RawSql, input: UpdateWorkspaceInput): Promise<Workspace> {
  await requireWorkspaceManagementAccess(db, input.workspaceId, input.organizationId, input.actorUserId);

  const now = new Date();
  try {
    await rawSql.transaction([
      rawSql`UPDATE workspaces
             SET name = COALESCE(${input.updates.name ?? null}, name),
                 slug = COALESCE(${input.updates.slug ?? null}, slug),
                 updated_at = ${now}
             WHERE id = ${input.workspaceId} AND deleted_at IS NULL`,
      auditInsertQuery(rawSql, {
        eventType: "workspace_updated",
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        targetType: "workspace",
        targetId: input.workspaceId,
        metadata: { updatedFields: Object.keys(input.updates) },
      }),
    ]);
  } catch (err) {
    if (isPostgresUniqueViolation(err) && input.updates.slug) {
      throw new SlugAlreadyTakenError(input.updates.slug);
    }
    throw err;
  }

  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(workspaces).where(and(eq(workspaces.id, input.workspaceId), isNull(workspaces.deletedAt)));
    return row;
  });
}

export interface SoftDeleteWorkspaceInput {
  workspaceId: string;
  organizationId: string;
  actorUserId: string;
}

/**
 * No workspace role — not even manager — may delete the workspace. Only
 * an organization owner or admin may, exclusively via the admin-override
 * path (Step 4A workspace rules, both stated explicitly). The workspace's
 * existence (scoped to this organization) is confirmed before the role
 * check, so a nonexistent workspace ID always fails closed with the same
 * not-found error rather than silently no-op'ing or misreporting.
 */
export async function softDeleteWorkspace(db: Db, rawSql: RawSql, input: SoftDeleteWorkspaceInput): Promise<void> {
  await requireTenantScopedResource(async () => {
    const [row] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.organizationId, input.organizationId), isNull(workspaces.deletedAt)));
    return row;
  });

  try {
    await requireOrganizationAdminOverride(db, input.organizationId, input.actorUserId);
  } catch {
    await recordAuditEvent(db, {
      eventType: "authorization_denied",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "workspace",
      targetId: input.workspaceId,
      metadata: { action: "delete_workspace", reason: "not_organization_admin" },
    });
    throw new WorkspaceDeletionNotPermittedError();
  }

  const now = new Date();
  await rawSql.transaction([
    rawSql`UPDATE workspaces SET deleted_at = ${now} WHERE id = ${input.workspaceId} AND organization_id = ${input.organizationId} AND deleted_at IS NULL`,
    auditInsertQuery(rawSql, {
      eventType: "workspace_deleted",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "workspace",
      targetId: input.workspaceId,
    }),
  ]);
}

export interface WorkspaceForUser extends Workspace {
  role: WorkspaceRole;
}

/** Every workspace this user holds an explicit membership in (a workspace switcher's data source) — soft-deleted workspaces excluded. */
export async function listWorkspacesForUser(db: Db, userId: string): Promise<WorkspaceForUser[]> {
  const rows = await db
    .select({
      id: workspaces.id,
      organizationId: workspaces.organizationId,
      name: workspaces.name,
      slug: workspaces.slug,
      deletedAt: workspaces.deletedAt,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(and(eq(workspaceMemberships.userId, userId), isNull(workspaces.deletedAt)));

  return rows;
}

export interface WorkspaceOption {
  id: string;
  name: string;
  slug: string;
}

/**
 * Every non-deleted workspace in the organization (Step 5C) — deliberately
 * NOT scoped to the actor's own explicit workspace memberships, unlike
 * `listWorkspacesForUser`. Used only to populate the invitation-creation
 * form's "optional workspace" choices: an organization owner/admin may
 * invite someone directly into ANY workspace of their organization, since
 * `createOrRefreshInvitation` itself only checks that the target workspace
 * belongs to this organization — it never requires the inviting actor to
 * hold a membership in that specific workspace. Owner/admin gated here to
 * match `createOrRefreshInvitation`'s own actor-role requirement, so this
 * list is never reachable by a member/viewer who couldn't invite anyone
 * anyway.
 */
export async function listWorkspacesForOrganization(db: Db, organizationId: string, actorUserId: string): Promise<WorkspaceOption[]> {
  const actorMembership = await requireOrganizationMembership(db, organizationId, actorUserId);
  requireOrganizationRole(actorMembership, ["owner", "admin"]);

  return db
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
    .from(workspaces)
    .where(and(eq(workspaces.organizationId, organizationId), isNull(workspaces.deletedAt)));
}

/**
 * The admin-override composition point for workspace MANAGEMENT
 * operations specifically (settings update here; membership management in
 * memberships.ts) — succeeds if the actor is either an explicit workspace
 * manager, or an organization owner/admin acting via override. Never used
 * for workspace content reads, which stay strictly membership-only via
 * `requireWorkspaceMembership`/`getWorkspaceForUser`.
 */
export async function requireWorkspaceManagementAccess(
  db: Db,
  workspaceId: string,
  organizationId: string,
  userId: string
): Promise<{ via: "workspace-manager" | "org-admin-override" }> {
  // Confirmed first, regardless of which access path succeeds below — a
  // nonexistent workspace, or one belonging to a different organization
  // than claimed, must always fail closed with the same not-found error,
  // never silently no-op an update or (worse) write a misleading audit
  // event for a workspace that was never actually touched.
  await requireTenantScopedResource(async () => {
    const [row] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId), isNull(workspaces.deletedAt)));
    return row;
  });

  try {
    const membership = await requireWorkspaceMembership(db, workspaceId, userId);
    if (membership.role === "manager") {
      return { via: "workspace-manager" };
    }
  } catch {
    // Not an explicit workspace member (or workspace not found from their
    // perspective) — fall through to the org-admin-override path below.
  }

  await requireOrganizationAdminOverride(db, organizationId, userId);
  return { via: "org-admin-override" };
}
