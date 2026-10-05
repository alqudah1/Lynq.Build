import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { createDbClient } from "@/db/client";
import { organizationMemberships, organizations, users } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { getAuthenticatedUser } from "@/lib/http/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/social/telegram/whoami — shows the signed-in user only their own
 * LYNQ email and organizations, so TELEGRAM_APPROVER_EMAIL (and, if needed,
 * TELEGRAM_ORGANIZATION_SLUG) can be set to exactly the right values.
 */
export async function GET() {
  const db = createDbClient(loadEnv());
  let userId: string;
  try {
    userId = (await getAuthenticatedUser(db)).userId;
  } catch {
    return Response.json({ ok: false, error: "Sign in to LYNQ on this site first, then open this link again." }, { status: 401 });
  }
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const orgs = await db
    .select({ slug: organizations.slug, name: organizations.name, role: organizationMemberships.role })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(eq(organizationMemberships.userId, userId), isNull(organizations.deletedAt)));
  return Response.json({
    ok: true,
    TELEGRAM_APPROVER_EMAIL: user?.email ?? null,
    organizations: orgs,
    next: orgs.length ? "Set TELEGRAM_APPROVER_EMAIL in Vercel (Preview) to exactly the email above." : "This account isn't in any organization — sign in with the account you use for LYNQ.",
  });
}
