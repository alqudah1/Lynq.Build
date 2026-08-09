import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { invitations, organizations, workspaces, users } from "@/db/schema";
import {
  requireOrganizationMembership,
  requireOrganizationRole,
  requireTenantScopedResource,
  type OrganizationRole,
  type WorkspaceRole,
} from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import {
  AdminCannotInviteOwnerViolationError,
  InvitationNotAvailableError,
  InvitationNotPendingViolationError,
  type InvitationUnavailableReason,
} from "./errors";
import { generateInvitationToken, hashInvitationToken, normalizeEmail, INVITATION_EXPIRY_MS } from "./tokens";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InvitationSummary {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  email: string;
  role: OrganizationRole;
  workspaceRole: WorkspaceRole | null;
  invitedByUserId: string | null;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

/**
 * Display-only enrichment of `InvitationSummary` (Step 5C) — `workspaceName`
 * and `invitedByName` are additive `SELECT`-time joins, not new domain
 * state; no behavior or authorization change. `invitedByName` is `null`
 * whenever the inviting user's row is unavailable (a soft-deleted user, or
 * no inviter recorded) — "invited-by display name when safely available,"
 * never a raw `invitedByUserId` in a UI-facing shape.
 */
export interface InvitationListItem extends InvitationSummary {
  workspaceName: string | null;
  invitedByName: string | null;
}

export interface InvitationPreview {
  organizationName: string;
  workspaceName: string | null;
  email: string;
  role: OrganizationRole;
  workspaceRole: WorkspaceRole | null;
  expiresAt: Date;
}

export interface CreateOrRefreshInvitationInput {
  organizationId: string;
  actorUserId: string;
  email: string;
  role: OrganizationRole;
  workspace?: { workspaceId: string; workspaceRole: WorkspaceRole } | null;
}

export interface CreateOrRefreshInvitationResult {
  invitation: InvitationSummary;
  /** The raw, unhashed token — exists only for this call's return value, to be handed to the email renderer. Never persist or log it. */
  rawToken: string;
  /** True when this call replaced an existing pending invitation to the same email (the atomic expired-pending-refresh behavior), false when it created a brand-new row. */
  refreshed: boolean;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "t" || value === "true";
  return Boolean(value);
}

interface UpsertRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  email: string;
  role: OrganizationRole;
  workspace_role: WorkspaceRole | null;
  invited_by_user_id: string | null;
  status: InvitationStatus;
  expires_at: unknown;
  accepted_at: unknown;
  created_at: unknown;
  was_inserted: unknown;
  [key: string]: unknown;
}

function mapUpsertRow(row: UpsertRow): InvitationSummary {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    workspaceRole: row.workspace_role,
    invitedByUserId: row.invited_by_user_id,
    status: row.status,
    expiresAt: toDate(row.expires_at),
    acceptedAt: row.accepted_at ? toDate(row.accepted_at) : null,
    createdAt: toDate(row.created_at),
  };
}

/**
 * Creates a new pending invitation, OR — if one is already pending for this
 * exact (organization, email) — atomically refreshes it in place: new raw
 * token, new hash, reset expiry, same row. This is ONE statement (a
 * data-modifying CTE cascade: the invitation UPSERT feeds the audit-event
 * INSERT directly via `FROM upsert`), never a separate read-then-write —
 * the required behavior from the schema's own documented plan (§9/§19) and
 * the Step 4C instruction to use the partial unique index
 * (`invitations_org_email_pending_unique`) as the final concurrency guard.
 * Two concurrent calls for the same email serialize on that index's row
 * lock exactly like any other Postgres UPSERT — one becomes the insert, the
 * other the update, both correctly converging on the same single row,
 * never a unique-violation error and never two pending rows.
 *
 * Authority rules enforced before any write: only owners/admins may invite
 * (Step 4A's existing organization-role gate), and an admin may never
 * invite someone as owner (only an owner may) — "assigned roles cannot
 * exceed the inviter's authority," restated concretely since owner/admin
 * are the only two roles permitted to invite at all.
 */
export async function createOrRefreshInvitation(
  db: Db,
  rawSql: RawSql,
  input: CreateOrRefreshInvitationInput
): Promise<CreateOrRefreshInvitationResult> {
  const actorMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  try {
    requireOrganizationRole(actorMembership, ["owner", "admin"]);
  } catch (err) {
    await recordAuditEvent(db, {
      eventType: "authorization_denied",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      metadata: { action: "create_invitation", reason: "insufficient_role" },
    });
    throw err;
  }

  if (actorMembership.role === "admin" && input.role === "owner") {
    await recordAuditEvent(db, {
      eventType: "authorization_denied",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      metadata: { action: "create_invitation", reason: "unauthorized_role" },
    });
    throw new AdminCannotInviteOwnerViolationError();
  }

  if (input.workspace) {
    await requireTenantScopedResource(async () => {
      const [row] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.id, input.workspace!.workspaceId),
            eq(workspaces.organizationId, input.organizationId),
            isNull(workspaces.deletedAt)
          )
        );
      return row;
    }).catch(async (err) => {
      await recordAuditEvent(db, {
        eventType: "authorization_denied",
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        metadata: { action: "create_invitation", reason: "tenant_mismatch" },
      });
      throw err;
    });
  }

  const normalizedEmail = normalizeEmail(input.email);
  const workspaceId = input.workspace?.workspaceId ?? null;
  const workspaceRole = input.workspace?.workspaceRole ?? null;

  const invitationId = randomUUID();
  const auditId = randomUUID();
  const rawToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS);

  const result = await db.execute<UpsertRow>(drizzleSql`
    WITH upsert AS (
      INSERT INTO invitations (id, organization_id, workspace_id, email, role, workspace_role, token_hash, invited_by_user_id, status, expires_at, accepted_at, created_at)
      VALUES (${invitationId}, ${input.organizationId}, ${workspaceId}, ${normalizedEmail}, ${input.role}::organization_role, ${workspaceRole}::workspace_role, ${tokenHash}, ${input.actorUserId}, 'pending', ${expiresAt}, NULL, now())
      ON CONFLICT (organization_id, email) WHERE status = 'pending'
      DO UPDATE SET
        workspace_id = excluded.workspace_id,
        role = excluded.role,
        workspace_role = excluded.workspace_role,
        token_hash = excluded.token_hash,
        invited_by_user_id = excluded.invited_by_user_id,
        expires_at = excluded.expires_at,
        created_at = now()
      RETURNING id, organization_id, workspace_id, email, role, workspace_role, invited_by_user_id, status, expires_at, accepted_at, created_at, (xmax = 0) AS was_inserted
    ),
    audit_write AS (
      INSERT INTO audit_logs (id, organization_id, actor_user_id, event_type, target_type, target_id, metadata)
      SELECT ${auditId}, organization_id, ${input.actorUserId}::uuid,
        CASE WHEN was_inserted THEN 'invitation_created' ELSE 'invitation_refreshed' END,
        'invitation', id,
        jsonb_build_object('email', email, 'role', role, 'workspaceId', workspace_id, 'workspaceRole', workspace_role)
      FROM upsert
      RETURNING 1
    )
    SELECT * FROM upsert
  `);

  const row = result.rows[0];
  if (!row) {
    throw new Error("invitation upsert returned no row");
  }

  return {
    invitation: mapUpsertRow(row),
    rawToken,
    refreshed: !toBool(row.was_inserted),
  };
}

/** Bulk, best-effort transition of any pending-but-past-expiry rows for one organization — keeps listings accurate without a scheduled job. */
async function expireOrganizationInvitationsIfNeeded(db: Db, organizationId: string): Promise<void> {
  await db.execute(
    drizzleSql`UPDATE invitations SET status = 'expired' WHERE organization_id = ${organizationId} AND status = 'pending' AND expires_at < now()`
  );
}

/** Single-row variant, used by the token-lookup and acceptance paths. */
export async function expireInvitationIfNeeded(db: Db, invitationId: string): Promise<void> {
  await db.execute(
    drizzleSql`UPDATE invitations SET status = 'expired' WHERE id = ${invitationId} AND status = 'pending' AND expires_at < now()`
  );
}

/** Only owners/admins may view an organization's invitations (same gate as creating one). */
export async function listOrganizationInvitations(
  db: Db,
  organizationId: string,
  actorUserId: string
): Promise<InvitationListItem[]> {
  const actorMembership = await requireOrganizationMembership(db, organizationId, actorUserId);
  requireOrganizationRole(actorMembership, ["owner", "admin"]);

  await expireOrganizationInvitationsIfNeeded(db, organizationId);

  const rows = await db
    .select({
      id: invitations.id,
      organizationId: invitations.organizationId,
      workspaceId: invitations.workspaceId,
      email: invitations.email,
      role: invitations.role,
      workspaceRole: invitations.workspaceRole,
      invitedByUserId: invitations.invitedByUserId,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      createdAt: invitations.createdAt,
      workspaceName: workspaces.name,
      invitedByName: users.name,
    })
    .from(invitations)
    .leftJoin(workspaces, eq(invitations.workspaceId, workspaces.id))
    .leftJoin(users, eq(invitations.invitedByUserId, users.id))
    .where(eq(invitations.organizationId, organizationId));

  return rows;
}

/**
 * Public preview lookup, keyed by the token HASH — the backing function for
 * both `GET /api/invitations/current` (reads the hash from the signed
 * continuation cookie) and `getInvitationByToken` below (hashes a raw token
 * first). Deliberately returns a minimal shape (no `tokenHash`, no
 * organization/workspace/invitation IDs, no membership data) — only what's
 * needed to present the invitation and decide whether to accept it. A hash
 * that doesn't match any row, or matches one that's expired/revoked/already
 * accepted, all throw the identical `InvitationNotAvailableError` (see that
 * class's own doc comment for why) — this also means an old continuation
 * cookie whose hash was superseded by an invitation refresh (which
 * overwrites `token_hash` in place) fails identically to a nonexistent one,
 * with no special-case logic required.
 */
export async function getInvitationPreviewByHash(db: Db, tokenHash: string): Promise<InvitationPreview> {
  const [row] = await db
    .select({
      id: invitations.id,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      email: invitations.email,
      role: invitations.role,
      workspaceRole: invitations.workspaceRole,
      organizationName: organizations.name,
      workspaceName: workspaces.name,
    })
    .from(invitations)
    .innerJoin(organizations, eq(invitations.organizationId, organizations.id))
    .leftJoin(workspaces, eq(invitations.workspaceId, workspaces.id))
    .where(eq(invitations.tokenHash, tokenHash));

  if (!row) {
    throw new InvitationNotAvailableError("not_found");
  }

  await expireInvitationIfNeeded(db, row.id);

  const reason = resolveUnavailableReason(row.status, row.expiresAt);
  if (reason) {
    throw new InvitationNotAvailableError(reason);
  }

  return {
    organizationName: row.organizationName,
    workspaceName: row.workspaceName,
    email: row.email,
    role: row.role,
    workspaceRole: row.workspaceRole,
    expiresAt: row.expiresAt,
  };
}

/**
 * Thin wrapper over `getInvitationPreviewByHash` for the ONE place a raw
 * token is still ever handled: the single raw-token exchange endpoint
 * (`src/app/invite/[rawToken]/route.ts`), which needs to validate the raw
 * token from the email link before exchanging it for a continuation cookie.
 * No other route ever calls this — every other invitation route operates
 * on the hash from the continuation cookie via `getInvitationPreviewByHash`
 * directly.
 */
export async function getInvitationByToken(db: Db, rawToken: string): Promise<InvitationPreview> {
  return getInvitationPreviewByHash(db, hashInvitationToken(rawToken));
}

/** `null` means "still genuinely pending and unexpired" — the only state acceptance/preview may proceed past. */
function resolveUnavailableReason(status: InvitationStatus, expiresAt: Date): InvitationUnavailableReason | null {
  if (status === "pending" && expiresAt.getTime() > Date.now()) {
    return null;
  }
  if (status === "pending") {
    return "expired";
  }
  if (status === "revoked") {
    return "revoked";
  }
  if (status === "accepted") {
    return "already_used";
  }
  return "expired";
}

export interface RevokeInvitationInput {
  organizationId: string;
  actorUserId: string;
  invitationId: string;
}

/** Only owners/admins may revoke. Revoking an invitation that isn't (or is no longer) pending is a domain-rule violation, not a silent no-op. */
export async function revokeInvitation(db: Db, input: RevokeInvitationInput): Promise<void> {
  const actorMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  try {
    requireOrganizationRole(actorMembership, ["owner", "admin"]);
  } catch (err) {
    await recordAuditEvent(db, {
      eventType: "authorization_denied",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "invitation",
      targetId: input.invitationId,
        metadata: { action: "revoke_invitation", reason: "insufficient_role" },
    });
    throw err;
  }

  const invitation = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select({ id: invitations.id, status: invitations.status, expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(and(eq(invitations.id, input.invitationId), eq(invitations.organizationId, input.organizationId)));
    return row;
  });

  if (invitation.status === "pending" && invitation.expiresAt.getTime() <= Date.now()) {
    await expireInvitationIfNeeded(db, invitation.id);
    throw new InvitationNotPendingViolationError();
  }
  if (invitation.status !== "pending") {
    throw new InvitationNotPendingViolationError();
  }

  await db.update(invitations).set({ status: "revoked" }).where(eq(invitations.id, invitation.id));

  await recordAuditEvent(db, {
    eventType: "invitation_revoked",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "invitation",
    targetId: invitation.id,
  });
}
