import "server-only";
import { createDbClient } from "@/db/client";
import { loadEnv } from "@/lib/env";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { getSessionCookie } from "@/lib/auth/cookies";
import { requireAuthenticatedUser } from "@/lib/authz/helpers";
import { getInvitationPreviewByHash } from "@/lib/invitations/invitations";
import { acceptInvitationByHash } from "@/lib/invitations/acceptance";
import {
  readInvitationContinuationCookie,
  clearInvitationContinuationCookie,
  loadInvitationContinuationSecret,
} from "@/lib/invitations/continuation";
import { NoActiveInvitationContextError, isTerminalInvitationFailure } from "@/lib/invitations/errors";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import {
  enforceRateLimit,
  deriveRateLimitIdentifier,
  invitationCurrentAcceptIpKey,
  invitationCurrentAcceptTokenKey,
  INVITATION_ACCEPT_RATE_LIMIT,
} from "@/lib/invitations/rate-limits";

export const dynamic = "force-dynamic";

function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * POST /api/invitations/current/accept
 *
 * Accepts the invitation named by the signed continuation cookie — no
 * token in the URL, no token in the request body (Step 4C.1 hardening
 * pass). Two paths, exactly as before, just re-keyed off the cookie
 * instead of a URL token:
 *
 * - **Authenticated**: accepts immediately via `acceptInvitationByHash`.
 *   On success OR on a TERMINAL failure (dead invitation, wrong email),
 *   the continuation cookie is cleared — retrying cannot help either
 *   case. On a TRANSIENT failure (anything unexpected), the cookie is
 *   preserved so the same request can be safely retried.
 * - **Unauthenticated**: the continuation cookie is already set (by the
 *   exchange endpoint) — this just re-validates the invitation is still
 *   viable and reports `{ "status": "oauth_required" }`; the client is
 *   expected to redirect into `/api/auth/{provider}`, which folds this
 *   same continuation into a fresh, state/nonce-protected pre-auth cookie.
 *
 * A replayed accept call after a successful acceptance (the same cookie
 * value resubmitted, e.g. a network retry) resolves idempotently —
 * `acceptInvitationByHash`'s own "already_member" path — never a duplicate
 * membership, never an error.
 *
 * 200 response (authenticated): { "data": { "outcome": "accepted" | "already_member", "organizationMembership": {...}, "workspaceMembership": null } }
 * 200 response (unauthenticated): { "data": { "status": "oauth_required" } }
 *
 * Errors:
 * 403 email_mismatch
 * 404 no_active_invitation — no continuation cookie present
 * 404 invitation_not_available — cookie present, invitation dead
 * 429 rate_limited
 */
export async function POST(request: Request) {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const limiter = new PostgresRateLimiter(db);
    const ip = getClientIp(request);
    const secret = loadInvitationContinuationSecret();

    const continuation = await readInvitationContinuationCookie(secret);
    if (!continuation) {
      throw new NoActiveInvitationContextError();
    }

    const derivedId = deriveRateLimitIdentifier(continuation.invitationTokenHash, secret);
    await enforceRateLimit(limiter, invitationCurrentAcceptIpKey(ip), INVITATION_ACCEPT_RATE_LIMIT);
    await enforceRateLimit(limiter, invitationCurrentAcceptTokenKey(derivedId), INVITATION_ACCEPT_RATE_LIMIT);

    const sessionToken = await getSessionCookie();
    let actorUserId: string | null = null;
    if (sessionToken) {
      try {
        const user = await requireAuthenticatedUser(db, sessionToken);
        actorUserId = user.userId;
      } catch {
        actorUserId = null;
      }
    }

    if (!actorUserId) {
      await getInvitationPreviewByHash(db, continuation.invitationTokenHash);
      return jsonSuccess({ status: "oauth_required" });
    }

    try {
      const outcome = await acceptInvitationByHash(db, { tokenHash: continuation.invitationTokenHash, actorUserId });
      await clearInvitationContinuationCookie();
      return jsonSuccess(outcome);
    } catch (err) {
      if (isTerminalInvitationFailure(err)) {
        await clearInvitationContinuationCookie();
      }
      throw err;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
