import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { importProspectsAction } from "@/lib/dashboard/actions/crm";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ImportProspectsForm } from "@/components/dashboard/crm/ImportProspectsForm";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function ImportProspectsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/leads/import`);

  let organizationName: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "CRM", href: `/app/${organizationSlug}/crm` }, { label: "Leads", href: `/app/${organizationSlug}/crm/leads` }, { label: "Import prospects" }]} />
      <PageHeader title="Import prospects" description="Stage reviewed LYNQ discovery results as companies, contacts, and new leads. This never sends outreach or qualifies a lead automatically." />
      <ImportProspectsForm action={importProspectsAction.bind(null, organizationSlug)} />
    </div>
  );
}
