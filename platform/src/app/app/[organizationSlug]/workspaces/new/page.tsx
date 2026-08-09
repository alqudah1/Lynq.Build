import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreateWorkspaceForm } from "@/components/dashboard/CreateWorkspaceForm";

export const dynamic = "force-dynamic";

/**
 * Create-workspace form (Step 5B). Only organization owners/admins may
 * create a workspace — `createWorkspace` itself enforces this; a member/
 * viewer sees an explanatory message instead of the form (a UX nicety,
 * not the actual security boundary). The creator automatically becomes
 * the workspace's `manager` — the existing, already-approved Step 4A
 * behavior — no other organization member gains workspace content access
 * merely because it was created.
 */
export default async function NewWorkspacePage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/workspaces/new`);

  let organizationName: string;
  let role: string;
  try {
    const { organization, membership } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    role = membership.role;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) {
      notFound();
    }
    throw err;
  }

  const canCreate = role === "owner" || role === "admin";

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "New workspace" }]} />
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl italic font-light text-foreground">Create a workspace</h1>
        <p className="text-sm text-muted">You&rsquo;ll be added as its manager. No other member gains access automatically.</p>
      </header>
      {canCreate ? (
        <CreateWorkspaceForm organizationSlug={organizationSlug} />
      ) : (
        <p className="text-sm text-muted">Only organization owners and admins can create a workspace.</p>
      )}
    </div>
  );
}
