import "server-only";
import { createDbClient } from "@/db/client";
import { loadEnv } from "@/lib/env";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { getInvitationPreviewByHash } from "@/lib/invitations/invitations";
import { readInvitationContinuationCookie, loadInvitationContinuationSecret } from "@/lib/invitations/continuation";
import { NoActiveInvitationContextError } from "@/lib/invitations/errors";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import {
  enforceRateLimit,
  deriveRateLimitIdentifier,
  invitationCurrentLookupIpKey,
  invitationCurrentLookupTokenKey,
  INVITATION_ACCEPT_RATE_LIMIT,
} from "@/lib/invitations/rate-limits";

export const dynamic = "force-dynamic";

function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * GET /api/invitations/current
 *
 * Preview of the invitation named by the signed continuation cookie set by
 * `GET /invite/{rawToken}` — no token in the URL at all (Step 4C.1
 * hardening pass). Never reads a token/hash from any URL, query parameter,
 * or request body; the cookie is the only source.
 *
 * 200 response: identical shape to the prior token-in-URL preview endpoint —
 * { "data": { "organizationName": "Acme", "workspaceName": null, "email": "...", "role": "member", "workspaceRole": null, "expiresAt": "..." } }
 *
 * Errors:
 * 404 no_active_invitation — no continuation cookie present (missing, tampered, or its own window expired)
 * 404 invitation_not_available — a cookie IS present, but its invitation is dead (expired/revoked/already accepted/refreshed away)
 * 429 rate_limited
 */
export async function GET(request: Request) {
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
    await enforceRateLimit(limiter, invitationCurrentLookupIpKey(ip), INVITATION_ACCEPT_RATE_LIMIT);
    await enforceRateLimit(limiter, invitationCurrentLookupTokenKey(derivedId), INVITATION_ACCEPT_RATE_LIMIT);

    const preview = await getInvitationPreviewByHash(db, continuation.invitationTokenHash);
    return jsonSuccess(preview);
  } catch (err) {
    return handleRouteError(err);
  }
}
