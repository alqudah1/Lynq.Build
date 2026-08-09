import { redirect } from "next/navigation";
import { Suspense } from "react";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { listOrganizationsForUser } from "@/lib/organizations/organizations";
import { InvitationStatusBanner } from "@/components/dashboard/InvitationStatusBanner";

export const dynamic = "force-dynamic";

/**
 * `/app` index (Step 5A). Deliberately does NOT auto-create an
 * organization for a user with none — shows an explicit empty state
 * instead. If the user belongs to at least one organization, redirects to
 * the first one, preserving `?invitation=` (if the OAuth callback attached
 * one) so the banner still renders once landed on the organization's own
 * dashboard home.
 */
export default async function AppIndexPage({ searchParams }: { searchParams: Promise<{ invitation?: string }> }) {
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, "/app");

  const organizations = await listOrganizationsForUser(db, user.userId);

  if (organizations.length > 0) {
    const { invitation } = await searchParams;
    const suffix = invitation === "accepted" || invitation === "failed" ? `?invitation=${invitation}` : "";
    redirect(`/app/${organizations[0].slug}${suffix}`);
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <Suspense fallback={null}>
        <InvitationStatusBanner />
      </Suspense>
      <p className="text-xs uppercase tracking-[0.3em] text-subtle">LYNQ</p>
      <h1 className="font-serif text-3xl italic font-light text-foreground">No organizations yet</h1>
      <p className="max-w-sm text-sm text-muted">
        You don&rsquo;t belong to any organization yet. Ask an existing member to invite you, or check back once an
        invitation has been sent.
      </p>
    </main>
  );
}
