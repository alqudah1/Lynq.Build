import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import { loadAuthEnv, AuthEnvValidationError } from "@/lib/auth/env";
import { getProviderConfigs, createAuthorizationUrl, type OAuthProviderId } from "@/lib/auth/providers";
import {
  generateState,
  generateCodeVerifier,
  generateNonce,
  createS256CodeChallenge,
  setPreAuthCookie,
} from "@/lib/auth/state";
import { resolveSafeRedirectTarget } from "@/lib/auth/redirects";
import { readInvitationContinuationCookie } from "@/lib/invitations/continuation";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS: OAuthProviderId[] = ["google", "microsoft"];

/** Per Module 2 §11's confirmed starting limit for OAuth sign-in attempts. */
const OAUTH_SIGNIN_RATE_LIMIT = { limit: 10, windowSeconds: 900 };

function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Starts the anonymous OAuth login flow (Step 3 design §5 "Start"). Never
 * implements organization/workspace logic, invitations, or UI — only
 * produces a redirect to the provider's authorization endpoint plus a
 * signed pre-auth cookie.
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
  const limiter = new PostgresRateLimiter(db);
  const ip = getClientIp(request);

  const rateLimitResult = await limiter.recordAttempt(`oauth:signin:ip:${ip}`, OAUTH_SIGNIN_RATE_LIMIT);
  if (!rateLimitResult.allowed) {
    return new Response("Too many attempts", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000)) },
    });
  }

  const providers = getProviderConfigs(authEnv);
  const provider = providers[providerId];

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const nonce = generateNonce();
  const codeChallenge = createS256CodeChallenge(codeVerifier);
  const redirectTo = resolveSafeRedirectTarget(new URL(request.url).searchParams.get("redirectTo"));

  // Invitation-continuation binding (Step 4C hardening pass): if a signed
  // continuation cookie is already present (set by the raw-token exchange
  // endpoint, `/invite/{rawToken}`), fold its token hash into THIS specific
  // pre-auth cookie rather than relying on the standalone cookie alone to
  // survive into the callback. This binds the invitation-continuation
  // intent to this exact state/nonce-protected OAuth attempt — the
  // callback only ever honors an `invitationTokenHash` that arrived inside
  // a pre-auth cookie whose `state` it independently verified against
  // Google/Microsoft's own callback redirect, which a planted/forged cookie
  // cannot satisfy.
  const continuation = await readInvitationContinuationCookie(authEnv.AUTH_SECRET);

  await setPreAuthCookie(
    {
      provider: providerId,
      state,
      codeVerifier,
      nonce,
      intent: "login",
      redirectTo,
      invitationTokenHash: continuation?.invitationTokenHash,
    },
    authEnv.AUTH_SECRET
  );

  const authorizationUrl = createAuthorizationUrl(provider, { state, codeChallenge, nonce });
  return Response.redirect(authorizationUrl.toString(), 302);
}
