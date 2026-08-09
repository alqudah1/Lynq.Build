import "server-only";
import { createDbClient } from "@/db/client";
import { loadEnv } from "@/lib/env";
import { handleRouteError } from "@/lib/http/responses";
import { getInvitationByToken } from "@/lib/invitations/invitations";
import { hashInvitationToken } from "@/lib/invitations/tokens";
import { setInvitationContinuationCookie, loadInvitationContinuationSecret } from "@/lib/invitations/continuation";
import { InvitationRateLimitedError } from "@/lib/invitations/errors";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import {
  enforceRateLimit,
  deriveRateLimitIdentifier,
  invitationExchangeIpKey,
  invitationExchangeTokenKey,
  INVITATION_ACCEPT_RATE_LIMIT,
} from "@/lib/invitations/rate-limits";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ rawToken: string }> };

function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Every response from this route — success or failure — carries these two headers (Step 4C.1 requirement): never cached, and never leaked to a next-hop site via the Referer header. */
function cleanRedirect(request: Request, status?: string): Response {
  const target = new URL("/invite", request.url);
  if (status) target.searchParams.set("status", status);
  return new Response(null, {
    status: 303,
    headers: {
      Location: target.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * GET /invite/{rawToken}
 *
 * The ONLY place a raw invitation token is ever handled after the email
 * link itself (Step 4C.1 hardening pass) — "raw token handling exists only
 * in the one exchange endpoint." Validates the token, exchanges it for a
 * signed, HttpOnly continuation cookie (carrying only the token's hash),
 * and redirects to the clean, token-free `/invite` landing. No response
 * from this route — success or failure — ever contains the raw token, a
 * hash, or any token-derived value in its body, headers, or redirect
 * target.
 *
 * `Cache-Control: no-store` and `Referrer-Policy: no-referrer` are set on
 * every response, per the hardening pass requirement — a cache or an
 * outbound Referer header are both real places the raw-token URL could
 * otherwise leak beyond this one request.
 *
 * 303 redirect to `/invite` on success, or `/invite?status=unavailable` for
 * any invalid/expired/revoked/already-accepted token (or any unexpected
 * error) — deliberately generic and identical in every case, exactly like
 * the prior `GET /api/invitations/{token}` preview endpoint's own
 * collapsed-response behavior. A rate-limit failure returns `429
 * rate_limited` directly (the standard JSON error envelope), not a
 * redirect, matching every other rate-limited endpoint in this codebase.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { rawToken } = await params;

  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const limiter = new PostgresRateLimiter(db);
    const ip = getClientIp(request);
    const secret = loadInvitationContinuationSecret();

    // Never the raw token or its plain hash as a rate-limit key — a
    // separately HMAC-derived, purpose-labeled identifier only (see
    // `deriveRateLimitIdentifier`'s own doc comment for why).
    const derivedId = deriveRateLimitIdentifier(rawToken, secret);
    await enforceRateLimit(limiter, invitationExchangeIpKey(ip), INVITATION_ACCEPT_RATE_LIMIT);
    await enforceRateLimit(limiter, invitationExchangeTokenKey(derivedId), INVITATION_ACCEPT_RATE_LIMIT);

    await getInvitationByToken(db, rawToken);
    await setInvitationContinuationCookie(hashInvitationToken(rawToken), secret);

    return cleanRedirect(request);
  } catch (err) {
    if (err instanceof InvitationRateLimitedError) {
      return handleRouteError(err);
    }
    return cleanRedirect(request, "unavailable");
  }
}
