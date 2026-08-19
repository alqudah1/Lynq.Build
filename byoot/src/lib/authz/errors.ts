/**
 * Authorization error taxonomy. The base shape (AuthzError, and the two
 * concrete errors below) is copied from platform/src/lib/authz/errors.ts —
 * every error carries the HTTP status it maps to, so a route handler can do
 * `catch (err) { return new Response(..., { status: err.httpStatus }) }`
 * without re-deriving the mapping.
 *
 * Adapted (per LYNQ_ENGINEERING_STANDARD.md Part F — "adapt only what's
 * genuinely product-specific"): platform/'s organization/workspace-specific
 * subclasses (LastOwnerViolationError, SlugAlreadyTakenError, etc.) are not
 * copied — BYOOT has no org/workspace model in this scaffold. In their
 * place: BonaFideConsumerRequiredError, the one new error the VOW gate
 * needs (BYOOT_TRANSFORMATION_PLAN.md Section C).
 */

export abstract class AuthzError extends Error {
  abstract readonly httpStatus: number;
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

export class TenantResourceNotFoundError extends AuthzError {
  readonly httpStatus = 404;
  readonly code = "not_found";
  constructor() {
    super("Resource not found");
    this.name = "TenantResourceNotFoundError";
  }
}

/**
 * The user is authenticated, but has not completed the bona-fide-consumer
 * acknowledgment required before any VOW-tier data (sold prices, price
 * history, historical DOM) can be returned — see
 * src/lib/listings/vow-gate.ts. Deliberately does NOT reveal whether the
 * requested listing has VOW data at all; the message is identical whether
 * the listing exists or not, same "don't leak information via error detail"
 * discipline platform/'s TenantResourceNotFoundError already applies.
 */
export class BonaFideConsumerRequiredError extends AuthzError {
  readonly httpStatus = 403;
  readonly code = "bona_fide_consumer_required";
  constructor() {
    super("This information requires a registered account and a bona fide consumer acknowledgment.");
    this.name = "BonaFideConsumerRequiredError";
  }
}
