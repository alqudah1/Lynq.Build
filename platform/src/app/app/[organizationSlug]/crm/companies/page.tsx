import { inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users } from "@/db/schema";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listCompaniesForUser } from "@/lib/crm/companies";
import { createCompanyAction } from "@/lib/dashboard/actions/crm";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreateCompanyForm } from "@/components/dashboard/crm/CreateCompanyForm";
import { CompanyRow } from "@/components/dashboard/crm/CompanyRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/companies`);

  let organizationName: string;
  let companies: Awaited<ReturnType<typeof listCompaniesForUser>>;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    companies = await listCompaniesForUser(db, { organizationId: organization.id, actorUserId: user.userId, limit: 200 });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const ownerIds = [...new Set(companies.map((c) => c.ownerUserId).filter((id): id is string => Boolean(id)))];
  const owners = ownerIds.length > 0 ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ownerIds)) : [];
  const ownerNameById = new Map(owners.map((o) => [o.id, o.name ?? o.email]));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "CRM", href: `/app/${organizationSlug}/crm` }, { label: "Companies" }]} />
      <PageHeader title="Companies" />

      <CreateCompanyForm action={createCompanyAction.bind(null, organizationSlug)} />

      {companies.length === 0 ? (
        <EmptyState title="No companies yet." description="Create the first one above." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th className="hidden sm:table-cell">Domain</Th>
              <Th className="hidden md:table-cell">Industry</Th>
              <Th>Lifecycle</Th>
              <Th className="hidden lg:table-cell">Owner</Th>
            </Tr>
          </THead>
          <TBody>
            {companies.map((company) => (
              <CompanyRow key={company.id} organizationSlug={organizationSlug} company={company} ownerName={company.ownerUserId ? (ownerNameById.get(company.ownerUserId) ?? "—") : "—"} />
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
