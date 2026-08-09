import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getSessionCookie, clearSessionCookie } from "@/lib/auth/cookies";
import { validateSessionToken, revokeSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Signs out the current session — deletes the database row immediately
 * (revocation takes effect on the very next request) and clears the
 * cookie client-side. Clearing the cookie alone would be insufficient,
 * since a copied cookie would otherwise remain valid (Module 2 §3, §5).
 */
export async function POST(request: Request) {
  const env = loadEnv();
  const db = createDbClient(env);

  const sessionToken = await getSessionCookie();
  const session = sessionToken ? await validateSessionToken(db, sessionToken) : null;

  if (session) {
    await revokeSession(db, session.id);
    await recordAuditEvent(db, {
      eventType: "logout",
      actorUserId: session.userId,
      targetType: "session",
      targetId: session.id,
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: request.headers.get("user-agent"),
    });
  }

  await clearSessionCookie();

  return new Response(null, { status: 204 });
}
