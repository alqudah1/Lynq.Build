/**
 * Module 2 schema — Authentication & Tenancy.
 *
 * Ten tables, each justified against a present Module 2 need in
 * platform/docs/MODULE_2_AUTH_AND_TENANCY_DESIGN.md §6 (nine tables from
 * Step 2) plus `rate_limit_counters`, added in Step 3 to back the
 * provider-agnostic rate-limiter interface (§11) — see
 * platform/docs/MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md §1. Deliberately does
 * NOT include `verification_tokens`, `accounts.password_hash`, or
 * `audit_logs.actor_type` — none had a real justification beyond "an auth
 * library would normally include it"; see §6's "What was deliberately not
 * created, and why" for the full reasoning. Adding any of them later is a
 * small, additive migration when a real need for them actually exists.
 *
 * `provider` (accounts) and `event_type` (audit_logs) are plain text, not
 * Postgres enums, specifically so that adding a new OAuth provider or a new
 * audit event type later never requires an `ALTER TYPE` — validated at the
 * application layer instead. Organization/workspace roles and invitation
 * status ARE Postgres enums: that set is part of the core authorization
 * model itself (§7) and is not expected to grow casually, so DB-level
 * enforcement is worth the trade-off there.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Intentional omissions from this schema, confirmed explicitly (hardening
 * pass, not an oversight):
 *
 * - `verification_tokens` is omitted because Module 2 launches OAuth-only
 *   (§1) and does not yet implement credential-based email verification or
 *   password reset — there is nothing to store a token for yet.
 * - `feature_flags` is deferred — it was never part of this design and is
 *   out of scope here on the same basis: it is not part of authentication
 *   or tenancy, and no current feature depends on it. Adding either later,
 *   when a real need exists, is a normal additive migration.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Organization-level roles (§7). Owner/admin/member/viewer — the core authorization model, not expected to grow casually. */
export const organizationRoleEnum = pgEnum("organization_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

/** Workspace-level roles (§7, revised) — deliberately a distinct, smaller set from organization roles. */
export const workspaceRoleEnum = pgEnum("workspace_role", ["manager", "member", "viewer"]);

/** Invitation lifecycle status (§9). */
export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

/**
 * `human` vs `agent` — the one distinction this schema's various attribution
 * and grantee columns key off (`audit_logs.actor_type`, `knowledge_items
 * .author_type`, `knowledge_item_versions.created_by_type`,
 * `brain_permission_grants.grantee_type`, Brain Modules 15/16/17). A real
 * enum: a closed, semantically fixed set, matching this schema's
 * `knowledge_domain`/`relationship_type` convention. Declared here, at the
 * very top of the file, because `audit_logs` — one of the very first
 * tables declared — now needs it; every later table that also needs it
 * (`access_log_entries`, `knowledge_items`, `knowledge_item_versions`,
 * `brain_permission_grants`) simply reaches backward to this single
 * declaration instead of each other's.
 */
export const accessActorTypeEnum = pgEnum("access_actor_type", ["human", "agent"]);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Normalized to lowercase at the application layer before every
  // insert/query as defense in depth (§4 of this hardening pass) — but the
  // database itself is the actual guarantee, via the functional unique
  // index below, not the application code.
  email: text("email").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  name: text("name"),
  image: text("image"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  // A functional unique index on lower(email), not a plain unique index on
  // email — this is what actually prevents "Alice@x.com" and
  // "alice@x.com" from being stored as two different identities. A plain
  // unique index on the raw column would not catch this at all.
  //
  // Considered and rejected: the `citext` extension, which would make
  // every comparison case-insensitive transparently. Rejected because (a)
  // it requires `CREATE EXTENSION citext`, an extra moving part on a
  // managed Postgres instance for one column's benefit; (b) Drizzle's
  // pg-core has no first-class `citext()` column type, so using it would
  // mean a raw-SQL customType instead of the typed column API used
  // everywhere else in this schema; and (c) application-layer
  // normalization to lowercase already happens before every write, so this
  // index only needs to catch what that normalization might miss (a bug,
  // a future write path that forgets to normalize) — a functional index is
  // sufficient defense in depth for that job without adding a dependency.
  uniqueIndex("users_email_lower_unique").on(sql`lower(${t.email})`),
]);

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // 'google' | 'microsoft' today; text (not an enum) so a future provider
  // never requires an ALTER TYPE — see the file header note.
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  ...timestamps,
}, (t) => [
  // The same external account must never resolve to two different LYNQ users.
  unique("accounts_provider_account_unique").on(t.provider, t.providerAccountId),
  // One link per provider per user; leading on user_id also efficiently
  // serves "list every login method linked to this user" (§6).
  unique("accounts_user_provider_unique").on(t.userId, t.provider),
]);

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
  // "Sign out everywhere" deletes by user_id — without this index that's a full scan as the table grows (§6).
  index("sessions_user_id_idx").on(t.userId),
  // The expiry-cleanup job filters on expires_at, not user_id (§6).
  index("sessions_expires_at_idx").on(t.expiresAt),
]);

// ---------------------------------------------------------------------------
// organizations
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  uniqueIndex("organizations_slug_unique").on(t.slug),
]);

// ---------------------------------------------------------------------------
// organization_memberships
// ---------------------------------------------------------------------------

export const organizationMemberships = pgTable("organization_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: organizationRoleEnum("role").notNull(),
  ...timestamps,
}, (t) => [
  // One role per person per organization; leading on organization_id also
  // serves "list every member of this org" directly (§6).
  unique("organization_memberships_org_user_unique").on(t.organizationId, t.userId),
  // Reverse direction — "list every organization this user belongs to" (org switcher, §6).
  index("organization_memberships_user_id_idx").on(t.userId),
]);

// ---------------------------------------------------------------------------
// workspaces
// ---------------------------------------------------------------------------

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  // Unique within an org, not globally — two unrelated orgs may each have a "marketing" workspace (§6).
  unique("workspaces_org_slug_unique").on(t.organizationId, t.slug),
  // Exists purely so `invitations` can reference (id, organization_id) as a
  // composite foreign key (below) — this is what lets the database itself,
  // not just application code, refuse to store an invitation whose
  // workspace belongs to a different organization than the invitation
  // claims. `id` alone is already unique via the primary key; adding this
  // composite unique alongside it is the standard, well-understood Postgres
  // pattern for enabling a composite FK reference, not a new independent
  // constraint with its own separate meaning.
  unique("workspaces_id_org_unique").on(t.id, t.organizationId),
]);

// ---------------------------------------------------------------------------
// workspace_memberships
// ---------------------------------------------------------------------------

export const workspaceMemberships = pgTable("workspace_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: workspaceRoleEnum("role").notNull(),
  ...timestamps,
}, (t) => [
  unique("workspace_memberships_workspace_user_unique").on(t.workspaceId, t.userId),
  // Reverse direction — "list every workspace this user can access" (workspace switcher, §6).
  index("workspace_memberships_user_id_idx").on(t.userId),
]);

// ---------------------------------------------------------------------------
// invitations
// ---------------------------------------------------------------------------

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Nullable: an invitation may be organization-only. No inline
  // `.references()` here — the real constraint is the composite foreign
  // key below, which ties this column to organization_id together.
  workspaceId: uuid("workspace_id"),
  email: text("email").notNull(),
  role: organizationRoleEnum("role").notNull(),
  workspaceRole: workspaceRoleEnum("workspace_role"),
  tokenHash: text("token_hash").notNull(),
  invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
  status: invitationStatusEnum("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("invitations_token_hash_unique").on(t.tokenHash),
  // Partial unique — prevents duplicate *pending* invitations to the same
  // email in the same org, while still allowing a new invitation after an
  // old one expired/was revoked (§6, §9). Also serves "list pending
  // invitations for this org" directly, since organization_id leads.
  //
  // Required transaction behavior for invitation creation (documented here,
  // NOT implemented yet — the invitation service itself is a later step):
  // creating an invitation must be an atomic UPSERT against this exact
  // partial index — e.g. `INSERT ... ON CONFLICT (organization_id, email)
  // WHERE status = 'pending' DO UPDATE SET token_hash = excluded.token_hash,
  // expires_at = excluded.expires_at, created_at = now()` — never a
  // separate "check, then maybe update, then insert" sequence, which would
  // race under concurrent requests for the same email. This single UPSERT
  // handles both cases this index could otherwise block uniformly: a
  // genuinely duplicate *active* pending invitation, and a pending
  // invitation whose `expires_at` has already silently passed (Postgres's
  // partial index has no concept of "expired," only the literal `status`
  // value) — both are simply extended in place by the same ON CONFLICT
  // DO UPDATE, with no separate "mark expired first" step required.
  uniqueIndex("invitations_org_email_pending_unique")
    .on(t.organizationId, t.email)
    .where(sql`${t.status} = 'pending'`),
  // Composite foreign key — this is what makes invitation-workspace tenancy
  // a DATABASE guarantee, not just an application-level check. It ties
  // (workspace_id, organization_id) together against workspaces' own (id,
  // organization_id) unique constraint, so the database physically cannot
  // store an invitation whose workspace belongs to a different organization
  // than the invitation's own organization_id — no row with that
  // combination could ever exist on the workspaces side. Postgres's
  // default MATCH SIMPLE semantics mean this check is automatically
  // skipped whenever workspace_id is NULL, so organization-only invitations
  // are unaffected.
  //
  // ON DELETE CASCADE (not SET NULL): a composite FK's ON DELETE action
  // applies to every column in its own list, and organization_id is
  // NOT NULL — a SET NULL here would try to null organization_id too and
  // fail outright. On reflection this is the more correct choice anyway:
  // an invitation whose workspace was deleted has nothing valid left to
  // reference. Silently turning it into an org-only invitation (the
  // previous design's intent) would misrepresent what was actually
  // invited. If preserving that history matters later, it belongs in the
  // invitation's own `status` transitions, not in quietly mutating
  // `workspace_id` to null.
  foreignKey({
    name: "invitations_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("cascade"),
]);

// ---------------------------------------------------------------------------
// audit_logs
// ---------------------------------------------------------------------------

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable + SET NULL: some events precede any org context (e.g. a failed
  // OAuth callback for an unrecognized email), and the log must outlive an
  // organization that's later deleted (§6, §14).
  organizationId: uuid("organization_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  // Nullable + SET NULL: the log must outlive the person it describes.
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  // Brain Module 16/17 — the agent-actor counterpart, matching
  // `actorUserId`'s exact precedent (must outlive the agent it describes;
  // no tenant-composite FK, same reasoning as `organizationId` above — an
  // audit row must remain readable after either side is gone). A lazy
  // thunk (`AnyPgColumn`), not a plain `() => agents.id`: `agents` is
  // declared later in this file than `auditLogs`, the identical forward-
  // reference shape `knowledgeItemVersions.knowledgeItemId` already uses
  // for `knowledgeItems`. At most one of `actorUserId`/`actorAgentId` is
  // ever set; both may be null (a system event with no actor at all, or a
  // tombstoned one).
  actorAgentId: uuid("actor_agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
  actorType: accessActorTypeEnum("actor_type"),
  // Text, not an enum — the event list (§10) is expected to grow as new
  // departments/features ship; an enum would require an ALTER TYPE per new
  // event, validated against the known list at the application layer instead.
  eventType: text("event_type").notNull(),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  // Deliberately excludes passwords, raw tokens, and session secrets — a
  // hard application-layer rule (§6, §10), not enforced by the column type.
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The single most likely real query: "recent activity for this org", needing both the tenant filter and chronological order together (§6).
  index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
  // Distinct real query: "everything this specific person did" (security investigation, §6).
  index("audit_logs_actor_user_id_idx").on(t.actorUserId),
  index("audit_logs_actor_agent_id_idx").on(t.actorAgentId),
  check("audit_logs_at_most_one_actor_check", sql`NOT (${t.actorUserId} IS NOT NULL AND ${t.actorAgentId} IS NOT NULL)`),
]);

// ---------------------------------------------------------------------------
// rate_limit_counters
// ---------------------------------------------------------------------------

/**
 * Backs the provider-agnostic rate-limiter interface (Module 2 §11; Step 3
 * design §1). No foreign keys: a key is a derived string
 * (`{scope}:{action}:{identifier}`) that must work for values that aren't
 * rows yet — an IP address, an email that may not correspond to a `users`
 * row. Every real query against this table is a point upsert-and-read by
 * `key` (see src/lib/rate-limit/postgres.ts); no secondary index is
 * justified. Rows for keys no longer in use accumulate indefinitely without
 * a cleanup job — the same operational caveat already noted for `sessions`
 * applies here, not a schema problem.
 */
export const rateLimitCounters = pgTable("rate_limit_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Agent Registry (`marketing/AGENT_FRAMEWORK.md` §3, §5, §14; anticipated by
// `MODULE_3_BRAIN_ARCHITECTURE.md` §13 entity 17 as "a Module 3-adjacent,
// not-yet-built system"). The first non-human identity this codebase has
// ever modeled — every agent that will eventually write to the Brain
// (Modules 16/17) or run under the Agent Runtime (`MODULE_4_AGENT_RUNTIME_
// ARCHITECTURE.md`) must be registered here first; an unregistered agent is
// a safety incident (§14). Declared here, BEFORE every Brain table, because
// Brain Module 16 needs `agents(id, organization_id)` as a composite FK
// target from both `brain_permission_grants` and `knowledge_items` — a
// forward reference to a table declared later in this file would be a
// module-evaluation temporal-dead-zone bug (the exact class of bug Module
// 15's `accessLogEntries` relocation already fixed once in this file).
// ---------------------------------------------------------------------------

/**
 * LYNQ's own fixed department list (`marketing/LYNQ_COMPANY_OS.md` §9–11) —
 * a closed, named set of 13 permanent departments, the same "small closed
 * set of business-meaningful values → a real enum, not a mutable lookup
 * table" judgment already applied to `knowledge_domain` (Module 1) rather
 * than inventing a `departments` CRUD system nobody has asked for yet.
 * Every Agent Anatomy record (AGENT_FRAMEWORK §3) requires exactly one.
 */
export const agentDepartmentEnum = pgEnum("agent_department", [
  "founders_office",
  "product",
  "design",
  "engineering",
  "ai_systems",
  "client_success",
  "sales_and_bizdev",
  "marketing_and_brand",
  "support",
  "finance_and_operations",
  "legal_and_compliance",
  "security_and_trust",
  "research_and_strategy",
]);

/**
 * AGENT_FRAMEWORK §5's seven permission levels, minus one: `founder` is
 * deliberately excluded from this enum's own value set, not merely
 * validated against elsewhere — "Founder is human-only, no exception ever"
 * is enforced structurally here the same way `assertHumanActor()` marks
 * the future agent-approval block in `lifecycle.ts`: an agent row can
 * never hold a level this type doesn't even contain.
 */
export const agentPermissionLevelEnum = pgEnum("agent_permission_level", [
  "observer",
  "assistant",
  "operator",
  "manager",
  "executive",
  "system",
]);

/** AGENT_FRAMEWORK §2's existence-lifecycle — distinct from the Agent RUNTIME's own per-task execution lifecycle (`MODULE_4_AGENT_RUNTIME_ARCHITECTURE.md`), which governs a task, not the agent identity itself. */
export const agentLifecycleStageEnum = pgEnum("agent_lifecycle_stage", [
  "idea",
  "specification",
  "development",
  "testing",
  "approval",
  "deployment",
  "monitoring",
  "improvement",
  "retired",
]);

/** AGENT_FRAMEWORK §13's health signal — a coarse, human/dashboard-facing status, not the detailed metrics themselves (§12), which belong to the Agent Runtime's own observability layer once it exists. */
export const agentHealthStatusEnum = pgEnum("agent_health_status", ["healthy", "degraded", "unhealthy", "unknown"]);

/**
 * Agent (AGENT_FRAMEWORK §3 "Agent Anatomy" + §14 "Agent Registry" — the
 * central catalog, "the employee's résumé" per
 * `MODULE_4_AGENT_RUNTIME_ARCHITECTURE.md`). One row per registered agent
 * identity, org-scoped like every other Brain-adjacent entity. Current
 * anatomy fields live directly on this row (mutable, like `knowledge_items`'
 * denormalized current-version fields); `agent_versions` holds the
 * append-only history of every change, mirroring `knowledge_item_versions`'
 * own "row holds a pointer, versions hold content" shape.
 */
export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Specific and non-generic per §3 ("Roadmap Synthesizer", never "Helper
  // Bot") — length-bounded in validation.ts, not here.
  name: text("name").notNull(),
  department: agentDepartmentEnum("department").notNull(),
  purpose: text("purpose").notNull(),
  responsibilities: text("responsibilities").notNull(),
  goals: text("goals").notNull(),
  inputs: text("inputs").notNull(),
  outputs: text("outputs").notNull(),
  successCriteria: text("success_criteria").notNull(),
  failureCriteria: text("failure_criteria").notNull(),
  retirementCriteria: text("retirement_criteria").notNull(),
  // §3's "Human owner" — every agent answers to exactly one accountable
  // person, never to "the department" abstractly. `restrict`, not
  // `cascade`/`set null`: an owner cannot be deleted out from under a
  // still-active agent (mirrors no existing precedent directly, but matches
  // this schema's general discipline of never silently orphaning an
  // authority-bearing reference).
  humanOwnerUserId: uuid("human_owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  permissionLevel: agentPermissionLevelEnum("permission_level").notNull(),
  lifecycleStage: agentLifecycleStageEnum("lifecycle_stage").notNull().default("idea"),
  healthStatus: agentHealthStatusEnum("health_status").notNull().default("unknown"),
  currentVersionNumber: integer("current_version_number").notNull().default(1),
  registeredByUserId: uuid("registered_by_user_id").references(() => users.id, { onDelete: "set null" }),
  // Retirement (§17) is the one-way terminal transition — "lessons
  // extracted, registry entry moves to Retired, never deleted" — same
  // "archive never deletes" philosophy as everything else in this schema.
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  retiredByUserId: uuid("retired_by_user_id").references(() => users.id, { onDelete: "set null" }),
  retirementReason: text("retirement_reason"),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "agents_human_owner_org_membership_fk",
    columns: [t.humanOwnerUserId, t.organizationId],
    foreignColumns: [organizationMemberships.userId, organizationMemberships.organizationId],
  }).onDelete("restrict"),
  index("agents_org_department_idx").on(t.organizationId, t.department),
  index("agents_org_lifecycle_stage_idx").on(t.organizationId, t.lifecycleStage),
  // Brain Module 16/17 — exists purely so `brain_permission_grants` and
  // `knowledge_items` can reference `(id, organization_id)` as a composite
  // foreign key, the identical `workspaces_id_org_unique` pattern already
  // established: `id` alone is already unique via the primary key; this is
  // the standard Postgres mechanism for a composite FK to depend on it,
  // not a new independent constraint with its own separate meaning.
  unique("agents_id_org_unique").on(t.id, t.organizationId),
]);

/**
 * AgentVersion — append-only anatomy snapshot, written on every meaningful
 * change to an agent's anatomy/permission level (AGENT_FRAMEWORK §16
 * Versioning: "a new version re-enters Specification/Testing/Approval").
 * Never updated or deleted, exactly like `knowledge_item_versions`.
 */
export const agentVersions = pgTable("agent_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  purpose: text("purpose").notNull(),
  responsibilities: text("responsibilities").notNull(),
  goals: text("goals").notNull(),
  inputs: text("inputs").notNull(),
  outputs: text("outputs").notNull(),
  successCriteria: text("success_criteria").notNull(),
  failureCriteria: text("failure_criteria").notNull(),
  retirementCriteria: text("retirement_criteria").notNull(),
  permissionLevel: agentPermissionLevelEnum("permission_level").notNull(),
  changeReason: text("change_reason"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("agent_versions_agent_version_unique").on(t.agentId, t.versionNumber),
]);

/**
 * AgentCredential — the concrete, authenticatable identity an agent
 * presents at runtime (AGENT_FRAMEWORK's prerequisite for Brain Modules
 * 16/17 and the Agent Runtime). Only a SHA-256 hash of the secret is ever
 * stored — never the plaintext, never recoverable, matching the
 * `session_token`/OAuth-secret handling discipline already established in
 * `auth/`. Multiple simultaneously-active credentials are allowed
 * (rotation-friendly, standard API-key practice); revocation is one-way,
 * exactly like every other terminal transition in this schema.
 */
export const agentCredentials = pgTable("agent_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  // Short, non-secret lookup prefix (like Stripe's `sk_live_...` prefix
  // convention) — lets a caller find the row without hashing every stored
  // credential against the presented secret.
  keyPrefix: text("key_prefix").notNull(),
  secretHash: text("secret_hash").notNull(),
  issuedByUserId: uuid("issued_by_user_id").references(() => users.id, { onDelete: "set null" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("agent_credentials_key_prefix_unique").on(t.keyPrefix),
  index("agent_credentials_agent_active_idx").on(t.agentId, t.revokedAt),
]);

// ---------------------------------------------------------------------------
// Brain — Module 1 (Core Knowledge Storage)
// ---------------------------------------------------------------------------

/**
 * The eight fixed Brain domains (platform/docs/MODULE_3_BRAIN_ARCHITECTURE.md
 * §3) — "effectively fixed... Founder's Office only, and rarely" changed, the
 * same justification already used for organization/workspace roles being a
 * real Postgres enum rather than free text (see this file's own top-of-file
 * note). Module 6 ("Domains" — MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md) adds
 * department ownership and category management on top of this fixed set
 * without ever needing to alter `knowledge_items` itself — a future
 * `knowledge_domain_meta`-style table would key off this same enum, never
 * requiring these eight values to change shape.
 *
 * Module 1 deliberately does NOT create a `KnowledgeCategory` table/column,
 * a deviation from both this module's own architecture doc (§13, entity 2)
 * and the Module 5 roadmap's own Module 1 sketch (which included Category).
 * This implementation's own task-level scope explicitly narrowed Module 1 to
 * "what Module 1 genuinely needs" and omits Category from its required
 * schema entirely — items reference a domain directly. Category is deferred
 * to Module 6, addable later as a nullable `category_id` column (an additive
 * migration, not a rewrite of `knowledge_items`) once real domain/category
 * management exists to make it meaningful. See
 * platform/docs/MODULE_5_BRAIN_MODULE_1_CORE_STORAGE.md for the full
 * discussion of this deviation.
 */
export const knowledgeDomainEnum = pgEnum("knowledge_domain", [
  "identity",
  "offerings",
  "market",
  "execution",
  "growth",
  "governance",
  "capability",
  "wisdom",
]);

// ---------------------------------------------------------------------------
// access_log_entries — Brain Module 15 (Audit Integration)
// ---------------------------------------------------------------------------

/**
 * AccessLogEntry (`MODULE_3_BRAIN_ARCHITECTURE.md` §11) — the separate,
 * higher-volume READ log, deliberately distinct from `audit_logs` (which
 * stays exactly what it already was: every *mutation*). Splitting them is
 * the identical reasoning §11 itself gives: a high-volume, possibly-sampled
 * read log must never compete with the append-only, never-sampled,
 * never-summarized mutation history for the same table's performance and
 * retention story.
 *
 * Write-only from the application's perspective — no update or delete path
 * is ever written anywhere in this module (proven directly by a structural
 * test), matching "Historical Memory is append-only" (§11) exactly like
 * `audit_logs` itself.
 *
 * No agent identity concept exists anywhere in this codebase yet (Brain
 * Modules 16/17, deliberately later) — every actual caller today passes
 * `actorType: "human"`, and this module's own logging policy
 * (`shouldLogAccess`) defers human-read logging entirely per §15.6's open
 * question, so this table currently receives no real traffic. It exists
 * now as the one designated write path so wiring full-fidelity agent-read
 * logging in a later module is a matter of that module calling
 * `recordAccessLogEntry` with `actorType: "agent"`, never a new table.
 */
export const accessLogEntries = pgTable("access_log_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorType: accessActorTypeEnum("actor_type").notNull(),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  domain: knowledgeDomainEnum("domain"),
  workspaceId: uuid("workspace_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("access_log_entries_org_created_idx").on(t.organizationId, t.createdAt),
  index("access_log_entries_org_actor_idx").on(t.organizationId, t.actorUserId),
]);

/**
 * Brain Modules 8/9 (Draft Workflow, Review/Approval) extend Module 1's
 * original two-state (`draft`, `archived`) lifecycle in place, exactly as
 * this enum's own original comment anticipated: `ALTER TYPE ... ADD VALUE`
 * additively, never a second `lifecycleState` column, which would have
 * been "duplicated mutable state" of the exact kind this schema already
 * avoids elsewhere (see `knowledgeItems`' own comment on why `revision` was
 * removed rather than kept alongside `versionNumber`).
 *
 * The full eight-state machine from `MODULE_3_BRAIN_ARCHITECTURE.md` §4:
 * `idea → draft → review → approved → published → archived → retired`,
 * plus the separate, narrow `purged` terminal value. `idea` and `purged`
 * are real, storage-ready enum values with **no code path that produces
 * them yet** — `createKnowledgeItem` still lands directly on `draft`
 * (Module 1's shipped behavior, unchanged; "idea" is a pre-system concept,
 * never a persisted row in this implementation), and `purge` requires
 * authority ("Founder's Office and Security & Trust jointly") this
 * codebase has no organizational-role model for at all — seeded here for
 * schema completeness, exactly like `brain_capability`'s own unused
 * `purge` value, not wired to any operation. See
 * `MODULE_5_BRAIN_MODULE_8_9_LIFECYCLE.md` for the full state machine,
 * transition-authority table, and why `purge` stays deliberately
 * unreachable.
 */
export const knowledgeItemStatusEnum = pgEnum("knowledge_item_status", [
  "idea",
  "draft",
  "review",
  "approved",
  "published",
  "archived",
  "retired",
  "purged",
]);

/**
 * Brain Module 14 (Decision Tracking) — `MODULE_3_BRAIN_GRAPH_AND_REASONING.md`
 * §5's Decision "Outcome" field: starts `pending`, updated once real-world
 * results are known. Item-level (the current fact, mirroring
 * `approvedAt`'s own precedent), even though every change to it is
 * recorded as a NEW VERSION of the same item (§5/§12: "captured via a new
 * version... the decision's identity hasn't changed") — this column is
 * what makes the current outcome directly queryable without joining
 * through version history, exactly the reasoning already applied to
 * `approvedByUserId`/`approvedAt`. Meaningful only for `classification =
 * 'decision'` items; left at its default (`pending`) and never read for
 * any other classification — a service-layer rule, not a CHECK
 * constraint, matching this schema's established "classification-specific
 * rules live in application code" precedent (e.g. Module 13's Observation
 * trust ceiling).
 */
export const decisionOutcomeEnum = pgEnum("decision_outcome", ["pending", "succeeded", "failed", "mixed"]);

/**
 * KnowledgeItemVersion (Brain Module 2 — "Version History") — the
 * immutable content history Module 1 deferred, declared BEFORE
 * `knowledgeItems` in this file specifically so `knowledgeItems`' own
 * composite foreign key (below) can reference this table's columns
 * directly — Drizzle's composite `foreignKey()` config is evaluated
 * eagerly, unlike the single-column `.references(() => ...)` shorthand
 * this table itself uses (a lazy callback) to point back at `knowledgeItems`
 * despite that table not being declared until after this one. Two tables
 * that reference each other always need exactly one direction expressed
 * lazily; this is that arrangement, chosen so the composite (harder to
 * make lazy) side comes second.
 *
 * Every content-changing write creates a new row here; no row, once
 * written, is ever updated or deleted by any code path in this module (no
 * PATCH/DELETE route exists for versions, and no `updateVersion`/
 * `deleteVersion` function is ever written — immutability is enforced by
 * application architecture: the absence of any mutating code path, not a
 * database trigger or a permissions rule, judged the smallest robust
 * mechanism sufficient for Module 2's actual risk — see
 * MODULE_5_BRAIN_MODULE_2_VERSION_HISTORY.md's "Immutability" section for
 * the full reasoning).
 *
 * `classification` moves here from `knowledgeItems` (see that table's own
 * comment below) — carries the identical CHECK constraint Module 1's
 * hardening pass added, just relocated to the table that now actually owns
 * this field. `title`/`content` were always meant to live wherever the
 * Brain's real content lives; this is that place now.
 *
 * `versionNumber` is a deterministic PER-ITEM sequence (1, 2, 3, ...) —
 * deliberately never a global auto-increment/sequence value, which would
 * leak cross-item ordering information and wouldn't make sense as a
 * user-facing "version 3 of this item" label. Enforced unique per item via
 * `knowledge_item_versions_item_version_unique` below — the actual, final
 * concurrency guard (see MODULE_5_BRAIN_MODULE_2_VERSION_HISTORY.md's
 * "Concurrency" section): two concurrent attempts to create "version 2" of
 * the same item can only ever result in one success, with the loser's
 * INSERT rejected by this exact constraint, regardless of what an
 * application-level optimistic check already tried to prevent.
 */
export const knowledgeItemVersions = pgTable("knowledge_item_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  knowledgeItemId: uuid("knowledge_item_id")
    .notNull()
    .references((): AnyPgColumn => knowledgeItems.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  classification: text("classification").notNull(),
  // Nullable + SET NULL — who actually wrote THIS version's content; may
  // differ from knowledgeItems.authorUserId (see that column's comment).
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  // Brain Module 17 — the agent-authored counterpart, plain single-column
  // FK matching `createdByUserId`'s own precedent (this table has no
  // `organizationId` of its own to compose a tenant-safety FK from; it
  // relies entirely on its parent `knowledgeItems` row for tenant scoping,
  // exactly as `createdByUserId` always has). At most one of the two is
  // ever set; both may be null (a version whose author, human or agent,
  // was later removed).
  createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdByType: accessActorTypeEnum("created_by_type"),
  // Nullable at the database level — a routine edit isn't always required
  // to explain itself. The SERVICE layer makes this mandatory specifically
  // for the restore/rollback path (a materially more consequential action),
  // never at the schema level, matching this task's own "nullable only if
  // justified" instruction.
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Enables the composite FK from knowledgeItems.currentVersionId below —
  // the standard Postgres pattern for a composite-FK target, identical in
  // spirit to `workspaces_id_org_unique`.
  unique("knowledge_item_versions_id_item_unique").on(t.id, t.knowledgeItemId),
  check(
    "knowledge_item_versions_at_most_one_creator_check",
    sql`NOT (${t.createdByUserId} IS NOT NULL AND ${t.createdByAgentId} IS NOT NULL)`
  ),
  // The per-item version-number uniqueness this whole design depends on.
  unique("knowledge_item_versions_item_version_unique").on(t.knowledgeItemId, t.versionNumber),
  // The default listing/history query: every version of one item, in order.
  index("knowledge_item_versions_item_idx").on(t.knowledgeItemId, t.versionNumber),
  // Brain Module 10 (Search Interface) — keyword-only, explicitly NOT
  // semantic/hybrid (Module 3.1 §13: keyword search is always available
  // without an embedding pipeline). A GIN expression index, not a new
  // generated/stored column and not a new table — `search.ts` computes the
  // identical `to_tsvector('english', title || ' ' || content)` expression
  // at query time so the planner can use this index; every version's
  // content is indexed (not only the current one), but `search.ts` only
  // ever queries through `knowledgeItems.currentVersionId`, so historical
  // versions are never actually surfaced as search results.
  index("knowledge_item_versions_fts_idx").using("gin", sql`to_tsvector('english', ${t.title} || ' ' || ${t.content})`),
  check(
    "knowledge_item_versions_classification_check",
    sql`${t.classification} IN ('fact', 'instruction', 'policy', 'procedure', 'decision', 'observation', 'note', 'summary', 'template', 'prompt', 'reference')`
  ),
]);

/**
 * KnowledgeItem (MODULE_3_BRAIN_ARCHITECTURE.md §1, §13, entity 3) — the
 * STABLE identity and tenancy record only, as of Brain Module 2 ("Version
 * History"). Everything that can change as understanding of a piece of
 * knowledge evolves — `title`, `content`, `classification` — now lives on
 * `knowledgeItemVersions` above, never duplicated here; this row holds only
 * what genuinely describes the item itself, not its content at any given
 * moment: which organization/workspace it belongs to, which domain
 * (ownership/permission boundary, not content — see below), its lifecycle
 * status, its original author, and a pointer to whichever version is
 * currently current.
 *
 * `domain` stays here, deliberately NOT versioned, even though Module 1
 * originally allowed changing it via `updateKnowledgeItem`. Module 3 §10
 * treats Domain as the Brain's permission/ownership boundary (Module 7's
 * future `DomainGrant`s are domain-scoped) — a structural, tenancy-adjacent
 * fact about the item, not a piece of its content the way title/content/
 * classification are. Reclassifying an item's domain is now deliberately
 * unsupported by any endpoint in this module — a domain change is a
 * boundary change, not a content edit, and is deferred to a future, more
 * carefully-authorized operation once Module 7's real grants exist to
 * govern it. See MODULE_5_BRAIN_MODULE_2_VERSION_HISTORY.md's "Deviations"
 * section for the full discussion.
 *
 * `revision` (Module 1's own lightweight optimistic-concurrency counter) is
 * REMOVED here — `knowledgeItemVersions.versionNumber`, resolved through
 * `currentVersionId`, now serves as the concurrency token, and keeping both
 * would be exactly the "duplicated mutable state" this design avoids.
 */
export const knowledgeItems = pgTable("knowledge_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Nullable: an item may be organization-only. No inline `.references()`
  // here — the real constraint is the composite foreign key below, the
  // identical pattern already used by `invitations.workspaceId`.
  workspaceId: uuid("workspace_id"),
  domain: knowledgeDomainEnum("domain").notNull(),
  status: knowledgeItemStatusEnum("status").notNull().default("draft"),
  // Nullable + SET NULL, matching `invitations.invitedByUserId`'s exact
  // precedent: application code always populates this at creation time: it
  // is never actually null in real usage, but the column stays nullable so
  // a referenced user row can still be removed without breaking this table.
  // This is the item's ORIGINAL author (a stable provenance fact, "who owns
  // this piece of knowledge") — distinct from `knowledgeItemVersions
  // .createdByUserId`, which records who authored each specific version's
  // content and can differ per version (e.g. an owner/admin correcting
  // someone else's draft). Authorization's "is this the item's author"
  // check (`src/lib/brain/authz.ts`) always means THIS field, never
  // "whoever wrote the current version."
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  // Brain Module 17 (Agent Attribution) — the agent-authored counterpart to
  // `authorUserId`. No inline `.references()`: the real tenant-safety
  // constraint is the composite FK below (mirrors `workspaceId`'s own
  // pattern on this exact table). At most one of `authorUserId`/
  // `authorAgentId` is ever set (never both — an agent is never
  // represented as a user, or vice versa); BOTH may legitimately be null,
  // matching `authorUserId`'s own pre-existing "SET NULL, the referenced
  // row may be removed" tombstone behavior — unlike `brain_permission_
  // grants`' grantee columns (which cascade-delete and therefore enforce
  // EXACTLY one), an item's author history must be allowed to go fully
  // null and still remain a valid, readable historical row.
  authorAgentId: uuid("author_agent_id"),
  // Explicit, queryable "who kind of thing authored this" — this schema's
  // standing "one enum value per row, never infer from which nullable
  // column happens to be set" convention. Nullable: legacy rows created
  // before this module all predate agents; the migration backfills
  // `'human'` for every existing row that has an `authorUserId`.
  authorType: accessActorTypeEnum("author_type"),
  // Nullable specifically because of insertion order: a new item is
  // inserted first (with this NULL), then its first version is inserted
  // referencing the item, then this pointer is set — the same
  // insert-then-backfill-the-pointer shape any self-referential-via-another-
  // table pointer requires. Never null in practice once creation completes;
  // the composite FK below is what guarantees it can only ever point to a
  // version that genuinely belongs to THIS item.
  currentVersionId: uuid("current_version_id"),
  ...timestamps,
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  // Brain Modules 8/9 — the "who/when" for each forward lifecycle
  // transition, following the identical precedent `knowledge_item_trust
  // .lastAssessedByUserId` already established: the audit log is the
  // historical trail, these columns are the current fact, queryable
  // without a join. All nullable + `ON DELETE SET NULL`, matching every
  // other "who did this" column in this schema.
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  publishedByUserId: uuid("published_by_user_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  retiredByUserId: uuid("retired_by_user_id").references(() => users.id, { onDelete: "set null" }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  // Mandatory at the SERVICE layer only (identical "nullable at the schema
  // level, required by the specific consequential operation" precedent as
  // `knowledge_item_versions.changeReason` for restores) — retiring is
  // exactly that kind of consequential, explain-yourself transition
  // (§4: "Any → Retired: owning department + explicit reason recorded").
  retiredReason: text("retired_reason"),
  // Brain Module 14 — see `decisionOutcomeEnum`'s own comment above.
  outcome: decisionOutcomeEnum("outcome").notNull().default("pending"),
}, (t) => [
  // Composite foreign key — the same database-level tenancy guarantee
  // `invitations` already uses: the database itself refuses to store a
  // knowledge item whose workspace belongs to a different organization than
  // the item's own organization_id. Requires `workspaces_id_org_unique`
  // (already defined on `workspaces`) as its target.
  foreignKey({
    name: "knowledge_items_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("cascade"),
  // The tenant-safe current-version guarantee (Brain Module 2): mirrors the
  // workspace/organization composite FK pattern exactly, but in the
  // opposite direction — this table REFERENCES knowledgeItemVersions
  // (rather than being referenced). The database itself physically cannot
  // store a current_version_id that belongs to a DIFFERENT item's version
  // history; a version row can only ever become "current" for the exact
  // item it was created under.
  foreignKey({
    name: "knowledge_items_current_version_fk",
    columns: [t.currentVersionId, t.id],
    foreignColumns: [knowledgeItemVersions.id, knowledgeItemVersions.knowledgeItemId],
  }),
  // Brain Module 17 — the agent-author tenant-safety guarantee, targeting
  // `agents_id_org_unique` exactly the way Module 16's
  // `brain_permission_grants_grantee_agent_org_fk` does.
  foreignKey({
    name: "knowledge_items_author_agent_org_fk",
    columns: [t.authorAgentId, t.organizationId],
    foreignColumns: [agents.id, agents.organizationId],
  }).onDelete("set null"),
  check("knowledge_items_at_most_one_author_check", sql`NOT (${t.authorUserId} IS NOT NULL AND ${t.authorAgentId} IS NOT NULL)`),
  // Additive, Brain Module 3 (Relationships) addition to this otherwise-
  // completed Module 1/2 table: enables `knowledge_relationships`' own
  // composite FKs (below) to reference `(id, organization_id)` together,
  // the identical tenant-safety pattern `workspaces_id_org_unique` and
  // `knowledge_item_versions_id_item_unique` already establish. `id` alone
  // is already globally unique via the primary key, so this constraint adds
  // no new real-world restriction — it exists purely so Postgres has a
  // named unique target for the composite FK to point at. Purely additive:
  // no data migration, no behavior change to any existing Module 1/2 code
  // path. See MODULE_5_BRAIN_MODULE_3_RELATIONSHIPS.md's "Deviations"
  // section for the full justification.
  unique("knowledge_items_id_org_unique").on(t.id, t.organizationId),
  // Default active listing: "this org's draft items" (and, filtered further
  // in application code, "this org's draft items in workspace X").
  index("knowledge_items_org_status_idx").on(t.organizationId, t.status),
  // Workspace-scoped listing and the unfiltered-list workspace-visibility
  // check both filter on this pair directly.
  index("knowledge_items_org_workspace_idx").on(t.organizationId, t.workspaceId),
  // Domain-filtered listing.
  index("knowledge_items_org_domain_idx").on(t.organizationId, t.domain),
  // Cursor-pagination ordering (`createdAt` desc, `id` desc tiebreak) —
  // Module 2 §14's "cursor-based, never offset-based" pagination principle,
  // applied here for the first time in this codebase.
  index("knowledge_items_org_created_idx").on(t.organizationId, t.createdAt),
]);

// ---------------------------------------------------------------------------
// knowledge_relationships — Brain Module 3
// ---------------------------------------------------------------------------

/**
 * The fixed nine-type relationship taxonomy (`MODULE_3_BRAIN_ARCHITECTURE.md`
 * §7), a real Postgres enum for the identical reason `knowledge_domain` is
 * one: a closed, semantically fixed set with named side effects per type
 * (e.g. `supersedes` carries a trust side-effect), not an extensible
 * classification the way `classification` is. A bypass attempt (a raw
 * insert with an invalid type string) is rejected by Postgres's own enum
 * type-cast, with no separate CHECK constraint needed.
 */
export const relationshipTypeEnum = pgEnum("relationship_type", [
  "supports",
  "contradicts",
  "depends_on",
  "supersedes",
  "related_to",
  "created_from",
  "references",
  "used_by",
  "required_for",
]);

/**
 * KnowledgeRelationship (`MODULE_3_BRAIN_ARCHITECTURE.md` §13, entity 8) — a
 * typed, directed edge between two stable `knowledge_items` (never between
 * two versions — §7 is explicit that relationships connect Items, not
 * Versions, so this table has no `version_id` of any kind). `organization_id`
 * is duplicated here (rather than derived transitively) specifically to
 * serve as the anchor for both composite tenant-safety FKs below — the
 * same "duplicate a scalar so a composite FK can enforce it at the database
 * level" tradeoff `invitations.organization_id` already makes.
 *
 * Deliberately has no `workspace_id` column of its own: a relationship's
 * visibility is governed entirely by whether the actor can independently
 * read *both* endpoint items (§7's "never grants visibility into the item
 * on its other end" rule, enforced in `src/lib/brain/relationships.ts`, not
 * by a column here) — the two endpoints may even belong to different
 * workspaces within the same organization, which is a legitimate, expected
 * shape (e.g. a `depends_on` edge from a workspace-scoped item to an
 * org-wide policy item), not an error condition.
 */
export const knowledgeRelationships = pgTable("knowledge_relationships", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  sourceItemId: uuid("source_item_id").notNull(),
  targetItemId: uuid("target_item_id").notNull(),
  relationshipType: relationshipTypeEnum("relationship_type").notNull(),
  // Nullable + SET NULL, matching `knowledge_items.author_user_id`'s exact
  // precedent — always populated at creation time by application code, but
  // a removed user row must not break this table. Purely provenance: unlike
  // `knowledge_items.author_user_id`, this column is NEVER consulted for
  // authorization (see `archiveRelationship`'s doc comment for why).
  creatorUserId: uuid("creator_user_id").references(() => users.id, { onDelete: "set null" }),
  // Nullable — explaining *why* two items are related is often genuinely
  // optional (a `references` edge is frequently self-evident); bounded to
  // 1000 chars at the application layer (`relationshipExplanationSchema`),
  // matching this codebase's existing "explicit, documented limit" pattern
  // for every other free-text field in the Brain module.
  explanation: text("explanation"),
  ...timestamps,
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  // Tenant-safety, source side: mirrors `knowledge_items_workspace_org_fk`
  // exactly. The database physically cannot store a relationship whose
  // source item belongs to a different organization than the relationship's
  // own organization_id.
  foreignKey({
    name: "knowledge_relationships_source_org_fk",
    columns: [t.sourceItemId, t.organizationId],
    foreignColumns: [knowledgeItems.id, knowledgeItems.organizationId],
  }).onDelete("cascade"),
  // Tenant-safety, target side: the identical guarantee, independently
  // enforced for the other endpoint. Together these two FKs make a
  // cross-organization edge structurally impossible to persist, not merely
  // application-checked.
  foreignKey({
    name: "knowledge_relationships_target_org_fk",
    columns: [t.targetItemId, t.organizationId],
    foreignColumns: [knowledgeItems.id, knowledgeItems.organizationId],
  }).onDelete("cascade"),
  // A self-link is never valid for any of the nine relationship types (an
  // item cannot supersede, depend on, or contradict itself) — enforced at
  // the database level as defense-in-depth alongside the service-layer
  // `SelfRelationshipViolationError` check, matching this module's
  // established "app check + DB backstop" pattern for classification.
  check("knowledge_relationships_no_self_link", sql`${t.sourceItemId} <> ${t.targetItemId}`),
  // The final concurrency guard against duplicate *active* edges (Module 3's
  // "reject duplicate active relationships" requirement): a partial unique
  // index, identical in spirit to `invitations_org_email_pending_unique` —
  // scoped to `archived_at IS NULL` so a genuinely new edge can always be
  // created after an old, identical one was archived. Two concurrent
  // attempts to create the same (source, target, type) triple can only ever
  // result in one success; the loser's INSERT is rejected by this exact
  // constraint (`src/lib/brain/relationships.ts` catches the `23505` and
  // reports `DuplicateRelationshipError`), regardless of what an
  // application-level pre-check already tried to prevent.
  uniqueIndex("knowledge_relationships_active_edge_unique")
    .on(t.sourceItemId, t.targetItemId, t.relationshipType)
    .where(sql`${t.archivedAt} IS NULL`),
  // The default query shape: "every relationship where this item is the
  // source" / "...is the target" (`listRelationshipsForItem` queries both
  // sides via an OR, so both indexes matter independently).
  index("knowledge_relationships_org_source_idx").on(t.organizationId, t.sourceItemId),
  index("knowledge_relationships_org_target_idx").on(t.organizationId, t.targetItemId),
]);

// ---------------------------------------------------------------------------
// knowledge_item_sources / knowledge_item_trust / knowledge_item_evidence
// — Brain Module 4 (Trust Model & Evidence)
// ---------------------------------------------------------------------------

/**
 * The six-tier trust taxonomy (`MODULE_3_BRAIN_ARCHITECTURE.md` §5), a real
 * Postgres enum for the identical reason `knowledge_domain` and
 * `relationship_type` are: a closed, semantically fixed set (each tier has
 * a specific, named meaning agents must respect), not an extensible
 * classification. Shared by both `knowledge_item_trust.trust_tier` (a
 * version's own current assessment) and `knowledge_item_evidence
 * .evidence_trust_tier` (a single piece of evidence's own, independently
 * reassessable trust) — `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §3 is
 * explicit that "evidence trust is reassessed the same way a version's
 * trust is," meaning the identical tier vocabulary, not a parallel one.
 */
export const trustTierEnum = pgEnum("trust_tier", ["verified", "approved", "observed", "hypothesis", "unknown", "deprecated"]);

/**
 * The nine-tier Source Hierarchy (`marketing/LYNQ_BRAIN.md` §7), in rank
 * order (index 1 = highest authority) — a real enum for the same reason
 * `trust_tier` is: a closed, fixed taxonomy with rank-based conflict-
 * resolution semantics (§5, §7), not something organizations customize.
 * Resolving cross-tier conflicts BY this rank is explicitly a reasoning-
 * layer concern (Module 3.1 §3/§10), out of scope here — this module only
 * stores which tier a version's content came from.
 */
export const sourceTypeEnum = pgEnum("source_type", [
  "founder_decision",
  "official_documentation",
  "client_approved",
  "internal_documentation",
  "meeting_notes",
  "ai_generated_draft",
  "external_research",
  "open_internet_search",
  "unverified",
]);

/**
 * The five storable Evidence classes (`MODULE_3_BRAIN_GRAPH_AND_REASONING.md`
 * §3's table) — deliberately excludes "Missing," which that same table
 * defines as "the explicit ABSENCE of evidence for a claim," a reasoning-
 * time query *result*, never a row that could exist in this table.
 */
export const evidenceClassEnum = pgEnum("evidence_class", ["primary", "supporting", "weak", "historical", "conflicting"]);

/**
 * KnowledgeSource (`MODULE_3_BRAIN_ARCHITECTURE.md` §13, entity 5) — where
 * one specific version's content actually came from. **Immutable with its
 * version**: entity 5's own words, "correcting a misattributed source
 * requires a NEW VERSION, not an edit to the source record" — there is no
 * `updateSource` function anywhere in this module, and this table has no
 * `updated_at` column, making that immutability structurally visible in
 * the schema itself, not just documented. One row per version, enforced by
 * the unique constraint on `knowledge_item_version_id` below (also what
 * lets `knowledge_item_trust`'s own composite pattern be reused verbatim).
 *
 * Deliberately its own table, not columns merged onto `knowledge_item_trust`
 * — the task's own "Trust and Source remain independent dimensions exactly
 * as defined in the approved architecture" instruction, and §13's ER
 * diagram, both show Source and Trust as two separate one-to-one
 * relationships off Version, not one combined record. Keeping them
 * structurally separate also makes each entity's own distinct mutability
 * rule (Source: write-once; Trust: reassessable) impossible to blur by
 * accident in a future update statement.
 */
export const knowledgeItemSources = pgTable("knowledge_item_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Denormalized alongside organization_id specifically to anchor the two
  // composite tenant-safety FKs below — the same "chain of composite FKs"
  // pattern `knowledge_relationships` already established: this table
  // references the version (proving it belongs to the claimed item), and
  // separately the item (proving IT belongs to the claimed organization),
  // giving full database-enforced tenant isolation transitively, with no
  // need to add `organization_id` to `knowledge_item_versions` itself.
  knowledgeItemId: uuid("knowledge_item_id").notNull(),
  knowledgeItemVersionId: uuid("knowledge_item_version_id").notNull(),
  sourceType: sourceTypeEnum("source_type").notNull(),
  // Nullable — which named human, registered agent, import job, or external
  // system specifically; bounded at the application layer
  // (`sourceDetailSchema`). Optional because the tier alone is sometimes
  // the whole story (e.g. `open_internet_search` rarely needs more detail).
  sourceDetail: text("source_detail"),
  recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("knowledge_item_sources_version_unique").on(t.knowledgeItemVersionId),
  foreignKey({
    name: "knowledge_item_sources_version_item_fk",
    columns: [t.knowledgeItemVersionId, t.knowledgeItemId],
    foreignColumns: [knowledgeItemVersions.id, knowledgeItemVersions.knowledgeItemId],
  }).onDelete("cascade"),
  foreignKey({
    name: "knowledge_item_sources_item_org_fk",
    columns: [t.knowledgeItemId, t.organizationId],
    foreignColumns: [knowledgeItems.id, knowledgeItems.organizationId],
  }).onDelete("cascade"),
  index("knowledge_item_sources_org_item_idx").on(t.organizationId, t.knowledgeItemId),
]);

/**
 * KnowledgeTrust (`MODULE_3_BRAIN_ARCHITECTURE.md` §13, entity 6) — the
 * current trust assessment for one specific version. **The one entity in
 * the version's cluster that is explicitly mutable**: entity 6's own
 * words, "trust is *reassessed*, not re-versioned." `revision` is the
 * optimistic-concurrency counter guarding that reassessment (Module 1's
 * exact `revision` pattern — a plain integer counter — reused here rather
 * than Module 2's version-number-via-pointer mechanism, because that
 * mechanism exists specifically to protect *content* history, and trust
 * reassessment deliberately does NOT create content history; see
 * MODULE_5_BRAIN_MODULE_4_TRUST_AND_EVIDENCE.md's "Concurrency" section).
 *
 * One row per version (unique on `knowledge_item_version_id`, identical
 * shape to `knowledge_item_sources` above), created lazily on the first
 * assessment rather than eagerly at version-creation time — this module
 * does not modify Module 2's version-creation code path at all; a version
 * with no assessment yet simply has no row here, and the service layer
 * (`getTrustAssessmentForVersion`) synthesizes an "unknown, unassessed"
 * view for that case rather than requiring a materialized row to exist.
 */
export const knowledgeItemTrust = pgTable("knowledge_item_trust", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  knowledgeItemId: uuid("knowledge_item_id").notNull(),
  knowledgeItemVersionId: uuid("knowledge_item_version_id").notNull(),
  trustTier: trustTierEnum("trust_tier").notNull(),
  revision: integer("revision").notNull().default(1),
  lastAssessedByUserId: uuid("last_assessed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [
  unique("knowledge_item_trust_version_unique").on(t.knowledgeItemVersionId),
  foreignKey({
    name: "knowledge_item_trust_version_item_fk",
    columns: [t.knowledgeItemVersionId, t.knowledgeItemId],
    foreignColumns: [knowledgeItemVersions.id, knowledgeItemVersions.knowledgeItemId],
  }).onDelete("cascade"),
  foreignKey({
    name: "knowledge_item_trust_item_org_fk",
    columns: [t.knowledgeItemId, t.organizationId],
    foreignColumns: [knowledgeItems.id, knowledgeItems.organizationId],
  }).onDelete("cascade"),
  index("knowledge_item_trust_org_item_idx").on(t.organizationId, t.knowledgeItemId),
]);

/**
 * Evidence (`MODULE_3_BRAIN_ARCHITECTURE.md` §13, entity 7) — a citation,
 * external reference, observed outcome, or client confirmation justifying
 * a version's trust assessment. **Append-only**: entity 7's own words,
 * "superseding evidence is added, not edited over" — there is no
 * `updateEvidence`/`deleteEvidence` function anywhere in this module. Many
 * rows per version (no uniqueness constraint on `knowledge_item_version_id`,
 * unlike Source/Trust above).
 *
 * `evidence_trust_tier` and `is_stale` are real, storage-ready columns
 * matching Module 3.1 §3's explicit "evidence trust is reassessed... it is
 * marked stale... never removed" behavior, but **no mutation path for
 * either exists in this module** — this task's own Operations list names
 * only creation and listing for evidence, not reassessment. Reassessing an
 * individual evidence row's own trust/staleness is deferred to whichever
 * later module actually needs it; adding that mutation later is a pure
 * service-layer addition, not a schema change.
 */
export const knowledgeItemEvidence = pgTable("knowledge_item_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  knowledgeItemId: uuid("knowledge_item_id").notNull(),
  knowledgeItemVersionId: uuid("knowledge_item_version_id").notNull(),
  evidenceClass: evidenceClassEnum("evidence_class").notNull(),
  // What the evidence actually says/shows — bounded at the application
  // layer (`evidenceDescriptionSchema`), a real citation body, not a title.
  description: text("description").notNull(),
  // Nullable — a URL, document id, or other external pointer; bounded
  // (`externalReferenceSchema`). Not every piece of evidence has one (a
  // directly observed outcome may have no external artifact at all).
  externalReference: text("external_reference"),
  evidenceTrustTier: trustTierEnum("evidence_trust_tier").notNull(),
  isStale: boolean("is_stale").notNull().default(false),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "knowledge_item_evidence_version_item_fk",
    columns: [t.knowledgeItemVersionId, t.knowledgeItemId],
    foreignColumns: [knowledgeItemVersions.id, knowledgeItemVersions.knowledgeItemId],
  }).onDelete("cascade"),
  foreignKey({
    name: "knowledge_item_evidence_item_org_fk",
    columns: [t.knowledgeItemId, t.organizationId],
    foreignColumns: [knowledgeItems.id, knowledgeItems.organizationId],
  }).onDelete("cascade"),
  // The default query shape: "every evidence row for this version, newest
  // first" (`listEvidenceForVersion`'s cursor-pagination ordering).
  index("knowledge_item_evidence_version_created_idx").on(t.knowledgeItemVersionId, t.createdAt),
]);

// ---------------------------------------------------------------------------
// knowledge_domain_metadata — Brain Module 6 (Domain Management)
// ---------------------------------------------------------------------------

/**
 * KnowledgeDomain's management layer (`MODULE_3_BRAIN_ARCHITECTURE.md` §13,
 * entity 1) — exactly the "future `knowledge_domain_meta`-style table"
 * `knowledgeDomainEnum`'s own comment above already anticipated. Adds
 * mutable presentation/ownership metadata on top of the eight fixed
 * identifiers Module 1 seeded as a Postgres enum, without ever touching
 * that enum, `knowledge_items.domain`, or any existing row — this table
 * only ever REFERENCES the eight canonical values, never redefines them.
 *
 * **Global, not organization-scoped** — deliberately. Entity 1's own text
 * describes domains as "instantiated per organization," but
 * `MODULE_3_BRAIN_ARCHITECTURE.md` §15's Open Question #1 explicitly and
 * permanently leaves "is the 8-domain list fixed forever, or organization-
 * configurable?" unresolved, and Module 1 already chose the simpler,
 * global-enum implementation over the per-organization-row design when it
 * shipped `knowledge_domain`. This table continues that already-shipped
 * choice rather than reopening Open Question #1 on its own authority —
 * every organization sees the identical eight rows, matching the identical
 * shared enum they already reference today. See
 * MODULE_5_BRAIN_MODULE_6_DOMAIN_MANAGEMENT.md's "Deviations" section for
 * the full reasoning.
 *
 * `domain` reuses `knowledgeDomainEnum` directly (not a plain text column)
 * so the database itself — not just a unique constraint — guarantees no
 * 9th, unsupported domain identifier can ever be inserted here; combined
 * with the unique constraint below, exactly one metadata row can exist per
 * canonical identifier, and none for any other string.
 */
export const knowledgeDomainMetadata = pgTable("knowledge_domain_metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: knowledgeDomainEnum("domain").notNull(),
  description: text("description").notNull(),
  // Deterministic UI/listing order — a presentational convenience with no
  // permission or identity implication, distinct from `domain` (the real
  // identifier) exactly the way Category is distinct from Domain (§3).
  sortOrder: integer("sort_order").notNull(),
  // Nullable: `MODULE_3_BRAIN_ARCHITECTURE.md` §15 Open Question #2 states
  // the domain-to-department mapping is explicitly "not confirmed, needs an
  // explicit Founder's Office decision" — seeding a fabricated mapping here
  // would misrepresent unconfirmed data as settled fact. The column exists
  // (entity 1's "Ownership: ... the mapped department" is real, approved
  // shape) but is left null for all eight rows until that decision is
  // actually made.
  ownerDepartment: text("owner_department"),
  // Entity 1's own "Lifecycle: effectively permanent; a domain is retired,
  // never deleted" — a real, approved lifecycle concept, represented here
  // even though no code path in this module can ever set it to true (no
  // administrative authority exists yet to safely govern a GLOBAL mutation
  // — see the authorization note in MODULE_5_BRAIN_MODULE_6_DOMAIN_MANAGEMENT.md).
  // Storage-ready, not yet mutable — the identical pattern Brain Module 4
  // used for `knowledge_item_evidence.is_stale`.
  isRetired: boolean("is_retired").notNull().default(false),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  // The final guard against "duplicate identifiers": at most one metadata
  // row may exist per canonical domain, database-level, not just assumed
  // by a well-behaved seed script.
  unique("knowledge_domain_metadata_domain_unique").on(t.domain),
  // The final guard against "invalid display ordering" colliding silently:
  // two domains can never claim the same display position.
  unique("knowledge_domain_metadata_sort_order_unique").on(t.sortOrder),
]);

// ---------------------------------------------------------------------------
// brain_permission_grants — Brain Module 7 (Brain Permissions)
// ---------------------------------------------------------------------------

/**
 * The Brain-domain capability set. Five terms — `read`, `draft_write`,
 * `approve`, `archive`, `purge` — are the architecture's own exact
 * vocabulary (`MODULE_3_BRAIN_ARCHITECTURE.md` §10's DomainGrant
 * `accessLevel`; §13 entity 12), reused verbatim per this task's own "use
 * the exact approved terminology where the architecture already defines
 * it" instruction. `purge` has no operation anywhere in this codebase that
 * checks it yet (Purge itself, §4, is a much later, unimplemented
 * lifecycle stage) — included anyway for the same reason Brain Module 4
 * stored `is_stale` before any code could set it: a real, approved
 * concept should be representable the moment its home table exists, not
 * retrofitted later as a breaking schema change.
 *
 * Three additional values were NOT in the architecture's 5-value list, but
 * were explicitly requested and are non-contradictory refinements of it:
 * `edit_own_draft`/`edit_any_draft` split what the architecture's flat
 * `draft-write` term left ambiguous — whose drafts a grant actually
 * authorizes editing — the exact distinction Brain Module 1's own
 * temporary stand-in already enforced as a hardcoded rule (author-vs-
 * owner/admin), now promoted to an explicit, independently-grantable
 * capability instead of an implicit role side-effect. `manage_permissions`
 * is a new, meta-level capability (about the grant system itself, not
 * about content) that this module's own grant-management operations need
 * to exist conceptually even though — see `authz.ts` — actual grant
 * management is gated by a temporary organization-role check in this
 * module, not by `manage_permissions` grants themselves yet.
 */
export const brainCapabilityEnum = pgEnum("brain_capability", [
  "read",
  "draft_write",
  "edit_own_draft",
  "edit_any_draft",
  "approve",
  "archive",
  "purge",
  "manage_permissions",
]);

/**
 * BrainPermissionGrant (`MODULE_3_BRAIN_ARCHITECTURE.md` §13 entity 12,
 * "DomainGrant") — the fourth, independent authorization gate §10
 * describes: an explicit, human-grantee, (organization, domain,
 * capability) authorization record, optionally narrowed to one workspace.
 *
 * **Scope model, and how it resolves `MODULE_3_BRAIN_ARCHITECTURE.md` §15
 * Open Question #12** ("does a workspace-scoped item need both a
 * Workspace membership AND a Domain Grant, or can a sufficiently-
 * privileged Domain Grant bypass the workspace check?" — explicitly
 * flagged there as this document's own unconfirmed *assumption*, not a
 * settled rule): this table resolves it as **exact-scope-match, no
 * crossing** — an organization-scoped grant (`workspace_id IS NULL`)
 * governs only organization-scoped content; a workspace-scoped grant
 * governs only that exact workspace's content; neither extends into the
 * other's territory automatically. This is the stricter of the two
 * readings the open question left available, chosen because the
 * architecture itself frames the question as unresolved rather than
 * specifying the looser (crossing) behavior, and because every prior
 * Brain module's own precedent (Module 1's hardening pass, above all)
 * consistently resolved similar ambiguities toward stricter tenant
 * isolation, never looser. See MODULE_5_BRAIN_MODULE_7_PERMISSIONS.md's
 * "Effective-permission resolution" section for the full reasoning and
 * MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md for how this interacts with §7's
 * own future refinement of this exact question.
 *
 * One row = one (organization, domain, workspace-or-null, grantee,
 * capability) tuple — never a bundled role or a capability array/set
 * column, per this task's own "do not collapse independent capabilities
 * into one role field" instruction, and matching this schema's own
 * established convention (`relationship_type`, `trust_tier`, etc. are
 * always one enum value per row). A grantee needing several capabilities
 * holds several rows; `getEffectiveBrainPermissions` computes their union.
 */
export const brainPermissionGrants = pgTable("brain_permission_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  domain: knowledgeDomainEnum("domain").notNull(),
  // Nullable: NULL = organization-scoped grant; non-null = workspace-scoped,
  // narrowed to exactly this workspace. No inline `.references()` — the
  // real tenant-safety constraint is the composite FK below.
  workspaceId: uuid("workspace_id"),
  // Brain Module 16 — widened from NOT NULL/human-only to a closed
  // (human | agent) grantee union, exactly the "second, real grantee type"
  // `MODULE_3_BRAIN_ARCHITECTURE.md` §15 Open Question #8 anticipated and
  // Module 2 §13 deliberately deferred. Nullable now: exactly one of
  // `granteeUserId`/`granteeAgentId` is set, enforced below by
  // `brain_permission_grants_exactly_one_grantee_check` — never both, never
  // neither (unlike author-style columns elsewhere, a grant's grantee FK is
  // `onDelete: cascade` on both sides, so there is no legacy "grantee was
  // deleted, now both are null" tombstone state to accommodate here).
  granteeUserId: uuid("grantee_user_id").references(() => users.id, { onDelete: "cascade" }),
  granteeAgentId: uuid("grantee_agent_id"),
  // Explicit, queryable grantee-type — this codebase's standing "one enum
  // value per row, never infer from which nullable column happens to be
  // set" convention (matches `trustTier`/`brainCapability` etc.). Existing
  // rows all predate agents and are backfilled `'human'` by the migration.
  granteeType: accessActorTypeEnum("grantee_type").notNull().default("human"),
  capability: brainCapabilityEnum("capability").notNull(),
  // Optimistic-concurrency counter — Module 1's plain-integer `revision`
  // pattern (not Module 2's version-number-via-pointer mechanism, which
  // exists specifically to protect immutable content history; a grant has
  // no content history to protect, only a single mutable `reason` field
  // and a one-way revoke transition).
  revision: integer("revision").notNull().default(1),
  grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  // Bounded, optional context for why this grant exists — never knowledge
  // content, never a secret (see `recordAuditEvent`'s own blanket rule,
  // which this field's audit-metadata inclusion must also respect).
  reason: text("reason"),
  // Revocation is a one-way, terminal transition — the identical "archive,
  // never un-archive; a new row is the only way back" philosophy already
  // established for knowledge items and relationships. NULL = active.
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [
  // Tenant-safety #1: a workspace-scoped grant's workspace must belong to
  // the grant's own claimed organization — the exact
  // `knowledge_items_workspace_org_fk`/`invitations_workspace_org_fk`
  // pattern. Postgres's default MATCH SIMPLE semantics skip this check
  // entirely whenever workspace_id is NULL (an organization-scoped grant),
  // so this FK only ever constrains the workspace-scoped case.
  foreignKey({
    name: "brain_permission_grants_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("cascade"),
  // Tenant-safety #2 — "grants to users outside the organization" enforced
  // at the database level, not only in route code: the grantee must have a
  // real `organization_memberships` row for this exact organization.
  // Removing that membership cascades away any grants it once justified —
  // there is no such thing as a grant surviving its own grantee's
  // departure from the organization.
  foreignKey({
    name: "brain_permission_grants_grantee_org_membership_fk",
    columns: [t.granteeUserId, t.organizationId],
    foreignColumns: [organizationMemberships.userId, organizationMemberships.organizationId],
  }).onDelete("cascade"),
  // Tenant-safety #3 — a workspace-scoped grant's grantee must also hold a
  // real `workspace_memberships` row for that exact workspace (again
  // automatically skipped by MATCH SIMPLE when workspace_id is NULL). A
  // workspace-scoped Domain Grant for someone who isn't even a workspace
  // member would be permission data with nothing to actually authorize —
  // the workspace-membership gate (§10 step 3) would already reject them
  // first, every time, making such a grant structurally inert. Preventing
  // it at creation time keeps the grants table itself always meaningful.
  foreignKey({
    name: "brain_permission_grants_grantee_workspace_membership_fk",
    columns: [t.granteeUserId, t.workspaceId],
    foreignColumns: [workspaceMemberships.userId, workspaceMemberships.workspaceId],
  }).onDelete("cascade"),
  // Tenant-safety #4 (Module 16) — the agent equivalent of tenant-safety
  // #2: an agent grantee must actually belong to this exact organization.
  // No agent equivalent of tenant-safety #3 exists — Agent Registry
  // agents are org-scoped only (no workspace-membership concept at all,
  // Module 6's own design), so a workspace-scoped agent grant is
  // authorized purely by holding the grant itself, never by an additional
  // membership row that structurally cannot exist for an agent.
  foreignKey({
    name: "brain_permission_grants_grantee_agent_org_fk",
    columns: [t.granteeAgentId, t.organizationId],
    foreignColumns: [agents.id, agents.organizationId],
  }).onDelete("cascade"),
  // Exactly one of the two grantee columns is ever set — never both
  // (an agent impersonating a user, or vice versa), never neither (unlike
  // author-style columns, both grantee FKs cascade-delete, so there is no
  // legitimate "grantee no longer exists" null state to allow here).
  check(
    "brain_permission_grants_exactly_one_grantee_check",
    sql`((${t.granteeUserId} IS NOT NULL)::int + (${t.granteeAgentId} IS NOT NULL)::int) = 1`
  ),
  // "Duplicate active grants" — FOUR partial unique indexes, not two.
  // The original two (split by "workspace_id IS NULL" vs "IS NOT NULL",
  // since Postgres unique indexes treat every NULL as distinct from every
  // other NULL — a naive single index across a nullable column would never
  // catch two duplicates that both have that column null) hit the exact
  // same problem again once `granteeAgentId` became a second nullable
  // column in the same index: a human grant always has `granteeAgentId
  // IS NULL`, so two identical human grants would no longer collide either
  // (verified directly — this was caught by this module's own pre-existing
  // duplicate-grant tests, not a hypothetical). Splitting by grantee type
  // too, on top of the existing workspace split, and filtering each
  // partial index to rows where its own grantee column IS NOT NULL closes
  // the gap correctly, without a magic sentinel UUID for either dimension.
  uniqueIndex("brain_permission_grants_org_scoped_human_active_unique")
    .on(t.organizationId, t.domain, t.granteeUserId, t.capability)
    .where(sql`${t.workspaceId} IS NULL AND ${t.granteeUserId} IS NOT NULL AND ${t.revokedAt} IS NULL`),
  uniqueIndex("brain_permission_grants_org_scoped_agent_active_unique")
    .on(t.organizationId, t.domain, t.granteeAgentId, t.capability)
    .where(sql`${t.workspaceId} IS NULL AND ${t.granteeAgentId} IS NOT NULL AND ${t.revokedAt} IS NULL`),
  uniqueIndex("brain_permission_grants_workspace_scoped_human_active_unique")
    .on(t.organizationId, t.domain, t.workspaceId, t.granteeUserId, t.capability)
    .where(sql`${t.workspaceId} IS NOT NULL AND ${t.granteeUserId} IS NOT NULL AND ${t.revokedAt} IS NULL`),
  uniqueIndex("brain_permission_grants_workspace_scoped_agent_active_unique")
    .on(t.organizationId, t.domain, t.workspaceId, t.granteeAgentId, t.capability)
    .where(sql`${t.workspaceId} IS NOT NULL AND ${t.granteeAgentId} IS NOT NULL AND ${t.revokedAt} IS NULL`),
  // Expected query patterns: "every active grant for this user" (effective-
  // permission resolution, on every Brain operation), "every grant for
  // this domain" and "every grant for this workspace" (admin listing).
  index("brain_permission_grants_org_grantee_active_idx").on(t.organizationId, t.granteeUserId, t.revokedAt),
  index("brain_permission_grants_org_grantee_agent_active_idx").on(t.organizationId, t.granteeAgentId, t.revokedAt),
  index("brain_permission_grants_org_domain_idx").on(t.organizationId, t.domain),
  index("brain_permission_grants_workspace_idx").on(t.workspaceId),
]);

// ---------------------------------------------------------------------------
// Agent Runtime Core — Module 7 (`MODULE_4_AGENT_RUNTIME_ARCHITECTURE.md`)
// ---------------------------------------------------------------------------

/**
 * `MODULE_4_AGENT_RUNTIME_ARCHITECTURE.md` §1's runtime lifecycle, renamed
 * to snake_case, plus two narrow additions the diagram omits but the
 * surrounding prose requires (see `MODULE_7_AGENT_RUNTIME_CORE.md`'s own
 * "Contradictions discovered" section for the full reasoning):
 * `queued` (an execution can exist before an agent is assigned — the
 * diagram's own starting point, `Idle → Assigned`, already assumes an
 * agent; §2's Task Model and the task's own `createExecution`/
 * `assignExecution` split imply a real gap before that) and `paused`
 * (§8: "an explicit, first-class control", never drawn as a state node).
 * Deliberately NOT included as separate states: `waiting_for_approval`,
 * `waiting_for_dependency`, `retry_scheduled` — §1 explicitly says
 * "distinct sub-reasons are always recorded even though 'Waiting' is the
 * single visible state"; those all fold into `waiting` + `wait_reason`.
 * `idle` itself is deliberately excluded — it describes an AGENT's own
 * resting availability (Agent Registry, `agents.lifecycleStage`), never a
 * state a specific execution row is ever created in or returns to.
 */
export const agentExecutionStatusEnum = pgEnum("agent_execution_status", [
  "queued",
  "assigned",
  "gathering_context",
  "planning",
  "reasoning",
  "waiting",
  "executing",
  "delegating",
  "human_approval",
  "verifying",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "archived",
]);

export const agentPlanStepStatusEnum = pgEnum("agent_plan_step_status", ["pending", "completed", "failed", "skipped"]);

export const agentApprovalRiskLevelEnum = pgEnum("agent_approval_risk_level", ["low", "medium", "high", "critical"]);

/** §7's exact five states. */
export const agentApprovalStatusEnum = pgEnum("agent_approval_status", ["pending", "approved", "rejected", "expired", "cancelled", "revision_requested"]);

/** §13's exact five states — deliberately mirrors `knowledgeItemStatusEnum`'s shape, a distinct value set (an Artifact is never a Knowledge Item, per §13's own "does not automatically live in the Brain" rule). */
export const agentArtifactStatusEnum = pgEnum("agent_artifact_status", ["draft", "review", "approved", "published", "archived"]);

/** The output SHAPES §13 names — never raw binary (see `agentArtifacts.content`/`externalRef`'s own comments). */
export const agentArtifactTypeEnum = pgEnum("agent_artifact_type", [
  "draft_text",
  "report",
  "proposal",
  "structured_data",
  "code_patch_reference",
  "file_reference",
  "action_proposal",
]);

export const agentDelegationStatusEnum = pgEnum("agent_delegation_status", ["active", "completed", "failed", "cancelled", "timed_out"]);

/**
 * AgentExecution — the merged Task+Execution entity. §2's Task Model
 * ("what needs doing": goal, owner, success/failure criteria, priority,
 * deadline, retry) and §1's runtime lifecycle (the actual state machine)
 * are modeled as ONE row, not two cross-referenced tables — per this
 * task's own "do not create unnecessary tables if a smaller normalized
 * model satisfies the approved architecture" instruction. A Subtask
 * (§2: "structurally identical to a Task, distinguished only by having a
 * parent Task") is exactly that here too: another `agent_executions` row
 * with `parentExecutionId` set — no separate subtask table, no separate
 * "delegated task" table (delegation-specific metadata lives in
 * `agentDelegations` below, layered on top of an ordinary parent/child
 * pair here).
 *
 * Goal/Objective (§2's upper two hierarchy levels) are folded into the
 * plain `goal` text field rather than their own tables — nothing in this
 * phase's required scope needs a Goal or Objective independently queried,
 * versioned, or manipulated apart from the Task that serves it; adding
 * two tables to hold text nobody yet needs to address independently would
 * be exactly the premature structure this task's own instructions warn
 * against. Revisit if a real multi-task-per-Goal reporting need emerges.
 */
export const agentExecutions = pgTable("agent_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Nullable: an execution may be organization-only. No inline
  // `.references()` — the real constraint is the composite FK below.
  workspaceId: uuid("workspace_id"),
  // The human who kicked this execution off — distinct from `ownerUserId`
  // (§2: "every task has exactly one accountable named human... distinct
  // from which agent is currently executing it"). Null for a
  // system/parent-execution-initiated child (a subtask or delegation has
  // no separate human initiator of its own).
  initiatingUserId: uuid("initiating_user_id").references(() => users.id, { onDelete: "set null" }),
  // `restrict`, matching `agents.humanOwnerUserId`'s own precedent —
  // accountability must never silently vanish out from under an
  // execution by deleting the accountable user.
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  // Nullable until the `assigned` transition. No inline `.references()` —
  // composite FK below (tenant-safety, matching `brain_permission_grants
  // .granteeAgentId`'s own pattern).
  assignedAgentId: uuid("assigned_agent_id"),
  // A snapshot of which `agent_versions.versionNumber` was actually
  // assigned — the Execution Context (§3) must be reproducible even if
  // the agent's own anatomy/permission level changes later.
  assignedAgentVersionNumber: integer("assigned_agent_version_number"),
  // Self-referencing — a subtask or delegation child's parent. No inline
  // `.references()` — composite FK below, requiring `agent_executions
  // _id_org_unique` (a delegation or subtask must stay within the same
  // organization as its parent, no exception).
  parentExecutionId: uuid("parent_execution_id"),
  // Denormalized top-of-tree pointer (self, for a root execution) —
  // cheap "get this whole tree" queries without a recursive CTE for the
  // common case. Pre-generated client-side (matching this codebase's
  // established `randomUUID()`-before-insert pattern), so a root's own
  // `rootExecutionId` can equal its own `id` in the same INSERT.
  rootExecutionId: uuid("root_execution_id").notNull(),
  // 0 for a root execution; parent's depth + 1 for a delegation child.
  // Hard-capped by the CHECK constraint below (§12: "hard maximum
  // delegation depth... exceeding it forces escalation").
  delegationDepth: integer("delegation_depth").notNull().default(0),
  goal: text("goal").notNull(),
  successCriteria: text("success_criteria").notNull(),
  failureCriteria: text("failure_criteria").notNull(),
  priority: integer("priority").notNull().default(0),
  deadline: timestamp("deadline", { withTimezone: true }),
  status: agentExecutionStatusEnum("status").notNull().default("queued"),
  // Populated only while `status = 'waiting'` — §1's own "distinct
  // sub-reasons are always recorded" design (see this enum's own comment
  // above). Free text, not an enum: the set of reasons an execution can be
  // blocked is expected to grow (tool call, delegation, contradiction,
  // dependency, retry-backoff) without ever needing a schema migration,
  // the identical `audit_logs.eventType` judgment.
  waitReason: text("wait_reason"),
  // Which Brain domains (`KnowledgeDomain[]`) this execution declared it
  // needs — part of the Execution Context's own "Brain access" field
  // (§3), duplicated here (not only inside `contextSnapshot`) so it is
  // directly queryable/indexable without parsing JSON.
  domainsRequested: jsonb("domains_requested").notNull().default([]),
  // The immutable Execution Context snapshot (§3) — assembled once, at
  // `gathering_context`, never mutated afterward. Null before that state
  // is reached. Deliberately excludes anything §3 forbids: no raw
  // credentials, session tokens, OAuth tokens, or hidden reasoning — see
  // `src/lib/agent-runtime/context.ts`'s own shape definition for the
  // exact, closed field list.
  contextSnapshot: jsonb("context_snapshot"),
  currentPlanId: uuid("current_plan_id"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  // Optimistic-concurrency counter — the identical plain-integer
  // `revision` pattern already established for `brain_permission_grants`/
  // `knowledge_item_trust`, reused here as the sole concurrency guard for
  // every state transition (atomic `UPDATE ... WHERE status = expected
  // AND revision = expected`), matching this codebase's own established
  // precedent rather than introducing a separate lease/worker-id system.
  revision: integer("revision").notNull().default(1),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "agent_executions_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "agent_executions_assigned_agent_org_fk",
    columns: [t.assignedAgentId, t.organizationId],
    foreignColumns: [agents.id, agents.organizationId],
  }).onDelete("restrict"),
  // Exists purely so the two self-referencing composite FKs below (parent,
  // root) have a named unique target — the identical `agents_id_org_unique`/
  // `knowledge_items_id_org_unique` pattern.
  unique("agent_executions_id_org_unique").on(t.id, t.organizationId),
  foreignKey({
    name: "agent_executions_parent_org_fk",
    columns: [t.parentExecutionId, t.organizationId],
    foreignColumns: [t.id, t.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "agent_executions_root_org_fk",
    columns: [t.rootExecutionId, t.organizationId],
    foreignColumns: [t.id, t.organizationId],
  }).onDelete("cascade"),
  check("agent_executions_retry_bound_check", sql`${t.retryCount} <= ${t.maxRetries}`),
  // §12: "a hard maximum delegation depth" — 5 is this implementation's
  // own concrete choice for architecture §16 Open Question #2 ("where
  // those ceilings sit is not [decided]"), documented here as a real,
  // revisitable number, not a silent default.
  check("agent_executions_delegation_depth_bound_check", sql`${t.delegationDepth} >= 0 AND ${t.delegationDepth} <= 5`),
  index("agent_executions_org_status_idx").on(t.organizationId, t.status),
  index("agent_executions_org_agent_status_idx").on(t.organizationId, t.assignedAgentId, t.status),
  index("agent_executions_parent_idx").on(t.parentExecutionId),
  index("agent_executions_root_idx").on(t.rootExecutionId),
  index("agent_executions_org_owner_idx").on(t.organizationId, t.ownerUserId),
]);

/**
 * AgentTaskDependency — §2's Dependency edge: `dependentExecutionId`
 * cannot start/complete until `dependsOnExecutionId` finishes. Supports
 * fan-in (many rows sharing one `dependentExecutionId`) and fan-out (many
 * rows sharing one `dependsOnExecutionId`) directly, since each is just a
 * row. Acyclicity is enforced in application code before insert (a
 * general DAG-acyclicity property is not expressible as a single-row
 * CHECK constraint the way the direct self-link check below is) — see
 * `dependencies.ts`'s own graph-traversal guard.
 */
export const agentTaskDependencies = pgTable("agent_task_dependencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  dependentExecutionId: uuid("dependent_execution_id").notNull(),
  dependsOnExecutionId: uuid("depends_on_execution_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "agent_task_dependencies_dependent_org_fk",
    columns: [t.dependentExecutionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "agent_task_dependencies_depends_on_org_fk",
    columns: [t.dependsOnExecutionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  check("agent_task_dependencies_no_self_link", sql`${t.dependentExecutionId} <> ${t.dependsOnExecutionId}`),
  unique("agent_task_dependencies_edge_unique").on(t.dependentExecutionId, t.dependsOnExecutionId),
  index("agent_task_dependencies_depends_on_idx").on(t.dependsOnExecutionId),
]);

/**
 * AgentPlan — §4's versioned Plan: every material revision is a NEW row
 * (never an in-place edit), retaining every prior version — the identical
 * `knowledge_item_versions` discipline applied to a task-scoped, not
 * company-knowledge-scoped, artifact (§4's own explicit comparison).
 */
export const agentPlans = pgTable("agent_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  // Mandatory at the SERVICE layer for a re-plan (version > 1) — nullable
  // at the schema level for a plan's very first version, matching
  // `knowledge_item_versions.changeReason`'s own precedent exactly.
  changeReason: text("change_reason"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdByType: accessActorTypeEnum("created_by_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "agent_plans_execution_org_fk",
    columns: [t.executionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  check("agent_plans_at_most_one_creator_check", sql`NOT (${t.createdByUserId} IS NOT NULL AND ${t.createdByAgentId} IS NOT NULL)`),
  unique("agent_plans_execution_version_unique").on(t.executionId, t.versionNumber),
  index("agent_plans_execution_version_idx").on(t.executionId, t.versionNumber),
]);

/**
 * AgentPlanStep — one subtask/dependency entry within a Plan version.
 * Append-only within a plan version (a re-plan creates a whole new
 * `agentPlans` row with its own fresh set of steps — this table is never
 * mutated to "rewrite" an already-approved plan version, only step
 * `status`/`completedAt` progress within the CURRENT version).
 */
export const agentPlanSteps = pgTable("agent_plan_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Denormalized from the parent plan — needed for `relatedExecutionId`'s
  // own tenant-safety composite FK below (this table has no other route
  // to an organization without joining through `agentPlans`).
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  planId: uuid("plan_id")
    .notNull()
    .references(() => agentPlans.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  description: text("description").notNull(),
  status: agentPlanStepStatusEnum("status").notNull().default("pending"),
  // If this step corresponds to a subtask or delegation child, the
  // execution that represents it. No inline `.references()` — composite
  // FK below.
  relatedExecutionId: uuid("related_execution_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "agent_plan_steps_related_execution_org_fk",
    columns: [t.relatedExecutionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("set null"),
  unique("agent_plan_steps_plan_step_unique").on(t.planId, t.stepNumber),
  index("agent_plan_steps_plan_idx").on(t.planId, t.stepNumber),
]);

/**
 * AgentCheckpoint — §8's durable checkpoint, written BEFORE any
 * side-effecting action proceeds. Append-only: no update/delete function
 * exists anywhere in this module, the same "absence of a mutating code
 * path is the immutability guarantee" pattern already established for
 * `knowledge_item_versions`/`access_log_entries`. `safeStateSummary` is a
 * BOUNDED operational summary — never raw chain-of-thought or unrestricted
 * hidden reasoning, enforced by convention at the service layer (the
 * column itself is just `jsonb`; the discipline lives in what
 * `checkpoints.ts` ever writes into it).
 */
export const agentCheckpoints = pgTable("agent_checkpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id").notNull(),
  // Monotonic per-execution ordering — the "latest checkpoint" query is
  // always `ORDER BY sequence_number DESC LIMIT 1`, never a timestamp
  // comparison (clock skew/equal timestamps must never be ambiguous here).
  sequenceNumber: integer("sequence_number").notNull(),
  statusAtCheckpoint: agentExecutionStatusEnum("status_at_checkpoint").notNull(),
  stepPosition: text("step_position"),
  safeStateSummary: jsonb("safe_state_summary").notNull().default({}),
  // Idempotency keys/references of side effects already completed as of
  // this checkpoint — §8/§12's "a retry can detect 'this already
  // succeeded' and skip re-executing the side effect."
  completedSideEffectRefs: jsonb("completed_side_effect_refs").notNull().default([]),
  retryCountAtCheckpoint: integer("retry_count_at_checkpoint").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "agent_checkpoints_execution_org_fk",
    columns: [t.executionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  unique("agent_checkpoints_execution_sequence_unique").on(t.executionId, t.sequenceNumber),
  index("agent_checkpoints_execution_sequence_idx").on(t.executionId, t.sequenceNumber),
]);

/**
 * AgentExecutionEvent — §10's append-only Events stream, the single
 * source every other observability view (Status, Progress, Execution
 * Timeline) projects from, never a separately-maintained parallel record.
 * Distinct from `audit_logs` (Module 2's platform-wide mutation log,
 * which this module ALSO writes to for the specific named event types
 * `MODULE_7_AGENT_RUNTIME_CORE.md` lists) the same way Brain Module 15's
 * `access_log_entries` is distinct from `audit_logs` — a richer,
 * execution-scoped, higher-volume detail stream with its own query shape
 * (`fromStatus`/`toStatus`), not a duplicate of the platform-wide log.
 */
export const agentExecutionEvents = pgTable("agent_execution_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id").notNull(),
  // Text, not an enum — matching `audit_logs.eventType`'s own exact
  // reasoning: this event-type list is expected to grow.
  eventType: text("event_type").notNull(),
  fromStatus: agentExecutionStatusEnum("from_status"),
  toStatus: agentExecutionStatusEnum("to_status"),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorAgentId: uuid("actor_agent_id").references(() => agents.id, { onDelete: "set null" }),
  // Both null = a system-driven event (e.g. the restart reconciliation
  // pass, §8) — matching `audit_logs`' own existing "some events have no
  // actor at all" precedent, deliberately NOT widening the shared
  // `access_actor_type` enum to add a third "system" value just for this
  // one table.
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "agent_execution_events_execution_org_fk",
    columns: [t.executionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  check("agent_execution_events_at_most_one_actor_check", sql`NOT (${t.actorUserId} IS NOT NULL AND ${t.actorAgentId} IS NOT NULL)`),
  index("agent_execution_events_execution_created_idx").on(t.executionId, t.createdAt),
  index("agent_execution_events_org_created_idx").on(t.organizationId, t.createdAt),
]);

/**
 * AgentApprovalRequest — §7's full state machine. `approverUserId` is
 * deliberately nullable: "approver requirements" (task instruction) is
 * satisfied here by the same interim "organization owner/admin" authority
 * used everywhere else a department-lead model doesn't yet exist (Brain
 * Module 7, Agent Registry) — any owner/admin may decide, `decidedByUserId`
 * records who actually did, never a single pre-named approver required at
 * creation time.
 */
export const agentApprovalRequests = pgTable("agent_approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id").notNull(),
  requestingAgentId: uuid("requesting_agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  requestedAction: text("requested_action").notNull(),
  summary: text("summary").notNull(),
  riskLevel: agentApprovalRiskLevelEnum("risk_level").notNull(),
  artifactId: uuid("artifact_id"),
  // A bounded reference to the proposed action (e.g. which tool, which
  // plan step, which artifact draft) — never raw reasoning, never a
  // secret. See this module's own blanket audit-metadata redaction rule.
  proposedActionRef: jsonb("proposed_action_ref"),
  status: agentApprovalStatusEnum("status").notNull().default("pending"),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  decisionNote: text("decision_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  // Mandatory — §7: "an unanswered request expires rather than sitting
  // forever or silently proceeding."
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Optimistic-concurrency counter — the sole guard behind "approval is
  // single-use" (atomic `UPDATE ... WHERE status = 'pending'`).
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "agent_approval_requests_execution_org_fk",
    columns: [t.executionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  index("agent_approval_requests_execution_status_idx").on(t.executionId, t.status),
  // The expiry-sweep query's own index — "every still-pending request past its expiry."
  index("agent_approval_requests_org_status_expires_idx").on(t.organizationId, t.status, t.expiresAt),
]);

/**
 * AgentArtifact — §13's task-execution-scoped output, structurally never
 * a Knowledge Item (`content`/`externalRef` are the artifact's own
 * fields, entirely separate columns/table from anything in
 * `knowledge_items`/`knowledge_item_versions` — promotion into the Brain,
 * per §13, always means authoring a genuinely new, separate Knowledge
 * Item citing this artifact as Source, never a shared row or a type
 * union).
 */
export const agentArtifacts = pgTable("agent_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id").notNull(),
  artifactType: agentArtifactTypeEnum("artifact_type").notNull(),
  title: text("title").notNull(),
  // Bounded text content, for text-shaped artifact types. Never large
  // binary content — see `externalRef`'s own comment for that case.
  content: text("content"),
  // A pointer (e.g. a Vercel Blob URL, a code-patch/PR reference) — the
  // explicit "do not store large binary files directly in Postgres"
  // instruction's actual mechanism: the file itself lives wherever this
  // codebase already stores blobs; only the reference lives here.
  externalRef: text("external_ref"),
  status: agentArtifactStatusEnum("status").notNull().default("draft"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdByType: accessActorTypeEnum("created_by_type").notNull(),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "agent_artifacts_execution_org_fk",
    columns: [t.executionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  check("agent_artifacts_at_most_one_creator_check", sql`NOT (${t.createdByUserId} IS NOT NULL AND ${t.createdByAgentId} IS NOT NULL)`),
  index("agent_artifacts_execution_status_idx").on(t.executionId, t.status),
  index("agent_artifacts_org_status_idx").on(t.organizationId, t.status),
]);

/**
 * AgentDelegation — §6's parent→child handoff metadata, layered on top of
 * an ordinary `agentExecutions` parent/child pair (`parentExecutionId`
 * already lives on `agentExecutions` itself; this table adds exactly the
 * delegation-specific facts a plain subtask doesn't need: which two
 * AGENTS are involved, the full ancestry path for O(1) cycle-membership
 * checks, and a hard timeout). `unique(childExecutionId)`: a delegated
 * execution has exactly one delegation record — it cannot be delegated
 * twice, matching "a child execution's parent is exactly one".
 */
export const agentDelegations = pgTable("agent_delegations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  parentExecutionId: uuid("parent_execution_id").notNull(),
  childExecutionId: uuid("child_execution_id").notNull(),
  delegatingAgentId: uuid("delegating_agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  delegateAgentId: uuid("delegate_agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  // The ordered list of execution ids from the root down to (and
  // including) this delegation's child — §6: "every delegation carries
  // the ordered ancestry of task IDs that led to it; a new delegation is
  // rejected outright if its target agent already appears in that
  // ancestry." Stored as jsonb (a plain array) so the cycle check is a
  // single `@>`-contains query, never a recursive CTE per delegation
  // attempt.
  ancestryPath: jsonb("ancestry_path").notNull(),
  depth: integer("depth").notNull(),
  timeoutAt: timestamp("timeout_at", { withTimezone: true }).notNull(),
  status: agentDelegationStatusEnum("status").notNull().default("active"),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "agent_delegations_parent_org_fk",
    columns: [t.parentExecutionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "agent_delegations_child_org_fk",
    columns: [t.childExecutionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  check("agent_delegations_no_self_delegation_check", sql`${t.parentExecutionId} <> ${t.childExecutionId}`),
  unique("agent_delegations_child_unique").on(t.childExecutionId),
  index("agent_delegations_parent_idx").on(t.parentExecutionId),
  index("agent_delegations_org_status_timeout_idx").on(t.organizationId, t.status, t.timeoutAt),
]);

// ---------------------------------------------------------------------------
// Tool Runtime Foundation — Module 8 (`MODULE_4_AGENT_RUNTIME_ARCHITECTURE.md` §5)
// ---------------------------------------------------------------------------

/** §5's own suggested taxonomy — a small, closed, foundational set; only `brain`/`artifact` have real tool rows this phase, the rest exist so the enum never needs an `ALTER TYPE` for tool categories this module already anticipated. */
export const toolCategoryEnum = pgEnum("tool_category", [
  "brain",
  "runtime",
  "artifact",
  "internal_api",
  "external_api",
  "communication",
  "data",
  "file",
  "administrative",
]);

/**
 * §5: "every call is classified by reversibility and external impact
 * BEFORE it executes." A real enum, not a computed flag — the identical
 * "closed, semantically fixed set with named side effects per value"
 * judgment already applied to `relationship_type`/`knowledge_domain`.
 */
export const toolSideEffectClassEnum = pgEnum("tool_side_effect_class", [
  "read_only",
  "internal_write",
  "external_write",
  "destructive",
  "financial",
  "permission_changing",
]);

/** No architecture-approved states exist yet for tool invocations specifically (§5 describes the policy, not a state machine) — this is this module's own concrete resolution, named directly from the task's own instruction. */
export const toolInvocationStatusEnum = pgEnum("tool_invocation_status", [
  "requested",
  "validating",
  "waiting_for_approval",
  "ready",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

export const toolErrorClassEnum = pgEnum("tool_error_class", [
  "invalid_input",
  "permission_denied",
  "approval_required",
  "tool_disabled",
  "tool_not_found",
  "timeout",
  "transient_failure",
  "permanent_failure",
  "provider_unavailable",
  "idempotency_conflict",
  "unsafe_retry",
  "runtime_error",
]);

/**
 * ToolDefinition — a registered, typed, permission-aware operation, never
 * an arbitrary prompt (§5). Global/platform-wide (no `organizationId`
 * column) — a tool is part of this platform's own fixed capability
 * surface, the identical judgment already applied to `knowledge_domain`
 * and Agent Registry's `agentDepartmentEnum`: a small, curated, centrally
 * governed set, not something each tenant registers independently.
 *
 * **Versioned by a new row, never an in-place content edit**: `(toolKey,
 * version)` is unique; `updateToolConfiguration` always inserts version
 * N+1, exactly mirroring `knowledge_item_versions`/`agent_plans`. An
 * already-referenced version's row is never mutated — `tool_invocations
 * .toolVersion` stays historically resolvable forever. `enabled` is the
 * one field toggled in place on the CURRENT version only (`enableTool`/
 * `disableTool`) — an availability flag, not tool-definition *content*,
 * the same distinction Agent Registry draws between `healthStatus`
 * (toggled in place) and anatomy fields (versioned).
 *
 * `inputSchema`/`outputSchema` are a bounded, human/audit-readable JSON
 * *description* of the shape (field names and types) for introspection
 * and the `GET .../tools/:toolKey` API — the actual, enforced, typed
 * validation lives in code (`src/lib/tools/implementations/`, a Zod
 * schema per tool), never re-derived from this jsonb column at runtime.
 * This keeps the database the authority on POLICY (risk, approval,
 * permission floor, enabled state) and code the authority on BEHAVIOR —
 * deliberately separated, never a single blurred system.
 */
export const toolDefinitions = pgTable("tool_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  toolKey: text("tool_key").notNull(),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: toolCategoryEnum("category").notNull(),
  inputSchema: jsonb("input_schema").notNull(),
  outputSchema: jsonb("output_schema").notNull(),
  riskLevel: agentApprovalRiskLevelEnum("risk_level").notNull(),
  sideEffectClass: toolSideEffectClassEnum("side_effect_class").notNull(),
  // The Brain capabilities (`BrainCapability[]`) this tool needs at
  // whatever domain(s) its own call-time input names — a tool isn't
  // fixed to one domain (`brain.search` can search any domain the caller
  // requests), so this is the CAPABILITY set to check, not a
  // (domain, capability) pair; `invokeTool` checks it against every
  // domain the actual call's own input lists.
  requiredCapabilities: jsonb("required_capabilities").notNull().default([]),
  // Null = no floor beyond the capability checks above. Enforces
  // AGENT_FRAMEWORK §5's trust ladder directly: a `manager`-tier agent
  // may do anything an `assistant`-tier agent may, never the reverse —
  // a single minimum threshold, not an arbitrary allow-list, is the
  // architecturally faithful model for a strictly-ordered ladder.
  minimumPermissionLevel: agentPermissionLevelEnum("minimum_permission_level"),
  approvalRequired: boolean("approval_required").notNull().default(false),
  timeoutSeconds: integer("timeout_seconds").notNull().default(30),
  maxRetryAttempts: integer("max_retry_attempts").notNull().default(0),
  retryBackoffSeconds: integer("retry_backoff_seconds").notNull().default(0),
  idempotencyRequired: boolean("idempotency_required").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  // Mandatory at the SERVICE layer for a re-version (version > 1),
  // nullable here for the first version — the exact `knowledge_item_versions
  // .changeReason` precedent.
  changeReason: text("change_reason"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [
  unique("tool_definitions_key_version_unique").on(t.toolKey, t.version),
  index("tool_definitions_key_idx").on(t.toolKey),
  // §5/task: "destructive, financial, and permission-changing actions
  // must never execute without explicit human approval" — enforced
  // structurally, not merely by application-code discipline: the
  // database itself refuses to store a high-risk tool definition with
  // `approval_required = false`. An agent (or a careless human) cannot
  // register around this rule.
  check(
    "tool_definitions_high_risk_requires_approval_check",
    sql`NOT (${t.sideEffectClass} IN ('destructive', 'financial', 'permission_changing') AND ${t.approvalRequired} = false)`
  ),
]);

/**
 * ToolInvocation — the durable record of one tool call, written BEFORE
 * the side effect proceeds (the identical checkpoint-before-side-effect
 * principle Module 7 §8 already established for execution transitions,
 * extended here to the tool-call granularity). Never stores raw
 * credentials, secrets, OAuth tokens, or hidden reasoning — `inputMetadata`/
 * `resultRef` are bounded, sanitized summaries, enforced by convention at
 * the service layer (`invocation.ts` is the only writer).
 */
export const toolInvocations = pgTable("tool_invocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  executionId: uuid("execution_id").notNull(),
  // No composite tenant-safety FK here (`agent_plan_steps` has no
  // `(id, organizationId)` unique target) — matching the same
  // "plain FK for a lower-criticality optional reference" judgment
  // already used for `agent_plan_steps.relatedExecutionId`'s siblings;
  // the invocation's real tenant scoping is `executionId`'s own
  // composite FK below.
  planStepId: uuid("plan_step_id").references(() => agentPlanSteps.id, { onDelete: "set null" }),
  agentId: uuid("agent_id").notNull(),
  agentVersionNumber: integer("agent_version_number").notNull(),
  toolKey: text("tool_key").notNull(),
  toolVersion: integer("tool_version").notNull(),
  status: toolInvocationStatusEnum("status").notNull().default("requested"),
  attemptNumber: integer("attempt_number").notNull().default(1),
  // Scoped to (organization, execution, tool) by the partial unique index
  // below — the caller's own key only needs to be unique for "this
  // logical action, within this tool, within this execution."
  idempotencyKey: text("idempotency_key").notNull(),
  inputMetadata: jsonb("input_metadata"),
  resultRef: jsonb("result_ref"),
  artifactId: uuid("artifact_id").references(() => agentArtifacts.id, { onDelete: "set null" }),
  errorClass: toolErrorClassEnum("error_class"),
  errorMessage: text("error_message"),
  approvalRequestId: uuid("approval_request_id").references(() => agentApprovalRequests.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "tool_invocations_execution_org_fk",
    columns: [t.executionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "tool_invocations_agent_org_fk",
    columns: [t.agentId, t.organizationId],
    foreignColumns: [agents.id, agents.organizationId],
  }).onDelete("restrict"),
  // §"Idempotency": "one logical action cannot execute twice... a
  // confirmed external side effect must not be repeated after recovery"
  // (enforced for every non-`failed` row — `succeeded`/`running`/
  // `requested`/etc. all stay unique) vs. "a failed validation must not
  // reserve an idempotency key permanently" (a `failed` row falls OUTSIDE
  // this partial index, freeing the exact same key for a fresh retry
  // attempt/row). This is the complete idempotency guarantee — no
  // separate idempotency-key table needed.
  uniqueIndex("tool_invocations_idempotency_unique")
    .on(t.organizationId, t.executionId, t.toolKey, t.idempotencyKey)
    .where(sql`${t.status} <> 'failed'`),
  index("tool_invocations_execution_idx").on(t.executionId, t.createdAt),
  index("tool_invocations_org_tool_idx").on(t.organizationId, t.toolKey),
]);

// ---------------------------------------------------------------------------
// Runtime Recovery, Reconciliation, and Background Worker Foundation
// (Module 9). A durable, Postgres-backed job queue — the exact mechanism
// `MODULE_4_AGENT_RUNTIME_ARCHITECTURE.md` §8 already specified ("a
// reconciliation pass finds every task last recorded as 'in progress'
// with no recent heartbeat, and resumes each from its last durable
// checkpoint"), never a second runtime or a new external dependency.
// ---------------------------------------------------------------------------

export const runtimeJobTypeEnum = pgEnum("runtime_job_type", [
  "execution_run",
  "execution_resume",
  "execution_retry",
  "tool_invocation_reconcile",
  "execution_reconcile",
  "cleanup_expired_sessions",
  "cleanup_rate_limit_counters",
  // Module 11 — the Workflow Engine's own 4 job types, dispatched through
  // this exact same queue and worker (never a second queue).
  "workflow_start",
  "workflow_continue",
  "workflow_node_execute",
  "workflow_reconcile",
  // Module 16 — Communications Core's own 2 job types, dispatched through
  // this exact same queue and worker (never a second execution engine).
  "communication_send",
  "communication_reconcile",
]);

export const runtimeJobStatusEnum = pgEnum("runtime_job_status", [
  "queued",
  "leased",
  "running",
  "retry_scheduled",
  "completed",
  "failed",
  "cancelled",
  "dead_lettered",
]);

/**
 * Server-to-server identity for worker processes — deliberately NOT the
 * human-session or agent-credential mechanisms (task's own explicit
 * instruction). A worker credential proves "this is a legitimate worker
 * process," nothing about business-data authority; the actual scope of
 * what a worker may touch during any one call comes entirely from the
 * job it holds a valid lease on (`runtime_jobs.lease_owner`), never from
 * this table. Only a SHA-256 hash is ever persisted, identical to
 * `agent_credentials`' own discipline.
 */
export const workerCredentials = pgTable("worker_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  workerName: text("worker_name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  secretHash: text("secret_hash").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  ...timestamps,
}, (t) => [
  uniqueIndex("worker_credentials_key_prefix_unique").on(t.keyPrefix),
]);

/**
 * The queue itself. One row persists across every attempt of a given
 * logical job — `attempt_count` increments in place rather than a new
 * row per retry, so `id` is a stable handle for the job's entire
 * lifetime (dead-letter inspection, manual retry, status polling all
 * address this same row).
 *
 * `organizationId` is nullable — a deliberate, narrow deviation from the
 * task's own field list, justified by `cleanup_*` jobs being genuinely
 * platform-wide (expired sessions and stale rate-limit counters belong
 * to no single organization); every other job type always sets it.
 */
export const runtimeJobs = pgTable("runtime_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  jobType: runtimeJobTypeEnum("job_type").notNull(),
  executionId: uuid("execution_id"),
  toolInvocationId: uuid("tool_invocation_id").references(() => toolInvocations.id, { onDelete: "set null" }),
  // Module 11 — forward reference via the lazy `AnyPgColumn` thunk
  // (`workflow_executions` is defined later in this file, at the end
  // alongside the other Module 10/11 tables it itself depends on) — the
  // identical pattern `audit_logs.actorAgentId`'s own forward reference to
  // `agents` already established. A single-column reference (not the
  // composite tenant-safe form `executionId` uses) — the same simple-FK
  // precedent `toolInvocationId` right above already sets for this table;
  // `organizationId` is still its own separate, always-populated column.
  workflowExecutionId: uuid("workflow_execution_id").references((): AnyPgColumn => workflowExecutions.id, { onDelete: "cascade" }),
  status: runtimeJobStatusEnum("status").notNull().default("queued"),
  priority: integer("priority").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  // `${workerCredentialId}:${workerInstanceId}` — proves not just "a
  // valid worker" but "the exact same process that claimed this lease,"
  // so a heartbeat/complete/fail call from a different process instance
  // sharing the same credential can never touch a lease it doesn't hold.
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  // Scoped by the partial unique index below to (organizationId,
  // jobType) among ACTIVE rows only — callers fold the logical target
  // (an execution id, a reconciliation run, a cleanup date-bucket)
  // directly into this key's text.
  idempotencyKey: text("idempotency_key").notNull(),
  failureClassification: text("failure_classification"),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  resultRef: jsonb("result_ref"),
  requiresHumanReview: boolean("requires_human_review").notNull().default(false),
  revision: integer("revision").notNull().default(1),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "runtime_jobs_execution_org_fk",
    columns: [t.executionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  // "Duplicate task requests reuse the existing queued execution when
  // idempotency matches" / "reconciliation cannot enqueue duplicate
  // resume jobs" — one active job per (org, type, idempotency key) at a
  // time; once a job reaches any terminal state the same key is free
  // again for a genuinely new job.
  uniqueIndex("runtime_jobs_idempotency_unique")
    .on(t.organizationId, t.jobType, t.idempotencyKey)
    .where(sql`${t.status} IN ('queued', 'leased', 'running', 'retry_scheduled')`),
  index("runtime_jobs_claim_idx").on(t.jobType, t.status, t.availableAt),
  index("runtime_jobs_execution_idx").on(t.executionId),
  index("runtime_jobs_org_status_idx").on(t.organizationId, t.status),
  index("runtime_jobs_workflow_execution_idx").on(t.workflowExecutionId),
  check("runtime_jobs_attempt_bound_check", sql`${t.attemptCount} <= ${t.maxAttempts}`),
]);

/**
 * Observability record for every reconciliation pass and cleanup run —
 * "records examined, records affected, duration, success/failure,
 * bounded error classification" (task's own required shape), one shared
 * table rather than a near-identical one per operation type.
 */
export const runtimeOperationRuns = pgTable("runtime_operation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  operationType: text("operation_type").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recordsExamined: integer("records_examined").notNull().default(0),
  recordsAffected: integer("records_affected").notNull().default(0),
  outcomeSummary: jsonb("outcome_summary"),
  succeeded: boolean("succeeded"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("runtime_operation_runs_type_idx").on(t.operationType, t.startedAt),
]);

// ---------------------------------------------------------------------------
// Projects Core (Module 10). The shared operational layer for real company
// projects (Kids Coding, Home Renovation Rebate, and LYNQ's own internal
// work) — built entirely on the existing organization/workspace, Agent
// Runtime, Tool Runtime, artifact, approval, and audit systems already
// defined above. Never a second execution/permission/artifact model:
// agent involvement in a task is represented purely by a link to a real
// `agent_executions` row (`project_execution_links`), never a parallel
// "agent assignment" concept — an agent is never a `project_members` row.
// ---------------------------------------------------------------------------

export const projectStatusEnum = pgEnum("project_status", [
  "proposed",
  "planning",
  "active",
  "paused",
  "blocked",
  "completed",
  "cancelled",
  "archived",
]);

/** Shared by both projects and tasks — identical four-value scale, one enum rather than two identical ones. */
export const projectPriorityEnum = pgEnum("project_priority", ["low", "normal", "high", "urgent"]);

export const projectMemberRoleEnum = pgEnum("project_member_role", ["project_owner", "project_manager", "contributor", "viewer"]);

export const projectPhaseStatusEnum = pgEnum("project_phase_status", ["not_started", "active", "completed", "cancelled"]);

export const projectMilestoneStatusEnum = pgEnum("project_milestone_status", ["planned", "active", "at_risk", "completed", "cancelled"]);

export const projectTaskStatusEnum = pgEnum("project_task_status", ["backlog", "ready", "in_progress", "blocked", "review", "completed", "cancelled"]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  // Stable, human-chosen short code (e.g. "KIDS", "REBATE") — unique per
  // organization. The service layer's `updateProject` never accepts a
  // change to this field at all once a project exists ("do not permit
  // project keys to be silently changed after dependent records exist" —
  // no versioned re-key strategy was needed for this phase, so the
  // simplest safe answer is "immutable after creation").
  projectKey: text("project_key").notNull(),
  description: text("description"),
  objective: text("objective"),
  status: projectStatusEnum("status").notNull().default("proposed"),
  priority: projectPriorityEnum("priority").notNull().default("normal"),
  startDate: timestamp("start_date", { withTimezone: true }),
  targetDate: timestamp("target_date", { withTimezone: true }),
  actualCompletionDate: timestamp("actual_completion_date", { withTimezone: true }),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  unique("projects_org_key_unique").on(t.organizationId, t.projectKey),
  // Enables composite FK targets from every child table below — the
  // identical `workspaces_id_org_unique`/`agents_id_org_unique` pattern.
  unique("projects_id_org_unique").on(t.id, t.organizationId),
  foreignKey({
    name: "projects_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  index("projects_org_status_idx").on(t.organizationId, t.status),
]);

export const projectMembers = pgTable("project_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: projectMemberRoleEnum("role").notNull(),
  addedByUserId: uuid("added_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "project_members_project_org_fk",
    columns: [t.projectId, t.organizationId],
    foreignColumns: [projects.id, projects.organizationId],
  }).onDelete("cascade"),
  unique("project_members_project_user_unique").on(t.projectId, t.userId),
  index("project_members_project_idx").on(t.projectId),
]);

export const projectPhases = pgTable("project_phases", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  // Gap-based (allocated in increments of 1000) rather than dense —
  // reordering one phase only ever needs to change ITS OWN sequence value
  // to a midpoint between its new neighbors, never a multi-row swap, so a
  // plain (non-deferrable) unique constraint is sufficient to prevent
  // duplicate sequence values under concurrency.
  sequence: integer("sequence").notNull(),
  status: projectPhaseStatusEnum("status").notNull().default("not_started"),
  startDate: timestamp("start_date", { withTimezone: true }),
  targetDate: timestamp("target_date", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "project_phases_project_org_fk",
    columns: [t.projectId, t.organizationId],
    foreignColumns: [projects.id, projects.organizationId],
  }).onDelete("cascade"),
  unique("project_phases_project_sequence_unique").on(t.projectId, t.sequence),
  unique("project_phases_id_org_unique").on(t.id, t.organizationId),
  index("project_phases_project_idx").on(t.projectId),
]);

export const projectMilestones = pgTable("project_milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  phaseId: uuid("phase_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: projectMilestoneStatusEnum("status").notNull().default("planned"),
  targetDate: timestamp("target_date", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "project_milestones_project_org_fk",
    columns: [t.projectId, t.organizationId],
    foreignColumns: [projects.id, projects.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "project_milestones_phase_org_fk",
    columns: [t.phaseId, t.organizationId],
    foreignColumns: [projectPhases.id, projectPhases.organizationId],
  }).onDelete("set null"),
  unique("project_milestones_id_org_unique").on(t.id, t.organizationId),
  index("project_milestones_project_idx").on(t.projectId),
]);

export const projectTasks = pgTable("project_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  phaseId: uuid("phase_id"),
  milestoneId: uuid("milestone_id"),
  parentTaskId: uuid("parent_task_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: projectTaskStatusEnum("status").notNull().default("backlog"),
  priority: projectPriorityEnum("priority").notNull().default("normal"),
  // Free text, deliberately not a DB enum — "general"/"agent_report"/etc.
  // are validated at the application layer (the same "adding a new value
  // never needs ALTER TYPE" reasoning `accounts.provider`/`audit_logs.
  // event_type` already established for this codebase), never hardcoded
  // into the schema itself.
  taskType: text("task_type").notNull().default("general"),
  startDate: timestamp("start_date", { withTimezone: true }),
  dueDate: timestamp("due_date", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  position: integer("position").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "project_tasks_project_org_fk",
    columns: [t.projectId, t.organizationId],
    foreignColumns: [projects.id, projects.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "project_tasks_phase_org_fk",
    columns: [t.phaseId, t.organizationId],
    foreignColumns: [projectPhases.id, projectPhases.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "project_tasks_milestone_org_fk",
    columns: [t.milestoneId, t.organizationId],
    foreignColumns: [projectMilestones.id, projectMilestones.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "project_tasks_parent_org_fk",
    columns: [t.parentTaskId, t.organizationId],
    foreignColumns: [t.id, t.organizationId],
  }).onDelete("cascade"),
  unique("project_tasks_id_org_unique").on(t.id, t.organizationId),
  index("project_tasks_project_status_idx").on(t.projectId, t.status),
  index("project_tasks_parent_idx").on(t.parentTaskId),
]);

export const projectTaskAssignments = pgTable("project_task_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull(),
  // Human-only, by design — "do not represent agents as human project
  // members." Agent involvement in a task is represented entirely by
  // `project_execution_links` (a real Agent Runtime execution, which
  // itself already carries `assignedAgentId`/`assignedAgentVersionNumber`
  // through the Runtime's own Execution Context), never a row here.
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedByUserId: uuid("assigned_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "project_task_assignments_task_org_fk",
    columns: [t.taskId, t.organizationId],
    foreignColumns: [projectTasks.id, projectTasks.organizationId],
  }).onDelete("cascade"),
  unique("project_task_assignments_task_user_unique").on(t.taskId, t.userId),
  index("project_task_assignments_task_idx").on(t.taskId),
]);

/**
 * One canonical directed edge per row: `blockingTaskId` blocks
 * `blockedTaskId`. "blocks"/"blocked_by" are both derived by querying
 * from either column — never stored twice ("store one canonical directed
 * relationship and derive the inverse").
 */
export const projectTaskDependencies = pgTable("project_task_dependencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  blockedTaskId: uuid("blocked_task_id").notNull(),
  blockingTaskId: uuid("blocking_task_id").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "project_task_dependencies_blocked_org_fk",
    columns: [t.blockedTaskId, t.organizationId],
    foreignColumns: [projectTasks.id, projectTasks.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "project_task_dependencies_blocking_org_fk",
    columns: [t.blockingTaskId, t.organizationId],
    foreignColumns: [projectTasks.id, projectTasks.organizationId],
  }).onDelete("cascade"),
  unique("project_task_dependencies_edge_unique").on(t.blockedTaskId, t.blockingTaskId),
  check("project_task_dependencies_no_self_check", sql`${t.blockedTaskId} <> ${t.blockingTaskId}`),
  index("project_task_dependencies_blocked_idx").on(t.blockedTaskId),
  index("project_task_dependencies_blocking_idx").on(t.blockingTaskId),
]);

/**
 * User-facing operational history — deliberately distinct from
 * `audit_logs` (the security/compliance record). Append-only, bounded
 * metadata, never full task descriptions or artifact content.
 */
export const projectEvents = pgTable("project_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  eventType: text("event_type").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorAgentId: uuid("actor_agent_id").references(() => agents.id, { onDelete: "set null" }),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "project_events_project_org_fk",
    columns: [t.projectId, t.organizationId],
    foreignColumns: [projects.id, projects.organizationId],
  }).onDelete("cascade"),
  index("project_events_project_idx").on(t.projectId, t.createdAt),
]);

/** Typed references only — never a copy of artifact content. "An artifact may be linked to multiple project entities... but duplicate links must be prevented." */
export const projectArtifactLinks = pgTable("project_artifact_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  artifactId: uuid("artifact_id").notNull().references(() => agentArtifacts.id, { onDelete: "cascade" }),
  linkedEntityType: text("linked_entity_type").notNull(),
  linkedEntityId: uuid("linked_entity_id").notNull(),
  linkedByUserId: uuid("linked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "project_artifact_links_project_org_fk",
    columns: [t.projectId, t.organizationId],
    foreignColumns: [projects.id, projects.organizationId],
  }).onDelete("cascade"),
  unique("project_artifact_links_unique").on(t.artifactId, t.linkedEntityType, t.linkedEntityId),
  index("project_artifact_links_entity_idx").on(t.linkedEntityType, t.linkedEntityId),
]);

/** One project task launching one real Agent Runtime execution — never a parallel execution model. "Duplicate execution launch is prevented" is enforced at the service layer (refuses a new launch while an active one is already linked to the same task), not by this table's own constraints alone. */
export const projectExecutionLinks = pgTable("project_execution_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  taskId: uuid("task_id").notNull(),
  executionId: uuid("execution_id").notNull(),
  launchedByUserId: uuid("launched_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "project_execution_links_project_org_fk",
    columns: [t.projectId, t.organizationId],
    foreignColumns: [projects.id, projects.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "project_execution_links_task_org_fk",
    columns: [t.taskId, t.organizationId],
    foreignColumns: [projectTasks.id, projectTasks.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "project_execution_links_execution_org_fk",
    columns: [t.executionId, t.organizationId],
    foreignColumns: [agentExecutions.id, agentExecutions.organizationId],
  }).onDelete("cascade"),
  unique("project_execution_links_execution_unique").on(t.executionId),
  index("project_execution_links_task_idx").on(t.taskId),
]);

/** The Runtime approval record remains authoritative — this is a typed pointer only, never a duplicated decision. */
export const projectApprovalLinks = pgTable("project_approval_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  approvalRequestId: uuid("approval_request_id").notNull().references(() => agentApprovalRequests.id, { onDelete: "cascade" }),
  linkedEntityType: text("linked_entity_type").notNull(),
  linkedEntityId: uuid("linked_entity_id").notNull(),
  linkedByUserId: uuid("linked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "project_approval_links_project_org_fk",
    columns: [t.projectId, t.organizationId],
    foreignColumns: [projects.id, projects.organizationId],
  }).onDelete("cascade"),
  unique("project_approval_links_unique").on(t.approvalRequestId, t.linkedEntityType, t.linkedEntityId),
  index("project_approval_links_entity_idx").on(t.linkedEntityType, t.linkedEntityId),
]);

// =============================================================================
// Module 11 — Workflow Engine Core
// =============================================================================
// The Workflow Engine orchestrates existing systems (Agent Runtime, Tool
// Runtime, Projects Core, approvals, artifacts, the runtime queue) — it
// never duplicates their own tables. `agent_executions`, `tool_invocations`,
// `agent_approval_requests`, `agent_artifacts`, `project_tasks`, and
// `runtime_jobs` are all reused by reference (a nullable pointer column),
// never re-modeled here.

export const workflowDefinitionStatusEnum = pgEnum("workflow_definition_status", ["draft", "published", "paused", "archived"]);
export const workflowVersionStatusEnum = pgEnum("workflow_version_status", ["draft", "valid", "published", "superseded", "rejected"]);
export const workflowNodeTypeEnum = pgEnum("workflow_node_type", [
  "start",
  "end",
  "agent_execution",
  "tool_invocation",
  "human_task",
  "approval",
  "condition",
  "wait",
  "project_task",
  "artifact_transform",
]);
export const workflowExecutionStatusEnum = pgEnum("workflow_execution_status", ["queued", "running", "waiting", "waiting_for_approval", "paused", "completed", "failed", "cancelled"]);
export const workflowNodeExecutionStatusEnum = pgEnum("workflow_node_execution_status", ["pending", "ready", "running", "waiting", "succeeded", "failed", "skipped", "cancelled"]);
export const workflowHumanTaskStatusEnum = pgEnum("workflow_human_task_status", ["pending", "completed", "cancelled"]);

/** Stable identity and ownership — the definition itself never carries live graph structure; that lives entirely in its versions. */
export const workflowDefinitions = pgTable("workflow_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  workflowKey: text("workflow_key").notNull(),
  description: text("description"),
  status: workflowDefinitionStatusEnum("status").notNull().default("draft"),
  // Forward reference (lazy `AnyPgColumn` thunk — `workflow_versions` is
  // defined immediately below) to the one CURRENT published version, if
  // any. Single-column, not composite: `workflow_versions.id` is globally
  // unique via its own primary key, and every write path that sets this
  // column already resolved the version within this exact organization.
  currentPublishedVersionId: uuid("current_published_version_id").references((): AnyPgColumn => workflowVersions.id, { onDelete: "restrict" }),
  // "Support reusable templates as normal workflow definitions marked as
  // templates" — never a separate execution architecture; a template is
  // simply a definition an org may copy into a fresh draft.
  isTemplate: boolean("is_template").notNull().default(false),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "workflow_definitions_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  unique("workflow_definitions_org_key_unique").on(t.organizationId, t.workflowKey),
  unique("workflow_definitions_id_org_unique").on(t.id, t.organizationId),
  index("workflow_definitions_org_status_idx").on(t.organizationId, t.status),
]);

/**
 * Immutable once published — "editing a published workflow must create a
 * new draft version rather than mutate the version used by previous
 * executions." `inputSchema`/`outputSchema` are bounded JSON Schema-shaped
 * descriptions (never executable), `validationResult` is the structured
 * output of the last validation pass (node/edge references + messages,
 * never raw reasoning).
 */
export const workflowVersions = pgTable("workflow_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowDefinitionId: uuid("workflow_definition_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  status: workflowVersionStatusEnum("status").notNull().default("draft"),
  name: text("name").notNull(),
  description: text("description"),
  inputSchema: jsonb("input_schema"),
  outputSchema: jsonb("output_schema"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  changeReason: text("change_reason"),
  validationResult: jsonb("validation_result"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "workflow_versions_definition_org_fk",
    columns: [t.workflowDefinitionId, t.organizationId],
    foreignColumns: [workflowDefinitions.id, workflowDefinitions.organizationId],
  }).onDelete("cascade"),
  unique("workflow_versions_definition_number_unique").on(t.workflowDefinitionId, t.versionNumber),
  unique("workflow_versions_id_org_unique").on(t.id, t.organizationId),
  // "Only one current published version may exist for a workflow
  // definition" — a real, atomic Postgres constraint, not an application
  // convention: publishing a second version can never race its way past
  // this even under true concurrency.
  uniqueIndex("workflow_versions_one_published_unique").on(t.workflowDefinitionId).where(sql`${t.status} = 'published'`),
  index("workflow_versions_definition_idx").on(t.workflowDefinitionId),
]);

/**
 * Typed orchestration instructions — never arbitrary executable code.
 * `configuration` is validated against its `nodeType` at the application
 * layer (`src/lib/workflows/validation.ts`); this table itself places no
 * constraint on that JSON's shape beyond "valid JSON," matching the
 * `project_tasks.taskType`/`audit_logs.eventType` precedent of keeping
 * type-specific shape validation out of the schema layer.
 */
export const workflowNodes = pgTable("workflow_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowVersionId: uuid("workflow_version_id").notNull(),
  nodeKey: text("node_key").notNull(),
  nodeType: workflowNodeTypeEnum("node_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  configuration: jsonb("configuration").notNull().default({}),
  inputMapping: jsonb("input_mapping").notNull().default({}),
  outputMapping: jsonb("output_mapping").notNull().default({}),
  retryPolicy: jsonb("retry_policy").notNull().default({}),
  timeoutPolicy: jsonb("timeout_policy").notNull().default({}),
  positionX: integer("position_x").notNull().default(0),
  positionY: integer("position_y").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "workflow_nodes_version_org_fk",
    columns: [t.workflowVersionId, t.organizationId],
    foreignColumns: [workflowVersions.id, workflowVersions.organizationId],
  }).onDelete("cascade"),
  unique("workflow_nodes_version_key_unique").on(t.workflowVersionId, t.nodeKey),
  // Enables edges' own composite FK below — "no cross-version edge" is a
  // real, structural constraint (an edge's endpoints are FK'd to THIS
  // exact pair), never merely an application-level check.
  unique("workflow_nodes_id_version_unique").on(t.id, t.workflowVersionId),
  unique("workflow_nodes_id_org_unique").on(t.id, t.organizationId),
  index("workflow_nodes_version_idx").on(t.workflowVersionId),
]);

/** Directed graph edges — "no cross-version edge" enforced structurally (see `workflow_nodes_id_version_unique` above), "no self-edge" via `CHECK`, "no duplicate active edge" via the unique constraint below. */
export const workflowEdges = pgTable("workflow_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowVersionId: uuid("workflow_version_id").notNull(),
  sourceNodeId: uuid("source_node_id").notNull(),
  targetNodeId: uuid("target_node_id").notNull(),
  // Matches a `condition` node's branch value; null for an unconditional
  // (single-outgoing-edge) node.
  conditionKey: text("condition_key"),
  sequence: integer("sequence").notNull().default(0),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "workflow_edges_version_org_fk",
    columns: [t.workflowVersionId, t.organizationId],
    foreignColumns: [workflowVersions.id, workflowVersions.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "workflow_edges_source_version_fk",
    columns: [t.sourceNodeId, t.workflowVersionId],
    foreignColumns: [workflowNodes.id, workflowNodes.workflowVersionId],
  }).onDelete("cascade"),
  foreignKey({
    name: "workflow_edges_target_version_fk",
    columns: [t.targetNodeId, t.workflowVersionId],
    foreignColumns: [workflowNodes.id, workflowNodes.workflowVersionId],
  }).onDelete("cascade"),
  check("workflow_edges_no_self_edge_check", sql`${t.sourceNodeId} <> ${t.targetNodeId}`),
  // A plain 3-column unique constraint does NOT catch duplicates when
  // `conditionKey` is NULL — SQL's own NULL-is-distinct-from-NULL rule
  // means Postgres never considers two NULL-conditionKey rows equal for
  // uniqueness purposes. Two indexes: the non-null case via the ordinary
  // constraint, the NULL case via its own partial unique index.
  unique("workflow_edges_source_target_condition_unique").on(t.sourceNodeId, t.targetNodeId, t.conditionKey),
  uniqueIndex("workflow_edges_source_target_null_condition_unique").on(t.sourceNodeId, t.targetNodeId).where(sql`${t.conditionKey} IS NULL`),
  index("workflow_edges_source_idx").on(t.sourceNodeId),
  index("workflow_edges_target_idx").on(t.targetNodeId),
]);

/** A durable instance of one published workflow version. Always processed through the existing runtime queue/worker — never executed synchronously inside an HTTP route. */
export const workflowExecutions = pgTable("workflow_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  workflowDefinitionId: uuid("workflow_definition_id").notNull(),
  workflowVersionId: uuid("workflow_version_id").notNull(),
  status: workflowExecutionStatusEnum("status").notNull().default("queued"),
  initiatorUserId: uuid("initiator_user_id").references(() => users.id, { onDelete: "set null" }),
  // Single-column references (not the composite tenant-safe form), same
  // as `runtime_jobs.toolInvocationId`'s own precedent — deliberately:
  // a composite `[col, organizationId]` FK combined with `ON DELETE SET
  // NULL` would null out BOTH columns, including `organizationId` itself,
  // which is `NOT NULL` on this table. A single-column reference avoids
  // that failure mode entirely; the tenant-safety these columns would
  // have added is already redundant given `resolveWorkflowExecutionById`
  // always filters by `organizationId` explicitly on every read.
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  projectTaskId: uuid("project_task_id").references(() => projectTasks.id, { onDelete: "set null" }),
  // Bounded structured input the execution started with — never a large
  // blob; large content belongs in an artifact, referenced by id.
  input: jsonb("input").notNull().default({}),
  currentNodeId: uuid("current_node_id").references(() => workflowNodes.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  failureClassification: text("failure_classification"),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "workflow_executions_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "workflow_executions_definition_org_fk",
    columns: [t.workflowDefinitionId, t.organizationId],
    foreignColumns: [workflowDefinitions.id, workflowDefinitions.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "workflow_executions_version_org_fk",
    columns: [t.workflowVersionId, t.organizationId],
    foreignColumns: [workflowVersions.id, workflowVersions.organizationId],
  }).onDelete("restrict"),
  unique("workflow_executions_id_org_unique").on(t.id, t.organizationId),
  index("workflow_executions_org_status_idx").on(t.organizationId, t.status),
  index("workflow_executions_definition_idx").on(t.workflowDefinitionId),
  index("workflow_executions_project_idx").on(t.projectId),
]);

/**
 * Durable, per-attempt node execution state. "One logical node execution
 * must not run twice": `workflow_node_executions_attempt_unique` gives
 * every attempt its own permanent row (full retry history, nothing
 * overwritten), while the partial `workflow_node_executions_active_unique`
 * index below ensures at most one attempt is ever ACTIVE (non-terminal)
 * for a given node within a given execution at a time — the same
 * structural "two workers cannot claim the same work" guarantee
 * `project_execution_links`/`runtime_jobs` already rely on, applied here.
 */
export const workflowNodeExecutions = pgTable("workflow_node_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowExecutionId: uuid("workflow_execution_id").notNull(),
  workflowNodeId: uuid("workflow_node_id").notNull(),
  status: workflowNodeExecutionStatusEnum("status").notNull().default("pending"),
  attemptNumber: integer("attempt_number").notNull().default(1),
  input: jsonb("input"),
  output: jsonb("output"),
  // Single-column references — see `workflow_executions.projectId`'s own
  // comment above for why: a composite `[col, organizationId]` FK paired
  // with `ON DELETE SET NULL` would null out this row's own (`NOT NULL`)
  // `organizationId` too.
  runtimeExecutionId: uuid("runtime_execution_id").references(() => agentExecutions.id, { onDelete: "set null" }),
  toolInvocationId: uuid("tool_invocation_id").references(() => toolInvocations.id, { onDelete: "set null" }),
  approvalRequestId: uuid("approval_request_id").references(() => agentApprovalRequests.id, { onDelete: "set null" }),
  projectTaskId: uuid("project_task_id").references(() => projectTasks.id, { onDelete: "set null" }),
  artifactId: uuid("artifact_id").references(() => agentArtifacts.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failureClassification: text("failure_classification"),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "workflow_node_executions_execution_org_fk",
    columns: [t.workflowExecutionId, t.organizationId],
    foreignColumns: [workflowExecutions.id, workflowExecutions.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "workflow_node_executions_node_org_fk",
    columns: [t.workflowNodeId, t.organizationId],
    foreignColumns: [workflowNodes.id, workflowNodes.organizationId],
  }).onDelete("restrict"),
  unique("workflow_node_executions_attempt_unique").on(t.workflowExecutionId, t.workflowNodeId, t.attemptNumber),
  // Enables `workflow_human_tasks`'/`workflow_execution_events`' own composite tenant-safe FK back to a specific node execution.
  unique("workflow_node_executions_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("workflow_node_executions_active_unique")
    .on(t.workflowExecutionId, t.workflowNodeId)
    .where(sql`${t.status} IN ('pending', 'ready', 'running', 'waiting')`),
  index("workflow_node_executions_execution_idx").on(t.workflowExecutionId),
]);

/** A structured manual work item — never impersonates a project task unless explicitly linked via the owning node execution's own `projectTaskId`. */
export const workflowHumanTasks = pgTable("workflow_human_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowExecutionId: uuid("workflow_execution_id").notNull(),
  workflowNodeExecutionId: uuid("workflow_node_execution_id").notNull(),
  title: text("title").notNull(),
  instructions: text("instructions"),
  assignedUserId: uuid("assigned_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  dueDate: timestamp("due_date", { withTimezone: true }),
  status: workflowHumanTaskStatusEnum("status").notNull().default("pending"),
  completedByUserId: uuid("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  outputData: jsonb("output_data"),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "workflow_human_tasks_execution_org_fk",
    columns: [t.workflowExecutionId, t.organizationId],
    foreignColumns: [workflowExecutions.id, workflowExecutions.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "workflow_human_tasks_node_execution_org_fk",
    columns: [t.workflowNodeExecutionId, t.organizationId],
    foreignColumns: [workflowNodeExecutions.id, workflowNodeExecutions.organizationId],
  }).onDelete("cascade"),
  unique("workflow_human_tasks_node_execution_unique").on(t.workflowNodeExecutionId),
  index("workflow_human_tasks_assignee_status_idx").on(t.assignedUserId, t.status),
]);

/** User-facing operational timeline — deliberately distinct from `audit_logs`, mirroring `project_events`'s own split. Append-only, bounded metadata. */
export const workflowExecutionEvents = pgTable("workflow_execution_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowExecutionId: uuid("workflow_execution_id").notNull(),
  eventType: text("event_type").notNull(),
  workflowNodeId: uuid("workflow_node_id"),
  workflowNodeExecutionId: uuid("workflow_node_execution_id"),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorAgentId: uuid("actor_agent_id").references(() => agents.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "workflow_execution_events_execution_org_fk",
    columns: [t.workflowExecutionId, t.organizationId],
    foreignColumns: [workflowExecutions.id, workflowExecutions.organizationId],
  }).onDelete("cascade"),
  index("workflow_execution_events_execution_idx").on(t.workflowExecutionId, t.createdAt),
]);

// ---------------------------------------------------------------------------
// Module 12 — LYNQ CRM Core
// ---------------------------------------------------------------------------
// The canonical customer/prospect layer Sales OS, Marketing OS, Projects,
// Workflows, and Agents build on later — never a second contact/customer
// model inside any future module. Every table is tenant-scoped by a direct
// `organizationId` FK (`onDelete: cascade`); every child-of-a-CRM-record
// table uses the composite `(id, organizationId)` tenant-safe FK pattern
// established from Module 6 onward. CRM authorization
// (`src/lib/crm/authz.ts`) and CRM agent permission grants
// (`crmAgentPermissionGrants` below) are deliberately independent of Brain
// permission grants (Module 3/16) — an agent's Brain domain access never
// implies CRM PII access; see `MODULE_12_CRM_AUTHORIZATION_AND_PRIVACY.md`.

export const crmLifecycleStageEnum = pgEnum("crm_lifecycle_stage", [
  "subscriber",
  "lead",
  "qualified_lead",
  "opportunity",
  "customer",
  "former_customer",
  "partner",
  "other",
]);
export const crmRecordStatusEnum = pgEnum("crm_record_status", ["active", "archived"]);
export const crmContactCompanyRelationshipTypeEnum = pgEnum("crm_contact_company_relationship_type", [
  "employee",
  "owner",
  "decision_maker",
  "billing_contact",
  "technical_contact",
  "advisor",
  "partner_contact",
  "former_employee",
  "other",
]);
export const crmRelationshipStatusEnum = pgEnum("crm_relationship_status", ["active", "ended"]);
export const crmLeadStatusEnum = pgEnum("crm_lead_status", ["new", "contacted", "engaged", "qualified", "disqualified", "converted"]);
export const crmPipelineStatusEnum = pgEnum("crm_pipeline_status", ["active", "archived"]);
export const crmOpportunityStatusEnum = pgEnum("crm_opportunity_status", ["open", "won", "lost"]);
export const crmActivityTypeEnum = pgEnum("crm_activity_type", ["call", "email", "meeting", "message", "note", "form_submission", "website_event", "other"]);
export const crmActivityDirectionEnum = pgEnum("crm_activity_direction", ["inbound", "outbound", "internal"]);
export const crmFollowUpStatusEnum = pgEnum("crm_follow_up_status", ["open", "completed", "cancelled"]);
export const crmPriorityEnum = pgEnum("crm_priority", ["low", "normal", "high", "urgent"]);
export const crmCustomFieldEntityTypeEnum = pgEnum("crm_custom_field_entity_type", ["contact", "company", "lead", "opportunity"]);
export const crmCustomFieldTypeEnum = pgEnum("crm_custom_field_type", ["short_text", "long_text", "number", "boolean", "date", "datetime", "single_select", "multi_select"]);
export const crmSourceTypeEnum = pgEnum("crm_source_type", ["manual", "website", "referral", "event", "paid_search", "organic_search", "social", "partner", "import", "api", "other"]);
export const crmTagEntityTypeEnum = pgEnum("crm_tag_entity_type", ["contact", "company", "lead", "opportunity"]);
export const crmProjectLinkEntityTypeEnum = pgEnum("crm_project_link_entity_type", ["contact", "company", "opportunity"]);
export const crmAgentPermissionEnum = pgEnum("crm_agent_permission", [
  "crm_contact_read",
  "crm_company_read",
  "crm_lead_read",
  "crm_opportunity_read",
  "crm_activity_read",
  "crm_note_read",
]);

/** Organization-scoped source definitions. Seeded with the fixed built-in list; an org may add custom `other`-typed sources. Preserves trustworthy attribution data only — no Marketing attribution modeling here. */
export const crmSources = pgTable("crm_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull(),
  name: text("name").notNull(),
  sourceType: crmSourceTypeEnum("source_type").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  unique("crm_sources_org_key_unique").on(t.organizationId, t.sourceKey),
  unique("crm_sources_id_org_unique").on(t.id, t.organizationId),
]);

/** Canonical CRM contact (person). Email/phone are never required — `idempotencyKey` (import-ready, bounded) is the one real duplicate-prevention constraint; normalized email/phone are indexed for warning-only duplicate detection, never a hard uniqueness rule (over-aggressive auto-merge is explicitly out of scope). */
export const crmContacts = pgTable("crm_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  displayName: text("display_name").notNull(),
  primaryEmail: text("primary_email"),
  normalizedPrimaryEmail: text("normalized_primary_email"),
  primaryPhone: text("primary_phone"),
  normalizedPrimaryPhone: text("normalized_primary_phone"),
  jobTitle: text("job_title"),
  department: text("department"),
  lifecycleStage: crmLifecycleStageEnum("lifecycle_stage").notNull().default("lead"),
  status: crmRecordStatusEnum("status").notNull().default("active"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  sourceId: uuid("source_id"),
  idempotencyKey: text("idempotency_key"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "crm_contacts_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "crm_contacts_source_org_fk",
    columns: [t.sourceId, t.organizationId],
    foreignColumns: [crmSources.id, crmSources.organizationId],
  }).onDelete("set null"),
  unique("crm_contacts_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("crm_contacts_idempotency_unique").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  index("crm_contacts_org_email_idx").on(t.organizationId, t.normalizedPrimaryEmail),
  index("crm_contacts_org_phone_idx").on(t.organizationId, t.normalizedPrimaryPhone),
  index("crm_contacts_owner_idx").on(t.ownerUserId),
  index("crm_contacts_org_status_idx").on(t.organizationId, t.status),
]);

/** Canonical CRM company/account. Domain is never globally or even org-uniquely enforced — two records may legitimately share a parent domain (subsidiaries, franchises); domain is an index for search and a warning signal only. */
export const crmCompanies = pgTable("crm_companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  domain: text("domain"),
  normalizedDomain: text("normalized_domain"),
  website: text("website"),
  industry: text("industry"),
  employeeRange: text("employee_range"),
  annualRevenueRange: text("annual_revenue_range"),
  phone: text("phone"),
  address: jsonb("address"),
  lifecycleStage: crmLifecycleStageEnum("lifecycle_stage").notNull().default("lead"),
  status: crmRecordStatusEnum("status").notNull().default("active"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  sourceId: uuid("source_id"),
  idempotencyKey: text("idempotency_key"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "crm_companies_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "crm_companies_source_org_fk",
    columns: [t.sourceId, t.organizationId],
    foreignColumns: [crmSources.id, crmSources.organizationId],
  }).onDelete("set null"),
  unique("crm_companies_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("crm_companies_idempotency_unique").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  index("crm_companies_org_domain_idx").on(t.organizationId, t.normalizedDomain),
  index("crm_companies_owner_idx").on(t.ownerUserId),
  index("crm_companies_org_status_idx").on(t.organizationId, t.status),
]);

/** Many-to-many contact↔company relationship. At most one ACTIVE `isPrimary` company per contact; duplicate active relationships of the same type between the same pair are rejected. */
export const crmContactCompanyRelationships = pgTable("crm_contact_company_relationships", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull(),
  companyId: uuid("company_id").notNull(),
  relationshipType: crmContactCompanyRelationshipTypeEnum("relationship_type").notNull(),
  status: crmRelationshipStatusEnum("status").notNull().default("active"),
  isPrimary: boolean("is_primary").notNull().default(false),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "crm_contact_company_rel_contact_org_fk",
    columns: [t.contactId, t.organizationId],
    foreignColumns: [crmContacts.id, crmContacts.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "crm_contact_company_rel_company_org_fk",
    columns: [t.companyId, t.organizationId],
    foreignColumns: [crmCompanies.id, crmCompanies.organizationId],
  }).onDelete("cascade"),
  uniqueIndex("crm_contact_company_rel_active_unique").on(t.contactId, t.companyId, t.relationshipType).where(sql`${t.status} = 'active'`),
  uniqueIndex("crm_contact_company_rel_primary_unique").on(t.contactId).where(sql`${t.isPrimary} = true AND ${t.status} = 'active'`),
  index("crm_contact_company_rel_company_idx").on(t.companyId),
]);

/** Organization/workspace-scoped sales pipeline. `isDefault` is unique per organization (not per workspace) — the smallest useful scope; a workspace-scoped pipeline may still be marked default for the whole org. */
export const crmPipelines = pgTable("crm_pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  pipelineKey: text("pipeline_key").notNull(),
  description: text("description"),
  status: crmPipelineStatusEnum("status").notNull().default("active"),
  isDefault: boolean("is_default").notNull().default(false),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "crm_pipelines_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  unique("crm_pipelines_org_key_unique").on(t.organizationId, t.pipelineKey),
  unique("crm_pipelines_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("crm_pipelines_org_default_unique").on(t.organizationId).where(sql`${t.isDefault} = true`),
]);

/** Pipeline stage. Gap-based `sequence` (1000-increments, same reorder pattern `project_phases.sequence` established). `isWon`/`isLost` always imply `isClosed`; a stage can never be both won and lost. */
export const crmPipelineStages = pgTable("crm_pipeline_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  pipelineId: uuid("pipeline_id").notNull(),
  name: text("name").notNull(),
  stageKey: text("stage_key").notNull(),
  sequence: integer("sequence").notNull(),
  stageType: text("stage_type"),
  probability: integer("probability"),
  isClosed: boolean("is_closed").notNull().default(false),
  isWon: boolean("is_won").notNull().default(false),
  isLost: boolean("is_lost").notNull().default(false),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "crm_pipeline_stages_pipeline_org_fk",
    columns: [t.pipelineId, t.organizationId],
    foreignColumns: [crmPipelines.id, crmPipelines.organizationId],
  }).onDelete("cascade"),
  unique("crm_pipeline_stages_pipeline_key_unique").on(t.pipelineId, t.stageKey),
  unique("crm_pipeline_stages_pipeline_sequence_unique").on(t.pipelineId, t.sequence),
  unique("crm_pipeline_stages_id_org_unique").on(t.id, t.organizationId),
  unique("crm_pipeline_stages_id_pipeline_unique").on(t.id, t.pipelineId),
  check("crm_pipeline_stages_won_lost_exclusive_check", sql`NOT (${t.isWon} AND ${t.isLost})`),
  check("crm_pipeline_stages_won_lost_implies_closed_check", sql`(NOT (${t.isWon} OR ${t.isLost})) OR ${t.isClosed}`),
]);

/** Canonical opportunity/deal. State (`open`/`won`/`lost`) is derived from the stage moved into, never set independently — see `src/lib/crm/opportunities.ts`. A closed opportunity requires the explicit `reopenOpportunity` operation; it never silently reopens via an ordinary stage move. */
export const crmOpportunities = pgTable("crm_opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  pipelineId: uuid("pipeline_id").notNull(),
  stageId: uuid("stage_id").notNull(),
  name: text("name").notNull(),
  primaryContactId: uuid("primary_contact_id"),
  companyId: uuid("company_id"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 14, scale: 2 }),
  currency: text("currency"),
  expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
  probabilityOverride: integer("probability_override"),
  sourceId: uuid("source_id"),
  status: crmOpportunityStatusEnum("status").notNull().default("open"),
  lostReason: text("lost_reason"),
  wonAt: timestamp("won_at", { withTimezone: true }),
  lostAt: timestamp("lost_at", { withTimezone: true }),
  idempotencyKey: text("idempotency_key"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "crm_opportunities_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "crm_opportunities_pipeline_org_fk",
    columns: [t.pipelineId, t.organizationId],
    foreignColumns: [crmPipelines.id, crmPipelines.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "crm_opportunities_stage_pipeline_fk",
    columns: [t.stageId, t.pipelineId],
    foreignColumns: [crmPipelineStages.id, crmPipelineStages.pipelineId],
  }).onDelete("restrict"),
  foreignKey({
    name: "crm_opportunities_contact_org_fk",
    columns: [t.primaryContactId, t.organizationId],
    foreignColumns: [crmContacts.id, crmContacts.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "crm_opportunities_company_org_fk",
    columns: [t.companyId, t.organizationId],
    foreignColumns: [crmCompanies.id, crmCompanies.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "crm_opportunities_source_org_fk",
    columns: [t.sourceId, t.organizationId],
    foreignColumns: [crmSources.id, crmSources.organizationId],
  }).onDelete("set null"),
  unique("crm_opportunities_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("crm_opportunities_idempotency_unique").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  index("crm_opportunities_pipeline_stage_idx").on(t.pipelineId, t.stageId),
  index("crm_opportunities_owner_idx").on(t.ownerUserId),
  index("crm_opportunities_org_status_idx").on(t.organizationId, t.status),
  check("crm_opportunities_lost_reason_check", sql`${t.status} <> 'lost' OR ${t.lostReason} IS NOT NULL`),
]);

/** Explicit lead-qualification object — never merely a contact status. `convertedOpportunityId` is set exactly once, by the one idempotent `convertLead` operation. */
export const crmLeads = pgTable("crm_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id"),
  companyId: uuid("company_id"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  sourceId: uuid("source_id"),
  status: crmLeadStatusEnum("status").notNull().default("new"),
  score: integer("score"),
  estimatedValueAmount: numeric("estimated_value_amount", { precision: 14, scale: 2 }),
  estimatedValueCurrency: text("estimated_value_currency"),
  qualificationNotes: text("qualification_notes"),
  nextAction: text("next_action"),
  convertedOpportunityId: uuid("converted_opportunity_id"),
  idempotencyKey: text("idempotency_key"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  disqualifiedAt: timestamp("disqualified_at", { withTimezone: true }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "crm_leads_contact_org_fk",
    columns: [t.contactId, t.organizationId],
    foreignColumns: [crmContacts.id, crmContacts.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "crm_leads_company_org_fk",
    columns: [t.companyId, t.organizationId],
    foreignColumns: [crmCompanies.id, crmCompanies.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "crm_leads_source_org_fk",
    columns: [t.sourceId, t.organizationId],
    foreignColumns: [crmSources.id, crmSources.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "crm_leads_opportunity_org_fk",
    columns: [t.convertedOpportunityId, t.organizationId],
    foreignColumns: [crmOpportunities.id, crmOpportunities.organizationId],
  }).onDelete("set null"),
  unique("crm_leads_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("crm_leads_idempotency_unique").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  index("crm_leads_owner_status_idx").on(t.ownerUserId, t.status),
  index("crm_leads_contact_idx").on(t.contactId),
  index("crm_leads_company_idx").on(t.companyId),
]);

/** Customer/prospect interaction history — append-only by construction: no update service function exists for this table, only create + list. Never stores raw email bodies/call recordings; a future integration stores content separately and references it via `externalReference`. */
export const crmActivities = pgTable("crm_activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id"),
  companyId: uuid("company_id"),
  leadId: uuid("lead_id"),
  opportunityId: uuid("opportunity_id"),
  activityType: crmActivityTypeEnum("activity_type").notNull(),
  direction: crmActivityDirectionEnum("direction"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  subject: text("subject"),
  summary: text("summary"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  agentId: uuid("agent_id"),
  externalReference: text("external_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "crm_activities_contact_org_fk",
    columns: [t.contactId, t.organizationId],
    foreignColumns: [crmContacts.id, crmContacts.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "crm_activities_company_org_fk",
    columns: [t.companyId, t.organizationId],
    foreignColumns: [crmCompanies.id, crmCompanies.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "crm_activities_lead_org_fk",
    columns: [t.leadId, t.organizationId],
    foreignColumns: [crmLeads.id, crmLeads.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "crm_activities_opportunity_org_fk",
    columns: [t.opportunityId, t.organizationId],
    foreignColumns: [crmOpportunities.id, crmOpportunities.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "crm_activities_agent_org_fk",
    columns: [t.agentId, t.organizationId],
    foreignColumns: [agents.id, agents.organizationId],
  }).onDelete("set null"),
  index("crm_activities_contact_idx").on(t.contactId, t.occurredAt),
  index("crm_activities_company_idx").on(t.companyId, t.occurredAt),
  index("crm_activities_lead_idx").on(t.leadId, t.occurredAt),
  index("crm_activities_opportunity_idx").on(t.opportunityId, t.occurredAt),
  check("crm_activities_target_check", sql`${t.contactId} IS NOT NULL OR ${t.companyId} IS NOT NULL OR ${t.leadId} IS NOT NULL OR ${t.opportunityId} IS NOT NULL`),
]);

/** Internal CRM notes — never exposed through public/unauthenticated APIs, never copied into audit metadata. Editable (bounded revision-guarded update) and archivable, unlike activities. */
export const crmNotes = pgTable("crm_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id"),
  companyId: uuid("company_id"),
  leadId: uuid("lead_id"),
  opportunityId: uuid("opportunity_id"),
  authorUserId: uuid("author_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  content: text("content").notNull(),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "crm_notes_contact_org_fk",
    columns: [t.contactId, t.organizationId],
    foreignColumns: [crmContacts.id, crmContacts.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "crm_notes_company_org_fk",
    columns: [t.companyId, t.organizationId],
    foreignColumns: [crmCompanies.id, crmCompanies.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "crm_notes_lead_org_fk",
    columns: [t.leadId, t.organizationId],
    foreignColumns: [crmLeads.id, crmLeads.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "crm_notes_opportunity_org_fk",
    columns: [t.opportunityId, t.organizationId],
    foreignColumns: [crmOpportunities.id, crmOpportunities.organizationId],
  }).onDelete("cascade"),
  index("crm_notes_contact_idx").on(t.contactId, t.createdAt),
  index("crm_notes_company_idx").on(t.companyId, t.createdAt),
  index("crm_notes_lead_idx").on(t.leadId, t.createdAt),
  index("crm_notes_opportunity_idx").on(t.opportunityId, t.createdAt),
  check("crm_notes_target_check", sql`${t.contactId} IS NOT NULL OR ${t.companyId} IS NOT NULL OR ${t.leadId} IS NOT NULL OR ${t.opportunityId} IS NOT NULL`),
]);

/** Customer-facing sales/service follow-up — deliberately distinct from `project_tasks` (operational project work) and `workflow_human_tasks` (workflow execution work). Never reuses either. */
export const crmFollowUps = pgTable("crm_follow_ups", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id"),
  companyId: uuid("company_id"),
  leadId: uuid("lead_id"),
  opportunityId: uuid("opportunity_id"),
  assignedUserId: uuid("assigned_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: crmFollowUpStatusEnum("status").notNull().default("open"),
  priority: crmPriorityEnum("priority").notNull().default("normal"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "crm_follow_ups_contact_org_fk",
    columns: [t.contactId, t.organizationId],
    foreignColumns: [crmContacts.id, crmContacts.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "crm_follow_ups_company_org_fk",
    columns: [t.companyId, t.organizationId],
    foreignColumns: [crmCompanies.id, crmCompanies.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "crm_follow_ups_lead_org_fk",
    columns: [t.leadId, t.organizationId],
    foreignColumns: [crmLeads.id, crmLeads.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "crm_follow_ups_opportunity_org_fk",
    columns: [t.opportunityId, t.organizationId],
    foreignColumns: [crmOpportunities.id, crmOpportunities.organizationId],
  }).onDelete("cascade"),
  index("crm_follow_ups_assignee_status_idx").on(t.assignedUserId, t.status),
  index("crm_follow_ups_due_idx").on(t.dueAt),
  check("crm_follow_ups_target_check", sql`${t.contactId} IS NOT NULL OR ${t.companyId} IS NOT NULL OR ${t.leadId} IS NOT NULL OR ${t.opportunityId} IS NOT NULL`),
]);

/** Organization-scoped CRM tags. Assignment is untyped-FK-safe via `entityType`+`entityId` (validated tenant-safe at the service layer, same polymorphic-pointer precedent `project_artifact_links` already established) — never a global cross-tenant tag. */
export const crmTags = pgTable("crm_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tagKey: text("tag_key").notNull(),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("crm_tags_org_key_unique").on(t.organizationId, t.tagKey),
  unique("crm_tags_id_org_unique").on(t.id, t.organizationId),
]);

export const crmTagAssignments = pgTable("crm_tag_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull(),
  entityType: crmTagEntityTypeEnum("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  assignedByUserId: uuid("assigned_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "crm_tag_assignments_tag_org_fk",
    columns: [t.tagId, t.organizationId],
    foreignColumns: [crmTags.id, crmTags.organizationId],
  }).onDelete("cascade"),
  unique("crm_tag_assignments_unique").on(t.tagId, t.entityType, t.entityId),
  index("crm_tag_assignments_entity_idx").on(t.entityType, t.entityId),
]);

/** Custom-field foundation — deliberately NOT a dynamic schema engine. Field types are a fixed, closed list; `validationRules` stores only bounded metadata (min/max/pattern/maxLength), never code, SQL, or a formula. */
export const crmCustomFieldDefinitions = pgTable("crm_custom_field_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entityType: crmCustomFieldEntityTypeEnum("entity_type").notNull(),
  fieldKey: text("field_key").notNull(),
  label: text("label").notNull(),
  fieldType: crmCustomFieldTypeEnum("field_type").notNull(),
  isRequired: boolean("is_required").notNull().default(false),
  options: jsonb("options"),
  validationRules: jsonb("validation_rules"),
  sequence: integer("sequence").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  unique("crm_custom_field_definitions_org_key_unique").on(t.organizationId, t.entityType, t.fieldKey),
  unique("crm_custom_field_definitions_id_org_unique").on(t.id, t.organizationId),
]);

export const crmCustomFieldValues = pgTable("crm_custom_field_values", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  fieldDefinitionId: uuid("field_definition_id").notNull(),
  entityType: crmCustomFieldEntityTypeEnum("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  value: jsonb("value"),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "crm_custom_field_values_definition_org_fk",
    columns: [t.fieldDefinitionId, t.organizationId],
    foreignColumns: [crmCustomFieldDefinitions.id, crmCustomFieldDefinitions.organizationId],
  }).onDelete("cascade"),
  unique("crm_custom_field_values_unique").on(t.fieldDefinitionId, t.entityId),
  index("crm_custom_field_values_entity_idx").on(t.entityType, t.entityId),
]);

/** Typed CRM↔Projects link — never duplicates project data inside CRM. Mirrors `project_artifact_links`'s own typed-pointer pattern exactly. */
export const crmProjectLinks = pgTable("crm_project_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  crmEntityType: crmProjectLinkEntityTypeEnum("crm_entity_type").notNull(),
  crmEntityId: uuid("crm_entity_id").notNull(),
  linkedByUserId: uuid("linked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "crm_project_links_project_org_fk",
    columns: [t.projectId, t.organizationId],
    foreignColumns: [projects.id, projects.organizationId],
  }).onDelete("cascade"),
  unique("crm_project_links_unique").on(t.projectId, t.crmEntityType, t.crmEntityId),
  index("crm_project_links_entity_idx").on(t.crmEntityType, t.crmEntityId),
]);

/** Narrow, explicit, default-deny CRM read grants for agents — structurally separate from `brainPermissionGrants`. An agent's Brain domain access never implies any of these. Organization-scoped only in this phase (the smallest safe interim authority); revocation is soft (`revokedAt`), never a row delete, so the grant history stays auditable. */
export const crmAgentPermissionGrants = pgTable("crm_agent_permission_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull(),
  permission: crmAgentPermissionEnum("permission").notNull(),
  grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "crm_agent_permission_grants_agent_org_fk",
    columns: [t.agentId, t.organizationId],
    foreignColumns: [agents.id, agents.organizationId],
  }).onDelete("cascade"),
  uniqueIndex("crm_agent_permission_grants_active_unique").on(t.organizationId, t.agentId, t.permission).where(sql`${t.revokedAt} IS NULL`),
  index("crm_agent_permission_grants_agent_idx").on(t.agentId),
]);

// =============================================================================
// Sales OS — Module 13
// =============================================================================
// Sales OS is the operational layer on top of CRM Core (Module 12). It NEVER
// duplicates crm_leads/crm_opportunities/crm_pipelines/crm_follow_ups/
// crm_activities/crm_notes — every table below either (a) configures how
// Sales OS operates on those existing CRM records, or (b) tracks Sales-OS-
// -specific process state (playbook execution, sequencing, targets) that
// points AT a CRM record by id rather than re-storing it. Lead queues,
// next-best-actions, the sales work queue, opportunity health, forecasting,
// and analytics are all deliberately NOT tables — they are deterministic
// queries computed at read time (see src/lib/sales-os/*), per this module's
// own "avoid tables for derived data where a deterministic query is enough"
// instruction.

export const salesLeadAssignmentStrategyEnum = pgEnum("sales_lead_assignment_strategy", ["manual", "round_robin", "least_open_leads"]);
export const salesForecastingModeEnum = pgEnum("sales_forecasting_mode", ["stage_probability"]);
export const salesTeamMemberRoleEnum = pgEnum("sales_team_member_role", ["manager", "rep", "viewer"]);
export const salesRoleEnum = pgEnum("sales_role", ["sales_admin", "sales_manager", "sales_rep", "viewer"]);
export const salesPlaybookTypeEnum = pgEnum("sales_playbook_type", ["lead_qualification", "opportunity", "follow_up"]);
export const salesPlaybookLifecycleEnum = pgEnum("sales_playbook_lifecycle", ["draft", "published", "archived"]);
export const salesPlaybookVersionStatusEnum = pgEnum("sales_playbook_version_status", ["draft", "published", "superseded"]);
export const salesPlaybookStepTypeEnum = pgEnum("sales_playbook_step_type", [
  "checklist",
  "collect_information",
  "crm_activity_required",
  "follow_up_required",
  "workflow",
  "approval",
  "artifact_required",
  "stage_recommendation",
  "manual_decision",
]);
export const salesQualificationRunStatusEnum = pgEnum("sales_qualification_run_status", ["not_started", "in_progress", "waiting", "qualified", "disqualified", "abandoned"]);
export const salesChecklistItemStatusEnum = pgEnum("sales_checklist_item_status", ["pending", "complete", "skipped"]);
export const salesOpportunityPlaybookRunStatusEnum = pgEnum("sales_opportunity_playbook_run_status", ["active", "completed", "abandoned"]);
export const salesSequenceTargetTypeEnum = pgEnum("sales_sequence_target_type", ["lead", "opportunity"]);
export const salesSequenceLifecycleEnum = pgEnum("sales_sequence_lifecycle", ["draft", "published", "archived"]);
export const salesSequenceVersionStatusEnum = pgEnum("sales_sequence_version_status", ["draft", "published", "superseded"]);
// Module 16 added "communication_draft" — a Sales sequence step may create
// a real outbound Communications OS draft message (never send directly;
// see `communications-os/sales-integration.ts`). Additive only — the
// existing 4 values and every step that uses them are unchanged.
export const salesSequenceStepActionTypeEnum = pgEnum("sales_sequence_step_action_type", ["crm_follow_up", "workflow_human_task", "approval_request", "internal_reminder", "communication_draft"]);
export const salesEnrollmentStatusEnum = pgEnum("sales_enrollment_status", ["active", "completed", "stopped", "cancelled"]);
export const salesStepRunStatusEnum = pgEnum("sales_step_run_status", ["pending", "completed", "skipped"]);
export const salesApprovalLinkedEntityTypeEnum = pgEnum("sales_approval_linked_entity_type", ["lead", "opportunity", "qualification_run", "opportunity_playbook_run"]);
export const salesTargetScopeTypeEnum = pgEnum("sales_target_scope_type", ["individual", "team"]);
export const salesTargetMetricTypeEnum = pgEnum("sales_target_metric_type", ["won_revenue", "opportunities_won", "leads_qualified", "activities_completed"]);
export const salesForecastCategoryEnum = pgEnum("sales_forecast_category", ["pipeline", "best_case", "commit", "closed"]);

/** One config row per organization, or per (organization, workspace) pair. Never fabricates fields for hypothetical features. */
export const salesConfigurations = pgTable("sales_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  defaultPipelineId: uuid("default_pipeline_id"),
  businessTimezone: text("business_timezone").notNull().default("UTC"),
  currency: text("currency").notNull().default("USD"),
  defaultLeadAssignmentStrategy: salesLeadAssignmentStrategyEnum("default_lead_assignment_strategy").notNull().default("manual"),
  defaultQualificationPlaybookId: uuid("default_qualification_playbook_id"),
  defaultOpportunityPlaybookId: uuid("default_opportunity_playbook_id"),
  staleLeadThresholdDays: integer("stale_lead_threshold_days").notNull().default(7),
  staleOpportunityThresholdDays: integer("stale_opportunity_threshold_days").notNull().default(14),
  forecastingMode: salesForecastingModeEnum("forecasting_mode").notNull().default("stage_probability"),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_configurations_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  uniqueIndex("sales_configurations_org_only_unique").on(t.organizationId).where(sql`${t.workspaceId} IS NULL`),
  uniqueIndex("sales_configurations_org_workspace_unique").on(t.organizationId, t.workspaceId).where(sql`${t.workspaceId} IS NOT NULL`),
]);

/** Operational grouping only — never confers CRM authority by itself. See sales_role_assignments for actual Sales OS capability grants. */
export const salesTeams = pgTable("sales_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  teamKey: text("team_key").notNull(),
  description: text("description"),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_teams_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  unique("sales_teams_org_key_unique").on(t.organizationId, t.teamKey),
  unique("sales_teams_id_org_unique").on(t.id, t.organizationId),
]);

/** A user's function within one specific team (reporting/grouping only). A member must already be an eligible org/workspace member — enforced at the service layer, not by an FK, since eligibility depends on workspace scope. */
export const salesTeamMembers = pgTable("sales_team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  teamRole: salesTeamMemberRoleEnum("team_role").notNull().default("rep"),
  isActive: boolean("is_active").notNull().default(true),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_team_members_team_org_fk",
    columns: [t.teamId, t.organizationId],
    foreignColumns: [salesTeams.id, salesTeams.organizationId],
  }).onDelete("cascade"),
  unique("sales_team_members_team_user_unique").on(t.teamId, t.userId),
  index("sales_team_members_user_idx").on(t.userId),
]);

/**
 * The Sales OS capability role — completely independent from CRM/Brain/
 * Workflow/Projects roles. One active role per user per organization;
 * capabilities are derived from `role` via a static map in
 * src/lib/sales-os/authz.ts, never stored per-grant ("map capabilities
 * rather than relying only on role labels" while still keeping the
 * storage model the smallest safe one — a single role column). Soft-
 * revoked, never deleted, so the grant history stays auditable.
 */
export const salesRoleAssignments = pgTable("sales_role_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: salesRoleEnum("role").notNull(),
  grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  uniqueIndex("sales_role_assignments_active_unique").on(t.organizationId, t.userId).where(sql`${t.revokedAt} IS NULL`),
  index("sales_role_assignments_user_idx").on(t.userId),
]);

/** Stable playbook identity — versions carry the actual structured process. */
export const salesPlaybooks = pgTable("sales_playbooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  playbookKey: text("playbook_key").notNull(),
  playbookType: salesPlaybookTypeEnum("playbook_type").notNull(),
  lifecycle: salesPlaybookLifecycleEnum("lifecycle").notNull().default("draft"),
  currentPublishedVersionId: uuid("current_published_version_id"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_playbooks_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  unique("sales_playbooks_org_key_unique").on(t.organizationId, t.playbookKey),
  unique("sales_playbooks_id_org_unique").on(t.id, t.organizationId),
]);

/** Immutable once published — a playbook version is never edited in place after publish, mirroring Workflow Engine's own version model. */
export const salesPlaybookVersions = pgTable("sales_playbook_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  playbookId: uuid("playbook_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  status: salesPlaybookVersionStatusEnum("status").notNull().default("draft"),
  changeReason: text("change_reason"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_playbook_versions_playbook_org_fk",
    columns: [t.playbookId, t.organizationId],
    foreignColumns: [salesPlaybooks.id, salesPlaybooks.organizationId],
  }).onDelete("cascade"),
  unique("sales_playbook_versions_playbook_number_unique").on(t.playbookId, t.versionNumber),
  unique("sales_playbook_versions_id_org_unique").on(t.id, t.organizationId),
  unique("sales_playbook_versions_id_playbook_unique").on(t.id, t.playbookId),
]);

/** A single structured step within a playbook version — never an executable script/prompt, only bounded structured configuration. */
export const salesPlaybookSteps = pgTable("sales_playbook_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  playbookVersionId: uuid("playbook_version_id").notNull(),
  stepKey: text("step_key").notNull(),
  stepType: salesPlaybookStepTypeEnum("step_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  sequence: integer("sequence").notNull(),
  configuration: jsonb("configuration").notNull().default({}),
  required: boolean("required").notNull().default(true),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_playbook_steps_version_org_fk",
    columns: [t.playbookVersionId, t.organizationId],
    foreignColumns: [salesPlaybookVersions.id, salesPlaybookVersions.organizationId],
  }).onDelete("cascade"),
  unique("sales_playbook_steps_version_key_unique").on(t.playbookVersionId, t.stepKey),
  unique("sales_playbook_steps_version_sequence_unique").on(t.playbookVersionId, t.sequence),
]);

/**
 * Documents HOW a lead qualification decision was reached — the CRM lead
 * (`crm_leads.status`) remains the sole authoritative qualification state.
 * This table never re-implements qualify/disqualify; it calls the existing
 * CRM service and records the playbook trail alongside. Only one
 * non-terminal run per lead at a time (partial unique index below).
 */
export const salesLeadQualificationRuns = pgTable("sales_lead_qualification_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull(),
  playbookVersionId: uuid("playbook_version_id").notNull(),
  assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  status: salesQualificationRunStatusEnum("status").notNull().default("not_started"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  missingInformation: jsonb("missing_information").notNull().default([]),
  workflowExecutionId: uuid("workflow_execution_id").references(() => workflowExecutions.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_lead_qualification_runs_lead_org_fk",
    columns: [t.leadId, t.organizationId],
    foreignColumns: [crmLeads.id, crmLeads.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "sales_lead_qualification_runs_version_org_fk",
    columns: [t.playbookVersionId, t.organizationId],
    foreignColumns: [salesPlaybookVersions.id, salesPlaybookVersions.organizationId],
  }).onDelete("restrict"),
  unique("sales_lead_qualification_runs_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("sales_lead_qualification_runs_active_unique").on(t.leadId).where(sql`${t.status} IN ('not_started','in_progress','waiting')`),
  index("sales_lead_qualification_runs_assignee_idx").on(t.assignedUserId, t.status),
]);

/** One row per playbook step for a given qualification run — the checklist progress. */
export const salesLeadQualificationItems = pgTable("sales_lead_qualification_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  qualificationRunId: uuid("qualification_run_id").notNull(),
  playbookStepId: uuid("playbook_step_id").notNull().references(() => salesPlaybookSteps.id, { onDelete: "cascade" }),
  status: salesChecklistItemStatusEnum("status").notNull().default("pending"),
  completedByUserId: uuid("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  evidenceActivityId: uuid("evidence_activity_id"),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_lead_qualification_items_run_org_fk",
    columns: [t.qualificationRunId, t.organizationId],
    foreignColumns: [salesLeadQualificationRuns.id, salesLeadQualificationRuns.organizationId],
  }).onDelete("cascade"),
  unique("sales_lead_qualification_items_run_step_unique").on(t.qualificationRunId, t.playbookStepId),
]);

/**
 * Operational playbook execution for an existing CRM opportunity. The
 * opportunity's CRM `stageId`/`status` remain solely authoritative — this
 * table tracks progress against the playbook and may only *recommend* a
 * stage move (see stage_recommendation step type); it never writes the
 * CRM stage itself. Only one active run per opportunity at a time.
 */
export const salesOpportunityPlaybookRuns = pgTable("sales_opportunity_playbook_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id").notNull(),
  playbookVersionId: uuid("playbook_version_id").notNull(),
  assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  status: salesOpportunityPlaybookRunStatusEnum("status").notNull().default("active"),
  currentStepId: uuid("current_step_id").references(() => salesPlaybookSteps.id, { onDelete: "set null" }),
  lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_opportunity_playbook_runs_opp_org_fk",
    columns: [t.opportunityId, t.organizationId],
    foreignColumns: [crmOpportunities.id, crmOpportunities.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "sales_opportunity_playbook_runs_version_org_fk",
    columns: [t.playbookVersionId, t.organizationId],
    foreignColumns: [salesPlaybookVersions.id, salesPlaybookVersions.organizationId],
  }).onDelete("restrict"),
  unique("sales_opportunity_playbook_runs_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("sales_opportunity_playbook_runs_active_unique").on(t.opportunityId).where(sql`${t.status} = 'active'`),
  index("sales_opportunity_playbook_runs_assignee_idx").on(t.assignedUserId, t.status),
]);

export const salesOpportunityPlaybookItems = pgTable("sales_opportunity_playbook_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  opportunityPlaybookRunId: uuid("opportunity_playbook_run_id").notNull(),
  playbookStepId: uuid("playbook_step_id").notNull().references(() => salesPlaybookSteps.id, { onDelete: "cascade" }),
  status: salesChecklistItemStatusEnum("status").notNull().default("pending"),
  completedByUserId: uuid("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  evidenceActivityId: uuid("evidence_activity_id"),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_opportunity_playbook_items_run_org_fk",
    columns: [t.opportunityPlaybookRunId, t.organizationId],
    foreignColumns: [salesOpportunityPlaybookRuns.id, salesOpportunityPlaybookRuns.organizationId],
  }).onDelete("cascade"),
  unique("sales_opportunity_playbook_items_run_step_unique").on(t.opportunityPlaybookRunId, t.playbookStepId),
]);

/** Stable follow-up sequence identity — versions carry the actual day-offset step plan. */
export const salesFollowUpSequences = pgTable("sales_follow_up_sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  sequenceKey: text("sequence_key").notNull(),
  targetType: salesSequenceTargetTypeEnum("target_type").notNull(),
  lifecycle: salesSequenceLifecycleEnum("lifecycle").notNull().default("draft"),
  currentPublishedVersionId: uuid("current_published_version_id"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_follow_up_sequences_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  unique("sales_follow_up_sequences_org_key_unique").on(t.organizationId, t.sequenceKey),
  unique("sales_follow_up_sequences_id_org_unique").on(t.id, t.organizationId),
]);

export const salesFollowUpSequenceVersions = pgTable("sales_follow_up_sequence_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sequenceId: uuid("sequence_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  status: salesSequenceVersionStatusEnum("status").notNull().default("draft"),
  changeReason: text("change_reason"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_follow_up_sequence_versions_seq_org_fk",
    columns: [t.sequenceId, t.organizationId],
    foreignColumns: [salesFollowUpSequences.id, salesFollowUpSequences.organizationId],
  }).onDelete("cascade"),
  unique("sales_follow_up_sequence_versions_seq_number_unique").on(t.sequenceId, t.versionNumber),
  unique("sales_follow_up_sequence_versions_id_org_unique").on(t.id, t.organizationId),
  unique("sales_follow_up_sequence_versions_id_seq_unique").on(t.id, t.sequenceId),
]);

/** A day-offset-from-enrollment step. Never sends real email/SMS/WhatsApp — actionType is bounded to internal, CRM-native, or workflow/approval actions only. */
export const salesFollowUpSequenceSteps = pgTable("sales_follow_up_sequence_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sequenceVersionId: uuid("sequence_version_id").notNull(),
  stepKey: text("step_key").notNull(),
  dayOffset: integer("day_offset").notNull(),
  actionType: salesSequenceStepActionTypeEnum("action_type").notNull(),
  title: text("title").notNull(),
  instructions: text("instructions"),
  sequence: integer("sequence").notNull(),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_follow_up_sequence_steps_version_org_fk",
    columns: [t.sequenceVersionId, t.organizationId],
    foreignColumns: [salesFollowUpSequenceVersions.id, salesFollowUpSequenceVersions.organizationId],
  }).onDelete("cascade"),
  unique("sales_follow_up_sequence_steps_version_key_unique").on(t.sequenceVersionId, t.stepKey),
  unique("sales_follow_up_sequence_steps_version_sequence_unique").on(t.sequenceVersionId, t.sequence),
]);

/** One active enrollment per target record — enforced by the partial unique index. Advancing survives worker restarts because progress is derived from `sales_sequence_step_runs`, never in-memory state. */
export const salesSequenceEnrollments = pgTable("sales_sequence_enrollments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sequenceVersionId: uuid("sequence_version_id").notNull(),
  targetType: salesSequenceTargetTypeEnum("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  enrolledByUserId: uuid("enrolled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  status: salesEnrollmentStatusEnum("status").notNull().default("active"),
  nextStepDueAt: timestamp("next_step_due_at", { withTimezone: true }),
  stoppedReason: text("stopped_reason"),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_sequence_enrollments_version_org_fk",
    columns: [t.sequenceVersionId, t.organizationId],
    foreignColumns: [salesFollowUpSequenceVersions.id, salesFollowUpSequenceVersions.organizationId],
  }).onDelete("restrict"),
  unique("sales_sequence_enrollments_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("sales_sequence_enrollments_active_unique").on(t.targetType, t.targetId).where(sql`${t.status} = 'active'`),
  index("sales_sequence_enrollments_due_idx").on(t.status, t.nextStepDueAt),
]);

/**
 * The idempotency guard for sequence advancement: a `(enrollmentId,
 * sequenceStepId)` row is created exactly once per step, so re-running the
 * advance sweep after a worker restart is always safe — a step already
 * recorded here is skipped, never re-executed, never creating a second
 * follow-up/human task/approval/reminder for the same step.
 */
export const salesSequenceStepRuns = pgTable("sales_sequence_step_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  enrollmentId: uuid("enrollment_id").notNull(),
  sequenceStepId: uuid("sequence_step_id").notNull().references(() => salesFollowUpSequenceSteps.id, { onDelete: "cascade" }),
  status: salesStepRunStatusEnum("status").notNull().default("pending"),
  crmFollowUpId: uuid("crm_follow_up_id"),
  // The started workflow execution for a `workflow_human_task` step — the
  // Workflow Engine's own human_task node is what actually creates the
  // task row; this column is the execution-level pointer, not the task
  // row itself, since correlating the eventual node-level task id would
  // require observing async engine progress, which the existing worker/
  // reconciliation loop already owns.
  workflowExecutionId: uuid("workflow_execution_id"),
  workflowHumanTaskId: uuid("workflow_human_task_id"),
  approvalRequestId: uuid("approval_request_id"),
  // Module 16 — the drafted (never auto-sent) Communications OS message for a `communication_draft` step.
  communicationMessageId: uuid("communication_message_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "sales_sequence_step_runs_enrollment_org_fk",
    columns: [t.enrollmentId, t.organizationId],
    foreignColumns: [salesSequenceEnrollments.id, salesSequenceEnrollments.organizationId],
  }).onDelete("cascade"),
  unique("sales_sequence_step_runs_enrollment_step_unique").on(t.enrollmentId, t.sequenceStepId),
]);

/** A typed pointer to an existing Runtime approval request — never a duplicate approval record. Mirrors crm_project_links' own typed-pointer pattern. */
export const salesApprovalLinks = pgTable("sales_approval_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  approvalRequestId: uuid("approval_request_id").notNull().references(() => agentApprovalRequests.id, { onDelete: "cascade" }),
  linkedEntityType: salesApprovalLinkedEntityTypeEnum("linked_entity_type").notNull(),
  linkedEntityId: uuid("linked_entity_id").notNull(),
  purpose: text("purpose").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("sales_approval_links_approval_unique").on(t.approvalRequestId),
  index("sales_approval_links_entity_idx").on(t.linkedEntityType, t.linkedEntityId),
]);

/** A rep or team target for one period/metric. Historically traceable — never overwritten, only revision-guarded updates to the same row for corrections. */
export const salesTargets = pgTable("sales_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  scopeType: salesTargetScopeTypeEnum("scope_type").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  teamId: uuid("team_id"),
  metricType: salesTargetMetricTypeEnum("metric_type").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  targetValue: numeric("target_value", { precision: 14, scale: 2 }).notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_targets_team_org_fk",
    columns: [t.teamId, t.organizationId],
    foreignColumns: [salesTeams.id, salesTeams.organizationId],
  }).onDelete("cascade"),
  check("sales_targets_scope_shape_check", sql`(${t.scopeType} = 'individual' AND ${t.userId} IS NOT NULL AND ${t.teamId} IS NULL) OR (${t.scopeType} = 'team' AND ${t.teamId} IS NOT NULL AND ${t.userId} IS NULL)`),
  uniqueIndex("sales_targets_individual_unique").on(t.organizationId, t.userId, t.metricType, t.periodStart, t.periodEnd).where(sql`${t.scopeType} = 'individual'`),
  uniqueIndex("sales_targets_team_unique").on(t.organizationId, t.teamId, t.metricType, t.periodStart, t.periodEnd).where(sql`${t.scopeType} = 'team'`),
]);

/** The one bounded, rep-settable field forecasting needs beyond CRM's own opportunity data — never a duplicate of amount/stage/status. Upserted: one row per opportunity. */
export const salesOpportunityForecasts = pgTable("sales_opportunity_forecasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id").notNull(),
  forecastCategory: salesForecastCategoryEnum("forecast_category").notNull(),
  setByUserId: uuid("set_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "sales_opportunity_forecasts_opp_org_fk",
    columns: [t.opportunityId, t.organizationId],
    foreignColumns: [crmOpportunities.id, crmOpportunities.organizationId],
  }).onDelete("cascade"),
  unique("sales_opportunity_forecasts_opportunity_unique").on(t.opportunityId),
]);

// =============================================================================
// Marketing OS — Module 15
// =============================================================================
// The operational layer for planning/managing/executing/measuring marketing
// work, built entirely on top of existing systems (CRM Core, Sales OS's own
// team/role/playbook/run patterns, Workflow Engine, Projects Core, Agent
// Runtime via Module 14's generic task handler contract, Runtime approvals
// and artifacts). No new authorization primitive, no new artifact model, no
// new approval table, no second campaign-status source of truth. CRM
// contacts/companies/leads/opportunities are referenced by id only — never
// copied — and audiences store filter DEFINITIONS, never duplicated people.

export const marketingCampaignStatusEnum = pgEnum("marketing_campaign_status", ["draft", "planning", "ready", "active", "paused", "completed", "cancelled", "archived"]);
export const marketingObjectiveTypeEnum = pgEnum("marketing_objective_type", ["awareness", "lead_generation", "engagement", "event_promotion", "product_launch", "customer_nurture", "retention", "other"]);
export const marketingContentTypeEnum = pgEnum("marketing_content_type", ["social_post", "email_draft", "landing_page_copy", "ad_copy", "blog_outline", "blog_draft", "campaign_brief", "creative_brief", "script", "announcement", "other"]);
export const marketingContentStatusEnum = pgEnum("marketing_content_status", ["draft", "review", "approved", "scheduled", "published", "rejected", "archived"]);
export const marketingAudienceEntityTypeEnum = pgEnum("marketing_audience_entity_type", ["contact", "company", "lead", "opportunity"]);
export const marketingAudienceEvaluationModeEnum = pgEnum("marketing_audience_evaluation_mode", ["dynamic", "static"]);
export const marketingPlaybookTypeEnum = pgEnum("marketing_playbook_type", ["campaign", "content_creation", "campaign_review", "launch", "nurture"]);
export const marketingPlaybookLifecycleEnum = pgEnum("marketing_playbook_lifecycle", ["draft", "published", "archived"]);
export const marketingPlaybookVersionStatusEnum = pgEnum("marketing_playbook_version_status", ["draft", "published", "superseded"]);
export const marketingRunStatusEnum = pgEnum("marketing_run_status", ["not_started", "in_progress", "waiting", "completed", "abandoned"]);
export const marketingRunItemStatusEnum = pgEnum("marketing_run_item_status", ["pending", "complete", "skipped"]);
export const marketingTeamMemberRoleEnum = pgEnum("marketing_team_member_role", ["manager", "contributor", "viewer"]);
export const marketingRoleEnum = pgEnum("marketing_role", ["marketing_admin", "marketing_manager", "marketing_contributor", "viewer"]);
export const marketingApprovalLinkedEntityTypeEnum = pgEnum("marketing_approval_linked_entity_type", ["content_item"]);
export const marketingProjectLinkEntityTypeEnum = pgEnum("marketing_project_link_entity_type", ["campaign", "content_item"]);
export const marketingAttributionTouchTypeEnum = pgEnum("marketing_attribution_touch_type", ["first_touch", "last_touch"]);
export const marketingDestinationTypeEnum = pgEnum("marketing_destination_type", ["external_url", "internal_reference"]);
export const marketingSpendSourceEnum = pgEnum("marketing_spend_source", ["manual", "synced"]);
export const marketingContentStudioStatusEnum = pgEnum("marketing_content_studio_status", ["concepts", "production", "saved"]);

/** Organization/workspace-scoped configuration — one row per scope, mirroring `sales_configurations`'s exact singleton pattern (a workspace-scoped row and the org-wide row coexist safely via two partial unique indexes). */
export const marketingConfigurations = pgTable("marketing_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  businessTimezone: text("business_timezone").notNull().default("UTC"),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  defaultCampaignOwnerUserId: uuid("default_campaign_owner_user_id").references(() => users.id, { onDelete: "set null" }),
  defaultApprovalPolicy: text("default_approval_policy").notNull().default("required"),
  defaultContentPlaybookId: uuid("default_content_playbook_id"),
  staleCampaignThresholdDays: integer("stale_campaign_threshold_days").notNull().default(14),
  attributionWindowDays: integer("attribution_window_days").notNull().default(30),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_configurations_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  uniqueIndex("marketing_configurations_org_only_unique").on(t.organizationId).where(sql`${t.workspaceId} IS NULL`),
  uniqueIndex("marketing_configurations_org_workspace_unique").on(t.organizationId, t.workspaceId).where(sql`${t.workspaceId} IS NOT NULL`),
]);

export const marketingTeams = pgTable("marketing_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  teamKey: text("team_key").notNull(),
  description: text("description"),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_teams_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  unique("marketing_teams_org_key_unique").on(t.organizationId, t.teamKey),
  unique("marketing_teams_id_org_unique").on(t.id, t.organizationId),
]);

export const marketingTeamMembers = pgTable("marketing_team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  teamRole: marketingTeamMemberRoleEnum("team_role").notNull().default("contributor"),
  isActive: boolean("is_active").notNull().default(true),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_team_members_team_org_fk",
    columns: [t.teamId, t.organizationId],
    foreignColumns: [marketingTeams.id, marketingTeams.organizationId],
  }).onDelete("cascade"),
  unique("marketing_team_members_team_user_unique").on(t.teamId, t.userId),
  index("marketing_team_members_user_idx").on(t.userId),
]);

/** One active role per user per organization — identical shape to `sales_role_assignments`. Capabilities are mapped from role in code (`ROLE_CAPABILITIES`), never a raw role-string comparison at call sites. */
export const marketingRoleAssignments = pgTable("marketing_role_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: marketingRoleEnum("role").notNull(),
  grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  uniqueIndex("marketing_role_assignments_active_unique").on(t.organizationId, t.userId).where(sql`${t.revokedAt} IS NULL`),
  index("marketing_role_assignments_user_idx").on(t.userId),
]);

/** Reusable audience DEFINITIONS — never duplicated people. `filterDefinition` is a bounded JSON filter tree validated against a safe, in-code field/operator registry (`src/lib/marketing-os/audience-filters.ts`) — never arbitrary SQL. `evaluationMode: "static"` freezes `snapshotCount`/`snapshotRecordIds` at evaluation time for campaign reproducibility; `"dynamic"` always re-queries CRM live. */
export const marketingAudiences = pgTable("marketing_audiences", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  audienceKey: text("audience_key").notNull(),
  description: text("description"),
  entityType: marketingAudienceEntityTypeEnum("entity_type").notNull(),
  filterDefinition: jsonb("filter_definition").notNull().default([]),
  evaluationMode: marketingAudienceEvaluationModeEnum("evaluation_mode").notNull().default("dynamic"),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }),
  snapshotCount: integer("snapshot_count"),
  snapshotRecordIds: jsonb("snapshot_record_ids"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_audiences_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  unique("marketing_audiences_org_key_unique").on(t.organizationId, t.audienceKey),
  unique("marketing_audiences_id_org_unique").on(t.id, t.organizationId),
]);

/** Canonical campaign — the one source of truth for campaign lifecycle status (playbook runs track process compliance, never a second status). `objectiveTargets` is a small, bounded, deterministic numeric-target object — never a predictive/fabricated score. */
export const marketingCampaigns = pgTable("marketing_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  campaignKey: text("campaign_key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  objectiveType: marketingObjectiveTypeEnum("objective_type").notNull().default("other"),
  objectiveTargets: jsonb("objective_targets").notNull().default({}),
  status: marketingCampaignStatusEnum("status").notNull().default("draft"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  budgetAmount: numeric("budget_amount", { precision: 14, scale: 2 }),
  currency: text("currency"),
  primaryAudienceId: uuid("primary_audience_id"),
  sourceId: uuid("source_id"),
  projectId: uuid("project_id"),
  workflowDefinitionId: uuid("workflow_definition_id"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_campaigns_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "marketing_campaigns_audience_org_fk",
    columns: [t.primaryAudienceId, t.organizationId],
    foreignColumns: [marketingAudiences.id, marketingAudiences.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "marketing_campaigns_source_org_fk",
    columns: [t.sourceId, t.organizationId],
    foreignColumns: [crmSources.id, crmSources.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "marketing_campaigns_project_org_fk",
    columns: [t.projectId, t.organizationId],
    foreignColumns: [projects.id, projects.organizationId],
  }).onDelete("set null"),
  unique("marketing_campaigns_org_key_unique").on(t.organizationId, t.campaignKey),
  unique("marketing_campaigns_id_org_unique").on(t.id, t.organizationId),
  index("marketing_campaigns_org_status_idx").on(t.organizationId, t.status),
  index("marketing_campaigns_owner_idx").on(t.ownerUserId),
]);

/** Additional (non-primary) audience associations — the campaign's own `primaryAudienceId` already covers the common single-audience case. */
export const marketingCampaignAudienceLinks = pgTable("marketing_campaign_audience_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull(),
  audienceId: uuid("audience_id").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "marketing_campaign_audience_links_campaign_org_fk",
    columns: [t.campaignId, t.organizationId],
    foreignColumns: [marketingCampaigns.id, marketingCampaigns.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "marketing_campaign_audience_links_audience_org_fk",
    columns: [t.audienceId, t.organizationId],
    foreignColumns: [marketingAudiences.id, marketingAudiences.organizationId],
  }).onDelete("cascade"),
  unique("marketing_campaign_audience_links_unique").on(t.campaignId, t.audienceId),
]);

/** Content body lives in a real Runtime artifact (`currentArtifactId`, single-column FK per the established `workflow_node_executions.artifactId` precedent — a composite FK paired with `ON DELETE SET NULL` would null out this row's own `organizationId` too) — never duplicated into this table. */
export const marketingContentItems = pgTable("marketing_content_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull(),
  title: text("title").notNull(),
  contentType: marketingContentTypeEnum("content_type").notNull(),
  status: marketingContentStatusEnum("status").notNull().default("draft"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  currentArtifactId: uuid("current_artifact_id").references(() => agentArtifacts.id, { onDelete: "set null" }),
  intendedChannel: text("intended_channel"),
  plannedPublishAt: timestamp("planned_publish_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  projectTaskId: uuid("project_task_id"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_content_items_campaign_org_fk",
    columns: [t.campaignId, t.organizationId],
    foreignColumns: [marketingCampaigns.id, marketingCampaigns.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "marketing_content_items_task_org_fk",
    columns: [t.projectTaskId, t.organizationId],
    foreignColumns: [projectTasks.id, projectTasks.organizationId],
  }).onDelete("set null"),
  unique("marketing_content_items_id_org_unique").on(t.id, t.organizationId),
  index("marketing_content_items_campaign_idx").on(t.campaignId),
  index("marketing_content_items_org_status_idx").on(t.organizationId, t.status),
]);

/** Every artifact ever attached to a content item, in order — the item's own `currentArtifactId` is always the latest; this table is the historical trail (Runtime artifacts are already immutable, so no content body is ever copied here, only the pointer + version number). */
export const marketingContentItemArtifacts = pgTable("marketing_content_item_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contentItemId: uuid("content_item_id").notNull(),
  // `onDelete: "cascade"` (not "restrict"): artifacts are never deleted in
  // normal operation (immutable, create-only), so this never fires outside
  // test cleanup — `cleanupAgentRuntimeTestData` deletes `agent_artifacts`
  // directly, and a `restrict` FK here blocked that (the same latent-bug
  // class as `marketing_approval_links.approvalRequestId`, fixed above).
  artifactId: uuid("artifact_id").notNull().references(() => agentArtifacts.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByAgentId: uuid("created_by_agent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "marketing_content_item_artifacts_item_org_fk",
    columns: [t.contentItemId, t.organizationId],
    foreignColumns: [marketingContentItems.id, marketingContentItems.organizationId],
  }).onDelete("cascade"),
  unique("marketing_content_item_artifacts_item_version_unique").on(t.contentItemId, t.versionNumber),
]);

/** Persistent, tenant-scoped brand truth used by Content Studio. A brand is intentionally not a campaign: it is reusable positioning, voice, visual and product context applied across many campaigns. */
export const marketingBrandProfiles = pgTable("marketing_brand_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  brandKey: text("brand_key").notNull(),
  name: text("name").notNull(),
  positioning: text("positioning").notNull(),
  audience: text("audience").notNull(),
  voice: text("voice").notNull(),
  visualRules: text("visual_rules").notNull(),
  productContext: text("product_context").notNull(),
  callsToAction: jsonb("calls_to_action").notNull().default([]),
  approvedExamples: jsonb("approved_examples").notNull().default([]),
  claimsGuardrails: text("claims_guardrails").notNull(),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_brand_profiles_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  unique("marketing_brand_profiles_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("marketing_brand_profiles_org_only_key_unique").on(t.organizationId, t.brandKey).where(sql`${t.workspaceId} IS NULL`),
  uniqueIndex("marketing_brand_profiles_workspace_key_unique").on(t.organizationId, t.workspaceId, t.brandKey).where(sql`${t.workspaceId} IS NOT NULL`),
]);

/** Tenant-scoped creative references that teach Content Studio structure and quality without turning competitor claims or protected assets into brand truth. */
export const marketingCreativeReferences = pgTable("marketing_creative_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  brandProfileId: uuid("brand_profile_id").notNull(),
  title: text("title").notNull(),
  referenceType: text("reference_type").notNull().default("short_video"),
  sourceUrl: text("source_url").notNull(),
  transcript: text("transcript").notNull().default(""),
  creativeNotes: text("creative_notes").notNull(),
  adaptationRules: text("adaptation_rules").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_creative_references_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "marketing_creative_references_brand_org_fk",
    columns: [t.brandProfileId, t.organizationId],
    foreignColumns: [marketingBrandProfiles.id, marketingBrandProfiles.organizationId],
  }).onDelete("restrict"),
  unique("marketing_creative_references_id_org_unique").on(t.id, t.organizationId),
  index("marketing_creative_references_org_brand_idx").on(t.organizationId, t.brandProfileId),
]);

/** Durable working record for the narrow Content Studio flow. The canonical pipeline/calendar record remains `marketing_content_items`; this row only preserves ideation and the editable pre-save production package. */
export const marketingContentStudioDrafts = pgTable("marketing_content_studio_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  brandProfileId: uuid("brand_profile_id").notNull(),
  goal: text("goal").notNull(),
  intendedChannel: text("intended_channel").notNull(),
  plannedPublishAt: timestamp("planned_publish_at", { withTimezone: true }),
  creativeReferenceIds: jsonb("creative_reference_ids").notNull().default([]),
  concepts: jsonb("concepts").notNull().default([]),
  selectedConceptId: text("selected_concept_id"),
  productionPackage: jsonb("production_package"),
  status: marketingContentStudioStatusEnum("status").notNull().default("concepts"),
  contentItemId: uuid("content_item_id"),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_content_studio_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "marketing_content_studio_brand_org_fk",
    columns: [t.brandProfileId, t.organizationId],
    foreignColumns: [marketingBrandProfiles.id, marketingBrandProfiles.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "marketing_content_studio_content_org_fk",
    columns: [t.contentItemId, t.organizationId],
    foreignColumns: [marketingContentItems.id, marketingContentItems.organizationId],
  }).onDelete("cascade"),
  index("marketing_content_studio_org_status_idx").on(t.organizationId, t.status),
  index("marketing_content_studio_owner_idx").on(t.ownerUserId),
]);

/** A real social or paid-media account tracked by Marketing OS. V1 is manual-first: `connectionStatus` never implies provider credentials exist. */
export const marketingChannelAccounts = pgTable("marketing_channel_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  brandProfileId: uuid("brand_profile_id").notNull(),
  platform: text("platform").notNull(),
  accountKind: text("account_kind").notNull().default("organic"),
  displayName: text("display_name").notNull(),
  handle: text("handle"),
  externalUrl: text("external_url"),
  connectionStatus: text("connection_status").notNull().default("manual"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({ name: "marketing_channel_accounts_workspace_org_fk", columns: [t.workspaceId, t.organizationId], foreignColumns: [workspaces.id, workspaces.organizationId] }).onDelete("restrict"),
  foreignKey({ name: "marketing_channel_accounts_brand_org_fk", columns: [t.brandProfileId, t.organizationId], foreignColumns: [marketingBrandProfiles.id, marketingBrandProfiles.organizationId] }).onDelete("restrict"),
  unique("marketing_channel_accounts_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("marketing_channel_accounts_scope_unique").on(t.organizationId, t.brandProfileId, t.platform, t.accountKind, t.displayName).where(sql`${t.archivedAt} IS NULL`),
  index("marketing_channel_accounts_org_platform_idx").on(t.organizationId, t.platform),
]);

/** Append-only real performance observations. Manual entry works today; provider sync can write the same shape later without replacing it. */
export const marketingContentPerformanceSnapshots = pgTable("marketing_content_performance_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contentItemId: uuid("content_item_id").notNull(),
  channelAccountId: uuid("channel_account_id").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  source: text("source").notNull().default("manual"),
  impressions: integer("impressions").notNull().default(0),
  reach: integer("reach").notNull().default(0),
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  saves: integer("saves").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  leads: integer("leads").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),
  spendAmount: numeric("spend_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  revenueAmount: numeric("revenue_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: "marketing_performance_content_org_fk", columns: [t.contentItemId, t.organizationId], foreignColumns: [marketingContentItems.id, marketingContentItems.organizationId] }).onDelete("cascade"),
  foreignKey({ name: "marketing_performance_account_org_fk", columns: [t.channelAccountId, t.organizationId], foreignColumns: [marketingChannelAccounts.id, marketingChannelAccounts.organizationId] }).onDelete("cascade"),
  index("marketing_performance_org_captured_idx").on(t.organizationId, t.capturedAt),
  index("marketing_performance_content_idx").on(t.contentItemId),
]);

export const marketingPlaybooks = pgTable("marketing_playbooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  playbookKey: text("playbook_key").notNull(),
  playbookType: marketingPlaybookTypeEnum("playbook_type").notNull(),
  lifecycle: marketingPlaybookLifecycleEnum("lifecycle").notNull().default("draft"),
  currentPublishedVersionId: uuid("current_published_version_id"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_playbooks_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  unique("marketing_playbooks_org_key_unique").on(t.organizationId, t.playbookKey),
  unique("marketing_playbooks_id_org_unique").on(t.id, t.organizationId),
]);

export const marketingPlaybookVersions = pgTable("marketing_playbook_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  playbookId: uuid("playbook_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  status: marketingPlaybookVersionStatusEnum("status").notNull().default("draft"),
  changeReason: text("change_reason"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_playbook_versions_playbook_org_fk",
    columns: [t.playbookId, t.organizationId],
    foreignColumns: [marketingPlaybooks.id, marketingPlaybooks.organizationId],
  }).onDelete("cascade"),
  unique("marketing_playbook_versions_playbook_number_unique").on(t.playbookId, t.versionNumber),
  unique("marketing_playbook_versions_id_org_unique").on(t.id, t.organizationId),
]);

/** `configuration` carries the step's own bounded requirement shape (e.g. `{requiredContentType: "campaign_brief"}`, `{requiredArtifact: true}`) — structured JSON, never executable code or an unrestricted prompt. */
export const marketingPlaybookSteps = pgTable("marketing_playbook_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  playbookVersionId: uuid("playbook_version_id").notNull(),
  stepKey: text("step_key").notNull(),
  stepType: text("step_type").notNull().default("checklist"),
  name: text("name").notNull(),
  description: text("description"),
  sequence: integer("sequence").notNull(),
  configuration: jsonb("configuration").notNull().default({}),
  required: boolean("required").notNull().default(true),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_playbook_steps_version_org_fk",
    columns: [t.playbookVersionId, t.organizationId],
    foreignColumns: [marketingPlaybookVersions.id, marketingPlaybookVersions.organizationId],
  }).onDelete("cascade"),
  unique("marketing_playbook_steps_version_key_unique").on(t.playbookVersionId, t.stepKey),
  unique("marketing_playbook_steps_version_sequence_unique").on(t.playbookVersionId, t.sequence),
]);

/** Process-compliance tracking for one campaign against one published playbook version — the campaign row above remains the sole source of truth for campaign lifecycle status. */
export const marketingCampaignRuns = pgTable("marketing_campaign_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull(),
  playbookVersionId: uuid("playbook_version_id").notNull(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  status: marketingRunStatusEnum("status").notNull().default("not_started"),
  missingRequirements: jsonb("missing_requirements").notNull().default([]),
  workflowExecutionId: uuid("workflow_execution_id").references(() => workflowExecutions.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_campaign_runs_campaign_org_fk",
    columns: [t.campaignId, t.organizationId],
    foreignColumns: [marketingCampaigns.id, marketingCampaigns.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "marketing_campaign_runs_version_org_fk",
    columns: [t.playbookVersionId, t.organizationId],
    foreignColumns: [marketingPlaybookVersions.id, marketingPlaybookVersions.organizationId],
  }).onDelete("restrict"),
  unique("marketing_campaign_runs_id_org_unique").on(t.id, t.organizationId),
  uniqueIndex("marketing_campaign_runs_active_unique").on(t.campaignId).where(sql`${t.status} IN ('not_started','in_progress','waiting')`),
]);

export const marketingCampaignRunItems = pgTable("marketing_campaign_run_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  campaignRunId: uuid("campaign_run_id").notNull(),
  playbookStepId: uuid("playbook_step_id").notNull(),
  status: marketingRunItemStatusEnum("status").notNull().default("pending"),
  completedByUserId: uuid("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  evidenceArtifactId: uuid("evidence_artifact_id").references(() => agentArtifacts.id, { onDelete: "set null" }),
  evidenceContentItemId: uuid("evidence_content_item_id"),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_campaign_run_items_run_org_fk",
    columns: [t.campaignRunId, t.organizationId],
    foreignColumns: [marketingCampaignRuns.id, marketingCampaignRuns.organizationId],
  }).onDelete("cascade"),
  unique("marketing_campaign_run_items_run_step_unique").on(t.campaignRunId, t.playbookStepId),
]);

/** Canonical destination/UTM reference layer only — no page builder, no hosting. `utmContent`/`utmTerm` default to `""` (never `null`) so the uniqueness constraint below behaves correctly (Postgres treats `NULL` as distinct-from-itself in unique indexes). */
export const marketingCampaignDestinations = pgTable("marketing_campaign_destinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull(),
  label: text("label").notNull(),
  url: text("url").notNull(),
  destinationType: marketingDestinationTypeEnum("destination_type").notNull().default("external_url"),
  utmSource: text("utm_source").notNull(),
  utmMedium: text("utm_medium").notNull(),
  utmCampaign: text("utm_campaign").notNull(),
  utmContent: text("utm_content").notNull().default(""),
  utmTerm: text("utm_term").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_campaign_destinations_campaign_org_fk",
    columns: [t.campaignId, t.organizationId],
    foreignColumns: [marketingCampaigns.id, marketingCampaigns.organizationId],
  }).onDelete("cascade"),
  unique("marketing_campaign_destinations_id_org_unique").on(t.id, t.organizationId),
  unique("marketing_campaign_destinations_utm_unique").on(t.campaignId, t.utmSource, t.utmMedium, t.utmCampaign, t.utmContent, t.utmTerm),
]);

/** Append-only, deterministic first-touch/latest-touch attribution — never full multi-touch modeling. At most one `first_touch` row per (organization, crmLeadId) — write-once, idempotent no-op on conflict; at most one `last_touch` row per (organization, crmLeadId) — always upserted to the newest observed touch. No PII: `crmContactId`/`crmLeadId` are bare id pointers, resolved back through CRM's own services when actually displayed. */
export const marketingAttributionRecords = pgTable("marketing_attribution_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id"),
  destinationId: uuid("destination_id"),
  crmLeadId: uuid("crm_lead_id"),
  crmContactId: uuid("crm_contact_id"),
  sourceId: uuid("source_id"),
  touchType: marketingAttributionTouchTypeEnum("touch_type").notNull(),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  externalClickId: text("external_click_id"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "marketing_attribution_records_campaign_org_fk",
    columns: [t.campaignId, t.organizationId],
    foreignColumns: [marketingCampaigns.id, marketingCampaigns.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "marketing_attribution_records_destination_org_fk",
    columns: [t.destinationId, t.organizationId],
    foreignColumns: [marketingCampaignDestinations.id, marketingCampaignDestinations.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "marketing_attribution_records_lead_org_fk",
    columns: [t.crmLeadId, t.organizationId],
    foreignColumns: [crmLeads.id, crmLeads.organizationId],
  }).onDelete("set null"),
  foreignKey({
    name: "marketing_attribution_records_contact_org_fk",
    columns: [t.crmContactId, t.organizationId],
    foreignColumns: [crmContacts.id, crmContacts.organizationId],
  }).onDelete("set null"),
  uniqueIndex("marketing_attribution_records_lead_touch_unique").on(t.organizationId, t.crmLeadId, t.touchType).where(sql`${t.crmLeadId} IS NOT NULL`),
  uniqueIndex("marketing_attribution_records_contact_touch_unique").on(t.organizationId, t.crmContactId, t.touchType).where(sql`${t.crmContactId} IS NOT NULL AND ${t.crmLeadId} IS NULL`),
  index("marketing_attribution_records_campaign_idx").on(t.campaignId),
]);

/** Manual budget planning/tracking only — no ad-platform spend sync. `spendSource` is always `"manual"` in this module; the `"synced"` value exists so a future integration can extend this table without a migration, and is never written here. */
export const marketingBudgetEntries = pgTable("marketing_budget_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull(),
  category: text("category").notNull().default("general"),
  plannedAmount: numeric("planned_amount", { precision: 14, scale: 2 }),
  spendAmount: numeric("spend_amount", { precision: 14, scale: 2 }),
  currency: text("currency").notNull(),
  spendSource: marketingSpendSourceEnum("spend_source").notNull().default("manual"),
  recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "marketing_budget_entries_campaign_org_fk",
    columns: [t.campaignId, t.organizationId],
    foreignColumns: [marketingCampaigns.id, marketingCampaigns.organizationId],
  }).onDelete("cascade"),
  unique("marketing_budget_entries_campaign_category_unique").on(t.campaignId, t.category),
]);

/**
 * A typed pointer to an existing Runtime approval request — same shape as
 * `sales_approval_links`, but with `onDelete: "cascade"` on
 * `approvalRequestId` (matching `project_approval_links`'s own correct
 * precedent) rather than `sales_approval_links`'s un-specified default
 * (`NO ACTION`) — that default blocks the shared test cleanup helper
 * (`cleanupAgentRuntimeTestData`) from deleting `agent_approval_requests`
 * rows still referenced by a link row, a latent bug discovered while
 * building this module's own tests. `sales_approval_links` was left
 * unmodified — out of this module's scope — and is flagged in the Module
 * 15 report instead.
 */
export const marketingApprovalLinks = pgTable("marketing_approval_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  approvalRequestId: uuid("approval_request_id").notNull().references(() => agentApprovalRequests.id, { onDelete: "cascade" }),
  linkedEntityType: marketingApprovalLinkedEntityTypeEnum("linked_entity_type").notNull(),
  linkedEntityId: uuid("linked_entity_id").notNull(),
  purpose: text("purpose").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("marketing_approval_links_approval_unique").on(t.approvalRequestId),
  index("marketing_approval_links_entity_idx").on(t.linkedEntityType, t.linkedEntityId),
]);

/** Additional (non-primary) Projects Core associations — mirrors `crm_project_links` exactly. The campaign's own `projectId` already covers the common single-project case; content items link to a project TASK directly via `projectTaskId`. */
export const marketingProjectLinks = pgTable("marketing_project_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  marketingEntityType: marketingProjectLinkEntityTypeEnum("marketing_entity_type").notNull(),
  marketingEntityId: uuid("marketing_entity_id").notNull(),
  linkedByUserId: uuid("linked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "marketing_project_links_project_org_fk",
    columns: [t.projectId, t.organizationId],
    foreignColumns: [projects.id, projects.organizationId],
  }).onDelete("cascade"),
  unique("marketing_project_links_unique").on(t.projectId, t.marketingEntityType, t.marketingEntityId),
  index("marketing_project_links_entity_idx").on(t.marketingEntityType, t.marketingEntityId),
]);

// ---------------------------------------------------------------------------
// Communications & Integrations Core — Module 16. The shared provider-
// neutral communications layer CRM Core/Sales OS/Marketing OS build on for
// real outbound/inbound email/SMS/WhatsApp — never a second CRM activity
// system, never a second approval system, never provider-specific business
// logic inside Sales/Marketing. Canonical channel model plus narrow, real
// provider adapters (Resend for email; development/log providers for
// SMS/WhatsApp) that can scale to more providers later without a schema
// change.
// ---------------------------------------------------------------------------

export const integrationProviderEnum = pgEnum("integration_provider", ["resend", "dev_email", "twilio", "dev_sms", "whatsapp_cloud_api", "dev_whatsapp"]);
export const communicationChannelEnum = pgEnum("communication_channel", ["email", "sms", "whatsapp"]);
export const integrationConnectionStatusEnum = pgEnum("integration_connection_status", ["pending", "connected", "verification_failed", "disabled", "disconnected"]);
export const communicationRoleEnum = pgEnum("communication_role", ["communications_admin", "communications_manager", "communications_agent", "viewer"]);
export const communicationConversationStatusEnum = pgEnum("communication_conversation_status", ["open", "pending", "resolved", "archived"]);
export const communicationDirectionEnum = pgEnum("communication_direction", ["inbound", "outbound"]);
export const communicationMessageStatusEnum = pgEnum("communication_message_status", ["draft", "pending_approval", "approved", "queued", "sending", "sent", "delivered", "failed", "received", "cancelled"]);
export const communicationFailureClassEnum = pgEnum("communication_failure_class", ["invalid_recipient", "suppressed", "consent_required", "provider_rejected", "provider_timeout", "permanent_provider_error", "transient_provider_error", "approval_revoked", "connection_disabled", "unknown"]);
export const communicationTemplateStatusEnum = pgEnum("communication_template_status", ["draft", "published", "archived"]);
export const communicationTemplateVersionStatusEnum = pgEnum("communication_template_version_status", ["draft", "published", "superseded"]);
export const communicationProviderEventProcessingStatusEnum = pgEnum("communication_provider_event_processing_status", ["pending", "processed", "failed", "ignored"]);
export const communicationDeliveryEventTypeEnum = pgEnum("communication_delivery_event_type", ["accepted", "sent", "delivered", "bounced", "failed", "rejected", "read"]);
export const communicationConsentStatusEnum = pgEnum("communication_consent_status", ["unknown", "opted_in", "opted_out", "suppressed"]);
export const communicationConsentSourceEnum = pgEnum("communication_consent_source", ["explicit_form", "reply_stop", "reply_start", "manual_admin", "imported", "inferred_transactional"]);
export const communicationSuppressionReasonEnum = pgEnum("communication_suppression_reason", ["user_opt_out", "bounced_hard", "complaint", "manual", "compliance_hold"]);
export const communicationExternalIdentityTypeEnum = pgEnum("communication_external_identity_type", ["email", "phone"]);
export const communicationBulkBatchStatusEnum = pgEnum("communication_bulk_batch_status", ["draft", "pending_approval", "approved", "queued", "in_progress", "paused", "completed", "cancelled", "failed"]);
export const communicationBulkRecipientStatusEnum = pgEnum("communication_bulk_recipient_status", ["pending", "skipped_suppressed", "skipped_no_consent", "queued", "sent", "failed"]);
export const communicationApprovalLinkedEntityTypeEnum = pgEnum("communication_approval_linked_entity_type", ["message", "bulk_batch"]);

/** An organization/workspace-owned external account (email/SMS/WhatsApp today; Slack/Teams/calendar/social/ads/storage later — same table, new enum values, no schema change). Never stores a raw token — see `integration_credentials`. */
export const integrationConnections = pgTable("integration_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  provider: integrationProviderEnum("provider").notNull(),
  integrationType: communicationChannelEnum("integration_type").notNull(),
  displayName: text("display_name").notNull(),
  status: integrationConnectionStatusEnum("status").notNull().default("pending"),
  externalAccountId: text("external_account_id"),
  scopesMetadata: jsonb("scopes_metadata").notNull().default([]),
  connectedByUserId: uuid("connected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "integration_connections_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  uniqueIndex("integration_connections_active_account_unique").on(t.organizationId, t.provider, t.externalAccountId).where(sql`${t.externalAccountId} IS NOT NULL AND ${t.disconnectedAt} IS NULL`),
  index("integration_connections_org_idx").on(t.organizationId, t.status),
]);

/** Rotation-friendly, encrypted-at-rest credential storage — mirrors `agent_credentials`' multi-row-per-owner shape, but holds a genuinely retrievable (encrypted, never plaintext) secret rather than a one-way hash, since a provider adapter must actually present it to send. At most one ACTIVE row per connection. */
export const integrationCredentials = pgTable("integration_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  issuedByUserId: uuid("issued_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("integration_credentials_active_unique").on(t.connectionId).where(sql`${t.revokedAt} IS NULL`),
  index("integration_credentials_connection_idx").on(t.connectionId),
]);

/** One active Communications OS role per user per org — independent of CRM/Brain/Sales/Marketing roles, mirroring `marketing_role_assignments` exactly. */
export const communicationRoleAssignments = pgTable("communication_role_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: communicationRoleEnum("role").notNull(),
  grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("communication_role_assignments_active_unique").on(t.organizationId, t.userId).where(sql`${t.revokedAt} IS NULL`),
]);

/** A thread — may exist with no resolved CRM contact (conservative identity resolution never auto-creates or auto-merges CRM records). */
export const communicationConversations = pgTable("communication_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  channel: communicationChannelEnum("channel").notNull(),
  integrationConnectionId: uuid("integration_connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),
  contactId: uuid("contact_id"),
  companyId: uuid("company_id"),
  leadId: uuid("lead_id"),
  opportunityId: uuid("opportunity_id"),
  externalThreadId: text("external_thread_id"),
  status: communicationConversationStatusEnum("status").notNull().default("open"),
  assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "communication_conversations_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "communication_conversations_contact_org_fk",
    columns: [t.contactId, t.organizationId],
    foreignColumns: [crmContacts.id, crmContacts.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "communication_conversations_company_org_fk",
    columns: [t.companyId, t.organizationId],
    foreignColumns: [crmCompanies.id, crmCompanies.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "communication_conversations_lead_org_fk",
    columns: [t.leadId, t.organizationId],
    foreignColumns: [crmLeads.id, crmLeads.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "communication_conversations_opportunity_org_fk",
    columns: [t.opportunityId, t.organizationId],
    foreignColumns: [crmOpportunities.id, crmOpportunities.organizationId],
  }).onDelete("cascade"),
  uniqueIndex("communication_conversations_thread_unique").on(t.organizationId, t.integrationConnectionId, t.externalThreadId).where(sql`${t.externalThreadId} IS NOT NULL`),
  index("communication_conversations_contact_idx").on(t.contactId),
  index("communication_conversations_org_status_idx").on(t.organizationId, t.status),
]);

/** The canonical message model — one shape for every channel/provider, provider metadata attached rather than a per-provider table. A draft is not a sent communication; "sent"/"delivered" require real provider evidence (or a truthful development-provider status), never fabricated. */
export const communicationMessages = pgTable("communication_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => communicationConversations.id, { onDelete: "cascade" }),
  direction: communicationDirectionEnum("direction").notNull(),
  channel: communicationChannelEnum("channel").notNull(),
  provider: integrationProviderEnum("provider"),
  integrationConnectionId: uuid("integration_connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),
  senderReference: text("sender_reference"),
  recipientReference: text("recipient_reference"),
  subject: text("subject"),
  bodyText: text("body_text"),
  contentArtifactId: uuid("content_artifact_id").references(() => agentArtifacts.id, { onDelete: "set null" }),
  status: communicationMessageStatusEnum("status").notNull().default("draft"),
  providerMessageId: text("provider_message_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  failureClass: communicationFailureClassEnum("failure_class"),
  failureCode: text("failure_code"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  // Single-column FK (not the composite `(agentId, organizationId)` form
  // used elsewhere in this codebase, e.g. `crm_activities.agentId`) —
  // deliberately, because a composite FK's `ON DELETE SET NULL` nulls
  // EVERY column in the key, including `organizationId`, which conflicts
  // with this table's own `organizationId NOT NULL` constraint. This is
  // a real, latent bug pattern that also exists (undiscovered, never
  // exercised) in `crm_activities.agentId` — flagged, not fixed there,
  // per this module's "do not redesign CRM Core" scope; fixed here
  // because it directly blocked this table's own test cleanup.
  createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
  approvalRequestId: uuid("approval_request_id"),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  uniqueIndex("communication_messages_idempotency_unique").on(t.organizationId, t.idempotencyKey),
  uniqueIndex("communication_messages_provider_message_unique").on(t.organizationId, t.provider, t.providerMessageId).where(sql`${t.providerMessageId} IS NOT NULL`),
  index("communication_messages_conversation_idx").on(t.conversationId, t.createdAt),
  index("communication_messages_org_status_idx").on(t.organizationId, t.status),
]);

export const communicationMessageTemplates = pgTable("communication_message_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  channel: communicationChannelEnum("channel").notNull(),
  name: text("name").notNull(),
  templateKey: text("template_key").notNull(),
  purpose: text("purpose"),
  status: communicationTemplateStatusEnum("status").notNull().default("draft"),
  currentPublishedVersionId: uuid("current_published_version_id"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  uniqueIndex("communication_message_templates_key_unique").on(t.organizationId, t.templateKey),
]);

/** Published versions are immutable — the same draft → published → superseded lifecycle every other versioned entity in this codebase uses. Variable substitution is a fixed, declared-variable-only engine (`{{variableName}}`) — never arbitrary code. */
export const communicationTemplateVersions = pgTable("communication_template_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").notNull().references(() => communicationMessageTemplates.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  status: communicationTemplateVersionStatusEnum("status").notNull().default("draft"),
  subjectTemplate: text("subject_template"),
  bodyTemplate: text("body_template").notNull(),
  variableSchema: jsonb("variable_schema").notNull().default([]),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("communication_template_versions_number_unique").on(t.templateId, t.versionNumber),
]);

/** Durable, deduplicated record of every inbound provider webhook/event — the dedup key is exactly `(provider, connection, externalEventId)` per spec. Raw payloads are deliberately never persisted here (§ privacy "do not store unnecessary raw payloads"); only the bounded, normalized reference this event resolved to. */
export const communicationProviderEvents = pgTable("communication_provider_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),
  provider: integrationProviderEnum("provider").notNull(),
  externalEventId: text("external_event_id").notNull(),
  eventType: text("event_type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processingStatus: communicationProviderEventProcessingStatusEnum("processing_status").notNull().default("pending"),
  normalizedEntityType: text("normalized_entity_type"),
  normalizedEntityId: uuid("normalized_entity_id"),
  failureCode: text("failure_code"),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("communication_provider_events_dedup_unique").on(t.provider, t.connectionId, t.externalEventId),
  index("communication_provider_events_org_status_idx").on(t.organizationId, t.processingStatus),
]);

/** Canonical, deterministic delivery-state history for a message — out-of-order provider events never regress state (enforced at the service layer by an explicit precedence order, never by insertion order). */
export const communicationDeliveryEvents = pgTable("communication_delivery_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => communicationMessages.id, { onDelete: "cascade" }),
  providerEventId: uuid("provider_event_id").references(() => communicationProviderEvents.id, { onDelete: "set null" }),
  eventType: communicationDeliveryEventTypeEnum("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  rawStatusText: text("raw_status_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("communication_delivery_events_provider_event_unique").on(t.providerEventId).where(sql`${t.providerEventId} IS NOT NULL`),
  index("communication_delivery_events_message_idx").on(t.messageId, t.occurredAt),
]);

/** Current consent state per (channel, identity) — a single revision-guarded row, not an append-only log; `communication_suppressions` tracks the broader, possibly-non-consent-driven "never send" signal separately (e.g. a hard bounce). Never assumes opt-in from CRM existence — every row starts `unknown`. */
export const communicationConsentRecords = pgTable("communication_consent_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  channel: communicationChannelEnum("channel").notNull(),
  normalizedIdentity: text("normalized_identity").notNull(),
  contactId: uuid("contact_id"),
  consentStatus: communicationConsentStatusEnum("consent_status").notNull().default("unknown"),
  consentSource: communicationConsentSourceEnum("consent_source"),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  suppressionReason: communicationSuppressionReasonEnum("suppression_reason"),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "communication_consent_records_contact_org_fk",
    columns: [t.contactId, t.organizationId],
    foreignColumns: [crmContacts.id, crmContacts.organizationId],
  }).onDelete("set null"),
  uniqueIndex("communication_consent_records_identity_unique").on(t.organizationId, t.channel, t.normalizedIdentity),
]);

/** A separate, broader "never send" flag — may originate from a hard bounce/complaint/manual/compliance hold, not only an explicit opt-out. At most one ACTIVE (unlifted) suppression per identity per channel; lifting preserves history rather than deleting the row. */
export const communicationSuppressions = pgTable("communication_suppressions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  channel: communicationChannelEnum("channel").notNull(),
  normalizedIdentity: text("normalized_identity").notNull(),
  suppressionReason: communicationSuppressionReasonEnum("suppression_reason").notNull(),
  source: text("source"),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }).notNull().defaultNow(),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  liftedByUserId: uuid("lifted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("communication_suppressions_active_unique").on(t.organizationId, t.channel, t.normalizedIdentity).where(sql`${t.liftedAt} IS NULL`),
]);

/** A cache of normalized-identity → CRM contact resolution — exact match only, populated conservatively; an ambiguous or no match simply leaves `contactId` null rather than guessing or creating a new contact. */
export const communicationExternalIdentities = pgTable("communication_external_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  identityType: communicationExternalIdentityTypeEnum("identity_type").notNull(),
  normalizedIdentity: text("normalized_identity").notNull(),
  contactId: uuid("contact_id"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "communication_external_identities_contact_org_fk",
    columns: [t.contactId, t.organizationId],
    foreignColumns: [crmContacts.id, crmContacts.organizationId],
  }).onDelete("set null"),
  uniqueIndex("communication_external_identities_unique").on(t.organizationId, t.identityType, t.normalizedIdentity),
]);

/** Metadata/reference only — never a raw binary in Postgres. `artifactId` for internally/agent-produced files, `externalRef` for inbound or provider-hosted content; at least one is required (enforced at the service layer). */
export const communicationAttachments = pgTable("communication_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => communicationMessages.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mediaType: text("media_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  artifactId: uuid("artifact_id").references(() => agentArtifacts.id, { onDelete: "set null" }),
  externalRef: text("external_ref"),
  providerAttachmentId: text("provider_attachment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("communication_attachments_message_idx").on(t.messageId),
]);

/** Bounded-batch outbound foundation — never a high-volume ESP. Recipients are a stable, evaluated snapshot (not a live re-query at send time), one canonical message per recipient, per-recipient consent/suppression checked individually. */
export const communicationBulkBatches = pgTable("communication_bulk_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  channel: communicationChannelEnum("channel").notNull(),
  campaignId: uuid("campaign_id").references(() => marketingCampaigns.id, { onDelete: "set null" }),
  audienceId: uuid("audience_id").references(() => marketingAudiences.id, { onDelete: "set null" }),
  templateVersionId: uuid("template_version_id").notNull().references(() => communicationTemplateVersions.id, { onDelete: "restrict" }),
  status: communicationBulkBatchStatusEnum("status").notNull().default("draft"),
  approvalRequestId: uuid("approval_request_id"),
  recipientSnapshotCount: integer("recipient_snapshot_count").notNull().default(0),
  maxRecipients: integer("max_recipients").notNull().default(200),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  uniqueIndex("communication_bulk_batches_active_per_campaign_unique").on(t.campaignId).where(sql`${t.campaignId} IS NOT NULL AND ${t.status} IN ('queued','in_progress')`),
]);

export const communicationBulkRecipients = pgTable("communication_bulk_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").notNull().references(() => communicationBulkBatches.id, { onDelete: "cascade" }),
  recipientReference: text("recipient_reference").notNull(),
  contactId: uuid("contact_id"),
  messageId: uuid("message_id").references(() => communicationMessages.id, { onDelete: "set null" }),
  status: communicationBulkRecipientStatusEnum("status").notNull().default("pending"),
  skipReason: text("skip_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "communication_bulk_recipients_contact_org_fk",
    columns: [t.contactId, t.organizationId],
    foreignColumns: [crmContacts.id, crmContacts.organizationId],
  }).onDelete("cascade"),
  uniqueIndex("communication_bulk_recipients_unique").on(t.batchId, t.recipientReference),
]);

/** Typed pointer to a real `agent_approval_requests` row — the ONLY approval-creation/decision mechanism reused directly from Runtime, never a duplicate approval table. Cascades from day one (Module 15/16's own hardening lesson — see the Module 16 fix to `sales_approval_links`). */
export const communicationApprovalLinks = pgTable("communication_approval_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  approvalRequestId: uuid("approval_request_id").notNull().references(() => agentApprovalRequests.id, { onDelete: "cascade" }),
  linkedEntityType: communicationApprovalLinkedEntityTypeEnum("linked_entity_type").notNull(),
  linkedEntityId: uuid("linked_entity_id").notNull(),
  purpose: text("purpose").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("communication_approval_links_approval_unique").on(t.approvalRequestId),
  index("communication_approval_links_entity_idx").on(t.linkedEntityType, t.linkedEntityId),
]);

// ---------------------------------------------------------------------------
// Analytics OS — Module 17. The centralized, deterministic cross-module
// analytics layer over CRM Core/Sales OS/Marketing OS/Communications OS/
// Projects Core/Workflow Engine/Agent Runtime. Deliberately the smallest
// possible schema: metrics/dimensions are an in-code registry (never a
// database table — the same "no dynamic/arbitrary" discipline every prior
// registry in this codebase already established), and every metric is
// computed LIVE from the real canonical tables those modules already own
// — never a duplicated or cached copy of business data. No snapshot/cache
// table exists yet because no metric implemented in this module is
// expensive enough to need one ("prefer live queries initially"); the
// schema and freshness-classification model are both already shaped to
// add one later without a breaking change.
// ---------------------------------------------------------------------------

export const analyticsTimeGrainEnum = pgEnum("analytics_time_grain", ["day", "week", "month", "quarter"]);
export const analyticsRoleEnum = pgEnum("analytics_role", ["analytics_admin", "analytics_manager", "viewer"]);
export const analyticsReportVisibilityEnum = pgEnum("analytics_report_visibility", ["private", "organization"]);
export const analyticsVisualizationEnum = pgEnum("analytics_visualization", ["kpi_card", "line", "bar", "table", "funnel", "progress", "status_distribution"]);
export const analyticsDateRangeStrategyEnum = pgEnum("analytics_date_range_strategy", ["last_7_days", "last_30_days", "last_90_days", "month_to_date", "quarter_to_date", "year_to_date", "custom"]);

/** Org/workspace-scoped defaults only — never a place metric business logic lives. Singleton-per-scope, mirrors `marketing_configurations`/`sales_configurations` exactly. */
export const analyticsConfigurations = pgTable("analytics_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  businessTimezone: text("business_timezone").notNull().default("UTC"),
  defaultTimeGrain: analyticsTimeGrainEnum("default_time_grain").notNull().default("day"),
  defaultDateRangeStrategy: analyticsDateRangeStrategyEnum("default_date_range_strategy").notNull().default("last_30_days"),
  defaultComparisonEnabled: boolean("default_comparison_enabled").notNull().default(true),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "analytics_configurations_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  uniqueIndex("analytics_configurations_org_only_unique").on(t.organizationId).where(sql`${t.workspaceId} IS NULL`),
  uniqueIndex("analytics_configurations_org_workspace_unique").on(t.organizationId, t.workspaceId).where(sql`${t.workspaceId} IS NOT NULL`),
]);

/** One active Analytics OS role per user per org — independent of CRM/Sales/Marketing/Communications/Brain roles, mirroring `communication_role_assignments` exactly. */
export const analyticsRoleAssignments = pgTable("analytics_role_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: analyticsRoleEnum("role").notNull(),
  grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("analytics_role_assignments_active_unique").on(t.organizationId, t.userId).where(sql`${t.revokedAt} IS NULL`),
]);

/** A saved analytics view — metric keys/dimensions/filters reference the in-code registry by KEY only; never executable SQL or an arbitrary expression. */
export const analyticsSavedReports = pgTable("analytics_saved_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  description: text("description"),
  metricKeys: jsonb("metric_keys").notNull().default([]),
  dateRangeStrategy: analyticsDateRangeStrategyEnum("date_range_strategy").notNull().default("last_30_days"),
  customStartDate: timestamp("custom_start_date", { withTimezone: true }),
  customEndDate: timestamp("custom_end_date", { withTimezone: true }),
  comparisonEnabled: boolean("comparison_enabled").notNull().default(true),
  timeGrain: analyticsTimeGrainEnum("time_grain").notNull().default("day"),
  dimensions: jsonb("dimensions").notNull().default([]),
  filters: jsonb("filters").notNull().default([]),
  visualization: analyticsVisualizationEnum("visualization").notNull().default("kpi_card"),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  visibility: analyticsReportVisibilityEnum("visibility").notNull().default("private"),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "analytics_saved_reports_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  index("analytics_saved_reports_org_idx").on(t.organizationId, t.ownerUserId),
]);

// ---------------------------------------------------------------------------
// Founder Workspace / Executive OS — Module 18. The executive command
// center consuming Analytics OS/CRM/Sales/Marketing/Communications/
// Projects/Workflow Engine/Agent Runtime/approvals — never a competing
// business truth of its own. Deliberately the smallest possible schema,
// mirroring Analytics OS's own "in-code registry, live derivation"
// discipline: attention items and the daily brief are computed live (an
// optional brief artifact is stored via the EXISTING `agent_artifacts`
// table, never a new one) — only genuinely durable, user-authored records
// (configuration, role grants, decisions, goals) get a table.
// ---------------------------------------------------------------------------

export const founderRoleEnum = pgEnum("founder_role", ["founder_viewer", "founder_executive", "founder_admin"]);
export const founderDecisionStatusEnum = pgEnum("founder_decision_status", ["proposed", "decided", "superseded", "archived"]);
export const founderGoalStatusEnum = pgEnum("founder_goal_status", ["active", "completed", "missed", "archived"]);

/** Business-level founder-workspace preferences — visible KPI groups, widget order, selected saved Analytics reports (by id, never a copied query), default date range/workspace. Org- or workspace-scoped, identical shape to `analytics_configurations`. */
export const founderWorkspaceConfigurations = pgTable("founder_workspace_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  visibleKpiGroups: jsonb("visible_kpi_groups").notNull().default(["growth", "sales", "marketing", "delivery", "operations", "communications", "ai"]),
  widgetOrder: jsonb("widget_order").notNull().default([]),
  selectedSavedReportIds: jsonb("selected_saved_report_ids").notNull().default([]),
  defaultDateRangeStrategy: analyticsDateRangeStrategyEnum("default_date_range_strategy").notNull().default("last_30_days"),
  defaultWorkspaceId: uuid("default_workspace_id"),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "founder_workspace_configurations_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "founder_workspace_configurations_default_workspace_org_fk",
    columns: [t.defaultWorkspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("set null"),
  uniqueIndex("founder_workspace_configurations_org_only_unique").on(t.organizationId).where(sql`${t.workspaceId} IS NULL`),
  uniqueIndex("founder_workspace_configurations_org_workspace_unique").on(t.organizationId, t.workspaceId).where(sql`${t.workspaceId} IS NOT NULL`),
]);

/** One active Founder Workspace role per user per org — independent of every other module's roles, mirroring `analytics_role_assignments` exactly. */
export const founderRoleAssignments = pgTable("founder_role_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: founderRoleEnum("role").notNull(),
  grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("founder_role_assignments_active_unique").on(t.organizationId, t.userId).where(sql`${t.revokedAt} IS NULL`),
]);

/**
 * A real business decision record — never hidden reasoning or chain-of-
 * thought. Every `related*Id` is a plain, single-column, lower-criticality
 * optional reference (the identical judgment `workflow_executions.projectId`
 * already established) — tenant safety for these is enforced at the
 * application layer (every resolver re-fetches by id AND organizationId),
 * not by a composite FK, since not every referenced table exposes a
 * `(id, organizationId)` unique target.
 */
export const founderDecisions = pgTable("founder_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  title: text("title").notNull(),
  decision: text("decision").notNull(),
  contextSummary: text("context_summary"),
  decisionOwnerUserId: uuid("decision_owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  decisionDate: timestamp("decision_date", { withTimezone: true }).notNull().defaultNow(),
  relatedProjectId: uuid("related_project_id").references(() => projects.id, { onDelete: "set null" }),
  relatedOpportunityId: uuid("related_opportunity_id").references(() => crmOpportunities.id, { onDelete: "set null" }),
  relatedCampaignId: uuid("related_campaign_id").references(() => marketingCampaigns.id, { onDelete: "set null" }),
  relatedWorkflowDefinitionId: uuid("related_workflow_definition_id").references(() => workflowDefinitions.id, { onDelete: "set null" }),
  relatedArtifactId: uuid("related_artifact_id").references(() => agentArtifacts.id, { onDelete: "set null" }),
  status: founderDecisionStatusEnum("status").notNull().default("proposed"),
  reviewDate: timestamp("review_date", { withTimezone: true }),
  // Set only through the existing, approved Brain promotion workflow — never automatic. Null means never promoted.
  promotedToBrainAt: timestamp("promoted_to_brain_at", { withTimezone: true }),
  supersededByDecisionId: uuid("superseded_by_decision_id"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "founder_decisions_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  foreignKey({
    name: "founder_decisions_superseded_by_fk",
    columns: [t.supersededByDecisionId],
    foreignColumns: [t.id],
  }).onDelete("set null"),
  index("founder_decisions_org_status_idx").on(t.organizationId, t.status),
]);

/**
 * A lightweight executive goal — current value is always DERIVED live from
 * Analytics OS via `metricKey` (validated against the metric registry at
 * write time, never a DB FK — the registry is in-code, the identical
 * judgment every Analytics OS dimension/metric reference already makes),
 * never duplicated/stored here. `relatedSalesTargetId` lets a goal
 * REFERENCE an existing Sales OS target instead of re-defining the same
 * objective — Sales targets remain Sales OS's own canonical truth.
 */
export const founderGoals = pgTable("founder_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  title: text("title").notNull(),
  metricKey: text("metric_key").notNull(),
  targetValue: numeric("target_value", { precision: 14, scale: 2 }).notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: founderGoalStatusEnum("status").notNull().default("active"),
  relatedSalesTargetId: uuid("related_sales_target_id").references(() => salesTargets.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "founder_goals_workspace_org_fk",
    columns: [t.workspaceId, t.organizationId],
    foreignColumns: [workspaces.id, workspaces.organizationId],
  }).onDelete("restrict"),
  index("founder_goals_org_status_idx").on(t.organizationId, t.status),
]);

// =============================================================================
// Jarvis secure phone control — inbound founder call sessions and commands
// =============================================================================
// Four tables, each justified against a requirement of the phone-control lane
// (platform/docs/JARVIS_PHONE_CONTROL.md):
//
//   `jarvis_call_sessions`        the stateful conversation (§4)
//   `jarvis_call_transcript_turns` partial + final speech, redacted (§3)
//   `jarvis_phone_commands`        the structured command draft (§5)
//   `jarvis_voice_webhook_events`  provider-event idempotency (§11)
//
// This module deliberately adds NO approval, project, task, execution, or job
// table. A confirmed low-risk command becomes a real `projects` row through
// the existing Office directive intake; a gated one stops at a decision on its
// own `jarvis_phone_commands` row and only becomes a project after a human
// decides it inside an authenticated session. There is exactly one
// orchestration system and this is not it — see
// `src/lib/office/directive-intake.ts`.
//
// No column in these tables ever holds raw speech, a caller's full phone
// number, or a verification passcode: transcripts are redacted by
// `src/lib/voice/redaction.ts` before insertion, and a caller is identified by
// its last four digits plus a match flag, never by the number itself.

/** Outbound is the existing two-minute founder notification call; inbound is the new command lane. Both are recorded so one screen shows every call Jarvis was part of. */
export const jarvisCallDirectionEnum = pgEnum("jarvis_call_direction", ["inbound", "outbound"]);

/** What the call itself was for. Keeps the pre-existing notification mode distinguishable from command capture forever. */
export const jarvisCallPurposeEnum = pgEnum("jarvis_call_purpose", ["founder_notification", "founder_command"]);

export const jarvisCallSessionStatusEnum = pgEnum("jarvis_call_session_status", [
  "active",
  "completed",
  "failed",
  /** The caller was not the enrolled founder number, or verification was exhausted. No command may exist under this session. */
  "refused",
]);

/** Caller ID alone never reaches `verified` — see src/lib/voice/founder-verification.ts. */
export const jarvisCallVerificationStateEnum = pgEnum("jarvis_call_verification_state", ["unverified", "verified", "failed"]);

export const jarvisCommandRiskLevelEnum = pgEnum("jarvis_command_risk_level", ["low", "medium", "high", "critical"]);

export const jarvisCommandConfirmationStatusEnum = pgEnum("jarvis_command_confirmation_status", [
  "pending",
  "confirmed",
  "declined",
  "expired",
]);

/**
 * The honest lifecycle of a spoken command. Every terminal state names what
 * actually happened; there is no state that means "probably fine".
 */
export const jarvisCommandDispatchStateEnum = pgEnum("jarvis_command_dispatch_state", [
  /** Captured, read back, not yet confirmed by the founder on the call. */
  "awaiting_confirmation",
  /** Confirmed and gated: waiting on a human decision inside an authenticated session. */
  "awaiting_approval",
  /**
   * A dispatch is IN FLIGHT — claimed by exactly one caller, creating real
   * records right now.
   *
   * This state is what actually closes the duplicate-dispatch race. A guarded
   * increment alone only stops two callers holding the SAME revision; a
   * request arriving while the winner is still inside
   * `createDirectiveProject` (which runs an LLM plan plus a long chain of
   * writes, and may take a minute) would re-read the bumped revision, see a
   * still-dispatchable state, and claim again — two projects, two sets of
   * launched agents, from one approval. Moving the row here means a later
   * reader has nothing to claim.
   *
   * `dispatch_started_at` bounds it: a process that dies mid-dispatch would
   * otherwise wedge the command forever, so the claim may be taken over once
   * the lease is provably stale.
   */
  "dispatching",
  /** A human declined it in the Office. Nothing was started. */
  "declined",
  /** A real Office directive project exists and the first handoff was dispatched. */
  "directive_created",
  /** The founder said no during the read-back. */
  "cancelled",
  /** Dispatch was attempted and genuinely failed; `failure_code` says why. Never silently retried into a duplicate. */
  "failed",
]);

export const jarvisWebhookProcessingStatusEnum = pgEnum("jarvis_webhook_processing_status", [
  "processed",
  "ignored",
  "failed",
]);

/**
 * One row per call. This is what makes the conversation stateful: every
 * webhook turn resolves its session by `(provider, provider_call_id)`, reads
 * the verification state and the open command draft, and advances them —
 * rather than replaying a one-way script.
 */
export const jarvisCallSessions = pgTable("jarvis_call_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** The LYNQ account the call acts as. RESTRICT, not SET NULL: a call session without an actor could never be audited or authorized after the fact. */
  founderUserId: uuid("founder_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  direction: jarvisCallDirectionEnum("direction").notNull(),
  purpose: jarvisCallPurposeEnum("purpose").notNull(),
  provider: text("provider").notNull().default("vapi"),
  providerCallId: text("provider_call_id").notNull(),
  /**
   * Deliberately NOT the caller's number. Four digits is enough for a founder
   * to recognize their own call in the UI and enough for an investigation to
   * correlate one, and is not a re-usable identifier if this table leaks.
   */
  callerNumberLastFour: text("caller_number_last_four"),
  /** Whether the caller ID matched the enrolled founder number. A necessary precondition, never sufficient on its own. */
  callerNumberMatched: boolean("caller_number_matched").notNull().default(false),
  status: jarvisCallSessionStatusEnum("status").notNull().default("active"),
  verificationState: jarvisCallVerificationStateEnum("verification_state").notNull().default("unverified"),
  verificationAttempts: integer("verification_attempts").notNull().default(0),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  /** Honest, provider-reported delivery state for the call itself (queued/ringing/in-progress/ended). Free text: the provider's vocabulary is not ours to enumerate. */
  deliveryStatus: text("delivery_status"),
  endedReason: text("ended_reason"),
  /** Set only when this lane itself failed (not when the founder simply hung up). Drives the visible failure state in Jarvis. */
  failureCode: text("failure_code"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  /** The provider's own end-of-call transcript, redacted. Convenience for review; the per-turn rows remain the record. */
  redactedSummaryTranscript: text("redacted_summary_transcript"),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  // The idempotency anchor for every webhook: a retried call event resolves
  // the same session instead of opening a second one.
  unique("jarvis_call_sessions_provider_call_unique").on(t.provider, t.providerCallId),
  // Enables the composite tenant FK from both child tables below — the
  // established `projects_id_org_unique` pattern.
  unique("jarvis_call_sessions_id_org_unique").on(t.id, t.organizationId),
  index("jarvis_call_sessions_org_started_idx").on(t.organizationId, t.startedAt),
  index("jarvis_call_sessions_org_status_idx").on(t.organizationId, t.status),
]);

/** Who was speaking. `founder` is whoever is on the call; the row is only ever trusted after `verification_state = 'verified'`. */
export const jarvisTranscriptRoleEnum = pgEnum("jarvis_transcript_role", ["founder", "jarvis"]);

/**
 * Partial and final speech, in order. Both are kept: a partial is what makes
 * the live Jarvis screen feel real while a call is still running, and a final
 * is what the command draft is built from. Every `redacted_text` has already
 * passed through `redactSensitiveText` — there is no raw column.
 */
export const jarvisCallTranscriptTurns = pgTable("jarvis_call_transcript_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  callSessionId: uuid("call_session_id").notNull(),
  sequence: integer("sequence").notNull(),
  role: jarvisTranscriptRoleEnum("role").notNull(),
  isFinal: boolean("is_final").notNull(),
  redactedText: text("redacted_text").notNull(),
  /** Which redaction rules fired, e.g. ["secret"]. Lets the founder see that something was removed without ever storing what it was. */
  redactedKinds: jsonb("redacted_kinds").notNull().default([]),
  spokenAt: timestamp("spoken_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "jarvis_call_transcript_turns_session_org_fk",
    columns: [t.callSessionId, t.organizationId],
    foreignColumns: [jarvisCallSessions.id, jarvisCallSessions.organizationId],
  }).onDelete("cascade"),
  // Second idempotency layer: even if two provider retries somehow pass the
  // event-level dedup, the same turn cannot be written twice.
  unique("jarvis_call_transcript_turns_session_sequence_unique").on(t.callSessionId, t.sequence),
  index("jarvis_call_transcript_turns_session_idx").on(t.callSessionId, t.sequence),
]);

/**
 * The structured command a conversation became — the eight required fields,
 * the risk decision, the confirmation, and the honest dispatch outcome.
 *
 * `project_id` is a plain nullable reference (the identical judgment
 * `workflow_executions.projectId` and `founder_decisions.relatedProjectId`
 * already make): tenant safety is enforced at the application layer, which
 * re-fetches by id AND organization_id on every read.
 */
export const jarvisPhoneCommands = pgTable("jarvis_phone_commands", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  callSessionId: uuid("call_session_id").notNull(),
  requestedOutcome: text("requested_outcome").notNull(),
  /** The company or person the work is about, when the founder named one. Never inferred. */
  targetName: text("target_name"),
  constraints: jsonb("constraints").notNull().default([]),
  requiredIntegrations: jsonb("required_integrations").notNull().default([]),
  proposedSteps: jsonb("proposed_steps").notNull().default([]),
  missingInformation: jsonb("missing_information").notNull().default([]),
  riskLevel: jarvisCommandRiskLevelEnum("risk_level").notNull(),
  requiresApproval: boolean("requires_approval").notNull(),
  gatedCategories: jsonb("gated_categories").notNull().default([]),
  riskReasons: jsonb("risk_reasons").notNull().default([]),
  /** True when the caller used language intended to skip the gate. Recorded, audited, and never honored. */
  overrideAttempted: boolean("override_attempted").notNull().default(false),
  /** Exactly what Jarvis read back on the call, so the Office shows the founder the same words they confirmed. */
  readbackText: text("readback_text").notNull(),
  confirmationStatus: jarvisCommandConfirmationStatusEnum("confirmation_status").notNull().default("pending"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  dispatchState: jarvisCommandDispatchStateEnum("dispatch_state").notNull().default("awaiting_confirmation"),
  /** Set only by a real human decision made inside an authenticated session — never by anything spoken on the call. */
  approvalDecidedByUserId: uuid("approval_decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvalDecidedAt: timestamp("approval_decided_at", { withTimezone: true }),
  approvalDecisionNote: text("approval_decision_note"),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  /** Machine-readable reason a dispatch genuinely failed. Never null while `dispatch_state = 'failed'`. */
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  dispatchAttempts: integer("dispatch_attempts").notNull().default(0),
  /** When the in-flight dispatch was claimed. Bounds `dispatching` so a died-mid-dispatch command can be taken over rather than wedged forever. */
  dispatchStartedAt: timestamp("dispatch_started_at", { withTimezone: true }),
  /**
   * Derived from the call and the confirmed content, not random: a retried
   * confirmation for the same command hashes identically and is rejected by
   * this constraint instead of opening a second project.
   */
  idempotencyKey: text("idempotency_key").notNull(),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  foreignKey({
    name: "jarvis_phone_commands_session_org_fk",
    columns: [t.callSessionId, t.organizationId],
    foreignColumns: [jarvisCallSessions.id, jarvisCallSessions.organizationId],
  }).onDelete("cascade"),
  unique("jarvis_phone_commands_idempotency_unique").on(t.organizationId, t.idempotencyKey),
  // At most ONE draft per call may be awaiting confirmation. Without this,
  // two concurrent `capture_command` events with different content both saw
  // no open row, derived different idempotency keys, and both inserted — and
  // only the newest was ever read or expired, leaving the other stuck on an
  // ended call forever.
  uniqueIndex("jarvis_phone_commands_one_open_per_call")
    .on(t.callSessionId)
    .where(sql`${t.dispatchState} = 'awaiting_confirmation'`),
  index("jarvis_phone_commands_session_idx").on(t.callSessionId),
  index("jarvis_phone_commands_org_state_idx").on(t.organizationId, t.dispatchState),
]);

/**
 * Provider-event idempotency, modelled directly on
 * `communication_provider_events` — the precedent this codebase already set
 * for "a webhook may be delivered more than once and must never act twice".
 *
 * `organization_id` is nullable because an event can arrive before (or
 * without) a resolvable tenant — a forged or misrouted delivery still gets
 * recorded as seen, and still cannot be replayed.
 */
export const jarvisVoiceWebhookEvents = pgTable("jarvis_voice_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("vapi"),
  /** Derived by `normalizeVapiEvent` — content-addressed, because Vapi does not send a unique id on every message type. */
  externalEventId: text("external_event_id").notNull(),
  eventType: text("event_type").notNull(),
  providerCallId: text("provider_call_id"),
  callSessionId: uuid("call_session_id").references(() => jarvisCallSessions.id, { onDelete: "set null" }),
  processingStatus: jarvisWebhookProcessingStatusEnum("processing_status").notNull(),
  failureCode: text("failure_code"),
  /**
   * What the assistant was told to say for this event, so a provider retry can
   * be answered with the SAME words rather than with nothing.
   *
   * Vapi reads a tool result out of the response body. A retry that lost the
   * idempotency claim used to receive a bare acknowledgement, which carries no
   * tool result at all — so a `confirm_command` that took longer than the
   * provider's timeout left the assistant with no answer while a real project
   * was being created behind it. Recording the answer is what makes "handled
   * exactly once" and "answered every time" both true.
   *
   * Jarvis's own sentence, never the caller's speech, and every field it is
   * built from was redacted before it was stored.
   */
  responseText: text("response_text"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("jarvis_voice_webhook_events_dedup_unique").on(t.provider, t.externalEventId),
  index("jarvis_voice_webhook_events_call_idx").on(t.providerCallId),
]);

/* ============================================================================
 * Jarvis Telegram control
 * ============================================================================
 * The founder is rarely at the laptop. Telegram gives Jarvis a two-way channel
 * he already has on his phone: he sends a directive, and Jarvis comes back for
 * a decision there rather than waiting for him to open a browser.
 *
 * The security model is the phone lane's, adapted rather than reinvented. A
 * Telegram chat id is not authentication — it is only stable, not secret — so
 * a chat becomes trusted exactly once, through a rotating passcode the founder
 * reads from an authenticated LYNQ session. After that the link IS the second
 * factor, and it can be revoked from the app at any time.
 */
export const jarvisTelegramLinkStatusEnum = pgEnum("jarvis_telegram_link_status", ["active", "revoked"]);

export const jarvisTelegramLinks = pgTable("jarvis_telegram_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** The LYNQ identity this chat acts as. Every action is attributed to it. */
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Telegram's numeric chat id, as a string — it exceeds 32 bits. */
  telegramChatId: text("telegram_chat_id").notNull(),
  telegramUsername: text("telegram_username"),
  status: jarvisTelegramLinkStatusEnum("status").notNull().default("active"),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (t) => [
  // One Telegram account controls at most one LYNQ identity at a time. A
  // revoked row stays for the audit trail and does not block a re-link.
  uniqueIndex("jarvis_telegram_links_active_chat_unique").on(t.telegramChatId).where(sql`${t.status} = 'active'`),
  index("jarvis_telegram_links_org_idx").on(t.organizationId, t.status),
]);

/**
 * Every inbound update, recorded once.
 *
 * Telegram redelivers an update until the webhook answers 200, so "handled
 * exactly once" has to be a database fact rather than an intention — the same
 * reasoning as `jarvis_voice_webhook_events`. Failed link attempts are
 * recorded here too, which is what the pairing attempt budget counts.
 *
 * `organization_id` is nullable because an update can arrive from a chat that
 * belongs to no tenant at all; it is still recorded, and still cannot replay.
 */
export const jarvisTelegramEvents = pgTable("jarvis_telegram_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  /** Telegram's own `update_id`, unique per bot. */
  externalEventId: text("external_event_id").notNull(),
  chatId: text("chat_id"),
  kind: text("kind").notNull(),
  outcome: text("outcome").notNull(),
  /** Redacted before storage — never a passcode, never a full message body. */
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("jarvis_telegram_events_external_unique").on(t.externalEventId),
  index("jarvis_telegram_events_chat_idx").on(t.chatId, t.createdAt),
]);
