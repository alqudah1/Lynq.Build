import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { invitations, organizationMemberships, workspaceMemberships, users } from "@/db/schema";
import type { OrganizationRole, WorkspaceRole } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { InvitationNotAvailableError, InvitationEmailMismatchError, type InvitationUnavailableReason } from "./errors";
import { hashInvitationToken, normalizeEmail } from "./tokens";
import { expireInvitationIfNeeded, type InvitationStatus } from "./invitations";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface OrganizationMembershipResult {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

export interface WorkspaceMembershipResult {
  workspaceId: string;
  organizationId: string;
  userId: string;
  role: WorkspaceRole;
}

export type AcceptInvitationOutcome =
  | { outcome: "accepted"; organizationMembership: OrganizationMembershipResult; workspaceMembership: WorkspaceMembershipResult | null }
  | { outcome: "already_member"; organizationMembership: OrganizationMembershipResult; workspaceMembership: WorkspaceMembershipResult | null };

/** `null` means "still genuinely pending and unexpired." Duplicated intentionally from invitations.ts's private copy to avoid a circular import; kept in sync by the shared test suite exercising both paths against the same fixtures. */
function resolveUnavailableReason(status: InvitationStatus, expiresAt: Date): InvitationUnavailableReason | null {
  if (status === "pending" && expiresAt.getTime() > Date.now()) {
    return null;
  }
  if (status === "pending") return "expired";
  if (status === "revoked") return "revoked";
  if (status === "accepted") return "already_used";
  return "expired";
}

interface AcceptResultRow {
  invite_updated_count: string | number;
  organization_id: string | null;
  workspace_id: string | null;
  organization_role: OrganizationRole | null;
  workspace_role: WorkspaceRole | null;
  [key: string]: unknown;
}

/**
 * The heart of Step 4C's transaction requirement: validating invitation
 * state, creating/confirming organization + optional workspace membership,
 * and transitioning the invitation to `accepted` are ONE Postgres statement
 * (a cascade of data-modifying CTEs), not a multi-step application-level
 * transaction — a single statement is inherently all-or-nothing regardless
 * of driver transaction support, which is what actually satisfies "a
 * failure at any point rolls back the entire acceptance" given the
 * neon-http driver's lack of interactive multi-statement transactions.
 *
 * `invite_update` conditionally flips status pending→accepted ONLY if it is
 * still pending and unexpired at the moment this statement executes — this
 * is the real concurrency guard (a conditional UPDATE, the same
 * "lock-and-recheck" pattern already used for the last-owner invariant in
 * Step 4A), not the earlier read in `acceptInvitationByHash` below, which is
 * only used for the email-match check and is never trusted for the actual
 * accept decision. If `invite_update` produces zero rows (a concurrent
 * accept already won, or the state changed between the read and this
 * statement), every downstream CTE — the membership upserts and the audit
 * write — correctly cascades to zero rows too, since each `SELECT ... FROM
 * invite_update` sees the same empty result. No partial acceptance is
 * possible.
 *
 * The membership upserts never downgrade an existing stronger role: `ON
 * CONFLICT ... DO UPDATE` compares a rank of the existing role against the
 * invitation's role and keeps whichever is higher — "never silently
 * downgrade or overwrite a stronger existing role."
 */
async function runAcceptanceStatement(
  db: Db,
  input: { invitationId: string; actorUserId: string }
): Promise<AcceptResultRow | null> {
  const orgMembershipId = randomUUID();
  const workspaceMembershipId = randomUUID();
  const auditId = randomUUID();

  const result = await db.execute<AcceptResultRow>(drizzleSql`
    WITH invite_update AS (
      UPDATE invitations
      SET status = 'accepted', accepted_at = now()
      WHERE id = ${input.invitationId}::uuid AND status = 'pending' AND expires_at > now()
      RETURNING organization_id, workspace_id, role, workspace_role
    ),
    org_membership_upsert AS (
      INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at, updated_at)
      SELECT ${orgMembershipId}, organization_id, ${input.actorUserId}::uuid, role, now(), now()
      FROM invite_update
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        role = CASE
          WHEN (CASE organization_memberships.role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'member' THEN 2 ELSE 1 END)
             >= (CASE excluded.role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'member' THEN 2 ELSE 1 END)
          THEN organization_memberships.role
          ELSE excluded.role
        END,
        updated_at = now()
      RETURNING organization_id, user_id, role
    ),
    workspace_membership_upsert AS (
      INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
      SELECT ${workspaceMembershipId}, workspace_id, ${input.actorUserId}::uuid, workspace_role, now(), now()
      FROM invite_update
      WHERE workspace_id IS NOT NULL AND workspace_role IS NOT NULL
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET
        role = CASE
          WHEN (CASE workspace_memberships.role WHEN 'manager' THEN 3 WHEN 'member' THEN 2 ELSE 1 END)
             >= (CASE excluded.role WHEN 'manager' THEN 3 WHEN 'member' THEN 2 ELSE 1 END)
          THEN workspace_memberships.role
          ELSE excluded.role
        END,
        updated_at = now()
      RETURNING workspace_id, user_id, role
    ),
    audit_write AS (
      INSERT INTO audit_logs (id, organization_id, actor_user_id, event_type, target_type, target_id, metadata)
      SELECT ${auditId}, organization_id, ${input.actorUserId}::uuid, 'invitation_accepted', 'invitation', ${input.invitationId}::uuid,
        jsonb_build_object('organizationRole', role, 'workspaceId', workspace_id, 'workspaceRole', workspace_role)
      FROM invite_update
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM invite_update) AS invite_updated_count,
      (SELECT organization_id FROM invite_update LIMIT 1) AS organization_id,
      (SELECT workspace_id FROM invite_update LIMIT 1) AS workspace_id,
      (SELECT role FROM org_membership_upsert LIMIT 1) AS organization_role,
      (SELECT role FROM workspace_membership_upsert LIMIT 1) AS workspace_role
  `);

  const row = result.rows[0];
  if (!row || Number(row.invite_updated_count) === 0) {
    return null;
  }
  return row;
}

/** Read-only idempotent-retry check: does this actor already hold exactly the membership this invitation would have granted? Used only after the atomic accept attempt found nothing left to do. */
async function tryResolveAlreadyMember(
  db: Db,
  organizationId: string,
  workspaceId: string | null,
  actorUserId: string
): Promise<AcceptInvitationOutcome | null> {
  const [orgMembership] = await db
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, actorUserId)));

  if (!orgMembership) {
    return null;
  }

  let workspaceMembership: WorkspaceMembershipResult | null = null;
  if (workspaceId) {
    const [wm] = await db
      .select({ role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, actorUserId)));
    if (!wm) {
      // Organization membership exists but the workspace piece never landed
      // — not a genuine prior success of THIS invitation; fall through to
      // the caller's failure path rather than claiming idempotent success.
      return null;
    }
    workspaceMembership = { workspaceId, organizationId, userId: actorUserId, role: wm.role };
  }

  return {
    outcome: "already_member",
    organizationMembership: { organizationId, userId: actorUserId, role: orgMembership.role },
    workspaceMembership,
  };
}

/**
 * Core acceptance service, keyed by the invitation's token HASH — never the
 * raw token. This is what the OAuth continuation path (`./continuation.ts`)
 * calls directly after login, since the signed continuation cookie itself
 * only ever carries a hash, never the raw token.
 */
export async function acceptInvitationByHash(
  db: Db,
  input: { tokenHash: string; actorUserId: string }
): Promise<AcceptInvitationOutcome> {
  const [actor] = await db.select({ email: users.email }).from(users).where(eq(users.id, input.actorUserId));
  const actorEmail = actor ? normalizeEmail(actor.email) : null;

  const [invitation] = await db
    .select({
      id: invitations.id,
      organizationId: invitations.organizationId,
      workspaceId: invitations.workspaceId,
      email: invitations.email,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(eq(invitations.tokenHash, input.tokenHash));

  if (!invitation) {
    await recordAuditEvent(db, {
      eventType: "invitation_acceptance_failed",
      actorUserId: input.actorUserId,
      metadata: { reason: "not_found" },
    });
    throw new InvitationNotAvailableError("not_found");
  }

  if (actorEmail !== invitation.email) {
    await recordAuditEvent(db, {
      eventType: "invitation_acceptance_failed",
      actorUserId: input.actorUserId,
      organizationId: invitation.organizationId,
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { reason: "email_mismatch" },
    });
    throw new InvitationEmailMismatchError();
  }

  const accepted = await runAcceptanceStatement(db, { invitationId: invitation.id, actorUserId: input.actorUserId });

  if (accepted) {
    return {
      outcome: "accepted",
      organizationMembership: {
        organizationId: accepted.organization_id!,
        userId: input.actorUserId,
        role: accepted.organization_role!,
      },
      workspaceMembership: accepted.workspace_id
        ? { workspaceId: accepted.workspace_id, organizationId: accepted.organization_id!, userId: input.actorUserId, role: accepted.workspace_role! }
        : null,
    };
  }

  const idempotent = await tryResolveAlreadyMember(db, invitation.organizationId, invitation.workspaceId, input.actorUserId);
  if (idempotent) {
    return idempotent;
  }

  await expireInvitationIfNeeded(db, invitation.id);
  const [current] = await db
    .select({ status: invitations.status, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(eq(invitations.id, invitation.id));

  const reason: InvitationUnavailableReason = current ? resolveUnavailableReason(current.status, current.expiresAt) ?? "already_used" : "not_found";

  await recordAuditEvent(db, {
    eventType: "invitation_acceptance_failed",
    actorUserId: input.actorUserId,
    organizationId: invitation.organizationId,
    targetType: "invitation",
    targetId: invitation.id,
    metadata: { reason },
  });
  throw new InvitationNotAvailableError(reason);
}

/** Public entry point for an already-authenticated caller (`POST /api/invitations/{token}/accept`) — hashes the raw token and delegates to the hash-keyed core. */
export async function acceptInvitation(
  db: Db,
  input: { token: string; actorUserId: string }
): Promise<AcceptInvitationOutcome> {
  const tokenHash = hashInvitationToken(input.token);
  return acceptInvitationByHash(db, { tokenHash, actorUserId: input.actorUserId });
}
