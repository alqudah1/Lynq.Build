import { inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users } from "@/db/schema";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listLeadsForUser } from "@/lib/crm/leads";
import { listContactsForUser } from "@/lib/crm/contacts";
import { listCompaniesForUser } from "@/lib/crm/companies";
import { createLeadAction } from "@/lib/dashboard/actions/crm";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreateLeadForm } from "@/components/dashboard/crm/CreateLeadForm";
import { LeadRow } from "@/components/dashboard/crm/LeadRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/leads`);

  let organizationId: string;
  let organizationName: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationId = organization.id;
    organizationName = organization.name;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [leads, contacts, companies] = await Promise.all([
    listLeadsForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
    listContactsForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
    listCompaniesForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
  ]);

  const ownerIds = [...new Set(leads.map((l) => l.ownerUserId).filter((id): id is string => Boolean(id)))];
  const owners = ownerIds.length > 0 ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ownerIds)) : [];
  const ownerNameById = new Map(owners.map((o) => [o.id, o.name ?? o.email]));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "CRM", href: `/app/${organizationSlug}/crm` }, { label: "Leads" }]} />
      <PageHeader
        title="Leads"
        actions={
          <Link
            href={`/app/${organizationSlug}/crm/leads/import`}
            className="lynq-transition flex min-h-11 items-center rounded-sm bg-foreground px-5 text-xs font-medium uppercase tracking-[0.08em] text-background hover:opacity-90"
          >
            Import prospects
          </Link>
        }
      />

      <CreateLeadForm
        contacts={contacts.map((c) => ({ id: c.id, name: c.displayName }))}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        action={createLeadAction.bind(null, organizationSlug)}
      />

      {leads.length === 0 ? (
        <EmptyState title="No leads yet." description="Create the first one above." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Lead</Th>
              <Th>Status</Th>
              <Th className="hidden sm:table-cell">Score</Th>
              <Th className="hidden md:table-cell">Estimated value</Th>
              <Th className="hidden lg:table-cell">Owner</Th>
            </Tr>
          </THead>
          <TBody>
            {leads.map((lead) => (
              <LeadRow key={lead.id} organizationSlug={organizationSlug} lead={lead} ownerName={lead.ownerUserId ? (ownerNameById.get(lead.ownerUserId) ?? "—") : "—"} />
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
