/**
 * Authorization error taxonomy for Step 4A (Organization/Workspace/Authorization
 * Domain Foundation). No HTTP route layer exists yet in this step, but each
 * error carries the HTTP status it is designed to map to, so a future route
 * handler can do `catch (err) { return new Response(..., { status: err.httpStatus }) }`
 * without re-deriving this mapping.
 *
 * Two distinct families, deliberately:
 *
 * - `AuthzError` — "can this actor even reach this resource/action at all."
 *   `TenantResourceNotFoundError` is used identically whether a resource
 *   truly doesn't exist OR the actor simply isn't a member of it — the two
 *   cases must be indistinguishable to the caller, so a cross-tenant probe
 *   never learns whether the thing it guessed exists.
 * - `DomainRuleViolationError` — "the actor can reach this, and the request
 *   is well-formed, but a business invariant forbids it" (e.g. removing the
 *   last owner). These are real, existing-resource situations — nothing is
 *   hidden by using them, so they map to 409, not 404.
 */

export abstract class AuthzError extends Error {
  abstract readonly httpStatus: number;
  /** Stable, machine-readable code for the HTTP error envelope (Step 4B) — set explicitly, never derived from the class name. */
  abstract readonly code: string;
}

export class UnauthenticatedError extends AuthzError {
  readonly httpStatus = 401;
  readonly code = "unauthenticated";
  constructor() {
    super("Authentication required");
    this.name = "UnauthenticatedError";
  }
}

/**
 * Used for BOTH "this organization/workspace does not exist" and "it exists
 * but this user has no membership in it" — deliberately the same error,
 * same message, so cross-tenant resource probing cannot distinguish the two
 * (Step 4A's "return 404 for inaccessible cross-tenant resources so
 * existence is not leaked" requirement).
 */
export class TenantResourceNotFoundError extends AuthzError {
  readonly httpStatus = 404;
  readonly code = "not_found";
  constructor() {
    super("Resource not found");
    this.name = "TenantResourceNotFoundError";
  }
}

/**
 * The actor's membership is confirmed (the resource is reachable, its
 * existence is already known to them) but their role doesn't permit this
 * specific action — safe to be explicit about, unlike TenantResourceNotFoundError.
 */
export class InsufficientRoleError extends AuthzError {
  readonly httpStatus = 403;
  readonly code = "forbidden";
  constructor(detail: string) {
    super(`Insufficient role: ${detail}`);
    this.name = "InsufficientRoleError";
  }
}

export abstract class DomainRuleViolationError extends Error {
  readonly httpStatus = 409;
  abstract readonly reason: string;
}

/** "The final owner cannot be removed or demoted" — organization rules. */
export class LastOwnerViolationError extends DomainRuleViolationError {
  readonly reason = "last_owner";
  constructor() {
    super("Cannot remove or demote the organization's final owner");
    this.name = "LastOwnerViolationError";
  }
}

/** "Users cannot change their own role" — organization and workspace rules. */
export class SelfRoleChangeViolationError extends DomainRuleViolationError {
  readonly reason = "self_role_change";
  constructor() {
    super("A user cannot change their own role");
    this.name = "SelfRoleChangeViolationError";
  }
}

/** "Admins cannot remove or demote owners" — unconditional, regardless of owner count. */
export class AdminCannotActOnOwnerViolationError extends DomainRuleViolationError {
  readonly reason = "admin_cannot_act_on_owner";
  constructor() {
    super("An admin cannot remove or demote an owner");
    this.name = "AdminCannotActOnOwnerViolationError";
  }
}

/** "A workspace membership cannot exist without an organization membership in the workspace's parent organization." */
export class ParentMembershipRequiredViolationError extends DomainRuleViolationError {
  readonly reason = "parent_membership_required";
  constructor() {
    super("The target user has no membership in the workspace's parent organization");
    this.name = "ParentMembershipRequiredViolationError";
  }
}

/** "No workspace role may delete the workspace" / "Only an organization owner or admin may delete a workspace." */
export class WorkspaceDeletionNotPermittedError extends DomainRuleViolationError {
  readonly reason = "workspace_deletion_not_permitted";
  constructor() {
    super("Only an organization owner or admin may delete a workspace");
    this.name = "WorkspaceDeletionNotPermittedError";
  }
}

/**
 * A real, previously-undiscovered gap surfaced by Step 5B's explicit
 * "duplicate-slug handling" requirement: `createOrganization`/
 * `updateOrganization`/`createWorkspace`/`updateWorkspace` previously let a
 * unique-constraint violation on `slug` propagate as a raw, unhandled
 * Postgres error (code `23505`) instead of a clean domain error — never
 * actually exercised before now, since no prior step had a UI needing a
 * safe, user-facing message for this case. Fixed at the domain layer (the
 * correct place for a real bug fix, not papered over in a form component)
 * — see `isPostgresUniqueViolation` at each call site.
 */
export class SlugAlreadyTakenError extends DomainRuleViolationError {
  readonly reason = "slug_taken";
  constructor(slug: string) {
    super(`The slug "${slug}" is already in use`);
    this.name = "SlugAlreadyTakenError";
  }
}
