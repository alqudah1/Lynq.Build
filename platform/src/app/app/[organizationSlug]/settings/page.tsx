import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { OrganizationSettingsForm } from "@/components/dashboard/OrganizationSettingsForm";
import { DeleteOrganizationSection } from "@/components/dashboard/DeleteOrganizationSection";

export const dynamic = "force-dynamic";

/**
 * Organization settings (Step 5B). Reachable by any organization member —
 * the update form is shown only for owner/admin, and the deletion section
 * only for owner; a member/viewer sees a read-only view instead. This is
 * a UX convenience only — the real authorization gate is `updateOrganization`
 * / `softDeleteOrganization` themselves, unchanged and untouched, which
 * enforce the same rules regardless of what this page renders.
 */
export default async function OrganizationSettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/settings`);

  let organizationName: string;
  let organizationSlugValue: string;
  let role: string;
  try {
    const { organization, membership } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    organizationSlugValue = organization.slug;
    role = membership.role;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) {
      notFound();
    }
    throw err;
  }

  const canUpdate = role === "owner" || role === "admin";
  const canDelete = role === "owner";

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Settings" }]} />
      <header>
        <h1 className="font-serif text-3xl italic font-light text-foreground">Organization settings</h1>
      </header>

      {canUpdate ? (
        <OrganizationSettingsForm organizationSlug={organizationSlug} name={organizationName} slug={organizationSlugValue} />
      ) : (
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-[0.1em] text-subtle">Organization name</dt>
            <dd className="text-foreground">{organizationName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.1em] text-subtle">Slug</dt>
            <dd className="text-foreground">{organizationSlugValue}</dd>
          </div>
          <p className="text-xs text-subtle">Only owners and admins can change these settings.</p>
        </dl>
      )}

      {canDelete ? (
        <section className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Danger zone</h2>
          <DeleteOrganizationSection organizationSlug={organizationSlug} organizationName={organizationName} />
        </section>
      ) : null}
    </div>
  );
}
