import "server-only";
import { and, eq, isNull, type Column } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { brainPermissionGrants } from "@/db/schema";
import {
  requireOrganizationMembership,
  requireWorkspaceMembership,
  type OrganizationMembershipRecord,
  type WorkspaceMembershipRecord,
} from "@/lib/authz/helpers";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import type { KnowledgeDomain } from "./knowledge-items";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type BrainCapability =
  | "read"
  | "draft_write"
  | "edit_own_draft"
  | "edit_any_draft"
  | "approve"
  | "archive"
  | "purge"
  | "manage_permissions";

/**
 * ============================================================================
 * Brain authorization — Module 7 (Brain Permissions)
 * ============================================================================
 *
 * REPLACES every temporary organization/workspace-*role*-based stand-in
 * that lived in this file since Module 1. `MODULE_3_BRAIN_ARCHITECTURE.md`
 * §10's fourth, independent gate — the explicit Domain Grant — is now real:
 * every Brain operation evaluates, in order:
 *
 * 1. Authentication (existing, `getAuthenticatedUser`, unchanged)
 * 2. Organization membership (existing, `requireOrganizationMembership`, unchanged)
 * 3. Workspace membership, only if the resource is workspace-scoped (existing, unchanged)
 * 4. An explicit `brain_permission_grants` capability at the *exact* matching
 *    scope (NEW — replaces every "organization owner/admin" / "workspace
 *    manager" hardcoded rule that used to stand in for this gate)
 *
 * No organization or workspace role is ever consulted for a content
 * decision anymore, anywhere in this file — that was always the point of
 * calling those rules "temporary."
 *
 * **Scope resolution** (see `brainPermissionGrants`'s own schema comment
 * for the full reasoning): a grant with `workspace_id IS NULL` governs only
 * organization-scoped content; a grant scoped to a specific workspace
 * governs only that exact workspace's content. Neither crosses into the
 * other. Multiple active grants for the same exact scope combine by union
 * (holding both `read` and `draft_write` grants means both apply).
 *
 * **Denial shape is unchanged from every prior module**: a failure at gate
 * 2 or 3 (membership) is `TenantResourceNotFoundError` (404) via the
 * existing `knowledge_access_denied` audit event, exactly as before. A
 * failure at gate 4 for a READ operation is *also* 404 (still
 * "can't distinguish nonexistent from inaccessible") but now audited as
 * `brain_permission_denied` — a new, distinct event (see `audit.ts`'s own
 * note on why the two are kept separate). A failure at gate 4 for a
 * mutation (create/update/archive/approve) is `InsufficientRoleError`
 * (403), also newly audited as `brain_permission_denied`.
 */

export interface BrainScopeParams {
  organizationId: string;
  workspaceId: string | null;
  domain: KnowledgeDomain;
  classification?: string;
}

export interface BrainAccessContext {
  organizationMembership: OrganizationMembershipRecord;
  workspaceMembership: WorkspaceMembershipRecord | null;
  capabilities: ReadonlySet<BrainCapability>;
}

async function recordAccessDenied(db: Db, input: { action: string; organizationId: string; actorUserId: string; domain?: string; classification?: string; workspaceId?: string | null }): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "knowledge_access_denied",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    // Deliberately never the workspace id itself, never a title/content
    // fragment, never session data — only enough to say what kind of
    // action was denied and in what shape of scope.
    metadata: {
      action: input.action,
      domain: input.domain ?? null,
      classification: input.classification ?? null,
      workspaceScoped: Boolean(input.workspaceId),
    },
  });
}

async function recordBrainPermissionDenied(
  db: Db,
  input: { capability: BrainCapability; organizationId: string; actorUserId: string; domain: string; workspaceId: string | null }
): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "brain_permission_denied",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "brain_permission_grant",
    metadata: {
      capability: input.capability,
      domain: input.domain,
      workspaceScoped: Boolean(input.workspaceId),
    },
  });
}

/**
 * The shared core behind BOTH `resolveEffectiveBrainCapabilities` (human)
 * and `resolveEffectiveBrainCapabilitiesForAgent` (Brain Module 16) — one
 * exact-scope-match query against `brain_permission_grants`, parameterized
 * only by WHICH grantee column to filter on. This is the concrete
 * enforcement of "use the existing Brain capability model, never a second
 * agent permission system": an agent's effective capabilities are resolved
 * by the identical table, identical exact-scope-match semantics, and
 * identical union-of-active-grants logic a human's are — the only
 * difference is which column names the grantee.
 */
async function resolveEffectiveBrainCapabilitiesForGrantee(
  db: Db,
  params: { organizationId: string; domain: KnowledgeDomain; workspaceId: string | null },
  granteeColumn: Column,
  granteeId: string
): Promise<Set<BrainCapability>> {
  const rows = await db
    .select({ capability: brainPermissionGrants.capability })
    .from(brainPermissionGrants)
    .where(
      and(
        eq(brainPermissionGrants.organizationId, params.organizationId),
        eq(brainPermissionGrants.domain, params.domain),
        params.workspaceId ? eq(brainPermissionGrants.workspaceId, params.workspaceId) : isNull(brainPermissionGrants.workspaceId),
        eq(granteeColumn, granteeId),
        isNull(brainPermissionGrants.revokedAt)
      )
    );
  return new Set(rows.map((row) => row.capability));
}

/**
 * Resolves the exact-scope-match union of every active capability the
 * actor holds — the core primitive every function in this file builds on.
 * A pure read: never throws, never audits (callers decide what a missing
 * capability means and how to report it).
 */
export async function resolveEffectiveBrainCapabilities(
  db: Db,
  params: { organizationId: string; domain: KnowledgeDomain; workspaceId: string | null },
  actorUserId: string
): Promise<Set<BrainCapability>> {
  return resolveEffectiveBrainCapabilitiesForGrantee(db, params, brainPermissionGrants.granteeUserId, actorUserId);
}

/**
 * Brain Module 16 (Agent Read API) — the agent-grantee equivalent of
 * `resolveEffectiveBrainCapabilities`, sharing the identical underlying
 * query via `resolveEffectiveBrainCapabilitiesForGrantee`. An agent's
 * `permissionLevel` or `department` (Agent Registry) is NEVER consulted
 * here and never substitutes for a real grant — this function's only
 * input beyond scope is the agent's own id, matching the task's explicit
 * "agent permission level must not substitute for Brain grants" rule.
 */
export async function resolveEffectiveBrainCapabilitiesForAgent(
  db: Db,
  params: { organizationId: string; domain: KnowledgeDomain; workspaceId: string | null },
  agentId: string
): Promise<Set<BrainCapability>> {
  return resolveEffectiveBrainCapabilitiesForGrantee(db, params, brainPermissionGrants.granteeAgentId, agentId);
}

/**
 * The shared engine behind every `requireBrain*Access` function below:
 * gates 2–3 (org/workspace membership, unchanged), then gate 4 (the named
 * capability, at the exact matching scope). `denialShape` controls only
 * how a gate-4 failure is reported — `"not_found"` for reads (matching
 * every existing "don't distinguish nonexistent from inaccessible" 404),
 * `"forbidden"` for every mutation (the actor's membership already proved
 * the resource is reachable; the failure is specifically about
 * insufficient capability).
 */
async function requireBrainCapability(
  db: Db,
  params: BrainScopeParams,
  actorUserId: string,
  capability: BrainCapability,
  denialShape: "not_found" | "forbidden"
): Promise<BrainAccessContext> {
  let organizationMembership: OrganizationMembershipRecord;
  try {
    organizationMembership = await requireOrganizationMembership(db, params.organizationId, actorUserId);
  } catch (err) {
    await recordAccessDenied(db, { action: capability, actorUserId, ...params });
    throw err;
  }

  let workspaceMembership: WorkspaceMembershipRecord | null = null;
  if (params.workspaceId) {
    try {
      workspaceMembership = await requireWorkspaceMembership(db, params.workspaceId, actorUserId);
      if (workspaceMembership.organizationId !== params.organizationId) {
        throw new TenantResourceNotFoundError();
      }
    } catch (err) {
      await recordAccessDenied(db, { action: capability, actorUserId, ...params });
      throw err;
    }
  }

  const capabilities = await resolveEffectiveBrainCapabilities(db, params, actorUserId);
  if (!capabilities.has(capability)) {
    await recordBrainPermissionDenied(db, { capability, organizationId: params.organizationId, actorUserId, domain: params.domain, workspaceId: params.workspaceId });
    throw denialShape === "not_found" ? new TenantResourceNotFoundError() : new InsufficientRoleError(`missing required Brain capability: ${capability}`);
  }

  return { organizationMembership, workspaceMembership, capabilities };
}

/**
 * Verifies the actor may currently READ a knowledge item scoped to
 * `organizationId` (and, if provided, `workspaceId`), *and* holds the
 * `read` Domain Grant capability for its domain at that exact scope.
 * `TenantResourceNotFoundError` for every failure mode, including a
 * missing capability — cross-tenant and cross-capability probing must
 * both be indistinguishable from "doesn't exist."
 */
export async function requireBrainReadAccess(db: Db, params: BrainScopeParams, actorUserId: string): Promise<BrainAccessContext> {
  return requireBrainCapability(db, params, actorUserId, "read", "not_found");
}

/** Verifies the actor may CREATE a knowledge item in this scope — requires the `draft_write` capability, exact-scope-matched. */
export async function requireBrainCreateAccess(db: Db, params: BrainScopeParams, actorUserId: string): Promise<BrainAccessContext> {
  return requireBrainCapability(db, params, actorUserId, "draft_write", "forbidden");
}

export type BrainMutateAction = "update" | "archive";

/**
 * Verifies the actor may UPDATE or ARCHIVE an item at this scope.
 * `"archive"` requires the `archive` capability. `"update"` requires
 * `edit_any_draft` (sufficient regardless of authorship), OR
 * `edit_own_draft` — but only when `actorUserId === authorUserId` — the
 * exact distinction Module 1's original temporary stand-in already
 * enforced as a hardcoded author-vs-owner/admin rule, now expressed as two
 * independently-grantable capabilities instead of an implicit role
 * side-effect. Runs its own full gate 2–4 check (no longer takes a
 * pre-resolved `ctx` from a separate prior call — see this module's own
 * design note in MODULE_5_BRAIN_MODULE_7_PERMISSIONS.md for why collapsing
 * to one self-contained call per operation was chosen over ctx-threading).
 */
export async function requireBrainMutateAccess(
  db: Db,
  params: BrainScopeParams,
  authorUserId: string | null,
  actorUserId: string,
  action: BrainMutateAction
): Promise<void> {
  try {
    await requireOrganizationMembership(db, params.organizationId, actorUserId);
  } catch (err) {
    await recordAccessDenied(db, { action, actorUserId, ...params });
    throw err;
  }

  if (params.workspaceId) {
    try {
      const workspaceMembership = await requireWorkspaceMembership(db, params.workspaceId, actorUserId);
      if (workspaceMembership.organizationId !== params.organizationId) {
        throw new TenantResourceNotFoundError();
      }
    } catch (err) {
      await recordAccessDenied(db, { action, actorUserId, ...params });
      throw err;
    }
  }

  const capabilities = await resolveEffectiveBrainCapabilities(db, params, actorUserId);
  const isAuthor = authorUserId !== null && authorUserId === actorUserId;

  const allowed = action === "archive" ? capabilities.has("archive") : capabilities.has("edit_any_draft") || (isAuthor && capabilities.has("edit_own_draft"));

  if (!allowed) {
    await recordBrainPermissionDenied(db, {
      capability: action === "archive" ? "archive" : isAuthor ? "edit_own_draft" : "edit_any_draft",
      organizationId: params.organizationId,
      actorUserId,
      domain: params.domain,
      workspaceId: params.workspaceId,
    });
    throw new InsufficientRoleError(
      action === "update" ? "requires edit_any_draft, or edit_own_draft while you are the item's author" : "requires the archive capability"
    );
  }
}

/**
 * Verifies the actor holds the `approve` capability at this exact scope —
 * the real Domain Grant this whole file's own Module 4 stand-in was always
 * meant to migrate to (`MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md` §4's own
 * Security Considerations named it: "requires `approve`-level Domain
 * Grant"). Unlike `requireBrainMutateAccess`, `approve` is never
 * substitutable by authorship — there is no "approve your own" capability.
 */
export async function requireBrainApproveAccess(db: Db, params: BrainScopeParams, actorUserId: string): Promise<BrainAccessContext> {
  return requireBrainCapability(db, params, actorUserId, "approve", "forbidden");
}

/**
 * ============================================================================
 * Agent-grantee gates — Brain Module 16/17
 * ============================================================================
 *
 * The agent equivalents of `requireBrainReadAccess`/`requireBrainCreateAccess`
 * — deliberately NOT a re-run of gates 2–3 (organization/workspace
 * membership) the human path performs, because those are human-only
 * concepts (`organization_memberships`/`workspace_memberships` both FK to
 * `users.id` only) that structurally do not apply to an agent. An agent's
 * "membership" in an organization IS its own `agents.organization_id`
 * column — no separate membership row exists or is needed. That tenant +
 * eligibility check (does this agent belong to this organization, is it
 * not retired) happens exactly ONCE per request, upstream, in
 * `src/lib/agents/authentication.ts`'s `authenticateAgentFromHeader` —
 * mirroring how human authentication (`getAuthenticatedUser`) also
 * happens once, upstream, before any Brain gate runs. By the time an
 * `agentId` reaches these functions, it is already a trusted, resolved,
 * eligible identity; these functions check ONLY the Brain-domain
 * capability itself, via the identical `brain_permission_grants` table
 * and `resolveEffectiveBrainCapabilitiesForAgent` — never a second,
 * agent-specific permission system.
 *
 * `src/lib/agents/*` depends on this file, never the reverse — these
 * functions take a bare `agentId: string`, not an imported `Agent`/
 * `AgentPrincipal` type, specifically to avoid a circular import between
 * `src/lib/brain/` and `src/lib/agents/`.
 */

async function recordAgentBrainReadDenied(
  db: Db,
  input: { organizationId: string; agentId: string; domain: string; workspaceId: string | null }
): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "agent_brain_read_denied",
    actorAgentId: input.agentId,
    organizationId: input.organizationId,
    targetType: "brain_permission_grant",
    metadata: { domain: input.domain, workspaceScoped: Boolean(input.workspaceId) },
  });
}

async function recordAgentBrainWriteDenied(
  db: Db,
  input: { organizationId: string; agentId: string; capability: BrainCapability; domain: string; workspaceId: string | null }
): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "agent_brain_write_denied",
    actorAgentId: input.agentId,
    organizationId: input.organizationId,
    targetType: "brain_permission_grant",
    metadata: { capability: input.capability, domain: input.domain, workspaceScoped: Boolean(input.workspaceId) },
  });
}

/**
 * Verifies the agent holds the `read` capability at this exact scope.
 * Always `TenantResourceNotFoundError` (404) on failure — identical
 * "cannot distinguish nonexistent from inaccessible" discipline as the
 * human read gate, never a 403 that would confirm a scope's existence to
 * an agent that can't see it.
 */
export async function requireAgentBrainReadAccess(db: Db, params: BrainScopeParams, agentId: string): Promise<ReadonlySet<BrainCapability>> {
  const capabilities = await resolveEffectiveBrainCapabilitiesForAgent(db, params, agentId);
  if (!capabilities.has("read")) {
    await recordAgentBrainReadDenied(db, { organizationId: params.organizationId, agentId, domain: params.domain, workspaceId: params.workspaceId });
    throw new TenantResourceNotFoundError();
  }
  return capabilities;
}

/**
 * Verifies the agent holds the `draft_write` capability at this exact
 * scope — Brain Module 17's one narrow write path agents are ever
 * authorized through. `InsufficientRoleError` (403), matching the human
 * create gate's own denial shape (a mutation attempt, not a read probe).
 */
export async function requireAgentBrainCreateAccess(db: Db, params: BrainScopeParams, agentId: string): Promise<ReadonlySet<BrainCapability>> {
  const capabilities = await resolveEffectiveBrainCapabilitiesForAgent(db, params, agentId);
  if (!capabilities.has("draft_write")) {
    await recordAgentBrainWriteDenied(db, { organizationId: params.organizationId, agentId, capability: "draft_write", domain: params.domain, workspaceId: params.workspaceId });
    throw new InsufficientRoleError("missing required Brain capability: draft_write");
  }
  return capabilities;
}

export { recordAccessDenied, recordBrainPermissionDenied };
