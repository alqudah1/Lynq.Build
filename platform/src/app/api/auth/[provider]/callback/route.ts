import "server-only";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import { loadAuthEnv, AuthEnvValidationError } from "@/lib/auth/env";
import { getProviderConfigs, type OAuthProviderId } from "@/lib/auth/providers";
import { readAndClearPreAuthCookie } from "@/lib/auth/state";
import { assertStateMatches, resolveProviderIdentity } from "@/lib/auth/callback";
import { completeLogin, completeLink } from "@/lib/auth/account-linking";
import { setSessionCookie, getSessionCookie } from "@/lib/auth/cookies";
import { validateSessionToken } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit";
import { AuthFlowError, IdentityConflictError, TokenExchangeError } from "@/lib/auth/errors";
import { resolveSafeRedirectTarget } from "@/lib/auth/redirects";
import { acceptInvitationByHash } from "@/lib/invitations/acceptance";
import { clearInvitationContinuationCookie } from "@/lib/invitations/continuation";
import { isTerminalInvitationFailure } from "@/lib/invitations/errors";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS: OAuthProviderId[] = ["google", "microsoft"];
const OAUTH_SIGNIN_RATE_LIMIT = { limit: 10, windowSeconds: 900 };

function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function failureRedirect(baseUrl: string, reason: "failed" | "conflict"): Response {
  return Response.redirect(new URL(`/?auth_error=${reason}`, baseUrl).toString(), 302);
}

/** Provider outages (§8) are audited distinctly from an actively invalid/suspicious request. */
function classifyFailureEvent(err: unknown): "oauth_provider_unavailable" | "oauth_login_failure" {
  return err instanceof TokenExchangeError && err.classification === "unavailable"
    ? "oauth_provider_unavailable"
    : "oauth_login_failure";
}

/**
 * Handles both the anonymous-login callback and the authenticated-link
 * callback (distinguished by the pre-auth cookie's own `intent`, never by
 * a client-suppliable query parameter) — Step 3 design §5, §6. Every
 * successful identity mutation (new signup, existing login, explicit
 * link) is written atomically with its own session and/or audit event by
 * account-linking.ts's completeLogin/completeLink (correction pass §5) —
 * this route never issues a session or writes an audit event for those
 * paths itself.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  if (!VALID_PROVIDERS.includes(providerParam as OAuthProviderId)) {
    return new Response("Not found", { status: 404 });
  }
  const providerId = providerParam as OAuthProviderId;

  let authEnv;
  try {
    authEnv = loadAuthEnv();
  } catch (err) {
    if (err instanceof AuthEnvValidationError) {
      console.error("[auth] environment validation failed:", err.missingOrInvalidKeys);
    }
    return new Response("Service unavailable", { status: 503 });
  }

  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const limiter = new PostgresRateLimiter(db);

  const url = new URL(request.url);
  const queryState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const ipAddress = getClientIp(request);
  const userAgent = request.headers.get("user-agent");

  // Read and clear the pre-auth cookie first — single-use, regardless of
  // what happens next (Step 3 design §5 step 6, §7).
  let payload;
  try {
    payload = await readAndClearPreAuthCookie(authEnv.AUTH_SECRET);
  } catch (err) {
    await recordAuditEvent(db, {
      eventType: "oauth_login_failure",
      metadata: { provider: providerId, reason: (err as AuthFlowError).reason ?? "unknown" },
      ipAddress,
      userAgent,
    });
    return failureRedirect(authEnv.AUTH_BASE_URL, "failed");
  }

  if (payload.provider !== providerId) {
    await recordAuditEvent(db, {
      eventType: "oauth_login_failure",
      metadata: { provider: providerId, reason: "provider_mismatch" },
      ipAddress,
      userAgent,
    });
    return failureRedirect(authEnv.AUTH_BASE_URL, "failed");
  }

  try {
    assertStateMatches(payload.state, queryState);
  } catch (err) {
    await recordAuditEvent(db, {
      eventType: "oauth_login_failure",
      // Never the state value itself — only the fact of a mismatch.
      metadata: { provider: providerId, reason: (err as AuthFlowError).reason },
      ipAddress,
      userAgent,
    });
    return failureRedirect(authEnv.AUTH_BASE_URL, "failed");
  }

  if (!code) {
    await recordAuditEvent(db, {
      eventType: "oauth_login_failure",
      metadata: { provider: providerId, reason: "missing_code" },
      ipAddress,
      userAgent,
    });
    return failureRedirect(authEnv.AUTH_BASE_URL, "failed");
  }

  const ipRateLimit = await limiter.recordAttempt(`oauth:signin:ip:${ipAddress}`, OAUTH_SIGNIN_RATE_LIMIT);
  if (!ipRateLimit.allowed) {
    return new Response("Too many attempts", { status: 429 });
  }

  const providers = getProviderConfigs(authEnv);
  const provider = providers[providerId];

  let identity;
  try {
    identity = await resolveProviderIdentity(provider, { code, codeVerifier: payload.codeVerifier, nonce: payload.nonce });
  } catch (err) {
    // Nonce mismatches are audited without ever including the nonce value
    // itself — AuthFlowError.reason is a fixed machine-readable string
    // ("nonce_mismatch"), never the actual nonce (correction pass §2).
    await recordAuditEvent(db, {
      eventType: classifyFailureEvent(err),
      metadata: { provider: providerId, reason: (err as AuthFlowError).reason ?? "unknown" },
      ipAddress,
      userAgent,
    });
    return failureRedirect(authEnv.AUTH_BASE_URL, "failed");
  }

  const accountRateLimit = await limiter.recordAttempt(
    `oauth:signin:account:${identity.email.toLowerCase()}`,
    OAUTH_SIGNIN_RATE_LIMIT
  );
  if (!accountRateLimit.allowed) {
    return new Response("Too many attempts", { status: 429 });
  }

  // Authenticated linking flow — only reachable via /api/auth/link/[provider].
  if (payload.intent === "link") {
    if (!payload.linkUserId) {
      return failureRedirect(authEnv.AUTH_BASE_URL, "failed");
    }

    const currentSessionToken = await getSessionCookie();
    const currentSession = currentSessionToken ? await validateSessionToken(db, currentSessionToken) : null;

    if (!currentSession || currentSession.userId !== payload.linkUserId) {
      // The session that started the link flow is no longer valid, or
      // doesn't match — never trust payload.linkUserId alone.
      return failureRedirect(authEnv.AUTH_BASE_URL, "failed");
    }

    try {
      await completeLink(db, rawSql, identity, currentSession.userId, { ipAddress, userAgent });
    } catch (err) {
      if (err instanceof IdentityConflictError) {
        await recordAuditEvent(db, {
          eventType: "oauth_link_conflict",
          actorUserId: currentSession.userId,
          targetType: "user",
          targetId: err.matchedUserId,
          metadata: { provider: providerId },
          ipAddress,
          userAgent,
        });
        return failureRedirect(authEnv.AUTH_BASE_URL, "conflict");
      }
      await recordAuditEvent(db, {
        eventType: "oauth_login_failure",
        actorUserId: currentSession.userId,
        metadata: { provider: providerId, reason: "link_failed" },
        ipAddress,
        userAgent,
      });
      return failureRedirect(authEnv.AUTH_BASE_URL, "failed");
    }

    return Response.redirect(new URL(payload.redirectTo, authEnv.AUTH_BASE_URL).toString(), 302);
  }

  // Anonymous login flow — completeLogin atomically handles user/account
  // creation (if needed), session issuance, and the success audit event
  // together (correction pass §5).
  let result;
  try {
    result = await completeLogin(db, rawSql, identity, { ipAddress, userAgent });
  } catch (err) {
    if (err instanceof IdentityConflictError) {
      await recordAuditEvent(db, {
        eventType: "oauth_link_conflict",
        targetType: "user",
        targetId: err.matchedUserId,
        metadata: { provider: providerId },
        ipAddress,
        userAgent,
      });
      return failureRedirect(authEnv.AUTH_BASE_URL, "conflict");
    }
    await recordAuditEvent(db, {
      eventType: "oauth_login_failure",
      metadata: { provider: providerId, reason: "login_transaction_failed" },
      ipAddress,
      userAgent,
    });
    return failureRedirect(authEnv.AUTH_BASE_URL, "failed");
  }

  // New-user invitation continuation (Step 4C, hardened): `invitationTokenHash`
  // only ever reaches here as part of THIS verified pre-auth payload — its
  // presence already proves this OAuth attempt was started specifically to
  // continue an invitation (see the login-initiation route), bound to the
  // state/nonce this callback already checked above. The login itself has
  // ALREADY fully succeeded by this point (session values are computed,
  // about to be persisted) — invitation acceptance is strictly an
  // afterthought that can never roll back or block it: no exception here
  // is allowed to prevent `setSessionCookie`/the success redirect below.
  //
  // Never silently swallowed (Step 4C.1 requirement): the outcome is
  // reflected in the redirect's `invitation` query parameter — `accepted`
  // or `failed`, deliberately generic in public even though
  // `acceptInvitationByHash` itself already audited the specific reason
  // internally. A TERMINAL failure (dead invitation, wrong email) clears
  // the standalone continuation cookie, since retrying cannot help. A
  // TRANSIENT failure (anything unexpected) preserves it, so the
  // now-authenticated user can retry via `POST /api/invitations/current/accept`
  // without a second OAuth round trip.
  let invitationResult: "accepted" | "failed" | null = null;
  if (payload.invitationTokenHash) {
    try {
      await acceptInvitationByHash(db, { tokenHash: payload.invitationTokenHash, actorUserId: result.userId });
      invitationResult = "accepted";
      await clearInvitationContinuationCookie();
    } catch (err) {
      invitationResult = "failed";
      if (isTerminalInvitationFailure(err)) {
        await clearInvitationContinuationCookie();
      }
    }
  }

  await setSessionCookie(result.rawToken, result.session.expiresAt);

  const redirectTo = resolveSafeRedirectTarget(payload.redirectTo);
  const destination = new URL(redirectTo, authEnv.AUTH_BASE_URL);
  if (invitationResult) {
    destination.searchParams.set("invitation", invitationResult);
  }
  return Response.redirect(destination.toString(), 302);
}
