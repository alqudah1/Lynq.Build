import { DomainRuleViolationError } from "@/lib/authz/errors";

/**
 * Invitation-domain error taxonomy (Step 4C). Two families, mirroring the
 * distinction already established in `@/lib/authz/errors`:
 *
 * - `InvitationError` — the invitation resource's own lifecycle/identity
 *   state (a token that can't be used right now, or is being used by the
 *   wrong person). Not an `AuthzError`, because these can be hit by a
 *   caller with no session at all — this is about the invitation, not the
 *   actor's authentication.
 * - Two `DomainRuleViolationError` subclasses (409, matching the existing
 *   Step 4A convention exactly) for actor-vs-invitation authority rules.
 */
export abstract class InvitationError extends Error {
  abstract readonly httpStatus: number;
  abstract readonly code: string;
}

export type InvitationUnavailableReason = "not_found" | "expired" | "revoked" | "already_used";

/**
 * Deliberately IDENTICAL response for a token that doesn't hash-match any
 * row, one that's expired, one that's revoked, and one already accepted —
 * all four are collapsed into one generic 404 (Step 4C requirement: "Return
 * generic responses for invalid, expired, revoked, or consumed tokens where
 * greater detail would aid enumeration"). The specific `internalReason` is
 * carried on the error object for audit-metadata purposes ONLY — never
 * surfaced in the HTTP response body (`handleRouteError` reads only
 * `.code`/`.message`, both fixed and generic here).
 */
export class InvitationNotAvailableError extends InvitationError {
  readonly httpStatus = 404;
  readonly code = "invitation_not_available";
  constructor(public readonly internalReason: InvitationUnavailableReason) {
    super("This invitation link is invalid or no longer available.");
    this.name = "InvitationNotAvailableError";
  }
}

/**
 * The token is genuine and still pending, but the authenticated caller's own
 * email (fetched fresh from their `users` row, never a client-supplied
 * value) does not match the invited address. Distinct from
 * `InvitationNotAvailableError` deliberately — the caller has demonstrated
 * possession of a real, live token, so telling them it's for a different
 * address is normal, expected UX, not an enumeration aid.
 */
export class InvitationEmailMismatchError extends InvitationError {
  readonly httpStatus = 403;
  readonly code = "email_mismatch";
  constructor() {
    super("This invitation was sent to a different email address.");
    this.name = "InvitationEmailMismatchError";
  }
}

/** Fail-closed response when the rate-limit backend itself cannot be reached for an acceptance-path check (Step 4C: "Fail closed for acceptance if the rate-limit backend is unavailable"). */
export class InvitationRateLimitedError extends InvitationError {
  readonly httpStatus = 429;
  readonly code = "rate_limited";
  constructor() {
    super("Too many attempts. Please try again later.");
    this.name = "InvitationRateLimitedError";
  }
}

/** "An admin cannot invite someone as organization owner" — only an owner may assign the owner role via invitation. */
export class AdminCannotInviteOwnerViolationError extends DomainRuleViolationError {
  readonly reason = "unauthorized_role";
  constructor() {
    super("An admin cannot invite a new member as organization owner");
    this.name = "AdminCannotInviteOwnerViolationError";
  }
}

/** Revoking (or otherwise acting on) an invitation that is no longer pending — already accepted, already revoked, or already expired. */
export class InvitationNotPendingViolationError extends DomainRuleViolationError {
  readonly reason = "already_used";
  constructor() {
    super("This invitation is no longer pending");
    this.name = "InvitationNotPendingViolationError";
  }
}

/**
 * No signed continuation cookie is present at all (absent, tampered, or its
 * own 10-minute window expired) — distinct from `InvitationNotAvailableError`,
 * which means a cookie/hash WAS present but points at a dead invitation.
 * Both surface as 404, but the different code aids a future client's UX
 * ("start over from your invitation link" vs. "this invitation is gone")
 * without leaking anything sensitive either way — this error carries no
 * information about any specific invitation at all.
 */
export class NoActiveInvitationContextError extends InvitationError {
  readonly httpStatus = 404;
  readonly code = "no_active_invitation";
  constructor() {
    super("No active invitation found. Please use your invitation link again.");
    this.name = "NoActiveInvitationContextError";
  }
}

/**
 * True for a failure that can never succeed on retry (the invitation is
 * genuinely dead, or the caller is genuinely the wrong person) — false for
 * anything else (an unexpected error, a rate-limit backend outage), which
 * MIGHT succeed if retried once the transient condition clears. Used by the
 * OAuth callback and the `current/accept` route to decide whether the
 * standalone continuation cookie should be cleared (terminal) or preserved
 * for a same-session retry (transient) — Step 4C hardening pass requirement.
 */
export function isTerminalInvitationFailure(err: unknown): boolean {
  return err instanceof InvitationNotAvailableError || err instanceof InvitationEmailMismatchError;
}
