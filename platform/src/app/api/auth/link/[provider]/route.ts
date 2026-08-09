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
import { getSessionCookie } from "@/lib/auth/cookies";
import { validateSessionToken } from "@/lib/auth/session";
import { resolveSafeRedirectTarget } from "@/lib/auth/redirects";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS: OAuthProviderId[] = ["google", "microsoft"];
const OAUTH_SIGNIN_RATE_LIMIT = { limit: 10, windowSeconds: 900 };

function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Starts the authenticated account-linking flow (Step 3 design §6). The
 * only entry point that can ever produce an "intent: link" pre-auth cookie
 * — requires an already-valid session, whose user_id is embedded in the
 * signed cookie so the callback can verify it hasn't changed by the time
 * the flow completes. No UI calls this yet (a settings-page "connect
 * another provider" button is explicitly deferred); it is a fully
 * testable, headless capability in the meantime.
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

  const sessionToken = await getSessionCookie();
  const session = sessionToken ? await validateSessionToken(db, sessionToken) : null;
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const limiter = new PostgresRateLimiter(db);
  const ip = getClientIp(request);
  const rateLimitResult = await limiter.recordAttempt(`oauth:signin:ip:${ip}`, OAUTH_SIGNIN_RATE_LIMIT);
  if (!rateLimitResult.allowed) {
    return new Response("Too many attempts", { status: 429 });
  }

  const providers = getProviderConfigs(authEnv);
  const provider = providers[providerId];

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const nonce = generateNonce();
  const codeChallenge = createS256CodeChallenge(codeVerifier);
  const redirectTo = resolveSafeRedirectTarget(new URL(request.url).searchParams.get("redirectTo"));

  await setPreAuthCookie(
    { provider: providerId, state, codeVerifier, nonce, intent: "link", linkUserId: session.userId, redirectTo },
    authEnv.AUTH_SECRET
  );

  const authorizationUrl = createAuthorizationUrl(provider, { state, codeChallenge, nonce });
  return Response.redirect(authorizationUrl.toString(), 302);
}
