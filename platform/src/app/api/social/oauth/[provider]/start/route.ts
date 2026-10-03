import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import { loadAuthEnv } from "@/lib/auth/env";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError } from "@/lib/http/responses";
import { beginConnection } from "@/lib/social-os/connections";
import { isSafeSocialRedirectPath, setSocialOAuthCookie } from "@/lib/social-os/oauth/state";
import type { SocialProviderId } from "@/lib/social-os/providers/social/types";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS: SocialProviderId[] = ["meta", "linkedin", "google_ads"];
const SOCIAL_OAUTH_START_RATE_LIMIT = { limit: 10, windowSeconds: 900 };

const querySchema = z.object({ organizationId: z.string().uuid(), brandProfileId: z.string().uuid(), redirectTo: z.string().max(2000).optional() });

/**
 * GET /api/social/oauth/{provider}/start?organizationId=&brandProfileId=&redirectTo=
 * Starts a Connection Center OAuth flow for an authenticated member with
 * `marketing_manage_connections`: signs a single-use state cookie bound to
 * org + brand + actor, then redirects to the provider's consent screen.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  if (!VALID_PROVIDERS.includes(providerParam as SocialProviderId)) return new Response("Not found", { status: 404 });
  const provider = providerParam as SocialProviderId;
  const url = new URL(request.url);
  const rawRedirect = url.searchParams.get("redirectTo");
  const redirectTo = isSafeSocialRedirectPath(rawRedirect) ? rawRedirect : "/";
  let authBaseUrl: string | null = null;
  try {
    const authEnv = loadAuthEnv();
    authBaseUrl = authEnv.AUTH_BASE_URL;
    const query = querySchema.parse({ organizationId: url.searchParams.get("organizationId"), brandProfileId: url.searchParams.get("brandProfileId"), redirectTo: rawRedirect ?? undefined });
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const limiter = new PostgresRateLimiter(db);
    const rate = await limiter.recordAttempt(`social-oauth:start:${user.userId}`, SOCIAL_OAUTH_START_RATE_LIMIT);
    if (!rate.allowed) return new Response("Too many attempts", { status: 429 });

    const { authorizationUrl, cookiePayload } = await beginConnection(db, { organizationId: query.organizationId, brandProfileId: query.brandProfileId, provider, actorUserId: user.userId, redirectTo });
    await setSocialOAuthCookie(cookiePayload, authEnv.AUTH_SECRET, authEnv.AUTH_BASE_URL);
    return Response.redirect(authorizationUrl, 302);
  } catch (err) {
    // A domain refusal (not configured, archived brand…) goes back to the page that asked, with a stable code.
    if (err instanceof DomainRuleViolationError && authBaseUrl) {
      const target = new URL(redirectTo, authBaseUrl);
      target.searchParams.set("social_error", err.reason);
      return Response.redirect(target.toString(), 302);
    }
    return handleRouteError(err);
  }
}
