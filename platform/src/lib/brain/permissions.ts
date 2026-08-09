import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { brainPermissionGrants, organizationMemberships, workspaceMemberships, workspaces, agents } from "@/db/schema";
import {
  requireOrganizationMembership,
  requireOrganizationRole,
  requireTenantScopedResource,
  type OrganizationMembershipRecord,
} from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveEffectiveBrainCapabilities, recordBrainPermissionDenied, type BrainCapability } from "./authz";
import {
  DuplicateBrainPermissionGrantError,
  BrainPermissionGrantAlreadyRevokedError,
  BrainPermissionGrantConflictError,
  CannotGrantUnauthorizedCapabilityError,
  BrainPermissionBootstrapAlreadyCompletedError,
  GranteeNotOrganizationMemberError,
  GranteeNotWorkspaceMemberError,
  GranteeAgentNotInOrganizationError,
} from "./errors";
import { isPostgresUniqueViolation } from "./db-errors";
import { knowledgeDomainSchema, BRAIN_CAPABILITIES } from "./validation";
import type { KnowledgeDomain } from "./knowledge-items";
import type { AccessActorType } from "./access-log";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Brain permission grant management — Module 7
 * ============================================================================
 *
 * Bounded CRUD + effective-permission resolution over `brain_permission_grants`
 * (see that table's own schema comment for the full scope model). This file
 * governs WHO may create/list/update/revoke a grant — a different, meta-level
 * question from `authz.ts`'s WHAT-content-can-you-touch gates.
 *
 * **Management authority** ("Permission-management authority" — this
 * module's own candidate policy, reviewed against
 * `MODULE_3_BRAIN_ARCHITECTURE.md` §13 entity 12's "Ownership: department
 * lead for that domain" note before adoption): entity 12's literal ownership
 * model is department-lead-based, but §15 Open Question #2 already flags
 * the domain-to-department mapping itself as *unconfirmed*, and Module 6
 * deliberately left `ownerDepartment` unresolved with no department table
 * to query — department-lead authority is therefore not implementable
 * today, not a rule this module is silently overriding. This file adopts
 * the task's own documented fallback instead: an organization **owner**
 * manages organization-scoped grants (`workspaceId IS NULL`); an
 * organization **owner or admin** manages workspace-scoped grants, for any
 * workspace in their own organization (there is no narrower
 * "administratively manageable workspace subset" concept anywhere else in
 * this codebase to borrow — `requireOrganizationAdminOverride`'s own
 * precedent is already org-wide, not per-workspace). Deliberately NOT
 * extended to workspace *manager* role — Brain capability grants are a
 * more sensitive authority than ordinary workspace membership
 * administration, and the task's candidate policy names only
 * owner/admin. Revisit once Module 6's department model is resolved.
 *
 * **"Cannot grant a capability you are not authorized to assign"**: checked
 * against the actor's own ORGANIZATION-scoped capability for the grant's
 * domain — regardless of whether the grant being created is itself
 * workspace-scoped. This is a deliberate, narrow exception to `authz.ts`'s
 * exact-scope-match rule for ordinary content access: requiring an admin to
 * already hold a workspace-scoped capability grant, for that *exact*
 * workspace, before they could ever hand one out would make the very first
 * workspace-scoped grant for any workspace impossible to create (bootstrap
 * only seeds organization-scoped rows — see `bootstrapBrainPermissions`).
 * Checking org-scoped holding instead keeps the rule meaningful ("you must
 * yourself be trusted with this capability for this domain, at least at
 * the organization level, before you may hand it to anyone") while staying
 * bootstrap-compatible.
 */

export interface BrainPermissionGrant {
  id: string;
  organizationId: string;
  domain: KnowledgeDomain;
  workspaceId: string | null;
  /** Brain Module 16 — exactly one of `granteeUserId`/`granteeAgentId` is ever non-null; `granteeType` says which. */
  granteeUserId: string | null;
  granteeAgentId: string | null;
  granteeType: AccessActorType;
  capability: BrainCapability;
  revision: number;
  grantedByUserId: string | null;
  reason: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Resolves grant-management authority for one (organization, workspace-or-null)
 * scope pair. Fails closed on a nonexistent/foreign workspace before
 * checking role, matching `requireWorkspaceManagementAccess`'s own "confirm
 * the resource first, regardless of which access path succeeds" precedent.
 */
async function requireGrantManagementAuthority(
  db: Db,
  organizationId: string,
  workspaceId: string | null,
  actorUserId: string
): Promise<OrganizationMembershipRecord> {
  if (workspaceId) {
    await requireTenantScopedResource(async () => {
      const [row] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId), isNull(workspaces.deletedAt)));
      return row;
    });
  }

  const membership = await requireOrganizationMembership(db, organizationId, actorUserId);
  requireOrganizationRole(membership, workspaceId ? ["owner", "admin"] : ["owner"]);
  return membership;
}

/** Denial-audit wrapper — every grant-management authority failure reuses `brain_permission_denied` (see `audit.ts`'s own note on why a meta-level authority denial is not a third event type). */
async function requireGrantManagementAuthorityOrDeny(
  db: Db,
  organizationId: string,
  workspaceId: string | null,
  domain: KnowledgeDomain,
  actorUserId: string
): Promise<void> {
  try {
    await requireGrantManagementAuthority(db, organizationId, workspaceId, actorUserId);
  } catch (err) {
    await recordBrainPermissionDenied(db, { capability: "manage_permissions", organizationId, actorUserId, domain, workspaceId });
    throw err;
  }
}

/** "A person cannot grant a capability they are not authorized to assign" — checked at organization scope for the grant's domain, regardless of the grant's own workspace scope (see this file's own top-level doc comment for the full reasoning). */
async function requireActorHoldsCapability(
  db: Db,
  organizationId: string,
  domain: KnowledgeDomain,
  capability: BrainCapability,
  actorUserId: string
): Promise<void> {
  const capabilities = await resolveEffectiveBrainCapabilities(db, { organizationId, domain, workspaceId: null }, actorUserId);
  if (!capabilities.has(capability)) {
    await recordBrainPermissionDenied(db, { capability, organizationId, actorUserId, domain, workspaceId: null });
    throw new CannotGrantUnauthorizedCapabilityError();
  }
}

async function requireGranteeIsOrganizationMember(db: Db, organizationId: string, granteeUserId: string): Promise<void> {
  const [row] = await db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, granteeUserId)));
  if (!row) {
    throw new GranteeNotOrganizationMemberError();
  }
}

async function requireGranteeIsWorkspaceMember(db: Db, workspaceId: string, granteeUserId: string): Promise<void> {
  const [row] = await db
    .select({ userId: workspaceMemberships.userId })
    .from(workspaceMemberships)
    .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, granteeUserId)));
  if (!row) {
    throw new GranteeNotWorkspaceMemberError();
  }
}

/**
 * Brain Module 16 — the agent-grantee equivalent of
 * `requireGranteeIsOrganizationMember`. No workspace-membership check
 * exists or is called for an agent grantee (see `GranteeAgentNotInOrganizationError`'s
 * own comment) — this single check is the complete grantee-validity gate
 * for an agent, regardless of whether the grant itself is org- or
 * workspace-scoped.
 */
async function requireGranteeAgentInOrganization(db: Db, organizationId: string, granteeAgentId: string): Promise<void> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, granteeAgentId), eq(agents.organizationId, organizationId)));
  if (!row) {
    throw new GranteeAgentNotInOrganizationError();
  }
}

/**
 * Brain Module 16 — a closed union, never a generic "principals" reference
 * (the exact judgment call `MODULE_3_BRAIN_ARCHITECTURE.md` §15 Open
 * Question #8 flagged as needing to be made "now that 'agent' is a second,
 * real grantee type" — resolved here as the simplest safe path, matching
 * Module 2 §13's own precedent for the identical question about actors).
 */
export type BrainPermissionGrantee = { type: "human"; userId: string } | { type: "agent"; agentId: string };

export interface CreateBrainPermissionGrantInput {
  organizationId: string;
  domain: KnowledgeDomain;
  workspaceId?: string | null;
  grantee: BrainPermissionGrantee;
  capability: BrainCapability;
  reason?: string | null;
  actorUserId: string;
}

/**
 * Creates one active grant row. Order of checks: grant-management
 * authority (who may act) → grantee validity (org member, and workspace
 * member if workspace-scoped and the grantee is human; org-scoped agent
 * check only, if the grantee is an agent) → "cannot grant unauthorized
 * capability" → insert, translating a `23505` unique-violation (any of
 * the four partial indexes) into `DuplicateBrainPermissionGrantError`
 * rather than a race-prone pre-check `SELECT` first — the identical
 * `createRelationship` precedent.
 */
export async function createBrainPermissionGrant(db: Db, input: CreateBrainPermissionGrantInput): Promise<BrainPermissionGrant> {
  const workspaceId = input.workspaceId ?? null;

  await requireGrantManagementAuthorityOrDeny(db, input.organizationId, workspaceId, input.domain, input.actorUserId);
  if (input.grantee.type === "human") {
    await requireGranteeIsOrganizationMember(db, input.organizationId, input.grantee.userId);
    if (workspaceId) {
      await requireGranteeIsWorkspaceMember(db, workspaceId, input.grantee.userId);
    }
  } else {
    await requireGranteeAgentInOrganization(db, input.organizationId, input.grantee.agentId);
  }
  await requireActorHoldsCapability(db, input.organizationId, input.domain, input.capability, input.actorUserId);

  try {
    const [row] = await db
      .insert(brainPermissionGrants)
      .values({
        organizationId: input.organizationId,
        domain: input.domain,
        workspaceId,
        granteeUserId: input.grantee.type === "human" ? input.grantee.userId : null,
        granteeAgentId: input.grantee.type === "agent" ? input.grantee.agentId : null,
        granteeType: input.grantee.type === "human" ? "human" : "agent",
        capability: input.capability,
        grantedByUserId: input.actorUserId,
        reason: input.reason ?? null,
      })
      .returning();

    await recordAuditEvent(db, {
      eventType: "brain_permission_granted",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "brain_permission_grant",
      targetId: row.id,
      metadata: {
        granteeType: input.grantee.type,
        granteeUserId: input.grantee.type === "human" ? input.grantee.userId : null,
        granteeAgentId: input.grantee.type === "agent" ? input.grantee.agentId : null,
        domain: input.domain,
        workspaceScoped: Boolean(workspaceId),
        capability: input.capability,
      },
    });

    return row as BrainPermissionGrant;
  } catch (err) {
    if (isPostgresUniqueViolation(err)) {
      throw new DuplicateBrainPermissionGrantError();
    }
    throw err;
  }
}

export interface ListBrainPermissionGrantsInput {
  organizationId: string;
  actorUserId: string;
  granteeUserId?: string;
  /** Brain Module 16 — filters to grants naming this exact agent as grantee. */
  granteeAgentId?: string;
  domain?: KnowledgeDomain;
  workspaceId?: string | null;
  includeRevoked?: boolean;
}

/**
 * Lists grants for an organization, optionally narrowed to one grantee, one
 * domain, and/or one workspace scope (`workspaceId: null` explicitly means
 * "organization-scoped grants only" — a distinct filter from "no workspace
 * filter at all", which is the default/undefined case). Read-only
 * oversight — gated at organization owner/admin uniformly (no workspace-
 * specific narrowing the way `createBrainPermissionGrant` requires), since
 * viewing who holds a grant carries none of the privilege-escalation risk
 * assigning one does.
 */
export async function listBrainPermissionGrants(db: Db, input: ListBrainPermissionGrantsInput): Promise<BrainPermissionGrant[]> {
  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  requireOrganizationRole(membership, ["owner", "admin"]);

  const conditions = [eq(brainPermissionGrants.organizationId, input.organizationId)];
  if (input.granteeUserId) conditions.push(eq(brainPermissionGrants.granteeUserId, input.granteeUserId));
  if (input.granteeAgentId) conditions.push(eq(brainPermissionGrants.granteeAgentId, input.granteeAgentId));
  if (input.domain) conditions.push(eq(brainPermissionGrants.domain, input.domain));
  if (input.workspaceId !== undefined) {
    conditions.push(input.workspaceId === null ? isNull(brainPermissionGrants.workspaceId) : eq(brainPermissionGrants.workspaceId, input.workspaceId));
  }
  if (!input.includeRevoked) conditions.push(isNull(brainPermissionGrants.revokedAt));

  const rows = await db
    .select()
    .from(brainPermissionGrants)
    .where(and(...conditions));

  return rows as BrainPermissionGrant[];
}

export interface EffectiveBrainPermissionsResult {
  /** Grouped by `${domain}:${workspaceId ?? "org"}` for direct lookup; matches `knowledge-items.ts`'s own `scopeKey` shape. */
  scopes: Array<{ domain: KnowledgeDomain; workspaceId: string | null; capabilities: BrainCapability[] }>;
}

/**
 * Resolves the CURRENT (calling) user's own complete effective-permission
 * map — every active grant they hold, across every domain and workspace
 * scope in this organization, grouped by exact scope. Always self-only; no
 * `targetUserId` parameter exists here by design (a caller wanting another
 * user's grants uses `listBrainPermissionGrants` instead, which is
 * authority-gated — self-lookup needs nothing beyond organization
 * membership, since a user is always entitled to know their own access).
 */
export async function getEffectiveBrainPermissions(db: Db, organizationId: string, actorUserId: string): Promise<EffectiveBrainPermissionsResult> {
  await requireOrganizationMembership(db, organizationId, actorUserId);

  const rows = await db
    .select({ domain: brainPermissionGrants.domain, workspaceId: brainPermissionGrants.workspaceId, capability: brainPermissionGrants.capability })
    .from(brainPermissionGrants)
    .where(and(eq(brainPermissionGrants.organizationId, organizationId), eq(brainPermissionGrants.granteeUserId, actorUserId), isNull(brainPermissionGrants.revokedAt)));

  const byScope = new Map<string, { domain: KnowledgeDomain; workspaceId: string | null; capabilities: Set<BrainCapability> }>();
  for (const row of rows) {
    const key = `${row.domain}:${row.workspaceId ?? "org"}`;
    let entry = byScope.get(key);
    if (!entry) {
      entry = { domain: row.domain, workspaceId: row.workspaceId, capabilities: new Set() };
      byScope.set(key, entry);
    }
    entry.capabilities.add(row.capability);
  }

  return { scopes: [...byScope.values()].map((entry) => ({ domain: entry.domain, workspaceId: entry.workspaceId, capabilities: [...entry.capabilities] })) };
}

export interface UpdateBrainPermissionGrantInput {
  organizationId: string;
  grantId: string;
  reason: string | null;
  expectedRevision: number;
  actorUserId: string;
}

/**
 * Updates a grant's own mutable `reason` field only — capability, scope,
 * and grantee are immutable once a grant exists (see this table's own
 * schema comment: revoke-and-recreate is the only way to change any of
 * those). Optimistic concurrency via the plain `revision` counter, the
 * identical `trust.ts`/`attachTrustMetadata` pattern.
 */
export async function updateBrainPermissionGrant(db: Db, input: UpdateBrainPermissionGrantInput): Promise<BrainPermissionGrant> {
  const existing = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select()
      .from(brainPermissionGrants)
      .where(and(eq(brainPermissionGrants.id, input.grantId), eq(brainPermissionGrants.organizationId, input.organizationId)));
    return row;
  });

  await requireGrantManagementAuthorityOrDeny(db, input.organizationId, existing.workspaceId, existing.domain, input.actorUserId);

  if (existing.revokedAt !== null) {
    throw new BrainPermissionGrantAlreadyRevokedError();
  }

  const [updated] = await db
    .update(brainPermissionGrants)
    .set({ reason: input.reason, revision: existing.revision + 1, updatedAt: new Date() })
    .where(and(eq(brainPermissionGrants.id, input.grantId), eq(brainPermissionGrants.revision, input.expectedRevision)))
    .returning();

  if (!updated) {
    await recordAuditEvent(db, {
      eventType: "brain_permission_denied",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "brain_permission_grant",
      targetId: existing.id,
      metadata: { action: "update", reason: "stale_revision", expectedRevision: input.expectedRevision },
    });
    throw new BrainPermissionGrantConflictError();
  }

  await recordAuditEvent(db, {
    eventType: "brain_permission_updated",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "brain_permission_grant",
    targetId: updated.id,
    metadata: { granteeUserId: updated.granteeUserId, domain: updated.domain, workspaceScoped: Boolean(updated.workspaceId), capability: updated.capability },
  });

  return updated as BrainPermissionGrant;
}

export interface RevokeBrainPermissionGrantInput {
  organizationId: string;
  grantId: string;
  actorUserId: string;
}

/**
 * Revokes a grant — a one-way, terminal transition (never "un-revoked");
 * re-granting later creates a brand-new row. Atomic
 * `UPDATE ... WHERE revoked_at IS NULL` is the complete concurrency guard,
 * identical to `archiveRelationship`'s own reasoning: two concurrent
 * revoke attempts can only ever result in one success, the loser's
 * `UPDATE` affects zero rows and receives the same
 * `BrainPermissionGrantAlreadyRevokedError` a plain pre-check would.
 */
export async function revokeBrainPermissionGrant(db: Db, input: RevokeBrainPermissionGrantInput): Promise<BrainPermissionGrant> {
  const existing = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select()
      .from(brainPermissionGrants)
      .where(and(eq(brainPermissionGrants.id, input.grantId), eq(brainPermissionGrants.organizationId, input.organizationId)));
    return row;
  });

  await requireGrantManagementAuthorityOrDeny(db, input.organizationId, existing.workspaceId, existing.domain, input.actorUserId);

  const [updated] = await db
    .update(brainPermissionGrants)
    .set({ revokedAt: new Date(), revokedByUserId: input.actorUserId, updatedAt: new Date() })
    .where(and(eq(brainPermissionGrants.id, input.grantId), isNull(brainPermissionGrants.revokedAt)))
    .returning();

  if (!updated) {
    throw new BrainPermissionGrantAlreadyRevokedError();
  }

  await recordAuditEvent(db, {
    eventType: "brain_permission_revoked",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "brain_permission_grant",
    targetId: updated.id,
    metadata: { granteeUserId: updated.granteeUserId, domain: updated.domain, workspaceScoped: Boolean(updated.workspaceId), capability: updated.capability },
  });

  return updated as BrainPermissionGrant;
}

export interface BootstrapBrainPermissionsInput {
  organizationId: string;
  actorUserId: string;
  reason?: string | null;
}

/**
 * The one-time "first real organization" bootstrap ("Migration from
 * temporary authorization" — CRITICAL section). Owner-triggered,
 * idempotent (refuses via `BrainPermissionBootstrapAlreadyCompletedError`
 * the moment ANY grant already exists for this organization — bootstrapped
 * or otherwise, so it can never layer a second batch on top), and creates
 * real, individually-revocable grant rows — never a standing implicit
 * override. Grants the invoking owner all eight capabilities across all
 * eight domains, organization-scoped (`workspaceId: null`) — deliberately
 * broad (an organization's first owner must be able to do anything and
 * delegate anything from a cold start) but fully auditable
 * (`brain_permission_bootstrapped`, listing every grant id created) and
 * fully revocable (each of the 64 rows can be individually revoked later
 * exactly like any other grant, once narrower, real delegation exists).
 * Workspace-scoped grants are deliberately NOT bootstrapped here — they
 * don't exist yet for a brand-new organization with no workspaces, and the
 * owner's organization-scoped capabilities are what let them create the
 * first workspace-scoped grant later (see this file's own top-level note
 * on why "cannot grant unauthorized capability" checks org-scope, not
 * exact-scope, specifically to keep that path open).
 */
export async function bootstrapBrainPermissions(db: Db, input: BootstrapBrainPermissionsInput): Promise<BrainPermissionGrant[]> {
  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  requireOrganizationRole(membership, ["owner"]);

  const [existing] = await db
    .select({ id: brainPermissionGrants.id })
    .from(brainPermissionGrants)
    .where(eq(brainPermissionGrants.organizationId, input.organizationId));
  if (existing) {
    throw new BrainPermissionBootstrapAlreadyCompletedError();
  }

  const reason = input.reason ?? "Organization bootstrap: initial owner grant";
  const rows = knowledgeDomainSchema.options.flatMap((domain) =>
    BRAIN_CAPABILITIES.map((capability) => ({
      organizationId: input.organizationId,
      domain,
      workspaceId: null,
      granteeUserId: input.actorUserId,
      capability,
      grantedByUserId: input.actorUserId,
      reason,
    }))
  );

  const inserted = await db.insert(brainPermissionGrants).values(rows).returning();

  await recordAuditEvent(db, {
    eventType: "brain_permission_bootstrapped",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "organization",
    targetId: input.organizationId,
    metadata: { granteeUserId: input.actorUserId, grantIds: inserted.map((row) => row.id), grantCount: inserted.length },
  });

  return inserted as BrainPermissionGrant[];
}

/** True once any grant (bootstrapped or explicitly created) exists for this organization — the same idempotency check `bootstrapBrainPermissions` itself uses, exposed for callers (e.g. a route) that want to show onboarding state without attempting (and having to catch a failed) bootstrap. */
export async function hasAnyBrainPermissionGrant(db: Db, organizationId: string): Promise<boolean> {
  const [row] = await db.select({ id: brainPermissionGrants.id }).from(brainPermissionGrants).where(eq(brainPermissionGrants.organizationId, organizationId));
  return Boolean(row);
}
