import "server-only";
import { timingSafeEqual } from "node:crypto";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { loadAuthEnv } from "@/lib/auth/env";
import { recordAuditEvent } from "@/lib/audit";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { completeConnection } from "@/lib/social-os/connections";
import { isSafeSocialRedirectPath, readAndClearSocialOAuthCookie, type SocialOAuthPayload } from "@/lib/social-os/oauth/state";
import type { SocialProviderId } from "@/lib/social-os/providers/social/types";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS: SocialProviderId[] = ["meta", "linkedin", "google_ads"];

function sameString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function redirectWith(baseUrl: string, path: string, params: Record<string, string>): Response {
  // Defence in depth: the signed payload's path is already validated, but never leave our origin.
  let target = new URL(isSafeSocialRedirectPath(path) ? path : "/", baseUrl);
  if (target.origin !== new URL(baseUrl).origin) target = new URL("/", baseUrl);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return Response.redirect(target.toString(), 302);
}

/** Provider error codes are echoed back only as a short, safe slug — never raw provider text, never a token. */
function safeCode(value: string | null): string {
  return (value ?? "provider_error").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60) || "provider_error";
}

/**
 * GET /api/social/oauth/{provider}/callback?code=&state= (or ?error=&error_description=)
 * Verifies the single-use state cookie (provider, state and the signed-in
 * actor must all match) before touching the database, then exchanges the
 * code and links the discovered accounts. Always ends in a redirect back
 * to the app path that started the flow.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  if (!VALID_PROVIDERS.includes(providerParam as SocialProviderId)) return new Response("Not found", { status: 404 });
  const provider = providerParam as SocialProviderId;

  let authEnv;
  try {
    authEnv = loadAuthEnv();
  } catch {
    return new Response("Service unavailable", { status: 503 });
  }

  let payload: SocialOAuthPayload;
  try {
    payload = await readAndClearSocialOAuthCookie(authEnv.AUTH_SECRET);
  } catch {
    return redirectWith(authEnv.AUTH_BASE_URL, "/", { social_error: "social_oauth_state_invalid" });
  }

  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  if (payload.provider !== provider || !sameString(state, payload.state)) {
    return redirectWith(authEnv.AUTH_BASE_URL, payload.redirectTo, { social_error: "social_oauth_state_invalid" });
  }

  const env = loadEnv();
  const db = createDbClient(env);
  const auditFailure = (code: string) =>
    recordAuditEvent(db, { eventType: "social_connection_failed", actorUserId: payload.actorUserId, organizationId: payload.organizationId, targetType: "marketing_brand_profile", targetId: payload.brandProfileId, metadata: { provider, code } });

  const providerError = url.searchParams.get("error");
  if (providerError) {
    const code = safeCode(providerError);
    await auditFailure(code);
    return redirectWith(authEnv.AUTH_BASE_URL, payload.redirectTo, { social_error: code });
  }

  const code = url.searchParams.get("code");
  if (!code) {
    await auditFailure("missing_code");
    return redirectWith(authEnv.AUTH_BASE_URL, payload.redirectTo, { social_error: "missing_code" });
  }

  try {
    // The grant can only land on the account of the person who started the flow.
    const user = await getAuthenticatedUser(db);
    if (user.userId !== payload.actorUserId) {
      await auditFailure("actor_mismatch");
      return redirectWith(authEnv.AUTH_BASE_URL, payload.redirectTo, { social_error: "social_oauth_state_invalid" });
    }
    const result = await completeConnection(db, { organizationId: payload.organizationId, brandProfileId: payload.brandProfileId, provider, actorUserId: user.userId, code, codeVerifier: payload.codeVerifier });
    return redirectWith(authEnv.AUTH_BASE_URL, payload.redirectTo, { connected: "1", provider, accounts: String(result.accounts.length) });
  } catch (err) {
    // completeConnection audits its own provider failures; authentication/authorization refusals are audited here.
    const reason = err instanceof DomainRuleViolationError ? err.reason : err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string" ? safeCode((err as { code: string }).code) : "connection_failed";
    if (!(err instanceof DomainRuleViolationError)) await auditFailure(reason).catch(() => undefined);
    if (!(err instanceof DomainRuleViolationError)) console.error("[social-oauth] callback failed:", err instanceof Error ? err.name : "unknown error");
    return redirectWith(authEnv.AUTH_BASE_URL, payload.redirectTo, { social_error: reason });
  }
}
