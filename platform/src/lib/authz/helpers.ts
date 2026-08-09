import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { organizationMemberships, workspaceMemberships, workspaces, organizations } from "@/db/schema";
import { validateSessionToken } from "@/lib/auth/session";
import { UnauthenticatedError, TenantResourceNotFoundError, InsufficientRoleError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";
export type WorkspaceRole = "manager" | "member" | "viewer";

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
}

export interface OrganizationMembershipRecord {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

export interface WorkspaceMembershipRecord {
  workspaceId: string;
  organizationId: string;
  userId: string;
  role: WorkspaceRole;
}

/**
 * The authenticated user's identity always comes from here — a validated
 * database session — never from a client-supplied header, cookie payload
 * field, query parameter, or request body value (Step 4A's explicit
 * requirement: never trust a user ID from the browser). Reuses Step 3's
 * `validateSessionToken` exactly as-is — no bypass, no test-only mode; the
 * only concession for testing without live OAuth is that tests obtain a
 * real, valid raw token via Step 3's own `createSession`, then pass it
 * through this exact function like any real request would.
 */
export async function requireAuthenticatedUser(db: Db, sessionToken: string | null): Promise<AuthenticatedUser> {
  if (!sessionToken) {
    throw new UnauthenticatedError();
  }
  const session = await validateSessionToken(db, sessionToken);
  if (!session) {
    throw new UnauthenticatedError();
  }
  return { userId: session.userId, sessionId: session.id };
}

/**
 * Resolves membership within one specific organization, scoped by BOTH the
 * organization ID and the user ID in the query's own WHERE clause — never
 * fetched globally by ID and authorized afterward. Throws the identical
 * error whether the organization doesn't exist, is soft-deleted, or simply
 * has no membership row for this user — a cross-tenant probe cannot tell
 * these apart (Step 4A: "return 404 for inaccessible cross-tenant
 * resources so existence is not leaked").
 */
export async function requireOrganizationMembership(
  db: Db,
  organizationId: string,
  userId: string
): Promise<OrganizationMembershipRecord> {
  const [row] = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      userId: organizationMemberships.userId,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        isNull(organizations.deletedAt)
      )
    );

  if (!row) {
    throw new TenantResourceNotFoundError();
  }
  return row as OrganizationMembershipRecord;
}

/**
 * Explicit workspace membership only — organization membership never
 * automatically grants it (Module 2 §7, restated as an explicit Step 4A
 * rule). Scoped by workspace ID + user ID + confirms the workspace itself
 * isn't soft-deleted, all in the same query. Same indistinguishable
 * not-found behavior as `requireOrganizationMembership`.
 */
export async function requireWorkspaceMembership(
  db: Db,
  workspaceId: string,
  userId: string
): Promise<WorkspaceMembershipRecord> {
  const [row] = await db
    .select({
      workspaceId: workspaceMemberships.workspaceId,
      organizationId: workspaces.organizationId,
      userId: workspaceMemberships.userId,
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, userId),
        isNull(workspaces.deletedAt)
      )
    );

  if (!row) {
    throw new TenantResourceNotFoundError();
  }
  return row as WorkspaceMembershipRecord;
}

/**
 * The membership is already confirmed reachable (existence is known to the
 * caller) — an insufficient role is a real, explicit 403, not something
 * that needs to be hidden the way TenantResourceNotFoundError does (Module
 * 2 §14's established distinction: 404 hides cross-tenant existence, 403
 * is correct for "your own resource, wrong role").
 */
export function requireOrganizationRole(membership: OrganizationMembershipRecord, allowedRoles: OrganizationRole[]): void {
  if (!allowedRoles.includes(membership.role)) {
    throw new InsufficientRoleError(`organization role "${membership.role}" is not one of [${allowedRoles.join(", ")}]`);
  }
}

export function requireWorkspaceRole(membership: WorkspaceMembershipRecord, allowedRoles: WorkspaceRole[]): void {
  if (!allowedRoles.includes(membership.role)) {
    throw new InsufficientRoleError(`workspace role "${membership.role}" is not one of [${allowedRoles.join(", ")}]`);
  }
}

/**
 * The admin-override pattern (Module 2 §7): an organization owner/admin may
 * administer workspace settings and membership without needing an explicit
 * workspace membership of their own. This grants exactly that and nothing
 * more — it is never a substitute for `requireWorkspaceMembership` when an
 * operation concerns workspace CONTENT rather than administration; domain
 * services call this only for the specific management operations the
 * override is meant to cover (workspace update/delete, workspace
 * membership add/remove/role-change).
 */
export async function requireOrganizationAdminOverride(
  db: Db,
  organizationId: string,
  userId: string
): Promise<OrganizationMembershipRecord> {
  const membership = await requireOrganizationMembership(db, organizationId, userId);
  requireOrganizationRole(membership, ["owner", "admin"]);
  return membership;
}

/**
 * Enforces "never fetch a resource globally by ID and authorize
 * afterward" by construction, not just by convention: `queryFn` must
 * already scope its own WHERE clause to the verified tenant
 * (organization/workspace) before calling this — this helper only turns
 * "no matching row came back" into the single, consistent
 * TenantResourceNotFoundError, so every domain service reports a
 * cross-tenant miss identically rather than each inventing its own
 * not-found handling (or, worse, fetching unscoped and checking
 * membership as an afterthought).
 */
export async function requireTenantScopedResource<T>(queryFn: () => Promise<T | undefined | null>): Promise<T> {
  const row = await queryFn();
  if (!row) {
    throw new TenantResourceNotFoundError();
  }
  return row;
}
