import { DomainRuleViolationError } from "@/lib/authz/errors";

/**
 * Optimistic-concurrency conflict (Brain Module 2's "Concurrency" section)
 * — the caller's `expectedVersionNumber` no longer matches the item's
 * actual current version, meaning someone else's edit landed first.
 * Replaces Module 1's `StaleRevisionError` (which was tied to the now-
 * removed `revision` column) — `versionNumber`, resolved through
 * `currentVersionId`, is the concurrency token now. Never a silent
 * overwrite: the caller must re-fetch the current version and decide
 * whether to retry. Also the error raised when a rollback/restore target
 * or an update attempt races against a concurrent change — recorded as
 * `knowledge_version_conflict` in the audit log.
 */
export class KnowledgeVersionConflictError extends DomainRuleViolationError {
  readonly reason = "version_conflict";
  constructor() {
    super("This knowledge item was changed by someone else since you loaded it. Refresh and try again.");
    this.name = "KnowledgeVersionConflictError";
  }
}

/** An item already in the `archived` state cannot be archived again — mirrors the existing `InvitationNotPendingViolationError` precedent (revoking twice fails safely, never silently). */
export class KnowledgeItemAlreadyArchivedError extends DomainRuleViolationError {
  readonly reason = "already_archived";
  constructor() {
    super("This knowledge item is already archived");
    this.name = "KnowledgeItemAlreadyArchivedError";
  }
}

/** Archived items cannot be edited — this now also covers rollback/restore, since restoring is itself a content-changing write ("Do not permit rollback of archived items unless the approved lifecycle explicitly allows it" — it does not). */
export class KnowledgeItemArchivedViolationError extends DomainRuleViolationError {
  readonly reason = "item_archived";
  constructor() {
    super("Archived knowledge items cannot be updated");
    this.name = "KnowledgeItemArchivedViolationError";
  }
}

// A requested version_number that doesn't exist for an otherwise-accessible
// item deliberately reuses the existing `TenantResourceNotFoundError`
// (`@/lib/authz/errors`) rather than a new error class — it is the exact
// same "don't distinguish nonexistent from inaccessible" 404 this codebase
// already applies everywhere, and version lookups are resolved via the
// same `requireTenantScopedResource` helper every other tenant-scoped
// lookup uses.

/**
 * Brain Module 3 (Relationships). A relationship's source and target must
 * be two distinct items — none of the nine relationship types are
 * meaningful as a self-link (an item cannot supersede, depend on, or
 * contradict itself). Mirrors the existing `SelfRoleChangeViolationError`
 * precedent exactly (`@/lib/authz/errors`): "self-X is invalid" is a
 * business-rule violation (409), not a request-shape problem, even though
 * it is also backed by a database CHECK constraint as defense-in-depth.
 */
export class SelfRelationshipViolationError extends DomainRuleViolationError {
  readonly reason = "self_relationship";
  constructor() {
    super("A knowledge item cannot have a relationship to itself");
    this.name = "SelfRelationshipViolationError";
  }
}

/**
 * A relationship with the identical (source, target, type) triple already
 * exists and is not archived. Mirrors `SlugAlreadyTakenError`'s exact
 * precedent: the service layer attempts the insert directly and translates
 * the resulting `23505` unique-violation (against
 * `knowledge_relationships_active_edge_unique`) into this clean domain
 * error, rather than doing a separate, race-prone pre-check SELECT first.
 */
export class DuplicateRelationshipError extends DomainRuleViolationError {
  readonly reason = "duplicate_relationship";
  constructor() {
    super("An active relationship of this type already exists between these two items");
    this.name = "DuplicateRelationshipError";
  }
}

/** A relationship already in the archived state cannot be archived again — the identical concept as `KnowledgeItemAlreadyArchivedError`, given its own reason string so a client can distinguish which resource type was already archived without needing to inspect the request path. */
export class RelationshipAlreadyArchivedError extends DomainRuleViolationError {
  readonly reason = "relationship_already_archived";
  constructor() {
    super("This relationship is already archived");
    this.name = "RelationshipAlreadyArchivedError";
  }
}

/**
 * Brain Module 4 (Trust & Evidence). The caller's `expectedRevision` no
 * longer matches the trust record's actual current revision, meaning
 * someone else's reassessment landed first. Mirrors `KnowledgeVersionConflictError`'s
 * exact precedent, but for `knowledge_item_trust`'s own `revision` counter
 * (Module 1's plain-integer concurrency pattern — see
 * MODULE_5_BRAIN_MODULE_4_TRUST_AND_EVIDENCE.md's "Concurrency" section for
 * why trust reuses that mechanism rather than Module 2's version-number-
 * via-pointer one). Recorded as `knowledge_trust_conflict` in the audit
 * log, never a misleading `knowledge_trust_assessed`.
 */
export class TrustAssessmentConflictError extends DomainRuleViolationError {
  readonly reason = "trust_conflict";
  constructor() {
    super("This version's trust assessment was changed by someone else since you loaded it. Refresh and try again.");
    this.name = "TrustAssessmentConflictError";
  }
}

/**
 * `MODULE_3_BRAIN_ARCHITECTURE.md` §13 entity 5: a version's Source is
 * immutable once recorded — "correcting a misattributed source requires a
 * new version, not an edit to the source record." Raised when a caller's
 * `attachTrustMetadata` request supplies a `sourceType` that differs from
 * the one already recorded for this version, an explicit rejection rather
 * than silently ignoring the caller's stated (but disallowed) intent.
 */
export class SourceImmutableViolationError extends DomainRuleViolationError {
  readonly reason = "source_immutable";
  constructor() {
    super("This version's source has already been recorded and cannot be changed; correct it on a new version instead");
    this.name = "SourceImmutableViolationError";
  }
}

/**
 * Brain Module 7 (Permissions). An identical active grant — same
 * organization, domain, workspace scope, grantee, and capability — already
 * exists. Mirrors `DuplicateRelationshipError`'s exact precedent: the
 * service layer attempts the insert directly and translates the resulting
 * `23505` unique-violation (against one of the two partial unique indexes
 * on `brain_permission_grants`) into this clean domain error, rather than
 * doing a separate, race-prone pre-check `SELECT` first.
 */
export class DuplicateBrainPermissionGrantError extends DomainRuleViolationError {
  readonly reason = "duplicate_grant";
  constructor() {
    super("An active grant of this exact capability already exists at this scope for this user");
    this.name = "DuplicateBrainPermissionGrantError";
  }
}

/** A grant already in the revoked state cannot be revoked again — the identical concept as `KnowledgeItemAlreadyArchivedError`/`RelationshipAlreadyArchivedError`, given its own reason string. */
export class BrainPermissionGrantAlreadyRevokedError extends DomainRuleViolationError {
  readonly reason = "grant_already_revoked";
  constructor() {
    super("This permission grant is already revoked");
    this.name = "BrainPermissionGrantAlreadyRevokedError";
  }
}

/**
 * Optimistic-concurrency conflict for a grant's `revision` counter — the
 * identical `KnowledgeVersionConflictError`/`TrustAssessmentConflictError`
 * precedent, applied to `brain_permission_grants`. Never silently folded
 * into a success audit event — see `MODULE_5_BRAIN_MODULE_7_PERMISSIONS.md`'s
 * "Audit" section for the exact event this produces.
 */
export class BrainPermissionGrantConflictError extends DomainRuleViolationError {
  readonly reason = "grant_conflict";
  constructor() {
    super("This permission grant was changed by someone else since you loaded it. Refresh and try again.");
    this.name = "BrainPermissionGrantConflictError";
  }
}

/**
 * "A person cannot grant a capability they are not authorized to assign"
 * (this module's own management-authority policy) — raised when an actor
 * who does otherwise hold authority to manage grants at this scope
 * attempts to grant a capability they do not themselves effectively hold.
 * A business-rule violation (409), not an authorization failure (403):
 * the actor IS allowed to manage grants here, the specific capability
 * requested is simply not theirs to assign.
 */
export class CannotGrantUnauthorizedCapabilityError extends DomainRuleViolationError {
  readonly reason = "cannot_grant_unauthorized_capability";
  constructor() {
    super("You cannot grant a capability you do not yourself hold at this scope");
    this.name = "CannotGrantUnauthorizedCapabilityError";
  }
}

/**
 * Bootstrap ("Migration from temporary authorization" — this module's own
 * bootstrap strategy) is a strictly one-time operation per organization:
 * once any Brain Permission Grant exists for an organization (bootstrapped
 * or otherwise), bootstrapping again is refused rather than silently
 * layering more grants on top — bounded, not a standing mechanism.
 */
export class BrainPermissionBootstrapAlreadyCompletedError extends DomainRuleViolationError {
  readonly reason = "bootstrap_already_completed";
  constructor() {
    super("Brain permissions have already been bootstrapped for this organization");
    this.name = "BrainPermissionBootstrapAlreadyCompletedError";
  }
}

/**
 * A grant's `granteeUserId` must already hold a real `organization_memberships`
 * row for the grant's own `organizationId` — mirrors `ParentMembershipRequiredViolationError`'s
 * exact "target has no membership in the relevant parent" shape, given its
 * own wording since this check has no workspace in play at all (an
 * org-scoped grant, or the organization side of a workspace-scoped one).
 * Also backed by `brain_permission_grants_grantee_org_membership_fk` at the
 * database level as defense-in-depth.
 */
export class GranteeNotOrganizationMemberError extends DomainRuleViolationError {
  readonly reason = "grantee_not_organization_member";
  constructor() {
    super("The grantee must already be a member of this organization");
    this.name = "GranteeNotOrganizationMemberError";
  }
}

/**
 * A workspace-scoped grant's `granteeUserId` must already hold a real
 * `workspace_memberships` row for the grant's own `workspaceId` — a
 * workspace-scoped Domain Grant for someone who isn't even a workspace
 * member would be permission data with nothing to actually authorize (see
 * `brain_permission_grants_grantee_workspace_membership_fk`'s own schema
 * comment). Also backed by that composite FK at the database level.
 */
export class GranteeNotWorkspaceMemberError extends DomainRuleViolationError {
  readonly reason = "grantee_not_workspace_member";
  constructor() {
    super("The grantee must already be a member of this workspace");
    this.name = "GranteeNotWorkspaceMemberError";
  }
}

/**
 * Brain Module 16 — the agent-grantee equivalent of
 * `GranteeNotOrganizationMemberError`: a grant's `granteeAgentId` must
 * name a real, registered agent belonging to the grant's own
 * `organizationId`. No workspace-membership equivalent exists for agents
 * (Agent Registry has no workspace concept at all) — a workspace-scoped
 * agent grant needs only this organization check, never a second one.
 */
export class GranteeAgentNotInOrganizationError extends DomainRuleViolationError {
  readonly reason = "grantee_agent_not_in_organization";
  constructor() {
    super("The grantee agent must belong to this organization");
    this.name = "GranteeAgentNotInOrganizationError";
  }
}

/**
 * Brain Modules 8/9 (Draft Workflow, Review/Approval). The requested
 * transition does not exist in `MODULE_3_BRAIN_ARCHITECTURE.md` §4's state
 * machine for the item's CURRENT status — e.g. attempting to publish a
 * `draft` item directly, or approving something already `archived` without
 * going through the explicit restore path. A business-rule violation
 * (409), not an authorization failure — the actor may hold every relevant
 * capability and still be rejected here, because the transition itself is
 * illegal from this state, for anyone.
 */
export class InvalidLifecycleTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_lifecycle_transition";
  constructor(from: string, to: string) {
    super(`Cannot transition from "${from}" to "${to}" — no such transition exists`);
    this.name = "InvalidLifecycleTransitionError";
  }
}

/**
 * `updateKnowledgeItem` (ordinary content edit) is only ever legal while an
 * item is `draft` — once it has moved to `review`/`approved`/`published`/
 * `retired`, editing its content directly would silently invalidate
 * whatever approval or trust signal is attached to the current version
 * (Module 4's trust model is per-version; an edit that skips back through
 * Draft would leave a never-reviewed version sitting as "current" on an
 * item still labeled Approved). The already-archived case keeps its own,
 * separate, pre-existing `KnowledgeItemArchivedViolationError` — this is
 * the distinct error for every OTHER non-draft state.
 */
export class KnowledgeItemNotEditableError extends DomainRuleViolationError {
  readonly reason = "item_not_editable";
  constructor(currentStatus: string) {
    super(`This knowledge item cannot be edited while it is "${currentStatus}" — only draft items can be updated directly`);
    this.name = "KnowledgeItemNotEditableError";
  }
}

/**
 * Brain Module 13 (Observation Generation).
 * `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §4's worked example: an
 * Observation is always distilled from something — it must cite at least
 * one real source item via a `created_from`/`supports` edge. Rejected
 * before any row is written, never created and then flagged as incomplete.
 */
export class ObservationRequiresSourceError extends DomainRuleViolationError {
  readonly reason = "observation_requires_source";
  constructor() {
    super("An Observation must cite at least one source item");
    this.name = "ObservationRequiresSourceError";
  }
}

/**
 * Brain Module 13. §4: an Observation's natural trust ceiling is Approved,
 * never Verified — it is, by definition, a pattern noticed across other
 * items, not a directly verified fact in its own right. Structurally
 * enforced in `attachTrustMetadata`, never left to reviewer discretion.
 */
export class ObservationTrustCeilingError extends DomainRuleViolationError {
  readonly reason = "observation_trust_ceiling";
  constructor() {
    super("An Observation's trust tier can never be set to \"verified\" — its natural ceiling is \"approved\"");
    this.name = "ObservationTrustCeilingError";
  }
}

/** Brain Module 14 (Decision Tracking). Outcome-recording and supersession are meaningful only for `classification: "decision"` items. */
export class NotADecisionItemError extends DomainRuleViolationError {
  readonly reason = "not_a_decision_item";
  constructor() {
    super("This operation is only valid for a Decision-classified knowledge item");
    this.name = "NotADecisionItemError";
  }
}
